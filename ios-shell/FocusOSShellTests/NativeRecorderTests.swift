import XCTest
@testable import FocusOSShell

private final class FakeTransport: UploadTransport {
    var uploadOutcome: [String: UploadOutcome] = [:]   // per session, default .ok
    var statusRead: [String: StatusRead] = [:]          // per session, default .failed
    var uploads: [(String, Int)] = []
    var statusReads = 0

    func upload(sessionId: String, index: Int, data: Data, completion: @escaping (UploadOutcome) -> Void) {
        uploads.append((sessionId, index))
        completion(uploadOutcome[sessionId] ?? .ok)
    }

    func readStatus(sessionId: String, completion: @escaping (StatusRead) -> Void) {
        statusReads += 1
        completion(statusRead[sessionId] ?? .failed)
    }
}

final class NativeRecorderTests: XCTestCase {
    private var root: URL!
    private var store: ChunkStore!
    private var transport: FakeTransport!
    private var now = Date(timeIntervalSince1970: 1_800_000_000)
    private var queue: UploadQueue!

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("r3-tests-\(UUID().uuidString)")
        store = ChunkStore(root: root)
        transport = FakeTransport()
        now = Date(timeIntervalSince1970: 1_800_000_000)
        queue = UploadQueue(store: store, transport: transport, now: { [unowned self] in self.now })
        queue.authUserId = "user-1"
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    /// A stopped session holding `chunks` finished chunk files (one ADTS frame each).
    @discardableResult
    private func makeSession(_ sid: String, chunks: Int, startedAt: Double) -> Manifest {
        let m = Manifest(sessionId: sid, userId: "user-1", nextIndex: chunks, startedAt: startedAt, status: "stopped")
        store.save(m)
        for i in 0..<chunks {
            var d = ADTS.header(payload: 20)
            d.append(Data(repeating: UInt8(i), count: 20))
            try? d.write(to: store.chunkURL(sid, i))
        }
        return m
    }

    private func stepOnce() -> StepResult {
        var out: StepResult = .idle
        queue.step { out = $0 }
        return out
    }

    // MARK: ADTS

    func testAdtsHeaderBytesForKnownFrameLength() {
        // payload 100 -> frame 107 = 0x6B; LC (profile 1), 16 kHz (index 8), mono.
        XCTAssertEqual([UInt8](ADTS.header(payload: 100)), [0xFF, 0xF1, 0x60, 0x40, 0x0D, 0x7F, 0xFC])
        // A 300 byte payload crosses into the high length bits: 307 = 0b1_0011_0011.
        XCTAssertEqual([UInt8](ADTS.header(payload: 300)), [0xFF, 0xF1, 0x60, 0x40, 0x26, 0x7F, 0xFC])
    }

    func testCompleteFramesTrimsATornTail() {
        var d = Data()
        for _ in 0..<2 { d.append(ADTS.header(payload: 10)); d.append(Data(repeating: 7, count: 10)) }
        let whole = d.count
        d.append(ADTS.header(payload: 10)); d.append(Data(repeating: 7, count: 4))   // torn
        XCTAssertEqual(ADTS.completeFrames(d).count, whole)
        XCTAssertEqual(ADTS.completeFrames(Data([1, 2, 3])).count, 0)
    }

    // MARK: Round-robin: a stuck session never blocks another

    func testStuckSessionDoesNotBlockAnotherSession() {
        makeSession("stuck", chunks: 2, startedAt: 1)
        makeSession("good", chunks: 2, startedAt: 2)
        transport.uploadOutcome["stuck"] = .server(500)

        var uploadedGood = 0
        for _ in 0..<12 {
            if case .uploaded("good", _) = stepOnce() { uploadedGood += 1 }
            now.addTimeInterval(70)   // past any backoff
            if uploadedGood == 2 { break }
        }
        XCTAssertEqual(uploadedGood, 2, "the good session must finish while the other keeps failing")
        XCTAssertEqual(store.pendingCount(store.load("good")!), 0)
        // The stuck session kept both of its files.
        XCTAssertEqual(store.chunkIndexes("stuck"), [0, 1])
        XCTAssertFalse(store.load("stuck")!.parked == true)
    }

    func testRoundRobinAlternatesBetweenReadySessions() {
        makeSession("a", chunks: 2, startedAt: 1)
        makeSession("b", chunks: 2, startedAt: 2)
        var order: [String] = []
        for _ in 0..<4 { if case .uploaded(let s, _) = stepOnce() { order.append(s) } }
        XCTAssertEqual(order, ["a", "b", "a", "b"])
    }

    // MARK: Parking only after a successful status read

    func testParksOnlyWhenStatusReadSucceedsAndIsNotRecording() {
        makeSession("s", chunks: 1, startedAt: 1)
        transport.uploadOutcome["s"] = .server(500)
        transport.statusRead["s"] = .failed          // the read itself fails: proves nothing

        for _ in 0..<8 { _ = stepOnce(); now.addTimeInterval(70) }
        XCTAssertGreaterThan(transport.statusReads, 0, "after 3 server errors the queue asks the server directly")
        XCTAssertFalse(store.load("s")!.parked == true, "a failed read never parks")

        transport.statusRead["s"] = .status("recording")   // still recording: keep retrying
        for _ in 0..<4 { _ = stepOnce(); now.addTimeInterval(70) }
        XCTAssertFalse(store.load("s")!.parked == true)

        transport.statusRead["s"] = .status("completed")
        var parked = false
        for _ in 0..<4 { if case .parked("s") = stepOnce() { parked = true; break }; now.addTimeInterval(70) }
        XCTAssertTrue(parked)
        let m = store.load("s")!
        XCTAssertEqual(m.parked, true)
        XCTAssertEqual(store.chunkIndexes("s"), [0], "parking keeps the files")
        // A parked session is never attempted again.
        let before = transport.uploads.count
        XCTAssertEqual(stepOnce(), .idle)
        XCTAssertEqual(transport.uploads.count, before)
    }

    func testMissingRowNeedsTwoReadsAtLeastAMinuteApart() {
        makeSession("s", chunks: 1, startedAt: 1)
        transport.uploadOutcome["s"] = .server(500)
        transport.statusRead["s"] = .empty
        var parkedAt: Int?
        for i in 0..<20 {
            if case .parked = stepOnce() { parkedAt = i; break }
            now.addTimeInterval(25)
        }
        XCTAssertNotNil(parkedAt)
        // Two empty reads closer than 60 s must NOT park: at least 3 more steps after the first empty read.
        XCTAssertGreaterThanOrEqual(parkedAt!, 4)
    }

    func testServerErrorsBelowThresholdNeverParkOrAskTheServer() {
        makeSession("s", chunks: 1, startedAt: 1)
        transport.uploadOutcome["s"] = .server(500)
        _ = stepOnce(); now.addTimeInterval(70)
        _ = stepOnce(); now.addTimeInterval(70)
        XCTAssertEqual(transport.statusReads, 0)
        XCTAssertFalse(store.load("s")!.parked == true)
    }

    // MARK: Never delete without 2xx

    func testFileIsDeletedOnlyAfterOk() {
        makeSession("s", chunks: 1, startedAt: 1)
        for outcome in [UploadOutcome.network, .server(500), .server(403), .unauthorized] {
            transport.uploadOutcome["s"] = outcome
            _ = stepOnce()
            now.addTimeInterval(70)
            XCTAssertEqual(store.chunkIndexes("s"), [0], "\(outcome) must keep the file")
            XCTAssertEqual(store.load("s")!.uploadedUpTo, -1)
        }
        transport.uploadOutcome["s"] = .ok
        XCTAssertEqual(stepOnce(), .uploaded("s", 0))
        XCTAssertEqual(store.chunkIndexes("s"), [])
        XCTAssertEqual(store.load("s")!.uploadedUpTo, 0)
    }

    func testNeverUploadsUnderAnotherAccountOrWithoutAToken() {
        makeSession("s", chunks: 1, startedAt: 1)
        queue.authUserId = "someone-else"
        XCTAssertEqual(stepOnce(), .idle)
        XCTAssertTrue(transport.uploads.isEmpty)
        queue.authUserId = "user-1"
        queue.tokenUsable = { false }
        XCTAssertEqual(stepOnce(), .waitingAuth)
        XCTAssertTrue(transport.uploads.isEmpty)
    }

    // MARK: Relaunch recovery

    func testPartFileIsRecoveredIntoAWholeChunkOnRelaunch() throws {
        var m = Manifest(sessionId: "s", userId: "user-1", nextIndex: 2, startedAt: 1, status: "recording")
        store.save(m)
        var part = Data()
        for _ in 0..<3 { part.append(ADTS.header(payload: 12)); part.append(Data(repeating: 9, count: 12)) }
        let whole = part.count
        part.append(ADTS.header(payload: 12)); part.append(Data(repeating: 9, count: 5))   // torn by the kill
        try part.write(to: store.partURL("s", 2))

        store.recover(&m)
        XCTAssertEqual(m.nextIndex, 3)
        XCTAssertEqual(try Data(contentsOf: store.chunkURL("s", 2)).count, whole)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.partURL("s", 2).path))
    }

    func testCleanupRemovesOnlyOldParkedSessions() {
        var old = makeSession("old", chunks: 1, startedAt: 1)
        old.parked = true; old.parkedAt = (now.timeIntervalSince1970 - 8 * 24 * 3600) * 1000
        store.save(old)
        var fresh = makeSession("fresh", chunks: 1, startedAt: 2)
        fresh.parked = true; fresh.parkedAt = (now.timeIntervalSince1970 - 2 * 24 * 3600) * 1000
        store.save(fresh)
        makeSession("live", chunks: 1, startedAt: 0)   // not parked: age alone never deletes it
        store.cleanupParked(olderThan: 7 * 24 * 3600, now: now)
        XCTAssertNil(store.load("old"))
        XCTAssertNotNil(store.load("fresh"))
        XCTAssertNotNil(store.load("live"))
    }

    // MARK: Bridge trust

    func testBridgeTrustChecksTheFrameURL() {
        XCTAssertTrue(ShellConfig.isTrustedAppURL(URL(string: "https://rogerceaser21.github.io/focus-os/app")))
        XCTAssertTrue(ShellConfig.isTrustedAppURL(URL(string: "https://rogerceaser21.github.io/focus-os/preview/")))
        XCTAssertFalse(ShellConfig.isTrustedAppURL(URL(string: "https://rogerceaser21.github.io/other-site/")))
        XCTAssertFalse(ShellConfig.isTrustedAppURL(URL(string: "https://rogerceaser21.github.io/")))
        XCTAssertFalse(ShellConfig.isTrustedAppURL(URL(string: "http://rogerceaser21.github.io/focus-os/")))
        XCTAssertFalse(ShellConfig.isTrustedAppURL(URL(string: "https://evil.example/focus-os/")))
        XCTAssertFalse(ShellConfig.isTrustedAppURL(nil))
    }
}

import Foundation

enum UploadOutcome: Equatable {
    case ok
    case unauthorized
    /// No answer from the server (offline, timeout, cancelled).
    case network
    /// The server answered with an error status.
    case server(Int)
}

enum StatusRead: Equatable {
    case status(String)
    /// The read worked and no row exists for the session.
    case empty
    /// The read itself failed: proves nothing.
    case failed
}

protocol UploadTransport: AnyObject {
    func upload(sessionId: String, index: Int, data: Data, completion: @escaping (UploadOutcome) -> Void)
    func readStatus(sessionId: String, completion: @escaping (StatusRead) -> Void)
}

enum StepResult: Equatable {
    case idle
    case waitingAuth
    case blocked(until: Date)
    case uploaded(String, Int)
    case failed(String)
    case parked(String)
}

/// Per-session upload queues served round-robin, so one stuck session never blocks
/// another. POLICY (mirrors the web recorder, src/lib/meetingRecorder.ts):
///  - a chunk file is deleted ONLY after an HTTP 2xx;
///  - the upload function answers 500 for permanent refusals and ALSO maps a
///    transient database error to "Session not found", so no error text is trusted;
///  - after `parkAfter` consecutive server errors on a session, a DIRECT read of the
///    session row decides: the session is PARKED (uploads stop, files stay, manifest
///    marked) only when that read succeeded and shows status != "recording", or
///    showed no row twice at least `missingConfirm` seconds apart. Anything else keeps
///    retrying with backoff.
/// Not thread-safe: the owner calls it from one serial queue.
final class UploadQueue {
    static let parkAfter = 3
    static let checkEvery: TimeInterval = 20
    static let missingConfirm: TimeInterval = 60
    static let backoffCap: TimeInterval = 60

    let store: ChunkStore
    let transport: UploadTransport
    let now: () -> Date
    var authUserId: String?
    var tokenUsable: () -> Bool = { true }

    private struct S {
        var errors = 0
        var serverErrors = 0
        var retryAt = Date.distantPast
        var lastCheck: Date?
        var emptyFirst: Date?
    }
    private var state: [String: S] = [:]
    private var lastServed: String?

    init(store: ChunkStore, transport: UploadTransport, now: @escaping () -> Date = Date.init) {
        self.store = store
        self.transport = transport
        self.now = now
    }

    /// Chunks waiting for upload, across sessions this user may upload (parked ones excluded).
    func pendingTotal() -> Int {
        store.loadAll().filter(eligible).reduce(0) { $0 + store.pendingCount($1) }
    }

    func earliestRetry() -> Date? {
        let ids = Set(work().map { $0.0.sessionId })
        return state.filter { ids.contains($0.key) }.map { $0.value.retryAt }.min()
    }

    func resetBackoff() {
        for k in state.keys { state[k]?.retryAt = .distantPast }
    }

    private func eligible(_ m: Manifest) -> Bool {
        if m.parked == true { return false }
        if let u = m.userId, u != authUserId { return false }   // never upload under another account
        return true
    }

    private func work() -> [(Manifest, Int)] {
        store.loadAll().filter(eligible).compactMap { m in
            let idx = m.uploadedUpTo + 1
            guard idx < m.nextIndex, FileManager.default.fileExists(atPath: store.chunkURL(m.sessionId, idx).path)
            else { return nil }
            return (m, idx)
        }
    }

    /// Attempt ONE upload for the next ready session (round-robin). The completion
    /// runs on whatever queue the transport calls back on.
    func step(completion: @escaping (StepResult) -> Void) {
        let all = work()
        if all.isEmpty { completion(.idle); return }
        guard tokenUsable() else { completion(.waitingAuth); return }
        let t = now()
        let ids = all.map { $0.0.sessionId }
        let start = lastServed.flatMap { ids.firstIndex(of: $0) }.map { $0 + 1 } ?? 0
        var pick: (Manifest, Int)?
        for k in 0..<all.count {
            let c = all[(start + k) % all.count]
            if (state[c.0.sessionId]?.retryAt ?? .distantPast) <= t { pick = c; break }
        }
        guard let (m, idx) = pick else {
            let until = all.compactMap { state[$0.0.sessionId]?.retryAt }.min() ?? t.addingTimeInterval(1)
            completion(.blocked(until: until))
            return
        }
        lastServed = m.sessionId
        guard let data = try? Data(contentsOf: store.chunkURL(m.sessionId, idx)) else {
            completion(.failed(m.sessionId)); return
        }
        transport.upload(sessionId: m.sessionId, index: idx, data: data) { [self] outcome in
            switch outcome {
            case .ok:
                // The ONLY place a chunk file is deleted.
                try? FileManager.default.removeItem(at: store.chunkURL(m.sessionId, idx))
                if var cur = store.load(m.sessionId) {
                    cur.uploadedUpTo = max(cur.uploadedUpTo, idx)
                    store.save(cur)
                }
                state[m.sessionId] = S()
                completion(.uploaded(m.sessionId, idx))
            case .unauthorized:
                completion(.waitingAuth)
            case .network, .server:
                fail(m.sessionId, outcome, completion)
            }
        }
    }

    private func fail(_ sid: String, _ outcome: UploadOutcome, _ completion: @escaping (StepResult) -> Void) {
        var s = state[sid] ?? S()
        s.errors += 1
        if case .server = outcome { s.serverErrors += 1 }
        s.retryAt = now().addingTimeInterval(min(UploadQueue.backoffCap, pow(2, Double(min(s.errors, 6)))))
        state[sid] = s
        guard s.serverErrors >= UploadQueue.parkAfter else { completion(.failed(sid)); return }
        let t = now()
        if let last = s.lastCheck, t.timeIntervalSince(last) < UploadQueue.checkEvery { completion(.failed(sid)); return }
        state[sid]?.lastCheck = t
        transport.readStatus(sessionId: sid) { [self] read in
            switch read {
            case .status(let st):
                if st != "recording" { park(sid, completion) }
                else { state[sid]?.emptyFirst = nil; completion(.failed(sid)) }
            case .empty:
                let first = state[sid]?.emptyFirst
                if first == nil { state[sid]?.emptyFirst = now(); completion(.failed(sid)) }
                else if now().timeIntervalSince(first!) >= UploadQueue.missingConfirm { park(sid, completion) }
                else { completion(.failed(sid)) }
            case .failed:
                completion(.failed(sid))
            }
        }
    }

    private func park(_ sid: String, _ completion: @escaping (StepResult) -> Void) {
        if var m = store.load(sid) {
            m.parked = true
            m.parkedAt = (now().timeIntervalSince1970 * 1000).rounded()
            store.save(m)
        }
        state.removeValue(forKey: sid)
        completion(.parked(sid))
    }
}

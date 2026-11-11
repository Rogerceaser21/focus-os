import Foundation

/// On-disk state of one native recording session. Pure Foundation: unit-testable
/// without AVAudioEngine (FocusOSShellTests).
struct Manifest: Codable, Equatable {
    var sessionId: String
    var userId: String?
    var nextIndex: Int = 0
    var uploadedUpTo: Int = -1
    var startedAt: Double
    var pausedMs: Double = 0
    var pausedAt: Double?
    /// recording | paused | stopping | stopped | killed
    var status: String
    var sampleRate: Int = 16_000
    /// The server closed this session (or it never existed): uploads stop, the files stay.
    var parked: Bool?
    var parkedAt: Double?
}

/// Files under <root>/<sessionId>/{manifest.json, 00000.aac, ..., 00003.part}.
final class ChunkStore {
    let root: URL
    init(root: URL) {
        self.root = root
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    static func isValidSessionId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 80 && id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }

    func dir(_ sid: String) -> URL { root.appendingPathComponent(sid, isDirectory: true) }
    func manifestURL(_ sid: String) -> URL { dir(sid).appendingPathComponent("manifest.json") }
    func chunkURL(_ sid: String, _ index: Int) -> URL { dir(sid).appendingPathComponent(String(format: "%05d.aac", index)) }
    func partURL(_ sid: String, _ index: Int) -> URL { dir(sid).appendingPathComponent(String(format: "%05d.part", index)) }

    func save(_ m: Manifest) {
        try? FileManager.default.createDirectory(at: dir(m.sessionId), withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(m) else { return }
        try? data.write(to: manifestURL(m.sessionId), options: .atomic)
    }

    func load(_ sid: String) -> Manifest? {
        guard let data = try? Data(contentsOf: manifestURL(sid)) else { return nil }
        return try? JSONDecoder().decode(Manifest.self, from: data)
    }

    func loadAll() -> [Manifest] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return names.compactMap { ChunkStore.isValidSessionId($0) ? load($0) : nil }
            .sorted { ($0.startedAt, $0.sessionId) < ($1.startedAt, $1.sessionId) }
    }

    func chunkIndexes(_ sid: String) -> [Int] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir(sid).path)) ?? []
        return names.compactMap { $0.hasSuffix(".aac") ? Int($0.dropLast(4)) : nil }.sorted()
    }

    func pendingCount(_ m: Manifest) -> Int {
        chunkIndexes(m.sessionId).filter { $0 > m.uploadedUpTo }.count
    }

    func remove(_ sid: String) { try? FileManager.default.removeItem(at: dir(sid)) }

    /// Turn a leftover .part (a killed app) into a whole chunk and repair the counters.
    func recover(_ m: inout Manifest) {
        let sid = m.sessionId
        let part = partURL(sid, m.nextIndex)
        if let data = try? Data(contentsOf: part) {
            let whole = ADTS.completeFrames(data)
            if !whole.isEmpty {
                try? whole.write(to: chunkURL(sid, m.nextIndex), options: .atomic)
                m.nextIndex += 1
            }
            try? FileManager.default.removeItem(at: part)
        }
        if let top = chunkIndexes(sid).last, top >= m.nextIndex { m.nextIndex = top + 1 }
    }

    /// Parked sessions older than `maxAge` are the only thing ever cleaned up by age.
    func cleanupParked(olderThan maxAge: TimeInterval, now: Date) {
        for m in loadAll() where m.parked == true {
            let at = (m.parkedAt ?? m.startedAt) / 1000
            if now.timeIntervalSince1970 - at > maxAge { remove(m.sessionId) }
        }
    }
}

enum ADTS {
    /// 7-byte ADTS header for one raw AAC-LC frame at 16 kHz mono.
    /// profile = objectType - 1 = 1 (LC); sampling index 8 = 16000 Hz; channels 1.
    static func header(payload: Int) -> Data {
        let len = payload + 7
        let profile = 1, freqIdx = 8, chan = 1
        var h = [UInt8](repeating: 0, count: 7)
        h[0] = 0xFF
        h[1] = 0xF1   // MPEG-4, layer 0, no CRC
        h[2] = UInt8((profile << 6) | (freqIdx << 2) | ((chan >> 2) & 1))
        h[3] = UInt8(((chan & 3) << 6) | ((len >> 11) & 3))
        h[4] = UInt8((len >> 3) & 0xFF)
        h[5] = UInt8(((len & 7) << 5) | 0x1F)
        h[6] = 0xFC
        return Data(h)
    }

    /// Keep only whole ADTS frames (a kill can tear the last write).
    static func completeFrames(_ data: Data) -> Data {
        let b = [UInt8](data)
        var pos = 0
        while pos + 7 <= b.count {
            guard b[pos] == 0xFF, (b[pos + 1] & 0xF0) == 0xF0 else { break }
            let len = (Int(b[pos + 3] & 3) << 11) | (Int(b[pos + 4]) << 3) | Int(b[pos + 5] >> 5)
            if len < 7 || pos + len > b.count { break }
            pos += len
        }
        return Data(b[0..<pos])
    }
}

import Foundation
import AVFoundation
import UIKit
import WebKit

/// Native meeting recorder (R3, 2026-11-11).
///
/// WHY: a diagnostic probe proved WKWebView getUserMedia capture stops when the
/// app goes to the background or the screen locks, even with UIBackgroundModes
/// audio and an active AVAudioSession. So the recording runs HERE, in
/// AVAudioEngine, controlled from the web app through the "recorder" script
/// message handler (ShellWebView.swift). The web side keeps the same public API.
///
/// AUDIO: mono, 16 kHz, AAC-LC, ~32 kbps, written as ADTS frames. A chunk is a
/// run of whole ADTS frames; chunk N+1 continues chunk N's stream, so the server
/// composes the recording by plain byte concatenation. A chunk rotates after 157
/// frames (1024 samples each = 10.05 s).
///
/// FILES: Application Support/meeting-chunks/<sessionId>/{manifest.json,
/// 00000.aac, ...}. The chunk being written is `<index>.part` and is renamed on
/// rotation; a killed app leaves the .part behind and relaunch recovers it.
/// A chunk file is deleted ONLY after its upload returned HTTP 2xx.
///
/// TOKENS: native never refreshes the Supabase session (that would rotate the
/// refresh token and log the web app out). The web passes {accessToken,
/// expiresAt} at start and again on every refresh; an expired token means the
/// chunks wait on disk and the backlog drains once the web pushes a fresh one.
final class NativeRecorder: NSObject {
    static let shared = NativeRecorder()

    static let sampleRate: Double = 16_000
    static let bitRate: Int = 32_000
    /// 157 AAC frames x 1024 samples / 16 kHz = 10.05 s.
    static let chunkPackets = 157
    /// Tokens only ever go to the project's own Supabase host.
    static let allowedSupabaseHost = "mshlbsgsyzzfxyxramjj.supabase.co"

    weak var webView: WKWebView?

    // Everything below is touched on `q` only.
    private let q = DispatchQueue(label: "tech.focusos.recorder")
    private var webReady = false
    private var eventQueue: [[String: Any]] = []

    struct Manifest: Codable {
        var sessionId: String
        var userId: String?
        var nextIndex: Int = 0
        var uploadedUpTo: Int = -1
        var startedAt: Double
        var pausedMs: Double = 0
        var pausedAt: Double?
        /// recording | paused | stopped | killed
        var status: String
        var sampleRate: Int = 16_000
    }

    private final class Rec {
        var m: Manifest
        var handle: FileHandle?
        var packets = 0
        var userPaused = false
        var interrupted = false
        init(_ m: Manifest) { self.m = m }
    }

    private var rec: Rec?
    private var engine = AVAudioEngine()
    private var pcmFmt: AVAudioFormat?
    private var aacFmt: AVAudioFormat?
    private var pcmConv: AVAudioConverter?
    private var aacConv: AVAudioConverter?
    private var observersInstalled = false

    // Upload state.
    private var supabaseURL: URL?
    private var anonKey: String?
    private var accessToken: String?
    private var tokenExpiresAt: Double = 0   // epoch seconds
    private var authUserId: String?
    private var tokenRejected = false
    private var uploading = false
    private var retryScheduled = false
    private var attempts = 0
    private var lastWaiting: String = ""
    /// Sessions whose `stopped {allUploaded}` the web already heard.
    private var reportedDone = Set<String>()

    private override init() { super.init() }

    // MARK: - Entry points

    static var rootDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("meeting-chunks", isDirectory: true)
    }

    private func dir(_ sessionId: String) -> URL {
        NativeRecorder.rootDir.appendingPathComponent(sessionId, isDirectory: true)
    }

    private func nowMs() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    /// App launch: repair files left by a killed app. Safe to call once.
    func recoverOnLaunch() {
        q.async { [self] in
            installObservers()
            try? FileManager.default.createDirectory(at: NativeRecorder.rootDir, withIntermediateDirectories: true)
            for m in loadAllManifests() {
                var man = m
                recoverFiles(&man)
                if man.status == "recording" || man.status == "paused" {
                    man.status = "killed"
                    man.pausedAt = nil
                }
                saveManifest(man)
            }
        }
    }

    /// The page (re)loaded: its handler is gone until it says "ready" again.
    func webReloaded() {
        q.async { [self] in webReady = false; reportedDone.removeAll() }
    }

    /// Validated by the caller (ShellWebView) to come from an app-host main frame.
    func handle(_ body: [String: Any]) {
        q.async { [self] in
            guard let cmd = body["cmd"] as? String else { return }
            switch cmd {
            case "ready": onReady()
            case "start": onStart(body)
            case "pause": onPause(byInterruption: false)
            case "resume": onResume()
            case "stop": onStop()
            case "setAuth": applyAuth(body); kickUpload()
            case "clearAuth":
                accessToken = nil; tokenExpiresAt = 0; authUserId = nil
            case "status": onReady(replayOnly: true)
            case "forget": onForget(body, onlyIfDone: true)
            case "discard": onForget(body, onlyIfDone: false)
            default: break
            }
        }
    }

    // MARK: - Events to the web

    private func emit(_ event: [String: Any]) {
        var e = event
        e["at"] = nowMs()
        guard webReady else {
            eventQueue.append(e)
            if eventQueue.count > 200 { eventQueue.removeFirst(eventQueue.count - 200) }
            return
        }
        send(e)
    }

    private func send(_ event: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        let js = "window.__focusosNativeRecorder && window.__focusosNativeRecorder.onEvent(\(json));"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func onReady(replayOnly: Bool = false) {
        if !replayOnly {
            webReady = true
            let queued = eventQueue
            eventQueue.removeAll()
            // Queued state events are stale after a reload: the fresh snapshot below
            // replaces them; keep only the one-off notices.
            for e in queued where (e["type"] as? String) != "state" && (e["type"] as? String) != "pending" {
                send(e)
            }
        }
        emitState()
        emit(["type": "pending", "sessions": pendingSessions()])
        emitWaiting(force: true)
        kickUpload()
    }

    private func emitState() {
        guard let r = rec else {
            emit(["type": "state", "state": "idle"])
            return
        }
        var e: [String: Any] = [
            "type": "state",
            "state": r.m.status == "paused" ? "paused" : "recording",
            "sessionId": r.m.sessionId,
            "startedAt": r.m.startedAt,
            "pausedMs": r.m.pausedMs,
            "interrupted": r.interrupted,
        ]
        if let p = r.m.pausedAt { e["pausedAt"] = p }
        emit(e)
    }

    // MARK: - Start / pause / resume / stop

    private func fail(_ message: String) {
        emit(["type": "error", "message": message])
    }

    private func applyAuth(_ body: [String: Any]) {
        if let u = body["supabaseUrl"] as? String, let url = URL(string: u),
           url.scheme == "https", url.host == NativeRecorder.allowedSupabaseHost {
            supabaseURL = url
        }
        if let k = body["anonKey"] as? String, !k.isEmpty { anonKey = k }
        if let t = body["accessToken"] as? String, !t.isEmpty {
            accessToken = t
            tokenRejected = false
        }
        if let e = body["expiresAt"] as? Double { tokenExpiresAt = e }
        else if let e = body["expiresAt"] as? Int { tokenExpiresAt = Double(e) }
        if let uid = body["userId"] as? String, !uid.isEmpty { authUserId = uid }
    }

    private func validSession(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 80 && id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }

    private func onStart(_ body: [String: Any]) {
        guard rec == nil else { fail("Already recording"); return }
        guard let sid = body["sessionId"] as? String, validSession(sid) else { fail("Bad session id"); return }
        applyAuth(body)
        guard supabaseURL != nil, anonKey != nil else { fail("Missing sign-in details"); return }
        let userId = body["userId"] as? String

        AVAudioApplication.requestRecordPermission { [weak self] granted in
            guard let self else { return }
            self.q.async {
                guard granted else { self.fail("Microphone access denied"); return }
                self.beginRecording(sessionId: sid, userId: userId)
            }
        }
    }

    private func beginRecording(sessionId: String, userId: String?) {
        guard rec == nil else { fail("Already recording"); return }
        do {
            try activateSession()
            try FileManager.default.createDirectory(at: dir(sessionId), withIntermediateDirectories: true)
            var m = Manifest(sessionId: sessionId, userId: userId, startedAt: nowMs(), status: "recording")
            // A session id reused after a crash keeps its numbering.
            if let old = loadManifest(sessionId) { m.nextIndex = old.nextIndex; m.uploadedUpTo = old.uploadedUpTo }
            try buildEncoder()
            let r = Rec(m)
            rec = r
            saveManifest(m)
            try startEngine()
            reportedDone.remove(sessionId)
            emit(["type": "started", "sessionId": sessionId, "startedAt": m.startedAt, "pausedMs": 0])
            emitState()
        } catch {
            rec = nil
            teardownEngine()
            deactivateSession()
            fail("Could not start recording: \(error.localizedDescription)")
        }
    }

    private func onPause(byInterruption: Bool) {
        guard let r = rec, r.m.status == "recording" else { return }
        engine.pause()
        finishChunk(r)
        r.m.status = "paused"
        r.m.pausedAt = nowMs()
        if byInterruption { r.interrupted = true } else { r.userPaused = true }
        saveManifest(r.m)
        emitState()
    }

    private func onResume() {
        guard let r = rec, r.m.status == "paused" else { return }
        do {
            try activateSession()
            try startEngine()
        } catch {
            fail("Could not resume recording: \(error.localizedDescription)")
            return
        }
        if let p = r.m.pausedAt { r.m.pausedMs += max(0, nowMs() - p) }
        r.m.pausedAt = nil
        r.m.status = "recording"
        r.userPaused = false
        let wasInterrupted = r.interrupted
        r.interrupted = false
        saveManifest(r.m)
        emitState()
        if wasInterrupted { emit(["type": "resumed", "sessionId": r.m.sessionId]) }
    }

    private func onStop() {
        guard let r = rec else {
            emit(["type": "state", "state": "idle"])
            return
        }
        emit(["type": "state", "state": "stopping", "sessionId": r.m.sessionId])
        teardownEngine()
        finishChunk(r)
        if let p = r.m.pausedAt { r.m.pausedMs += max(0, nowMs() - p); r.m.pausedAt = nil }
        r.m.status = "stopped"
        saveManifest(r.m)
        rec = nil
        deactivateSession()
        emit(["type": "state", "state": "idle"])
        kickUpload()
        checkDone()
    }

    private func onForget(_ body: [String: Any], onlyIfDone: Bool) {
        guard let sid = body["sessionId"] as? String, validSession(sid), rec?.m.sessionId != sid else { return }
        if onlyIfDone, let m = loadManifest(sid), pendingCount(m) > 0 { return }
        try? FileManager.default.removeItem(at: dir(sid))
        reportedDone.remove(sid)
    }

    // MARK: - Audio session + engine

    private func activateSession() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker])
        try s.setActive(true)
    }

    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func buildEncoder() throws {
        let pcm = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: NativeRecorder.sampleRate,
                                channels: 1, interleaved: false)!
        guard let aac = AVAudioFormat(settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: NativeRecorder.sampleRate,
            AVNumberOfChannelsKey: 1,
        ]), let conv = AVAudioConverter(from: pcm, to: aac) else {
            throw NSError(domain: "NativeRecorder", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "AAC encoder unavailable"])
        }
        let rates = conv.applicableEncodeBitRates?.map { $0.intValue } ?? []
        if rates.contains(NativeRecorder.bitRate) {
            conv.bitRate = NativeRecorder.bitRate
        } else if let nearest = rates.min(by: { abs($0 - NativeRecorder.bitRate) < abs($1 - NativeRecorder.bitRate) }) {
            conv.bitRate = nearest
        }
        pcmFmt = pcm
        aacFmt = aac
        aacConv = conv
    }

    /// (Re)install the input tap against the CURRENT hardware format (it changes on
    /// a route change) and start the engine.
    private func startEngine() throws {
        guard let pcm = pcmFmt else { throw NSError(domain: "NativeRecorder", code: 2) }
        engine.inputNode.removeTap(onBus: 0)
        let input = engine.inputNode
        let hw = input.outputFormat(forBus: 0)
        guard hw.sampleRate > 0, hw.channelCount > 0 else {
            throw NSError(domain: "NativeRecorder", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "No microphone input"])
        }
        pcmConv = AVAudioConverter(from: hw, to: pcm)
        input.installTap(onBus: 0, bufferSize: 4096, format: hw) { [weak self] buf, _ in
            self?.q.async { self?.process(buf) }
        }
        engine.prepare()
        try engine.start()
    }

    private func teardownEngine() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    // MARK: - Encode + write

    private func process(_ buf: AVAudioPCMBuffer) {
        guard let r = rec, r.m.status == "recording",
              let pcmConv, let pcmFmt, let aacConv, let aacFmt else { return }
        let ratio = pcmFmt.sampleRate / buf.format.sampleRate
        let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 64
        guard let pcmOut = AVAudioPCMBuffer(pcmFormat: pcmFmt, frameCapacity: cap) else { return }
        var supplied = false
        var err: NSError?
        let st = pcmConv.convert(to: pcmOut, error: &err) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true
            status.pointee = .haveData
            return buf
        }
        guard st != .error, pcmOut.frameLength > 0 else { return }

        let comp = AVAudioCompressedBuffer(format: aacFmt, packetCapacity: 16,
                                           maximumPacketSize: aacConv.maximumOutputPacketSize)
        var fed = false
        while true {
            var e2: NSError?
            let s2 = aacConv.convert(to: comp, error: &e2) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true
                status.pointee = .haveData
                return pcmOut
            }
            if s2 == .error { break }
            writePackets(comp, to: r)
            if s2 == .inputRanDry || s2 == .endOfStream { break }
            if comp.packetCount == 0 { break }
        }
    }

    private func writePackets(_ comp: AVAudioCompressedBuffer, to r: Rec) {
        guard comp.packetCount > 0, let descs = comp.packetDescriptions else { return }
        for i in 0..<Int(comp.packetCount) {
            let d = descs[i]
            let size = Int(d.mDataByteSize)
            if size == 0 { continue }
            var frame = NativeRecorder.adtsHeader(payload: size)
            frame.append(Data(bytes: comp.data.advanced(by: Int(d.mStartOffset)), count: size))
            guard let h = ensureHandle(r) else { return }
            h.write(frame)
            r.packets += 1
            if r.packets >= NativeRecorder.chunkPackets { finishChunk(r) }
        }
    }

    private func partURL(_ sid: String, _ index: Int) -> URL {
        dir(sid).appendingPathComponent(String(format: "%05d.part", index))
    }

    private func chunkURL(_ sid: String, _ index: Int) -> URL {
        dir(sid).appendingPathComponent(String(format: "%05d.aac", index))
    }

    private func ensureHandle(_ r: Rec) -> FileHandle? {
        if let h = r.handle { return h }
        let url = partURL(r.m.sessionId, r.m.nextIndex)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        guard let h = try? FileHandle(forWritingTo: url) else {
            fail("Could not write the recording to disk")
            return nil
        }
        _ = try? h.seekToEnd()
        r.handle = h
        return h
    }

    /// Close the chunk being written (if it holds audio), rename it into place and
    /// bump the index. Called on rotation, pause, interruption and stop.
    private func finishChunk(_ r: Rec) {
        try? r.handle?.close()
        r.handle = nil
        guard r.packets > 0 else { return }
        let from = partURL(r.m.sessionId, r.m.nextIndex)
        let to = chunkURL(r.m.sessionId, r.m.nextIndex)
        try? FileManager.default.removeItem(at: to)
        do { try FileManager.default.moveItem(at: from, to: to) } catch {
            fail("Could not save a recording piece")
            return
        }
        let index = r.m.nextIndex
        r.m.nextIndex += 1
        r.packets = 0
        saveManifest(r.m)
        emit(["type": "chunkSaved", "sessionId": r.m.sessionId, "index": index])
        kickUpload()
    }

    /// 7-byte ADTS header for one raw AAC-LC frame at 16 kHz mono.
    /// profile = objectType - 1 = 1 (LC); sampling index 8 = 16000 Hz; channels 1.
    static func adtsHeader(payload: Int) -> Data {
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

    // MARK: - Manifests + recovery

    private func manifestURL(_ sid: String) -> URL { dir(sid).appendingPathComponent("manifest.json") }

    private func saveManifest(_ m: Manifest) {
        guard let data = try? JSONEncoder().encode(m) else { return }
        try? data.write(to: manifestURL(m.sessionId), options: .atomic)
    }

    private func loadManifest(_ sid: String) -> Manifest? {
        guard let data = try? Data(contentsOf: manifestURL(sid)) else { return nil }
        return try? JSONDecoder().decode(Manifest.self, from: data)
    }

    private func loadAllManifests() -> [Manifest] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: NativeRecorder.rootDir.path)) ?? []
        return names.compactMap { validSession($0) ? loadManifest($0) : nil }
            .sorted { $0.startedAt < $1.startedAt }
    }

    private func existingChunkIndexes(_ sid: String) -> [Int] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir(sid).path)) ?? []
        return names.compactMap { n in
            n.hasSuffix(".aac") ? Int(n.dropLast(4)) : nil
        }.sorted()
    }

    /// Turn a leftover .part into a whole chunk and repair the counters.
    private func recoverFiles(_ m: inout Manifest) {
        let sid = m.sessionId
        let part = partURL(sid, m.nextIndex)
        if let data = try? Data(contentsOf: part) {
            let whole = NativeRecorder.completeFrames(data)
            if !whole.isEmpty {
                try? whole.write(to: chunkURL(sid, m.nextIndex), options: .atomic)
                m.nextIndex += 1
            }
            try? FileManager.default.removeItem(at: part)
        }
        if let top = existingChunkIndexes(sid).last, top >= m.nextIndex { m.nextIndex = top + 1 }
    }

    private func pendingCount(_ m: Manifest) -> Int {
        existingChunkIndexes(m.sessionId).filter { $0 > m.uploadedUpTo }.count
    }

    private func pendingSessions() -> [[String: Any]] {
        loadAllManifests().filter { $0.sessionId != rec?.m.sessionId }.map { m in
            var d: [String: Any] = [
                "sessionId": m.sessionId,
                "status": m.status,
                "lastIndex": m.nextIndex - 1,
                "uploadedUpTo": m.uploadedUpTo,
                "pending": pendingCount(m),
                "startedAt": m.startedAt,
                "pausedMs": m.pausedMs,
                "allUploaded": pendingCount(m) == 0,
            ]
            if let u = m.userId { d["userId"] = u }
            return d
        }
    }

    // MARK: - Upload

    private func tokenUsable() -> Bool {
        accessToken != nil && !tokenRejected && tokenExpiresAt > Date().timeIntervalSince1970 + 5
    }

    private func totalPending() -> Int {
        loadAllManifests().filter { $0.userId == nil || $0.userId == authUserId }
            .reduce(0) { $0 + pendingCount($1) }
    }

    private func nextChunk() -> (Manifest, Int)? {
        for m in loadAllManifests() {
            if let u = m.userId, u != authUserId { continue }   // never upload under another account
            let idx = m.uploadedUpTo + 1
            if idx < m.nextIndex, FileManager.default.fileExists(atPath: chunkURL(m.sessionId, idx).path) {
                return (m, idx)
            }
        }
        return nil
    }

    private func emitWaiting(force: Bool = false) {
        let pending = totalPending()
        var reason = ""
        if pending > 0 && !tokenUsable() { reason = "signin" }
        else if pending > 0 && attempts > 0 { reason = "network" }
        let key = "\(reason):\(pending)"
        if reason.isEmpty { lastWaiting = key; return }
        if !force && key == lastWaiting { return }
        lastWaiting = key
        emit(["type": "uploadWaiting", "pending": pending, "reason": reason])
    }

    func kickUpload() {
        q.async { [self] in uploadNext() }
    }

    private func uploadNext() {
        guard !uploading, !retryScheduled else { return }
        guard let (m, idx) = nextChunk() else {
            attempts = 0
            checkDone()
            return
        }
        guard tokenUsable(), let base = supabaseURL, let anon = anonKey, let token = accessToken else {
            emitWaiting()
            return
        }
        guard let bytes = try? Data(contentsOf: chunkURL(m.sessionId, idx)) else { return }
        let payload: [String: Any] = [
            "sessionId": m.sessionId,
            "chunkIndex": idx,
            "audioBase64": bytes.base64EncodedString(),
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var req = URLRequest(url: base.appendingPathComponent("functions/v1/focusos-upload-audio-chunk"))
        req.httpMethod = "POST"
        req.timeoutInterval = 45
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = body

        uploading = true
        var bg = UIBackgroundTaskIdentifier.invalid
        DispatchQueue.main.sync {
            bg = UIApplication.shared.beginBackgroundTask(withName: "focusos-chunk-upload") {}
        }
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            guard let self else { return }
            self.q.async {
                self.uploading = false
                DispatchQueue.main.async {
                    if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) }
                }
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if err == nil, (200..<300).contains(code) {
                    self.chunkUploaded(m.sessionId, idx)
                } else {
                    if code == 401 { self.tokenRejected = true }
                    self.attempts += 1
                    self.emitWaiting(force: true)
                    self.scheduleRetry()
                }
            }
        }.resume()
    }

    private func chunkUploaded(_ sid: String, _ idx: Int) {
        try? FileManager.default.removeItem(at: chunkURL(sid, idx))   // only after a confirmed 2xx
        if rec?.m.sessionId == sid {
            rec?.m.uploadedUpTo = idx
            if let r = rec { saveManifest(r.m) }
        } else if var m = loadManifest(sid) {
            m.uploadedUpTo = idx
            saveManifest(m)
        }
        attempts = 0
        lastWaiting = ""
        emit(["type": "chunkUploaded", "sessionId": sid, "index": idx])
        uploadNext()
    }

    private func scheduleRetry() {
        // A rejected or missing token waits for the web's next setAuth instead of polling.
        if tokenRejected { return }
        retryScheduled = true
        let delay = min(60.0, pow(2.0, Double(min(attempts, 6))))
        q.asyncAfter(deadline: .now() + delay) { [self] in
            retryScheduled = false
            uploadNext()
        }
    }

    /// Tell the web about every finished (stopped or killed) session whose chunks all uploaded.
    private func checkDone() {
        for m in loadAllManifests() where m.status == "stopped" || m.status == "killed" {
            if let u = m.userId, u != authUserId { continue }
            guard m.sessionId != rec?.m.sessionId, pendingCount(m) == 0,
                  !reportedDone.contains(m.sessionId) else { continue }
            reportedDone.insert(m.sessionId)
            emit(["type": "stopped", "sessionId": m.sessionId, "lastIndex": m.nextIndex - 1,
                  "allUploaded": true, "status": m.status])
        }
    }

    // MARK: - Interruptions, route changes, lifecycle

    private func installObservers() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onInterruption(_:)),
                       name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(onMediaReset(_:)),
                       name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        nc.addObserver(self, selector: #selector(onRouteChange(_:)),
                       name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(onEngineConfig(_:)),
                       name: .AVAudioEngineConfigurationChange, object: nil)
        nc.addObserver(self, selector: #selector(onActive(_:)),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func onInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        q.async { [self] in
            guard let r = rec else { return }
            switch type {
            case .began:
                guard r.m.status == "recording" else { return }
                onPause(byInterruption: true)
                emit(["type": "interrupted", "sessionId": r.m.sessionId])
            case .ended:
                guard r.interrupted else { return }
                let opts = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                    .map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
                if opts.contains(.shouldResume), !r.userPaused { onResume() }
                // Otherwise stay paused and interrupted: the web's Resume button calls onResume.
            @unknown default: break
            }
        }
    }

    @objc private func onMediaReset(_ note: Notification) {
        q.async { [self] in
            guard let r = rec else { return }
            // The audio daemon restarted: every engine object is dead. Rebuild.
            engine = AVAudioEngine()
            guard r.m.status == "recording" else { return }
            do { try activateSession(); try startEngine() }
            catch { fail("Recording stopped: audio restarted (\(error.localizedDescription))") }
        }
    }

    @objc private func onRouteChange(_ note: Notification) {
        // The engine posts its own configuration-change; that handler rebuilds the tap.
        // Nothing to do here except make sure a paused recording stays paused.
    }

    @objc private func onEngineConfig(_ note: Notification) {
        q.async { [self] in
            guard let r = rec, r.m.status == "recording" else { return }
            do { try startEngine() }
            catch { fail("Microphone changed and recording could not continue: \(error.localizedDescription)") }
        }
    }

    @objc private func onActive(_ note: Notification) {
        q.async { [self] in
            emitState()
            emitWaiting(force: true)
            uploadNext()
        }
    }
}

import Foundation
import AVFoundation
import UIKit
import WebKit
import UserNotifications

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
/// frames (1024 samples each = 10.05 s). Encoders are flushed on pause and stop so
/// the tail of the audio is never dropped.
///
/// FILES: Application Support/meeting-chunks/<sessionId>/{manifest.json,
/// 00000.aac, ...} (ChunkStore.swift). The chunk being written is `<index>.part`;
/// a killed app leaves it behind and relaunch recovers it.
///
/// UPLOAD: UploadQueue.swift (per-session round-robin, files deleted only after
/// 2xx, parking only after a successful status read).
///
/// TOKENS: native never refreshes the Supabase session (that would rotate the
/// refresh token and log the web app out). The web passes {accessToken,
/// expiresAt} at start and again on every refresh; an expired token means the
/// chunks wait on disk and the backlog drains once the web pushes a fresh one.
///
/// HONESTY: never "recording" while capturing nothing. A failed engine restart or
/// 5 s without audio buffers switches to paused + `interrupted {reason}`, retries
/// with backoff, and posts a local notification when the app is not in front.
final class NativeRecorder: NSObject {
    static let shared = NativeRecorder()

    static let sampleRate: Double = 16_000
    static let bitRate: Int = 32_000
    /// 157 AAC frames x 1024 samples / 16 kHz = 10.05 s.
    static let chunkPackets = 157
    /// Tokens only ever go to the project's own Supabase host.
    static let allowedSupabaseHost = "mshlbsgsyzzfxyxramjj.supabase.co"
    static let silenceLimit: TimeInterval = 5
    static let parkedMaxAge: TimeInterval = 7 * 24 * 3600
    static let noticeID = "focusos-recording-paused"

    weak var webView: WKWebView?

    // Everything below is touched on `q` only.
    private let q = DispatchQueue(label: "tech.focusos.recorder")
    private var webReady = false
    private var eventQueue: [[String: Any]] = []

    private final class Rec {
        var m: Manifest
        var handle: FileHandle?
        var packets = 0
        var userPaused = false
        var interrupted = false
        var interruptReason: String?
        /// Engine stopped, queued buffers still being written (pause/stop in progress).
        var draining = false
        var lastBufferAt = Date()
        var resumeLoop = 0
        init(_ m: Manifest) { self.m = m }
    }

    let store = ChunkStore(root: NativeRecorder.rootDir)
    private var rec: Rec?
    private var engine = AVAudioEngine()
    private var pcmFmt: AVAudioFormat?
    private var aacFmt: AVAudioFormat?
    private var pcmConv: AVAudioConverter?
    private var aacConv: AVAudioConverter?
    private var observersInstalled = false
    private var watchdog: DispatchSourceTimer?

    // Upload state.
    private let transport = SupabaseTransport()
    private var queue: UploadQueue!
    private var tokenExpiresAt: Double = 0   // epoch seconds
    private var tokenRejected = false
    private var pumping = false
    private var retryScheduled = false
    private var lastWaiting = ""
    /// Sessions whose `stopped {allUploaded}` the web already heard.
    private var reportedDone = Set<String>()
    /// A start waiting on the mic prompt; `discard` for it cancels the start.
    private var pendingStartId: String?
    private var cancelledStarts = Set<String>()
    private var notifAllowed = false

    private override init() {
        super.init()
        transport.callbackQueue = q
        queue = UploadQueue(store: store, transport: transport)
        queue.tokenUsable = { [weak self] in
            guard let self else { return false }
            return self.transport.accessToken != nil && !self.tokenRejected
                && self.tokenExpiresAt > Date().timeIntervalSince1970 + 5
        }
    }

    // MARK: - Entry points

    static var rootDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("meeting-chunks", isDirectory: true)
    }

    private func nowMs() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    /// App launch: repair files left by a killed app, drop old parked sessions. Safe to call once.
    func recoverOnLaunch() {
        q.async { [self] in
            installObservers()
            for m in store.loadAll() {
                var man = m
                store.recover(&man)
                if ["recording", "paused", "stopping"].contains(man.status) {
                    man.status = "killed"
                    man.pausedAt = nil
                }
                store.save(man)
            }
            store.cleanupParked(olderThan: NativeRecorder.parkedMaxAge, now: Date())
            if UserDefaults.standard.bool(forKey: "focusos.recorder.notifAsked") {
                UNUserNotificationCenter.current().getNotificationSettings { [weak self] s in
                    self?.q.async { self?.notifAllowed = (s.authorizationStatus == .authorized) }
                }
            }
        }
    }

    /// The page (re)loaded: its handler is gone until it says "ready" again.
    func webReloaded() {
        q.async { [self] in webReady = false; reportedDone.removeAll() }
    }

    /// Validated by the caller (ShellWebView) to come from a trusted app-origin main frame.
    func handle(_ body: [String: Any]) {
        q.async { [self] in
            guard let cmd = body["cmd"] as? String else { return }
            switch cmd {
            case "ready": onReady()
            case "start": onStart(body)
            case "pause": onPause(reason: nil)
            case "resume": onResume()
            case "stop": onStop()
            case "setAuth": applyAuth(body); queue.resetBackoff(); pump()
            case "clearAuth":
                transport.accessToken = nil; tokenExpiresAt = 0; queue.authUserId = nil
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
        pump()
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
        if let why = r.interruptReason { e["interruptReason"] = why }
        emit(e)
    }

    private func fail(_ message: String) {
        emit(["type": "error", "message": message])
    }

    private func persist(_ r: Rec) {
        // The upload queue owns uploadedUpTo / parked: never clobber them with a stale copy.
        if let disk = store.load(r.m.sessionId) {
            r.m.uploadedUpTo = max(disk.uploadedUpTo, r.m.uploadedUpTo)
            r.m.parked = disk.parked
            r.m.parkedAt = disk.parkedAt
        }
        store.save(r.m)
    }

    // MARK: - Start / pause / resume / stop

    private func applyAuth(_ body: [String: Any]) {
        if let u = body["supabaseUrl"] as? String, let url = URL(string: u),
           url.scheme == "https", url.host == NativeRecorder.allowedSupabaseHost {
            transport.supabaseURL = url
        }
        if let k = body["anonKey"] as? String, !k.isEmpty { transport.anonKey = k }
        if let t = body["accessToken"] as? String, !t.isEmpty {
            transport.accessToken = t
            tokenRejected = false
        }
        if let e = body["expiresAt"] as? Double { tokenExpiresAt = e }
        else if let e = body["expiresAt"] as? Int { tokenExpiresAt = Double(e) }
        if let uid = body["userId"] as? String, !uid.isEmpty { queue.authUserId = uid }
    }

    private func onStart(_ body: [String: Any]) {
        guard rec == nil, pendingStartId == nil else { fail("Already recording"); return }
        guard let sid = body["sessionId"] as? String, ChunkStore.isValidSessionId(sid) else { fail("Bad session id"); return }
        applyAuth(body)
        guard transport.supabaseURL != nil, transport.anonKey != nil else { fail("Missing sign-in details"); return }
        let userId = body["userId"] as? String
        pendingStartId = sid
        cancelledStarts.remove(sid)

        AVAudioApplication.requestRecordPermission { [weak self] granted in
            guard let self else { return }
            self.q.async {
                self.pendingStartId = nil
                // The page gave up on this start (permission prompt took too long): never record it.
                if self.cancelledStarts.remove(sid) != nil { return }
                guard granted else { self.fail("Microphone access denied"); return }
                self.beginRecording(sessionId: sid, userId: userId)
            }
        }
    }

    private func requestNotificationsOnce() {
        let key = "focusos.recorder.notifAsked"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
            self?.q.async { self?.notifAllowed = granted }
        }
    }

    private func beginRecording(sessionId: String, userId: String?) {
        guard rec == nil else { fail("Already recording"); return }
        do {
            try activateSession()
            var m = Manifest(sessionId: sessionId, userId: userId, startedAt: nowMs(), status: "recording")
            // A session id reused after a crash keeps its numbering.
            if let old = store.load(sessionId) { m.nextIndex = old.nextIndex; m.uploadedUpTo = old.uploadedUpTo }
            try buildEncoder()
            let r = Rec(m)
            rec = r
            store.save(m)
            try startEngine()
            reportedDone.remove(sessionId)
            requestNotificationsOnce()
            emit(["type": "started", "sessionId": sessionId, "startedAt": m.startedAt, "pausedMs": 0])
            emitState()
        } catch {
            rec = nil
            teardownEngine()
            deactivateSession()
            fail("Could not start recording: \(error.localizedDescription)")
        }
    }

    /// Pause (user) or interruption (reason != nil). The engine stops first; buffers
    /// already queued are still written before the chunk is closed.
    private func onPause(reason: String?) {
        guard let r = rec, r.m.status == "recording", !r.draining else { return }
        engine.pause()
        r.draining = true
        if let reason { r.interrupted = true; r.interruptReason = reason } else { r.userPaused = true }
        q.async { [self] in
            guard rec === r else { return }
            r.draining = false
            flushEncoders(r)
            finishChunk(r)
            r.m.status = "paused"
            r.m.pausedAt = nowMs()
            persist(r)
            emitState()
            if let reason {
                emit(["type": "interrupted", "sessionId": r.m.sessionId, "reason": reason])
                scheduleResumeNotice()
            }
        }
    }

    private func onResume() {
        guard let r = rec, r.m.status == "paused" else { return }
        r.resumeLoop += 1   // cancels any retry loop in flight
        do {
            try activateSession()
            try startEngine()
        } catch {
            fail("Could not resume recording: \(error.localizedDescription)")
            return
        }
        commitResume(r)
    }

    private func commitResume(_ r: Rec) {
        if let p = r.m.pausedAt { r.m.pausedMs += max(0, nowMs() - p) }
        r.m.pausedAt = nil
        r.m.status = "recording"
        r.userPaused = false
        let wasInterrupted = r.interrupted
        r.interrupted = false
        r.interruptReason = nil
        r.lastBufferAt = Date()
        persist(r)
        cancelResumeNotice()
        emitState()
        if wasInterrupted { emit(["type": "resumed", "sessionId": r.m.sessionId]) }
    }

    private func onStop() {
        guard let r = rec else {
            emit(["type": "state", "state": "idle"])
            return
        }
        // A pause / interruption drain is in flight: its block is already on the
        // serial queue, so re-enqueue the Stop to run right after it (never drop it).
        guard !r.draining else { q.async { [self] in onStop() }; return }
        emit(["type": "state", "state": "stopping", "sessionId": r.m.sessionId])
        r.resumeLoop += 1
        cancelResumeNotice()
        stopWatchdog()
        teardownEngine()
        r.draining = true
        // Buffers already handed to the queue are written BEFORE the encoders flush.
        q.async { [self] in
            guard rec === r else { return }
            r.draining = false
            if r.m.status == "recording" { flushEncoders(r) }
            finishChunk(r)
            if let p = r.m.pausedAt { r.m.pausedMs += max(0, nowMs() - p); r.m.pausedAt = nil }
            r.m.status = "stopped"
            persist(r)
            rec = nil
            deactivateSession()
            emit(["type": "state", "state": "idle"])
            pump()
            checkDone()
        }
    }

    private func onForget(_ body: [String: Any], onlyIfDone: Bool) {
        guard let sid = body["sessionId"] as? String, ChunkStore.isValidSessionId(sid) else { return }
        if !onlyIfDone {
            if pendingStartId == sid { cancelledStarts.insert(sid) }
            if let r = rec, r.m.sessionId == sid {
                // The page considers this session failed: stop without keeping anything.
                r.resumeLoop += 1
                stopWatchdog()
                teardownEngine()
                try? r.handle?.close()
                r.handle = nil
                rec = nil
                deactivateSession()
                cancelResumeNotice()
                emit(["type": "state", "state": "idle"])
            }
        }
        guard rec?.m.sessionId != sid else { return }
        if onlyIfDone, let m = store.load(sid), store.pendingCount(m) > 0 { return }
        store.remove(sid)
        reportedDone.remove(sid)
    }

    // MARK: - Audio session + engine

    private func activateSession() throws {
        let s = AVAudioSession.sharedInstance()
        var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
        if #available(iOS 26.0, *) { options.insert(.allowBluetoothHFP) } else { options.insert(.allowBluetooth) }
        try s.setCategory(.playAndRecord, mode: .default, options: options)
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

    /// A fresh engine: after a route change, a media-services reset or a failed start the
    /// old one is not trusted.
    private func rebuildEngine() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        engine = AVAudioEngine()
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
        rec?.lastBufferAt = Date()
        startWatchdog()
    }

    private func teardownEngine() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    // MARK: - Watchdog + honest failure

    private func startWatchdog() {
        guard watchdog == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 2, repeating: 2)
        t.setEventHandler { [weak self] in
            guard let self, let r = self.rec, r.m.status == "recording", !r.draining else { return }
            if Date().timeIntervalSince(r.lastBufferAt) > NativeRecorder.silenceLimit {
                self.engineFailed("noAudio")
            }
        }
        t.resume()
        watchdog = t
    }

    private func stopWatchdog() {
        watchdog?.cancel()
        watchdog = nil
    }

    /// The engine died or went silent: say so (paused + interrupted {reason}), then keep
    /// trying to restart with backoff; `resumed` follows a success.
    private func engineFailed(_ reason: String) {
        guard let r = rec, r.m.status == "recording", !r.draining else { return }
        onPause(reason: reason)
        // The pause finishes on the queue; the restart loop starts right behind it.
        q.async { [self] in startResumeLoop(r, attempt: 0) }
    }

    private func startResumeLoop(_ r: Rec, attempt: Int, token: Int? = nil) {
        let id: Int
        if let token { id = token } else { r.resumeLoop += 1; id = r.resumeLoop }
        guard rec === r, r.interrupted, r.m.status == "paused", !r.userPaused, r.resumeLoop == id else { return }
        do {
            rebuildEngine()
            try activateSession()
            try startEngine()
            commitResume(r)
        } catch {
            guard attempt < 4 else { return }   // stays paused + notified; foreground auto-resumes
            let delay = Double(1 << attempt)
            q.asyncAfter(deadline: .now() + delay) { [self] in startResumeLoop(r, attempt: attempt + 1, token: id) }
        }
    }

    // MARK: - Local notification

    private func appIsActive() -> Bool {
        var active = true
        DispatchQueue.main.sync { active = UIApplication.shared.applicationState == .active }
        return active
    }

    private func scheduleResumeNotice() {
        guard notifAllowed, !appIsActive() else { return }
        let c = UNMutableNotificationContent()
        c.title = "Focus OS"
        c.body = "Meeting recording paused. Open Focus OS to resume."
        c.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 15, repeats: false)
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: NativeRecorder.noticeID, content: c, trigger: trigger))
    }

    private func cancelResumeNotice() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [NativeRecorder.noticeID])
        center.removeDeliveredNotifications(withIdentifiers: [NativeRecorder.noticeID])
    }

    // MARK: - Encode + write

    private func process(_ buf: AVAudioPCMBuffer) {
        guard let r = rec, r.m.status == "recording" || r.draining,
              let pcmConv, let pcmFmt else { return }
        r.lastBufferAt = Date()
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
        encode(pcm: pcmOut, flush: false, to: r)
    }

    /// Feed PCM (or nothing) to the AAC encoder and write every packet it yields.
    /// `flush` ends the stream so the encoder releases its buffered tail.
    private func encode(pcm: AVAudioPCMBuffer?, flush: Bool, to r: Rec) {
        guard let aacConv, let aacFmt else { return }
        let comp = AVAudioCompressedBuffer(format: aacFmt, packetCapacity: 16,
                                           maximumPacketSize: aacConv.maximumOutputPacketSize)
        var fed = false
        while true {
            var e: NSError?
            let st = aacConv.convert(to: comp, error: &e) { _, status in
                if !fed, let pcm {
                    fed = true
                    status.pointee = .haveData
                    return pcm
                }
                fed = true
                status.pointee = flush ? .endOfStream : .noDataNow
                return nil
            }
            if st == .error { break }
            writePackets(comp, to: r)
            if st == .inputRanDry || st == .endOfStream { break }
            if comp.packetCount == 0 { break }
        }
    }

    /// Drain the resampler and the encoder so the last captured audio reaches the file,
    /// then reset both for the next stretch of audio.
    private func flushEncoders(_ r: Rec) {
        if let pcmConv, let pcmFmt {
            let tail = AVAudioPCMBuffer(pcmFormat: pcmFmt, frameCapacity: 4096)
            var err: NSError?
            if let tail {
                _ = pcmConv.convert(to: tail, error: &err) { _, status in
                    status.pointee = .endOfStream
                    return nil
                }
                if tail.frameLength > 0 { encode(pcm: tail, flush: false, to: r) }
            }
            pcmConv.reset()
        }
        encode(pcm: nil, flush: true, to: r)
        aacConv?.reset()
    }

    private func writePackets(_ comp: AVAudioCompressedBuffer, to r: Rec) {
        guard comp.packetCount > 0, let descs = comp.packetDescriptions else { return }
        for i in 0..<Int(comp.packetCount) {
            let d = descs[i]
            let size = Int(d.mDataByteSize)
            if size == 0 { continue }
            var frame = ADTS.header(payload: size)
            frame.append(Data(bytes: comp.data.advanced(by: Int(d.mStartOffset)), count: size))
            guard let h = ensureHandle(r) else { return }
            h.write(frame)
            r.packets += 1
            if r.packets >= NativeRecorder.chunkPackets { finishChunk(r) }
        }
    }

    private func ensureHandle(_ r: Rec) -> FileHandle? {
        if let h = r.handle { return h }
        let url = store.partURL(r.m.sessionId, r.m.nextIndex)
        try? FileManager.default.createDirectory(at: store.dir(r.m.sessionId), withIntermediateDirectories: true)
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
        let from = store.partURL(r.m.sessionId, r.m.nextIndex)
        let to = store.chunkURL(r.m.sessionId, r.m.nextIndex)
        try? FileManager.default.removeItem(at: to)
        do { try FileManager.default.moveItem(at: from, to: to) } catch {
            fail("Could not save a recording piece")
            return
        }
        let index = r.m.nextIndex
        r.m.nextIndex += 1
        r.packets = 0
        persist(r)
        emit(["type": "chunkSaved", "sessionId": r.m.sessionId, "index": index])
        pump()
    }

    // MARK: - Pending report

    private func pendingSessions() -> [[String: Any]] {
        store.loadAll().filter { $0.sessionId != rec?.m.sessionId }.map { m in
            var d: [String: Any] = [
                "sessionId": m.sessionId,
                "status": m.status,
                "lastIndex": m.nextIndex - 1,
                "uploadedUpTo": m.uploadedUpTo,
                "pending": store.pendingCount(m),
                "startedAt": m.startedAt,
                "pausedMs": m.pausedMs,
                "allUploaded": store.pendingCount(m) == 0,
                "parked": m.parked == true,
            ]
            if let u = m.userId { d["userId"] = u }
            return d
        }
    }

    // MARK: - Upload pump

    private func emitWaiting(force: Bool = false) {
        let pending = queue.pendingTotal()
        var reason = ""
        if pending > 0 && !queue.tokenUsable() { reason = "signin" }
        else if pending > 0 && queue.earliestRetry().map({ $0 > Date() }) == true { reason = "network" }
        let key = "\(reason):\(pending)"
        if reason.isEmpty { lastWaiting = key; return }
        if !force && key == lastWaiting { return }
        lastWaiting = key
        emit(["type": "uploadWaiting", "pending": pending, "reason": reason])
    }

    func kickUpload() { q.async { [self] in pump() } }

    private func pump() {
        guard !pumping, !retryScheduled else { return }
        pumping = true
        let bg = BackgroundTaskBox()
        // The audio mode keeps a recording app alive; this covers a backlog drain after
        // Stop. When iOS ends the time, the in-flight request is cancelled (the chunk stays
        // queued for the next attempt) and the task is released.
        bg.begin { [weak self] in self?.q.async { self?.transport.cancelCurrent() } }
        queue.step { [self] result in
            // Transport calls back on `q`.
            pumping = false
            bg.end()
            switch result {
            case .idle:
                lastWaiting = ""
                checkDone()
            case .uploaded(let sid, let idx):
                lastWaiting = ""
                emit(["type": "chunkUploaded", "sessionId": sid, "index": idx])
                pump()
            case .parked(let sid):
                emit(["type": "parked", "sessionId": sid])
                pump()
            case .waitingAuth:
                if transport.lastUnauthorized { tokenRejected = true }
                emitWaiting(force: true)
            case .blocked(let until):
                emitWaiting(force: true)
                scheduleRetry(at: until)
            case .failed:
                emitWaiting(force: true)
                scheduleRetry(at: queue.earliestRetry() ?? Date().addingTimeInterval(2))
            }
        }
    }

    private func scheduleRetry(at date: Date) {
        retryScheduled = true
        q.asyncAfter(deadline: .now() + max(0.5, date.timeIntervalSinceNow)) { [self] in
            retryScheduled = false
            pump()
        }
    }

    /// Tell the web about every finished (stopped or killed) session whose chunks all uploaded.
    private func checkDone() {
        for m in store.loadAll() where (m.status == "stopped" || m.status == "killed") && m.parked != true {
            if let u = m.userId, u != queue.authUserId { continue }
            guard m.sessionId != rec?.m.sessionId, store.pendingCount(m) == 0,
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
        nc.addObserver(self, selector: #selector(onEngineConfig(_:)),
                       name: .AVAudioEngineConfigurationChange, object: nil)
        nc.addObserver(self, selector: #selector(onActive(_:)),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func onInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        let optRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        q.async { [self] in
            guard let r = rec else { return }
            switch type {
            case .began:
                onPause(reason: "call")
            case .ended:
                guard r.interrupted, !r.userPaused else { return }
                if AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume) {
                    // May fail in the background (cannotStartRecording): the loop retries,
                    // and the notice + foreground auto-resume cover the rest.
                    q.async { [self] in startResumeLoop(r, attempt: 0) }
                }
            @unknown default: break
            }
        }
    }

    @objc private func onMediaReset(_ note: Notification) {
        q.async { [self] in
            guard let r = rec, r.m.status == "recording" else { return }
            rebuildEngine()
            do { try activateSession(); try startEngine() }
            catch { engineFailed("mediaReset") }
            _ = r
        }
    }

    @objc private func onEngineConfig(_ note: Notification) {
        q.async { [self] in
            guard let r = rec, r.m.status == "recording", !r.draining else { return }
            do { try startEngine() }
            catch { engineFailed("route") }
        }
    }

    @objc private func onActive(_ note: Notification) {
        q.async { [self] in
            // Back in front with a recording paused by an interruption: resume at once.
            if let r = rec, r.interrupted, !r.userPaused, r.m.status == "paused" {
                startResumeLoop(r, attempt: 0)
            }
            emitState()
            emitWaiting(force: true)
            queue.resetBackoff()
            pump()
        }
    }
}

/// One iOS background task around an upload step, ended exactly once (also from the
/// expiry handler, which must never be empty).
final class BackgroundTaskBox {
    private var id = UIBackgroundTaskIdentifier.invalid
    private let lock = NSLock()

    func begin(onExpire: @escaping () -> Void) {
        DispatchQueue.main.sync {
            self.id = UIApplication.shared.beginBackgroundTask(withName: "focusos-chunk-upload") { [weak self] in
                onExpire()
                self?.end()
            }
        }
    }

    func end() {
        lock.lock()
        let current = id
        id = .invalid
        lock.unlock()
        guard current != .invalid else { return }
        DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(current) }
    }
}

/// URLSession transport for the Supabase edge function + the status read.
/// All completions are delivered on `callbackQueue`.
final class SupabaseTransport: UploadTransport {
    var supabaseURL: URL?
    var anonKey: String?
    var accessToken: String?
    var callbackQueue: DispatchQueue = .main
    private(set) var lastUnauthorized = false
    private var current: URLSessionDataTask?

    func cancelCurrent() { current?.cancel() }

    private func request(_ path: String, method: String) -> URLRequest? {
        guard let base = supabaseURL, let anon = anonKey, let token = accessToken,
              let url = URL(string: path, relativeTo: base)?.absoluteURL else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 45
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return req
    }

    func upload(sessionId: String, index: Int, data: Data, completion: @escaping (UploadOutcome) -> Void) {
        let payload: [String: Any] = ["sessionId": sessionId, "chunkIndex": index, "audioBase64": data.base64EncodedString()]
        guard var req = request("functions/v1/focusos-upload-audio-chunk", method: "POST"),
              let body = try? JSONSerialization.data(withJSONObject: payload) else {
            callbackQueue.async { completion(.network) }
            return
        }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        lastUnauthorized = false
        let task = URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            self?.callbackQueue.async {
                if err != nil { completion(.network) }
                else if (200..<300).contains(code) { completion(.ok) }
                else if code == 401 { self?.lastUnauthorized = true; completion(.unauthorized) }
                else { completion(.server(code)) }
            }
        }
        current = task
        task.resume()
    }

    func readStatus(sessionId: String, completion: @escaping (StatusRead) -> Void) {
        guard let req = request("rest/v1/focusos_recording_sessions?id=eq.\(sessionId)&select=status", method: "GET") else {
            callbackQueue.async { completion(.failed) }
            return
        }
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            var result = StatusRead.failed
            if err == nil, (200..<300).contains(code), let data,
               let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
                if rows.isEmpty { result = .empty }
                else if let st = rows[0]["status"] as? String { result = .status(st) }
            }
            self?.callbackQueue.async { completion(result) }
        }.resume()
    }
}

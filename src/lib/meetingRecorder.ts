/**
 * Meeting recorder — ONE recorder for the whole app, living at module scope.
 *
 * WHY THIS EXISTS (2026-11-10): the recorder used to live in component refs
 * inside src/pages/Meetings.tsx, and that page's unmount cleanup stopped the mic
 * tracks. Any navigation away from /meetings therefore killed the recording, so
 * Igor could not record a meeting and keep using the app. The recorder now owns
 * the stream, the MediaRecorder, the upload queue and the whole save path here
 * (house precedent: src/lib/brainDumpAudio.ts), so a recording survives every
 * route change and a Stop pressed on any route completes the save.
 *
 * NO LOST AUDIO:
 *  - chunks flush every 10 s (was 30 s), and on visibilitychange -> hidden and
 *    pagehide, so a backgrounded or closed tab loses at most a few seconds;
 *  - a chunk index is SPENT only when its upload succeeded. A failed chunk keeps
 *    its place at the head of an ordered queue and is retried with the SAME index
 *    (bounded retries, exponential backoff), so later chunks never overtake it
 *    and the sequence the server composes from never has a hole;
 *  - {sessionId, startedAt, title, pausedMs, ...} is mirrored to localStorage while
 *    recording, so the orphan-recovery banner can show the real title and duration.
 *
 * The chunk transport (base64 through focusos-upload-audio-chunk) is unchanged.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { isCapturing as brainDumpCapturing } from '@/lib/brainDumpAudio';

export interface MeetingParticipant {
  name: string;
  email: string;
}

export interface StartOptions {
  title: string;
  projectId?: string | null;
  participants?: MeetingParticipant[];
}

export type RecorderPhase = 'idle' | 'recording' | 'paused' | 'saving';

export interface SavedMeeting {
  id: string;
  /** processing_status the server returned, or null when it did not say. */
  processingStatus: string | null;
}

export interface RecorderSnapshot {
  phase: RecorderPhase;
  sessionId: string | null;
  title: string;
  /** Wall-clock ms when recording began. */
  startedAt: number;
  /** Total ms spent paused so far (closed pauses only). */
  pausedMs: number;
  /** Wall-clock ms the current pause began, or null while not paused. */
  pausedAt: number | null;
  /** Wall-clock ms the recording was stopped; elapsed freezes here while saving. */
  endedAt: number | null;
  /** Bumped each time a save completes; `saved` is that save's meeting. */
  savedSeq: number;
  saved: SavedMeeting | null;
  /** Bumped each time a save fails; `failedSessionId` is that save's session. */
  failedSeq: number;
  failedSessionId: string | null;
}

export const RECORDING_SESSION_STORAGE_KEY = 'focusos-meeting-recording-session';

export interface PersistedRecording {
  sessionId: string;
  startedAt: number;
  title: string;
  pausedMs: number;
  /** Set when Stop was pressed. */
  endedAt?: number;
  /** Set on every successful chunk upload (the best end-time guess after a crash). */
  lastChunkAt?: number;
}

/** Test hook only: window.__meetingRecorderTuning = { flushMs, backoffMs }. */
const tuning = (): { flushMs: number; backoffMs: number } => {
  const t = (typeof window !== 'undefined' && (window as any).__meetingRecorderTuning) || {};
  return {
    flushMs: typeof t.flushMs === 'number' ? t.flushMs : 10_000,
    backoffMs: typeof t.backoffMs === 'number' ? t.backoffMs : 1000,
  };
};

const TICK_MAX_ATTEMPTS = 4;
const FINAL_MAX_ATTEMPTS = 8;
const BACKOFF_CAP_MS = 15_000;

/* ─── localStorage mirror ─────────────────────────────── */

export function readPersistedRecording(): PersistedRecording | null {
  try {
    const raw = localStorage.getItem(RECORDING_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.sessionId !== 'string' || typeof p.startedAt !== 'number') return null;
    return p as PersistedRecording;
  } catch {
    return null;
  }
}

function writePersisted(patch: Partial<PersistedRecording> & { sessionId: string }) {
  try {
    const prev = readPersistedRecording();
    const base = prev && prev.sessionId === patch.sessionId ? prev : ({} as Partial<PersistedRecording>);
    localStorage.setItem(RECORDING_SESSION_STORAGE_KEY, JSON.stringify({ ...base, ...patch }));
  } catch {
    /* storage blocked: recovery just falls back to its estimate */
  }
}

export function clearPersistedRecording() {
  try {
    localStorage.removeItem(RECORDING_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Real duration in whole seconds for a persisted record, or null when unknown. */
export function persistedDurationSeconds(p: PersistedRecording): number | null {
  const end = p.endedAt ?? p.lastChunkAt;
  if (typeof end !== 'number') return null;
  return Math.max(0, Math.round((end - p.startedAt - (p.pausedMs || 0)) / 1000));
}

/* ─── module state ────────────────────────────────────── */

interface QueueItem {
  blob: Blob;
  b64?: string;
}

interface Active {
  stream: MediaStream;
  recorder: MediaRecorder;
  mimeType: string;
  sessionId: string;
  projectId: string | null;
  participants: MeetingParticipant[];
  buffer: Blob[];
  queue: QueueItem[];
  nextIndex: number;
  drainPromise: Promise<boolean> | null;
  flushRequested: boolean;
  flushTimer: ReturnType<typeof setInterval> | null;
}

let active: Active | null = null;
let starting = false;
let wakeLock: any = null;

const initial: RecorderSnapshot = {
  phase: 'idle',
  sessionId: null,
  title: '',
  startedAt: 0,
  pausedMs: 0,
  pausedAt: null,
  endedAt: null,
  savedSeq: 0,
  saved: null,
  failedSeq: 0,
  failedSessionId: null,
};

let snapshot: RecorderSnapshot = initial;
const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<RecorderSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable between changes: the same object is returned until the next setSnapshot. */
export function getSnapshot(): RecorderSnapshot {
  return snapshot;
}

/** True while a recording is live OR paused: the mic is held either way. */
export function isRecording(): boolean {
  return snapshot.phase === 'recording' || snapshot.phase === 'paused';
}

/** Pure: elapsed recorded milliseconds at `now`, pauses excluded. */
export function elapsedMs(s: RecorderSnapshot, now: number): number {
  if (s.phase === 'idle') return 0;
  const end = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

/* ─── helpers ─────────────────────────────────────────── */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function blobToBase64(blob: Blob): Promise<string> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const batch = 8192;
  for (let i = 0; i < u8.length; i += batch) {
    binary += String.fromCharCode(...u8.subarray(i, i + batch));
  }
  return btoa(binary);
}

async function acquireWakeLock() {
  try {
    const nav = navigator as any;
    if (!nav.wakeLock?.request) return;
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* unsupported, denied or page hidden: never fatal */
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

/* ─── upload queue ────────────────────────────────────── */

/**
 * Upload the head of the queue until it is empty. A chunk's index is only
 * consumed when its upload succeeded; on failure the SAME item is retried with the
 * SAME index after a backoff, so the server never sees a gap. Returns false when
 * the attempts ran out (the queue keeps its items for the next flush).
 */
function drain(a: Active, maxAttempts: number): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    while (a.drainPromise) await a.drainPromise;
    if (a.queue.length === 0) return true;
    const p = (async () => {
      let attempts = 0;
      while (a.queue.length > 0) {
        const item = a.queue[0];
        const index = a.nextIndex;
        try {
          if (item.b64 === undefined) item.b64 = await blobToBase64(item.blob);
          const { error } = await supabase.functions.invoke('focusos-upload-audio-chunk', {
            body: { sessionId: a.sessionId, chunkIndex: index, audioBase64: item.b64 },
          });
          if (error) throw error;
          a.queue.shift();
          a.nextIndex = index + 1;
          attempts = 0;
          writePersisted({ sessionId: a.sessionId, lastChunkAt: Date.now() });
        } catch (err) {
          attempts += 1;
          console.error(`Chunk ${index} upload failed (attempt ${attempts}):`, err);
          if (attempts >= maxAttempts) return false;
          await sleep(Math.min(tuning().backoffMs * 2 ** (attempts - 1), BACKOFF_CAP_MS));
        }
      }
      return true;
    })();
    a.drainPromise = p;
    try {
      return await p;
    } finally {
      a.drainPromise = null;
    }
  };
  return run();
}

function enqueueBuffer(a: Active, drainAfter: boolean) {
  if (a.buffer.length > 0) {
    a.queue.push({ blob: new Blob(a.buffer, { type: a.mimeType }) });
    a.buffer = [];
  }
  if (drainAfter && a.queue.length > 0) void drain(a, TICK_MAX_ATTEMPTS);
}

/** Cut the current buffer into a chunk now and upload it. */
function flush() {
  const a = active;
  if (!a) return;
  if (a.recorder.state === 'inactive') {
    enqueueBuffer(a, true);
    return;
  }
  a.flushRequested = true;
  try {
    // The matching dataavailable event enqueues the buffer (see ondataavailable).
    a.recorder.requestData();
  } catch {
    a.flushRequested = false;
    enqueueBuffer(a, true);
  }
}

/* ─── lifecycle ───────────────────────────────────────── */

export async function start(opts: StartOptions): Promise<boolean> {
  if (starting || snapshot.phase !== 'idle') return false;
  if (brainDumpCapturing()) {
    toast.error('Brain dump is using the microphone. Finish it first.', { id: 'meeting-mic-lockout' });
    return false;
  }
  starting = true;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
    });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';

    const { data: sessionData, error: sessionError } = await supabase.functions.invoke(
      'focusos-start-recording-session',
      { body: { mimeType: mimeType.split(';')[0] } },
    );
    if (sessionError || !sessionData?.sessionId) throw new Error('Failed to start recording session');

    const recorder = new MediaRecorder(stream, { mimeType });
    const a: Active = {
      stream,
      recorder,
      mimeType,
      sessionId: sessionData.sessionId,
      projectId: opts.projectId ?? null,
      participants: (opts.participants ?? []).filter((p) => p.name.trim()),
      buffer: [],
      queue: [],
      nextIndex: 0,
      drainPromise: null,
      flushRequested: false,
      flushTimer: null,
    };

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) a.buffer.push(e.data);
      if (a.flushRequested) {
        a.flushRequested = false;
        enqueueBuffer(a, true);
      }
    };

    active = a;
    const startedAt = Date.now();
    recorder.start(1000);
    a.flushTimer = setInterval(flush, tuning().flushMs);

    writePersisted({
      sessionId: a.sessionId,
      startedAt,
      title: opts.title,
      pausedMs: 0,
    });
    void acquireWakeLock();

    setSnapshot({
      phase: 'recording',
      sessionId: a.sessionId,
      title: opts.title,
      startedAt,
      pausedMs: 0,
      pausedAt: null,
      endedAt: null,
    });
    toast.success('Recording started');
    return true;
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    active = null;
    if (error instanceof Error && error.name === 'NotAllowedError') {
      toast.error('Microphone access denied. Check browser permissions.');
    } else {
      toast.error('Failed to start recording. Check your microphone.');
      console.error('Recording error:', error);
    }
    return false;
  } finally {
    starting = false;
  }
}

export function pause() {
  const a = active;
  if (!a || snapshot.phase !== 'recording' || a.recorder.state !== 'recording') return;
  a.recorder.pause();
  const pausedAt = Date.now();
  setSnapshot({ phase: 'paused', pausedAt });
  flush();
}

export function resume() {
  const a = active;
  if (!a || snapshot.phase !== 'paused' || a.recorder.state !== 'paused') return;
  a.recorder.resume();
  const pausedMs = snapshot.pausedMs + (Date.now() - (snapshot.pausedAt ?? Date.now()));
  setSnapshot({ phase: 'recording', pausedMs, pausedAt: null });
  writePersisted({ sessionId: a.sessionId, pausedMs });
  void acquireWakeLock();
}

export function stop() {
  const a = active;
  if (!a || !isRecording()) return;
  const endedAt = Date.now();
  const pausedMs = snapshot.pausedMs + (snapshot.pausedAt ? endedAt - snapshot.pausedAt : 0);
  const durationSeconds = Math.max(0, Math.round((endedAt - snapshot.startedAt - pausedMs) / 1000));
  if (a.flushTimer) {
    clearInterval(a.flushTimer);
    a.flushTimer = null;
  }
  releaseWakeLock();
  writePersisted({ sessionId: a.sessionId, pausedMs, endedAt });
  setSnapshot({ phase: 'saving', pausedMs, pausedAt: null, endedAt });

  if (a.recorder.state === 'inactive') {
    void finalize(a, durationSeconds);
    return;
  }
  a.recorder.onstop = () => void finalize(a, durationSeconds);
  try {
    a.recorder.stop();
  } catch {
    void finalize(a, durationSeconds);
  }
}

async function finalize(a: Active, durationSeconds: number) {
  a.stream.getTracks().forEach((t) => t.stop());
  enqueueBuffer(a, false);
  const drained = await drain(a, FINAL_MAX_ATTEMPTS);

  const fail = (message: string) => {
    toast.error(message);
    active = null;
    setSnapshot({
      phase: 'idle',
      failedSeq: snapshot.failedSeq + 1,
      failedSessionId: a.sessionId,
    });
  };

  if (a.nextIndex === 0) {
    fail('Failed to upload the recording. It is saved on this device only if the page stays open; try again.');
    return;
  }
  if (!drained) {
    toast.warning('Some of the last audio could not be uploaded. The rest of the meeting is being saved.');
  }

  toast.info('Uploading and processing your meeting...');
  try {
    const { data, error } = await supabase.functions.invoke('focusos-process-meeting', {
      body: {
        sessionId: a.sessionId,
        mimeType: a.mimeType.split(';')[0],
        projectId: a.projectId,
        title:
          snapshot.title.trim() ||
          `Meeting ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        durationSeconds,
        participants: a.participants,
      },
    });
    if (error) throw error;

    clearPersistedRecording();
    active = null;
    const status: string | null = data?.processing_status ?? null;
    setSnapshot({
      phase: 'idle',
      savedSeq: snapshot.savedSeq + 1,
      saved: { id: data?.id, processingStatus: status },
    });
    if (status && status !== 'done' && data?.id) {
      triggerTranscription(data.id);
      toast.success('Meeting saved. Transcribing now.');
    } else {
      toast.success('Meeting processed successfully!');
    }
  } catch (error) {
    console.error('Process meeting error:', error);
    // The persisted record stays so the recovery banner can show the real title.
    fail('Failed to process meeting. Your recording is saved. Use the recovery banner to retry.');
  }
}

/**
 * Kick the segmented transcriber. Its whole contract is the meeting id: the worker
 * reads everything else off the row. Not awaited: it may "fail" on the gateway
 * timeout while the function keeps running server-side.
 */
export function triggerTranscription(meetingId: string, opts?: { retry?: boolean }) {
  try {
    supabase.functions
      .invoke('focusos-transcribe-meeting', {
        body: opts?.retry ? { meetingId, retry: true } : { meetingId },
      })
      .catch((err: any) => {
        console.log('transcribe-meeting invoke completed or timed out (expected):', err?.message);
      });
  } catch (err) {
    console.error('Failed to trigger transcription:', err);
  }
}

/* ─── page-lifecycle listeners (module level) ─────────── */

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!isRecording()) return;
    if (document.visibilityState === 'hidden') {
      flush();
    } else {
      void acquireWakeLock();
    }
  });
  window.addEventListener('pagehide', () => {
    if (isRecording()) flush();
  });
}

/* ─── React binding ───────────────────────────────────── */

/**
 * Snapshot plus a derived elapsed time. The elapsed value is computed from
 * startedAt and the pause accumulator on EVERY render, never counted by ticks, so
 * a throttled or hidden tab cannot undercount; the 1 s interval only forces the
 * re-render (and a visible-again render happens at once).
 */
export function useMeetingRecorder(): { snap: RecorderSnapshot; elapsedSeconds: number } {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (snap.phase !== 'recording') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [snap.phase]);
  return { snap, elapsedSeconds: Math.floor(elapsedMs(snap, Date.now()) / 1000) };
}

/** Subscribe-only helper for mic entry points (disables them while a meeting records). */
export function useMeetingRecordingActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.phase === 'recording' || snapshot.phase === 'paused',
    () => false,
  );
}

export const MEETING_MIC_HINT = 'Meeting recording in progress';

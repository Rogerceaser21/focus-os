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
 *  - {sessionId, startedAt, title, pausedMs, ...} is mirrored to localStorage (one
 *    record PER session) while recording, so the orphan-recovery banner can show
 *    the real title and duration;
 *  - Stop never gives up on the network: the save stays alive in a "waiting for
 *    connection" state, retries (backoff capped at 30 s, immediately on `online` and
 *    on visible) and calls process-meeting only once the queue is EMPTY. Unsent
 *    chunks are mirrored to IndexedDB, so a reload or a closed tab loses nothing;
 *    on the next start they are uploaded in order and the save is finished.
 *  - Sign-out stops the mic at once and keeps the unsent chunks for that user id;
 *    they are never uploaded under another account.
 *
 * The chunk transport (base64 through focusos-upload-audio-chunk) is unchanged.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { isCapturing as brainDumpCapturing } from '@/lib/brainDumpAudio';
import { SHELL_REC } from '@/lib/shell';
import { putChunk, deleteChunk, getSessionChunks, listChunkSessionIds, deleteSessionChunks, deleteStaleChunks } from '@/lib/meetingChunkStore';

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
  /** The recording session this save belongs to. */
  sessionId: string;
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
  /** Saves still running in the background (offline Stop, resumed after reload). */
  saveJobs: number;
  /** Chunks still to upload across those saves. */
  savePending: number;
  /** True while a save is retrying because uploads are failing. */
  saveWaiting: boolean;
  /** Why uploads wait: no connection, or (native recorder) the sign-in token needs refreshing. */
  saveWaitReason: 'network' | 'signin' | null;
  /** Native recorder only: paused by a call, alarm, Siri or a microphone/route failure; Resume continues. */
  interrupted: boolean;
  /** Why: 'call' | 'route' | 'mediaReset' | 'noAudio' | 'engine' (null when not interrupted). */
  interruptReason: string | null;
  /** Bumped each time a save completes; `saved` is that save's meeting. */
  savedSeq: number;
  saved: SavedMeeting | null;
  /** Bumped each time a save fails; `failedSessionId` is that save's session. */
  failedSeq: number;
  failedSessionId: string | null;
}

export const RECORDING_SESSION_STORAGE_KEY = 'focusos-meeting-recording-sessions';

export interface PersistedRecording {
  sessionId: string;
  userId?: string | null;
  projectId?: string | null;
  participants?: MeetingParticipant[];
  mimeType?: string;
  startedAt: number;
  title: string;
  pausedMs: number;
  /** Set when Stop was pressed. */
  endedAt?: number;
  /** Set on every successful chunk upload (the best end-time guess after a crash). */
  lastChunkAt?: number;
  /** The server closed this session; its unsent chunks are kept but no longer retried. */
  closed?: boolean;
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

/* ─── localStorage mirror (one record per session) ───── */

type RecordMap = Record<string, PersistedRecording>;

function readMap(): RecordMap {
  try {
    const raw = localStorage.getItem(RECORDING_SESSION_STORAGE_KEY);
    const m = raw ? JSON.parse(raw) : null;
    return m && typeof m === 'object' ? (m as RecordMap) : {};
  } catch {
    return {};
  }
}

function writeMap(m: RecordMap) {
  try {
    if (Object.keys(m).length === 0) localStorage.removeItem(RECORDING_SESSION_STORAGE_KEY);
    else localStorage.setItem(RECORDING_SESSION_STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: recovery just falls back to its estimate */
  }
}

export function readPersistedRecording(sessionId: string): PersistedRecording | null {
  const p = readMap()[sessionId];
  return p && typeof p.startedAt === 'number' ? p : null;
}

function writePersisted(patch: Partial<PersistedRecording> & { sessionId: string }) {
  const m = readMap();
  m[patch.sessionId] = { ...(m[patch.sessionId] || {}), ...patch } as PersistedRecording;
  writeMap(m);
}

export function clearPersistedRecording(sessionId: string) {
  const m = readMap();
  if (!(sessionId in m)) return;
  delete m[sessionId];
  writeMap(m);
}

/** Real duration in whole seconds for a persisted record, or null when unknown. */
export function persistedDurationSeconds(p: PersistedRecording): number | null {
  const end = p.endedAt ?? p.lastChunkAt;
  if (typeof end !== 'number') return null;
  return Math.max(0, Math.round((end - p.startedAt - (p.pausedMs || 0)) / 1000));
}

/* ─── module state ────────────────────────────────────── */

interface QueueItem {
  index: number;
  blob: Blob;
  b64?: string;
  persisted?: Promise<void>;
}

/** Everything the save path needs; outlives the MediaRecorder. */
interface Job {
  sessionId: string;
  userId: string | null;
  mimeType: string;
  projectId: string | null;
  participants: MeetingParticipant[];
  title: string;
  queue: QueueItem[];
  /** Next chunk index to hand out; spent for good only when the upload succeeds. */
  nextAssign: number;
  drainPromise: Promise<boolean> | null;
  waiting: boolean;
  halted: boolean;
  /** Releases this tab's save lease for the session (held from start/resume to the end of the save). */
  release?: (() => void) | null;
  /** Last time the session row was read to see whether the server closed it. */
  lastCheckAt?: number;
  /** First time a clean read found NO row for the session. */
  missingSince?: number;
  /** Native recorder: chunks still on the phone, counted from native events (queue stays empty). */
  nativePending?: number;
  /** Native recorder: the reason uploads are waiting, if they are. */
  nativeWaitReason?: 'network' | 'signin' | null;
  /** Native recorder: process-meeting already started for this job. */
  finalizing?: boolean;
}

interface Active {
  job: Job;
  stream: MediaStream;
  recorder: MediaRecorder;
  buffer: Blob[];
  flushRequested: boolean;
  flushTimer: ReturnType<typeof setInterval> | null;
}

let active: Active | null = null;
let starting = false;
let wakeLock: any = null;
let wakeGen = 0;
let currentUserId: string | null = null;
const jobs = new Set<Job>();

const initial: RecorderSnapshot = {
  phase: 'idle',
  sessionId: null,
  title: '',
  startedAt: 0,
  pausedMs: 0,
  pausedAt: null,
  endedAt: null,
  saveJobs: 0,
  savePending: 0,
  saveWaiting: false,
  saveWaitReason: null,
  interrupted: false,
  interruptReason: null,
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

function refreshSaveStats() {
  let pending = 0;
  let waiting = false;
  let reason: 'network' | 'signin' | null = null;
  jobs.forEach((j) => {
    pending += j.queue.length + (j.nativePending ?? 0);
    if (j.waiting) {
      waiting = true;
      reason = j.nativeWaitReason === 'signin' ? 'signin' : reason ?? 'network';
    }
  });
  if (!waiting) reason = null;
  if (
    jobs.size === snapshot.saveJobs &&
    pending === snapshot.savePending &&
    waiting === snapshot.saveWaiting &&
    reason === snapshot.saveWaitReason
  )
    return;
  setSnapshot({ saveJobs: jobs.size, savePending: pending, saveWaiting: waiting, saveWaitReason: reason });
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

/** True while this session is recording or its save is still running (never an orphan). */
export function isSessionInFlight(sessionId: string): boolean {
  return (
    active?.job.sessionId === sessionId ||
    nativeJob?.sessionId === sessionId ||
    Array.from(jobs).some((j) => j.sessionId === sessionId)
  );
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

const wakers = new Set<() => void>();
/** Wake every sleeping retry now (network came back, tab visible again, halt). */
function wakeAll() {
  Array.from(wakers).forEach((w) => w());
}
const sleepOrWake = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      wakers.delete(done);
      resolve();
    };
    const t = setTimeout(done, ms);
    wakers.add(done);
  });

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
  const gen = wakeGen;
  try {
    const nav = navigator as any;
    if (!nav.wakeLock?.request) return;
    if (wakeLock && !wakeLock.released) return;
    const lock = await nav.wakeLock.request('screen');
    if (gen !== wakeGen) {
      // Stop landed while the request was pending: give it straight back.
      try {
        lock?.release?.();
      } catch {
        /* ignore */
      }
      return;
    }
    wakeLock = lock;
  } catch {
    /* unsupported, denied or page hidden: never fatal */
  }
}

function releaseWakeLock() {
  wakeGen += 1;
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

/* ─── one tab owns a session's save ────────────────────── */

const LEASE_TTL_MS = 90_000;
const LEASE_BEAT_MS = 5_000;
const TAB_ID = Math.random().toString(36).slice(2);
/** Lease heartbeats, also run when the tab becomes visible (timers are throttled in the background). */
const leaseBeats = new Set<() => void>();

/**
 * Take ownership of a session's upload + save so two tabs of the same browser can
 * never both run it (process-meeting has no status guard and would duplicate the
 * meeting). Web Locks where available (auto-released if the tab dies); otherwise a
 * localStorage lease with a heartbeat. Resolves null when another tab owns it.
 */
async function acquireSessionLease(sessionId: string): Promise<(() => void) | null> {
  const locks = (typeof navigator !== 'undefined' ? (navigator as any).locks : undefined) as
    | { request: (name: string, opts: any, cb: (lock: unknown) => Promise<void> | void) => Promise<unknown> }
    | undefined;
  if (locks?.request) {
    return new Promise((resolve) => {
      void locks
        .request(`focusos-meeting-save-${sessionId}`, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          return new Promise<void>((held) => resolve(() => held()));
        })
        .catch(() => resolve(() => {}));
    });
  }
  const key = `focusos-meeting-lease-${sessionId}`;
  try {
    const cur = JSON.parse(localStorage.getItem(key) || 'null');
    if (cur && cur.owner !== TAB_ID && Date.now() - cur.ts < LEASE_TTL_MS) return null;
    const beat = () => localStorage.setItem(key, JSON.stringify({ owner: TAB_ID, ts: Date.now() }));
    beat();
    leaseBeats.add(beat);
    const timer = setInterval(beat, LEASE_BEAT_MS);
    return () => {
      clearInterval(timer);
      leaseBeats.delete(beat);
      try {
        const now = JSON.parse(localStorage.getItem(key) || 'null');
        if (now?.owner === TAB_ID) localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => {};
  }
}

/** Remove a session's chunks + record (Discard, a server-side permanent refusal). */
export async function discardSessionData(sessionId: string) {
  nativePost({ cmd: 'discard', sessionId });
  nativePendingBySession.delete(sessionId);
  clearPersistedRecording(sessionId);
  await deleteSessionChunks(sessionId);
}

/* ─── upload queue ────────────────────────────────────── */

/**
 * POLICY: an upload ERROR never deletes audio and never retires a session. The
 * approval gate fails closed (403) and the upload function maps any database hiccup
 * to "Session not found", so no error message can be trusted to mean "never". Unsent
 * chunks leave IndexedDB only when uploaded, on Discard, or by the 7-day cleanup.
 * The ONLY thing that stops a save loop is a DIRECT read of the session row that
 * succeeds and shows it is no longer 'recording' (or, twice at least a minute
 * apart, shows no row at all).
 */
const CHECK_EVERY_MS = 20_000;
const MISSING_CONFIRM_MS = 60_000;

/** Non-network failure = the server answered with an error (HTTP response present). */
const isServerError = (err: any) => typeof err?.context?.status === 'number';

async function sessionIsClosed(job: Job): Promise<boolean> {
  const now = Date.now();
  if (job.lastCheckAt && now - job.lastCheckAt < CHECK_EVERY_MS) return false;
  job.lastCheckAt = now;
  try {
    const { data, error } = await (supabase as any)
      .from('focusos_recording_sessions')
      .select('status')
      .eq('id', job.sessionId)
      .maybeSingle();
    if (error) return false; // an unreadable row proves nothing
    if (data === null) {
      if (!job.missingSince) job.missingSince = now;
      return now - job.missingSince >= MISSING_CONFIRM_MS;
    }
    job.missingSince = undefined;
    return typeof data?.status === 'string' && data.status !== 'recording';
  } catch {
    return false;
  }
}

/** Stop retrying a session the server closed. Chunks and record are KEPT. */
function stopClosedJob(job: Job) {
  job.halted = true;
  jobs.delete(job);
  job.waiting = false;
  wakeAll();
  writePersisted({ sessionId: job.sessionId, closed: true });
  toast.error('Part of this meeting could not be uploaded; it is kept on this device.', {
    id: `closed-${job.sessionId}`,
  });
  refreshSaveStats();
  if (snapshot.phase === 'saving' && snapshot.sessionId === job.sessionId) setSnapshot({ phase: 'idle' });
  job.release?.();
  job.release = null;
}

const BACKOFF_CAP_TICK_MS = 15_000;
const BACKOFF_CAP_FINAL_MS = 30_000;
const BACKOFF_CAP_SERVER_MS = 120_000;

/**
 * Upload the head of the queue until it is empty. A chunk's index is only
 * consumed when its upload succeeded; on failure the SAME item is retried with the
 * SAME index after a backoff, so the server never sees a gap. `maxAttempts`
 * Infinity (the save path) never gives up: it flags the job as waiting, sleeps
 * with a capped backoff and is woken at once by `online` / visible. Returns false
 * when the attempts ran out or the job was halted (the queue keeps its items).
 */
function drain(job: Job, maxAttempts: number): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    while (job.drainPromise) await job.drainPromise;
    if (job.queue.length === 0) return true;
    const p = (async () => {
      let attempts = 0;
      while (job.queue.length > 0) {
        if (job.halted) return false;
        const item = job.queue[0];
        try {
          if (item.persisted) await item.persisted;
          if (item.b64 === undefined) item.b64 = await blobToBase64(item.blob);
          const { error } = await supabase.functions.invoke('focusos-upload-audio-chunk', {
            body: { sessionId: job.sessionId, chunkIndex: item.index, audioBase64: item.b64 },
          });
          if (error) throw error;
          if (job.halted) return false;
          job.queue.shift();
          void deleteChunk(job.sessionId, item.index);
          attempts = 0;
          job.waiting = false;
          writePersisted({ sessionId: job.sessionId, lastChunkAt: Date.now() });
          refreshSaveStats();
        } catch (err) {
          attempts += 1;
          console.error(`Chunk ${item.index} upload failed (attempt ${attempts}):`, err);
          const serverSide = isServerError(err);
          if (serverSide && (await sessionIsClosed(job))) {
            stopClosedJob(job);
            return false;
          }
          if (maxAttempts === Infinity) {
            job.waiting = true;
            // A save that is waiting for the connection becomes a BACKGROUND save:
            // the page and pill leave the foreground "saving" state so a new
            // meeting can start while this one keeps retrying.
            if (snapshot.phase === 'saving' && snapshot.sessionId === job.sessionId) setSnapshot({ phase: 'idle' });
            refreshSaveStats();
          }
          if (job.halted || attempts >= maxAttempts) return false;
          const cap = serverSide
            ? BACKOFF_CAP_SERVER_MS
            : maxAttempts === Infinity
            ? BACKOFF_CAP_FINAL_MS
            : BACKOFF_CAP_TICK_MS;
          await sleepOrWake(Math.min(tuning().backoffMs * 2 ** (attempts - 1), cap));
          if (job.halted) return false;
        }
      }
      return true;
    })();
    job.drainPromise = p;
    try {
      return await p;
    } finally {
      job.drainPromise = null;
    }
  };
  return run();
}

function enqueueBuffer(a: Active, drainAfter: boolean) {
  const job = a.job;
  if (a.buffer.length > 0) {
    const item: QueueItem = {
      index: job.nextAssign++,
      blob: new Blob(a.buffer, { type: job.mimeType }),
    };
    item.persisted = putChunk(job.sessionId, item.index, item.blob);
    job.queue.push(item);
    a.buffer = [];
  }
  if (drainAfter && !job.halted && job.queue.length > 0) void drain(job, 4);
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
  // A save still running in the background (offline Stop) never blocks a new meeting.
  if (starting || (snapshot.phase !== 'idle' && snapshot.phase !== 'saving')) return false;
  if (brainDumpCapturing()) {
    toast.error('Brain dump is using the microphone. Finish it first.', { id: 'meeting-mic-lockout' });
    return false;
  }
  if (useNative()) return startNative(opts);
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

    let userId = currentUserId;
    if (!userId) {
      try {
        userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
      } catch {
        userId = null;
      }
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const job: Job = {
      sessionId: sessionData.sessionId,
      userId,
      mimeType: mimeType.split(';')[0],
      projectId: opts.projectId ?? null,
      participants: (opts.participants ?? []).filter((p) => p.name.trim()),
      title: opts.title,
      queue: [],
      nextAssign: 0,
      drainPromise: null,
      waiting: false,
      halted: false,
    };
    job.release = await acquireSessionLease(job.sessionId);
    const a: Active = { job, stream, recorder, buffer: [], flushRequested: false, flushTimer: null };

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
      sessionId: job.sessionId,
      userId,
      projectId: job.projectId,
      participants: job.participants,
      mimeType: job.mimeType,
      startedAt,
      title: opts.title,
      pausedMs: 0,
    });
    void acquireWakeLock();

    setSnapshot({
      phase: 'recording',
      sessionId: job.sessionId,
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
  if (nativeJob) return pauseNative();
  const a = active;
  if (!a || snapshot.phase !== 'recording' || a.recorder.state !== 'recording') return;
  a.recorder.pause();
  const pausedAt = Date.now();
  setSnapshot({ phase: 'paused', pausedAt });
  flush();
}

export function resume() {
  if (nativeJob) return resumeNative();
  const a = active;
  if (!a || snapshot.phase !== 'paused' || a.recorder.state !== 'paused') return;
  a.recorder.resume();
  const pausedMs = snapshot.pausedMs + (Date.now() - (snapshot.pausedAt ?? Date.now()));
  setSnapshot({ phase: 'recording', pausedMs, pausedAt: null });
  writePersisted({ sessionId: a.job.sessionId, pausedMs });
  void acquireWakeLock();
}

export function stop() {
  if (nativeJob) return stopNative();
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
  a.job.title = snapshot.title;
  writePersisted({ sessionId: a.job.sessionId, pausedMs, endedAt });
  setSnapshot({ phase: 'saving', pausedMs, pausedAt: null, endedAt });

  const finish = () => {
    a.stream.getTracks().forEach((t) => t.stop());
    enqueueBuffer(a, false);
    if (active === a) active = null;
    void runSave(a.job, durationSeconds);
  };
  if (a.recorder.state === 'inactive') {
    finish();
    return;
  }
  a.recorder.onstop = finish;
  try {
    a.recorder.stop();
  } catch {
    finish();
  }
}

/** Foreground bookkeeping: the pill / banner leave "saving" when THIS save ends. */
function leaveSaving(job: Job, patch: Partial<RecorderSnapshot>) {
  const foreground = snapshot.phase === 'saving' && snapshot.sessionId === job.sessionId;
  setSnapshot(foreground ? { phase: 'idle', ...patch } : patch);
}

/**
 * Finish a save: upload EVERYTHING still queued (never giving up, waiting for the
 * connection as long as it takes), and only then call process-meeting and clear
 * the record. A halted job (sign-out) leaves its record and its IndexedDB chunks
 * for the same user's next session.
 */
async function runSave(job: Job, durationSeconds: number) {
  // Only the tab that owns the session's lease uploads and saves it.
  if (job.release === undefined) job.release = await acquireSessionLease(job.sessionId);
  if (job.release === null) {
    if (snapshot.phase === 'saving' && snapshot.sessionId === job.sessionId) setSnapshot({ phase: 'idle' });
    return; // another tab owns this save
  }
  try {
    await runSaveOwned(job, durationSeconds);
  } finally {
    job.release?.();
    job.release = null;
  }
}

async function runSaveOwned(job: Job, durationSeconds: number) {
  jobs.add(job);
  refreshSaveStats();
  if (job.queue.length > 0) toast.info('Uploading your meeting...', { id: `save-${job.sessionId}` });
  const drained = await drain(job, Infinity);
  jobs.delete(job);
  job.waiting = false;
  if (!drained || job.halted) {
    refreshSaveStats();
    if (snapshot.phase === 'saving' && snapshot.sessionId === job.sessionId) setSnapshot({ phase: 'idle' });
    return;
  }
  refreshSaveStats();
  await finalizeSave(job, durationSeconds);
}

/** Everything after the last chunk is uploaded: process-meeting, once. */
async function finalizeSave(job: Job, durationSeconds: number) {

  // Another tab (or Recover) may have processed this session already: never run
  // process-meeting twice. Skip only on a status we can positively read.
  try {
    const { data: row } = await (supabase as any)
      .from('focusos_recording_sessions')
      .select('status')
      .eq('id', job.sessionId)
      .maybeSingle();
    if (row && typeof row.status === 'string' && row.status !== 'recording') {
      void discardSessionData(job.sessionId);
      toast.dismiss(`save-${job.sessionId}`);
      toast.info('This meeting was already saved elsewhere.');
      leaveSaving(job, {});
      return;
    }
  } catch {
    /* unreadable: carry on, the server call below is the authority */
  }

  try {
    const { data, error } = await supabase.functions.invoke('focusos-process-meeting', {
      body: {
        sessionId: job.sessionId,
        mimeType: job.mimeType,
        projectId: job.projectId,
        title:
          job.title.trim() ||
          `Meeting ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        durationSeconds,
        participants: job.participants,
      },
    });
    if (error) throw error;

    clearPersistedRecording(job.sessionId);
    const status: string | null = data?.processing_status ?? null;
    leaveSaving(job, {
      savedSeq: snapshot.savedSeq + 1,
      saved: { id: data?.id, sessionId: job.sessionId, processingStatus: status },
    });
    toast.dismiss(`save-${job.sessionId}`);
    if (status && status !== 'done' && data?.id) {
      triggerTranscription(data.id);
      toast.success('Meeting saved. Transcribing now.');
    } else {
      toast.success('Meeting processed successfully!');
    }
  } catch (error) {
    console.error('Process meeting error:', error);
    // The persisted record stays so the recovery banner can show the real title.
    toast.error('Failed to process meeting. Your recording is saved. Use the recovery banner to retry.');
    leaveSaving(job, { failedSeq: snapshot.failedSeq + 1, failedSessionId: job.sessionId });
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

/* ─── resume after reload / sign-out ──────────────────── */

let resuming = false;

/**
 * Called once per signed-in user: any session of THIS user that still holds unsent
 * chunks in IndexedDB is uploaded in index order. A session the user had already
 * stopped is then saved (process-meeting); one that was cut off mid-recording is
 * only uploaded, and the recovery banner offers it from the server's own session.
 */
export async function resumePendingSessions(userId: string): Promise<void> {
  if (resuming) return;
  resuming = true;
  try {
    await resumeScan(userId);
  } finally {
    resuming = false;
  }
}

async function resumeScan(userId: string): Promise<void> {
  if (useNative()) await processNativePending(userId);
  let ids: string[] = [];
  try {
    ids = await listChunkSessionIds();
  } catch {
    return;
  }
  for (const sessionId of ids) {
    if (active?.job.sessionId === sessionId) continue;
    if (Array.from(jobs).some((j) => j.sessionId === sessionId)) continue;
    const meta = readPersistedRecording(sessionId);
    if (!meta || meta.userId !== userId || meta.closed) continue;
    // Another tab of this browser may already own this session's save.
    const release = await acquireSessionLease(sessionId);
    if (release === null) continue;
    const stored = await getSessionChunks(sessionId);
    if (stored.length === 0) {
      release();
      continue;
    }
    const job: Job = {
      sessionId,
      userId,
      mimeType: meta.mimeType || 'audio/webm',
      projectId: meta.projectId ?? null,
      participants: meta.participants ?? [],
      title: meta.title || '',
      queue: stored.map((c) => ({
        index: c.chunkIndex,
        blob: new Blob([c.data], { type: c.mime || meta.mimeType || 'audio/webm' }),
      })),
      nextAssign: stored[stored.length - 1].chunkIndex + 1,
      drainPromise: null,
      waiting: false,
      halted: false,
      release,
    };
    if (typeof meta.endedAt === 'number') {
      toast.info('Finishing a meeting that was not fully saved...');
      void runSave(job, persistedDurationSeconds(meta) ?? 0);
    } else {
      jobs.add(job);
      refreshSaveStats();
      void drain(job, Infinity).then(() => {
        jobs.delete(job);
        refreshSaveStats();
        job.release?.();
        job.release = null;
      });
    }
  }
}

/** Sign-out: stop the mic now, never upload these chunks under another account. */
function haltForSignOut() {
  jobs.forEach((j) => {
    j.halted = true;
    j.release?.();
    j.release = null;
  });
  wakeAll();
  haltNativeForSignOut();
  const a = active;
  if (a) {
    a.job.halted = true;
    a.job.release?.();
    a.job.release = null;
    if (a.flushTimer) clearInterval(a.flushTimer);
    a.flushTimer = null;
    releaseWakeLock();
    const endedAt = Date.now();
    const pausedMs = snapshot.pausedMs + (snapshot.pausedAt ? endedAt - snapshot.pausedAt : 0);
    writePersisted({ sessionId: a.job.sessionId, pausedMs, endedAt, title: snapshot.title });
    // The last slice still reaches the buffer: persist it to IndexedDB for next time.
    a.recorder.onstop = () => enqueueBuffer(a, false);
    try {
      if (a.recorder.state !== 'inactive') a.recorder.stop();
    } catch {
      /* ignore */
    }
    a.stream.getTracks().forEach((t) => t.stop());
    active = null;
  }
  jobs.clear();
  setSnapshot({
    phase: 'idle',
    sessionId: null,
    pausedAt: null,
    endedAt: null,
    saveJobs: 0,
    savePending: 0,
    saveWaiting: false,
  });
}

/* ─── native engine (iOS shell, R3) ───────────────────── */

/**
 * In the iOS shell (window.__FOCUSOS_SHELL_REC__) the recording runs natively
 * (ios-shell NativeRecorder.swift: AVAudioEngine, AAC-LC ADTS 16 kHz mono ~32 kbps,
 * 10 s chunks on disk, native upload) because WKWebView capture stops in the
 * background. The web side only sends commands and mirrors the events into the
 * SAME snapshot, so RecordingPill and Meetings never learn which engine runs.
 *
 * Commands (window.webkit.messageHandlers.recorder.postMessage): ready, start,
 * pause, resume, stop, setAuth, clearAuth, status, forget, discard.
 * Events (window.__focusosNativeRecorder.onEvent): started, state, chunkSaved,
 * chunkUploaded, uploadWaiting, interrupted, resumed, stopped, error, pending.
 * Native owns pausedMs/pausedAt while it runs; the web adopts them from `state`.
 * Native never refreshes the session: setAuth is pushed on every token change.
 */
interface NativeEvent {
  type: string;
  at?: number;
  sessionId?: string;
  [k: string]: any;
}

/** Native rotates a chunk every 157 AAC frames at 16 kHz = 10.048 s (NativeRecorder.swift). */
const NATIVE_CHUNK_MS = 10_048;

interface NativePendingSession {
  sessionId: string;
  status: string;
  lastIndex: number;
  uploadedUpTo: number;
  pending: number;
  allUploaded: boolean;
  userId?: string;
}

/** The session native is recording right now (null otherwise). */
let nativeJob: Job | null = null;
/** Sessions native has stopped, waiting for their last piece before process-meeting. */
const nativeSaves = new Map<string, { job: Job; durationSeconds: number }>();
/** Pieces still on the phone per session, from native events (drives the recovery banner). */
const nativePendingBySession = new Map<string, number>();
let nativePendingList: NativePendingSession[] = [];
const NATIVE_START_TIMEOUT_MS = 60_000;
/** Test hook only: window.__meetingRecorderTuning.nativeStartMs shortens the start wait. */
const nativeStartTimeoutMs = (): number => {
  const t = (typeof window !== 'undefined' && (window as any).__meetingRecorderTuning) || {};
  return typeof t.nativeStartMs === 'number' ? t.nativeStartMs : NATIVE_START_TIMEOUT_MS;
};
let nativeStartWaiter: { resolve: (e: NativeEvent) => void; reject: (e: Error) => void } | null = null;

function nativeBridge(): { postMessage: (body: object) => void } | null {
  if (!SHELL_REC || typeof window === 'undefined') return null;
  return (window as any).webkit?.messageHandlers?.recorder ?? null;
}

/** True when this page runs inside a shell build that carries the native recorder. */
function useNative(): boolean {
  return nativeBridge() !== null;
}

function nativePost(body: object) {
  try {
    nativeBridge()?.postMessage(body);
  } catch (err) {
    console.error('native recorder post failed:', err);
  }
}

async function pushNativeAuth(sessionArg?: { access_token: string; expires_at?: number; user: { id: string } }) {
  if (!useNative()) return;
  try {
    const s = sessionArg ?? (await supabase.auth.getSession()).data.session;
    if (!s) return;
    nativePost({
      cmd: 'setAuth',
      supabaseUrl: (supabase as any).supabaseUrl,
      anonKey: (supabase as any).supabaseKey,
      accessToken: s.access_token,
      expiresAt: s.expires_at ?? 0,
      userId: s.user.id,
    });
  } catch {
    /* no session yet: native keeps waiting */
  }
}

function nativeJobFromRecord(sessionId: string, title?: string): Job {
  const meta = readPersistedRecording(sessionId);
  return {
    sessionId,
    userId: meta?.userId ?? currentUserId,
    mimeType: 'audio/aac',
    projectId: meta?.projectId ?? null,
    participants: meta?.participants ?? [],
    title: meta?.title || title || '',
    queue: [],
    nextAssign: 0,
    drainPromise: null,
    waiting: false,
    halted: false,
    nativePending: 0,
    nativeWaitReason: null,
  };
}

function setNativePending(sessionId: string, n: number) {
  const v = Math.max(0, n);
  if (v === 0) nativePendingBySession.delete(sessionId);
  else nativePendingBySession.set(sessionId, v);
  jobs.forEach((j) => {
    if (j.sessionId === sessionId) j.nativePending = v;
  });
  if (nativeJob?.sessionId === sessionId) nativeJob.nativePending = v;
  refreshSaveStats();
}

function startNative(opts: StartOptions): Promise<boolean> {
  return (async () => {
    starting = true;
    let startedSessionId: string | null = null;
    try {
      const { data: sessionData, error: sessionError } = await supabase.functions.invoke(
        'focusos-start-recording-session',
        { body: { mimeType: 'audio/aac' } },
      );
      if (sessionError || !sessionData?.sessionId) throw new Error('Failed to start recording session');
      const { data: auth } = await supabase.auth.getSession();
      const s = auth.session;
      if (!s) throw new Error('Not signed in');
      const sessionId: string = sessionData.sessionId;
      startedSessionId = sessionId;
      const started = new Promise<NativeEvent>((resolve, reject) => {
        // The microphone permission prompt can take a while: wait up to 60 s.
        const t = setTimeout(() => {
          nativeStartWaiter = null;
          reject(new Error('Native recorder did not start'));
        }, nativeStartTimeoutMs());
        nativeStartWaiter = {
          resolve: (e) => {
            clearTimeout(t);
            resolve(e);
          },
          reject: (e) => {
            clearTimeout(t);
            reject(e);
          },
        };
      });
      nativePost({
        cmd: 'start',
        sessionId,
        userId: s.user.id,
        supabaseUrl: (supabase as any).supabaseUrl,
        anonKey: (supabase as any).supabaseKey,
        accessToken: s.access_token,
        expiresAt: s.expires_at ?? 0,
      });
      const ev = await started;
      const startedAt = typeof ev.startedAt === 'number' ? ev.startedAt : Date.now();
      const job: Job = {
        sessionId,
        userId: s.user.id,
        mimeType: 'audio/aac',
        projectId: opts.projectId ?? null,
        participants: (opts.participants ?? []).filter((p) => p.name.trim()),
        title: opts.title,
        queue: [],
        nextAssign: 0,
        drainPromise: null,
        waiting: false,
        halted: false,
        nativePending: 0,
        nativeWaitReason: null,
      };
      nativeJob = job;
      writePersisted({
        sessionId,
        userId: job.userId,
        projectId: job.projectId,
        participants: job.participants,
        mimeType: 'audio/aac',
        startedAt,
        title: opts.title,
        pausedMs: 0,
      });
      setSnapshot({
        phase: 'recording',
        sessionId,
        title: opts.title,
        startedAt,
        pausedMs: 0,
        pausedAt: null,
        endedAt: null,
        interrupted: false,
        interruptReason: null,
      });
      startedSessionId = null; // started: a later failure is a normal stop, not a discard
      toast.success('Recording started');
      return true;
    } catch (error) {
      nativeStartWaiter = null;
      // The page gives up on this start: native must never record a session the page considers failed.
      if (startedSessionId) nativePost({ cmd: 'discard', sessionId: startedSessionId });
      const msg = error instanceof Error ? error.message : '';
      if (/denied/i.test(msg)) toast.error('Microphone access denied. Check Settings > Focus OS > Microphone.');
      else {
        toast.error('Failed to start recording. Check your microphone.');
        console.error('Recording error:', error);
      }
      return false;
    } finally {
      starting = false;
    }
  })();
}

function pauseNative() {
  if (!nativeJob || snapshot.phase !== 'recording') return;
  setSnapshot({ phase: 'paused', pausedAt: Date.now() });
  nativePost({ cmd: 'pause' });
}

function resumeNative() {
  if (!nativeJob || snapshot.phase !== 'paused') return;
  const pausedMs = snapshot.pausedMs + (Date.now() - (snapshot.pausedAt ?? Date.now()));
  setSnapshot({ phase: 'recording', pausedMs, pausedAt: null, interrupted: false, interruptReason: null });
  writePersisted({ sessionId: nativeJob.sessionId, pausedMs });
  nativePost({ cmd: 'resume' });
}

function stopNative() {
  const job = nativeJob;
  if (!job || !isRecording()) return;
  const endedAt = Date.now();
  const pausedMs = snapshot.pausedMs + (snapshot.pausedAt ? endedAt - snapshot.pausedAt : 0);
  const durationSeconds = Math.max(0, Math.round((endedAt - snapshot.startedAt - pausedMs) / 1000));
  job.title = snapshot.title;
  writePersisted({ sessionId: job.sessionId, pausedMs, endedAt });
  setSnapshot({ phase: 'saving', pausedMs, pausedAt: null, endedAt, interrupted: false, interruptReason: null });
  nativeSaves.set(job.sessionId, { job, durationSeconds });
  job.nativePending = nativePendingBySession.get(job.sessionId) ?? 0;
  jobs.add(job);
  nativeJob = null;
  refreshSaveStats();
  nativePost({ cmd: 'stop' });
}

/** Native finished the session and every piece is uploaded: save it, once. */
async function nativeFinish(sessionId: string) {
  const entry = nativeSaves.get(sessionId);
  if (!entry || entry.job.finalizing) return;
  const { job, durationSeconds } = entry;
  job.finalizing = true;
  setNativePending(sessionId, 0);
  job.waiting = false;
  jobs.delete(job);
  refreshSaveStats();
  try {
    await finalizeSave(job, durationSeconds);
  } finally {
    nativeSaves.delete(sessionId);
    // Saved (or already saved elsewhere): the phone's copy has done its job. On a
    // failed save the record stays and the files stay for the recovery banner.
    if (!readPersistedRecording(sessionId)) nativePost({ cmd: 'forget', sessionId });
  }
}

/** Native stopped retrying a session the server closed. Files and record are KEPT. */
function nativeParked(sessionId: string) {
  const entry = nativeSaves.get(sessionId);
  nativeSaves.delete(sessionId);
  Array.from(jobs).forEach((j) => {
    if (j.sessionId === sessionId) {
      j.halted = true;
      jobs.delete(j);
    }
  });
  if (entry) entry.job.halted = true;
  setNativePending(sessionId, 0);
  writePersisted({ sessionId, closed: true });
  toast.error('Part of this meeting could not be uploaded; it is kept on this device.', { id: `closed-${sessionId}` });
  refreshSaveStats();
  if (snapshot.phase === 'saving' && snapshot.sessionId === sessionId) setSnapshot({ phase: 'idle' });
}

/** Sessions native still holds from an earlier page life or app launch. */
async function processNativePending(userId: string) {
  await pushNativeAuth();
  for (const s of nativePendingList) {
    if (nativeJob?.sessionId === s.sessionId || nativeSaves.has(s.sessionId)) continue;
    const meta = readPersistedRecording(s.sessionId);
    if ((s as { parked?: boolean }).parked) {
      if (meta && meta.userId === userId && !meta.closed) writePersisted({ sessionId: s.sessionId, closed: true });
      continue;
    }
    if (!meta || meta.userId !== userId || meta.closed) continue;
    setNativePending(s.sessionId, s.pending);
    // The app was swiped away (force quit) mid-recording: native marks it 'killed'.
    // Treat it as stopped at its last saved piece, so reopening the app finishes the
    // meeting instead of leaving it for a recovery banner (Igor, 2026-11-11).
    if (s.status === 'killed' && typeof meta.endedAt !== 'number') {
      const pieces = Math.max(0, (s.lastIndex ?? -1) + 1);
      const endedAt = meta.startedAt + (meta.pausedMs || 0) + pieces * NATIVE_CHUNK_MS;
      writePersisted({ sessionId: s.sessionId, endedAt });
      meta.endedAt = endedAt;
    }
    const job = nativeJobFromRecord(s.sessionId);
    job.nativePending = s.pending;
    if (typeof meta.endedAt === 'number') {
      nativeSaves.set(s.sessionId, { job, durationSeconds: persistedDurationSeconds(meta) ?? 0 });
      if (s.allUploaded) {
        toast.info('Finishing a meeting that was not fully saved...');
        void nativeFinish(s.sessionId);
      } else {
        jobs.add(job);
        refreshSaveStats();
        toast.info('Finishing a meeting that was not fully saved...');
      }
    } else if (s.allUploaded) {
      // Cut off mid-recording and fully uploaded: the recovery banner offers it from the server.
      nativePost({ cmd: 'forget', sessionId: s.sessionId });
    } else {
      // Cut off mid-recording: only upload the rest.
      jobs.add(job);
      refreshSaveStats();
    }
  }
  nativePendingList = [];
}

function onNativeEvent(e: NativeEvent) {
  const sid = e.sessionId;
  switch (e.type) {
    case 'started':
      nativeStartWaiter?.resolve(e);
      nativeStartWaiter = null;
      break;
    case 'error':
      if (nativeStartWaiter) {
        nativeStartWaiter.reject(new Error(String(e.message ?? 'Native recorder error')));
        nativeStartWaiter = null;
      } else {
        toast.error(String(e.message ?? 'The recorder reported a problem.'), { id: 'native-recorder-error' });
      }
      break;
    case 'state': {
      if (e.state === 'idle') {
        // Native is not recording. If the page still believes it is, the recording
        // was lost (the page keeps its files for the recovery banner).
        if (!starting && nativeJob && (snapshot.phase === 'recording' || snapshot.phase === 'paused')) {
          nativeJob = null;
          setSnapshot({ phase: 'idle', interrupted: false, interruptReason: null, pausedAt: null });
          toast.error('The recording stopped unexpectedly. What was captured is kept.');
        }
        break;
      }
      if (e.state !== 'recording' && e.state !== 'paused') break;
      if (!sid) break;
      if (!nativeJob) {
        // The page reloaded while native kept recording: reattach.
        if (snapshot.phase !== 'idle' && snapshot.phase !== 'saving') break;
        nativeJob = nativeJobFromRecord(sid);
        nativeJob.nativePending = nativePendingBySession.get(sid) ?? 0;
        setSnapshot({ sessionId: sid, title: nativeJob.title, endedAt: null });
      }
      if (nativeJob.sessionId !== sid) break;
      const paused = e.state === 'paused';
      const patch: Partial<RecorderSnapshot> = {
        phase: paused ? 'paused' : 'recording',
        startedAt: typeof e.startedAt === 'number' ? e.startedAt : snapshot.startedAt,
        pausedMs: typeof e.pausedMs === 'number' ? e.pausedMs : snapshot.pausedMs,
        pausedAt: paused ? (typeof e.pausedAt === 'number' ? e.pausedAt : snapshot.pausedAt ?? Date.now()) : null,
        interrupted: e.interrupted === true,
        interruptReason: e.interrupted === true ? (typeof e.interruptReason === 'string' ? e.interruptReason : snapshot.interruptReason ?? 'call') : null,
      };
      setSnapshot(patch);
      writePersisted({ sessionId: sid, pausedMs: snapshot.pausedMs });
      break;
    }
    case 'interrupted':
      if (nativeJob && (!sid || sid === nativeJob.sessionId)) {
        if (snapshot.phase === 'recording') setSnapshot({ phase: 'paused', pausedAt: e.at ?? Date.now() });
        const reason = typeof e.reason === 'string' ? e.reason : 'call';
        setSnapshot({ interrupted: true, interruptReason: reason });
        toast.info(
          reason === 'call'
            ? 'Recording paused: a call or alarm took the microphone.'
            : 'Recording paused: the microphone stopped. Resume to continue.',
          { id: 'native-interrupted' },
        );
      }
      break;
    case 'resumed':
      if (nativeJob && (!sid || sid === nativeJob.sessionId)) {
        if (snapshot.phase === 'paused') {
          const pausedMs = snapshot.pausedMs + ((e.at ?? Date.now()) - (snapshot.pausedAt ?? e.at ?? Date.now()));
          setSnapshot({ phase: 'recording', pausedMs: Math.max(snapshot.pausedMs, pausedMs), pausedAt: null });
        }
        setSnapshot({ interrupted: false, interruptReason: null });
        toast.success('Recording resumed', { id: 'native-interrupted' });
      }
      break;
    case 'chunkSaved':
      if (sid) setNativePending(sid, (nativePendingBySession.get(sid) ?? 0) + 1);
      break;
    case 'chunkUploaded':
      if (sid) {
        setNativePending(sid, (nativePendingBySession.get(sid) ?? 1) - 1);
        writePersisted({ sessionId: sid, lastChunkAt: Date.now() });
        jobs.forEach((j) => {
          if (j.waiting) {
            j.waiting = false;
            j.nativeWaitReason = null;
          }
        });
        if (nativeJob) nativeJob.waiting = false;
        refreshSaveStats();
      }
      break;
    case 'uploadWaiting': {
      const reason: 'network' | 'signin' = e.reason === 'signin' ? 'signin' : 'network';
      const apply = (j: Job) => {
        j.waiting = true;
        j.nativeWaitReason = reason;
      };
      jobs.forEach(apply);
      if (nativeJob) apply(nativeJob);
      refreshSaveStats();
      // A save that is waiting becomes a BACKGROUND save (same as the web path), so
      // the pill leaves the foreground "saving" state and a new meeting can start.
      if (snapshot.phase === 'saving' && snapshot.sessionId && nativeSaves.has(snapshot.sessionId)) {
        setSnapshot({ phase: 'idle' });
      }
      break;
    }
    case 'stopped':
      if (sid && e.allUploaded === true) {
        if (nativeSaves.has(sid)) void nativeFinish(sid);
        else if (nativeJob?.sessionId !== sid) {
          // An upload-only session (cut off mid-recording) is fully uploaded: release it.
          Array.from(jobs).forEach((j) => {
            if (j.sessionId === sid) jobs.delete(j);
          });
          setNativePending(sid, 0);
          nativePost({ cmd: 'forget', sessionId: sid });
        }
      }
      break;
    case 'parked':
      if (sid) nativeParked(sid);
      break;
    case 'pending': {
      nativePendingList = Array.isArray(e.sessions) ? (e.sessions as NativePendingSession[]) : [];
      for (const s of nativePendingList) setNativePending(s.sessionId, s.pending);
      if (currentUserId) void processNativePending(currentUserId);
      break;
    }
    default:
      break;
  }
}

/** Sign-out: stop native recording, keep its files, never upload them under another account. */
function haltNativeForSignOut() {
  if (!useNative() && !nativeJob && nativeSaves.size === 0) return;
  const job = nativeJob;
  if (job) {
    job.halted = true;
    const endedAt = Date.now();
    const pausedMs = snapshot.pausedMs + (snapshot.pausedAt ? endedAt - snapshot.pausedAt : 0);
    writePersisted({ sessionId: job.sessionId, pausedMs, endedAt, title: snapshot.title });
    nativePost({ cmd: 'stop' });
    nativeJob = null;
  }
  nativeSaves.forEach(({ job: j }) => {
    j.halted = true;
  });
  nativeSaves.clear();
  nativePost({ cmd: 'clearAuth' });
}

if (typeof window !== 'undefined' && SHELL_REC) {
  (window as any).__focusosNativeRecorder = { onEvent: onNativeEvent };
  // Handshake: native flushes anything it queued and replays its state + backlog.
  nativePost({ cmd: 'ready' });
}

/* ─── page-lifecycle listeners (module level) ─────────── */

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (isRecording()) flush();
    } else {
      wakeAll();
      leaseBeats.forEach((b) => b());
      if (isRecording()) void acquireWakeLock();
      if (currentUserId) void resumePendingSessions(currentUserId);
      void pushNativeAuth();
    }
  });
  window.addEventListener('pagehide', () => {
    if (isRecording()) flush();
  });
  window.addEventListener('online', () => {
    wakeAll();
    if (currentUserId) void resumePendingSessions(currentUserId);
  });
  // Housekeeping: the first build used a single-record key; chunks older than 7 days
  // whose record is gone can never be resumed.
  try {
    localStorage.removeItem('focusos-meeting-recording-session');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    // Only audio the server already closed (or whose record is gone) is cleaned up by
    // age. A meeting that never uploaded keeps its chunks and record until it uploads
    // or the user presses Discard: "nothing lost".
    const maxAge = 7 * 24 * 3600 * 1000;
    const m = readMap();
    void deleteStaleChunks(maxAge, (sessionId) => !m[sessionId] || m[sessionId].closed === true);
    let changed = false;
    for (const id of Object.keys(m)) {
      if (m[id].closed === true && Date.now() - m[id].startedAt > maxAge) {
        delete m[id];
        changed = true;
      }
    }
    if (changed) writeMap(m);
  }, 10_000);
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) currentUserId = session.user.id;
      if (session && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        void pushNativeAuth(session);
      }
      if (event === 'SIGNED_OUT') {
        currentUserId = null;
        haltForSignOut();
      }
    });
  } catch {
    /* auth client unavailable: recorder still works without sign-out handling */
  }
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

/** Unsent chunks for this session still sit on this device (and the save is not abandoned). */
/**
 * True when this session's record says it is still recording in some tab right now
 * (no Stop, not closed, a chunk or start within the last 90 s). The recovery banner
 * must not offer Recover for it: that would close a live recording in another tab.
 */
export function isLiveInAnotherTab(sessionId: string, now = Date.now()): boolean {
  const r = readMap()[sessionId];
  if (!r || r.endedAt || r.closed) return false;
  const last = r.lastChunkAt ?? r.startedAt;
  return now - last < 90_000;
}

export async function hasUnsentChunks(sessionId: string): Promise<boolean> {
  if (isSessionInFlight(sessionId)) return true;
  if (readPersistedRecording(sessionId)?.closed) return false;
  if ((nativePendingBySession.get(sessionId) ?? 0) > 0) return true;
  try {
    return (await getSessionChunks(sessionId)).length > 0;
  } catch {
    return false;
  }
}

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  GoogleGenAI, Modality, Type, Behavior, FunctionResponseScheduling,
} from '@google/genai';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { startCapture as engineStartCapture, stopCapture as engineStopCapture, getDebugSnapshot as getAudioDebugSnapshot } from '@/lib/brainDumpAudio';
import type { TaskPriority } from '@/types/task';

export interface BrainDumpTask {
  id: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  destination: 'today' | 'existing-project' | 'new-project';
  projectName?: string; // For existing or new project
  projectId?: string;   // For existing project match
  startDate?: string;   // ISO date string e.g. "2026-02-22"
  endDate?: string;
  dueDate?: string;
}

type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error';


export interface ProjectInfo {
  id: string;
  name: string;
}

const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

/* ── Transport constants ─────────────────────────────────────────────────────
   The Live socket dies on its own schedule: WS lifetime is ~10 min, an
   audio-only session is capped at 15 min, and this model is known to close with
   1008 mid-function-call. None of that should cost the user their list, so an
   unexpected close while the user is still recording is retried in place. */
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_MS = [250, 750, 2000];
/** Reconnect this long before the deadline the server announced in `goAway`. */
const GO_AWAY_LEAD_MS = 1000;
/** ~256ms of PCM per chunk (4096 frames @16kHz), so this is a ~10s tail. The
 *  buffer now also covers the PRE-CONNECT window — capture starts on the orb
 *  tap, before the socket exists, so the user's first words ride in here and
 *  flush on open instead of being lost to the connect latency. */
const MAX_BUFFERED_AUDIO_CHUNKS = 40;
const MAX_PENDING_TOOL_RESPONSES = 32;
/** Enough history to answer any re-delivery; bounded so a storm cannot balloon. */
const MAX_PROCESSED_CALLS = 200;

/* ── Prompt budget ───────────────────────────────────────────────────────────
   Gemini Live re-prefills the ENTIRE cumulative context on every turn, so the
   setup payload is paid again on each utterance: prompt size is latency, on
   every sentence, for the whole session. Both lists below are therefore bounded
   — an account with 300 projects, or a long dump on its third reconnect, must
   not make a one-sentence task slow. */
const MAX_PROJECTS_IN_PROMPT = 60;
const MAX_PREVIOUS_TASKS_IN_PROMPT = 30;

/* ── Idle auto-stop ──────────────────────────────────────────────────────────
   Silence bills at the full audio rate, so a session the user walked away from
   is a live meter. The server sends NOTHING while nobody is talking, so "no
   server message at all for this long" is the cleanest, cheapest proxy for
   "nobody is there" — no VAD mirroring on the client, no extra timers on the
   mic path. Any message (tool call, resumption handle, goAway, transcript)
   pushes the deadline out. */
const IDLE_STOP_MS = 90_000;

/** DEV-only: ?idlestop=<ms> shortens the wait so a spec can prove the path in a
 *  few seconds. import.meta.env.DEV is the literal `false` in a production
 *  build, so this whole branch is dead-code-eliminated (same precedent as the
 *  mock transport below). */
function idleStopMs(): number {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const raw = new URLSearchParams(window.location.search).get('idlestop');
    const ms = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return IDLE_STOP_MS;
}

/* ── Bisect switches (house law: one suspect off, let the rig confess) ────────
   Flip any to true to prove the guard it names is what a test is measuring.
   tests/braindump-live-transport.spec.ts documents the expected failures. */
const BISECT_DISABLE_TOOLCALL_DEDUP = false;
const BISECT_DISABLE_RECONNECT = false;
const BISECT_DISABLE_IDLE_STOP = false;

/* Async function calling. Declaring the extraction tools NON_BLOCKING and
   answering SILENT means the model never stalls waiting on our echo and never
   speaks because of it — the mitigation for "closed 1008 mid-function-call".
   Both fields exist in @google/genai 1.41.0 (Behavior, FunctionResponseScheduling).
   One-line revert if a live call ever misbehaves on this model. */
const USE_NON_BLOCKING_TOOLS = true;

/* ── ?m31=1 — the model A/B switch (production, param-gated) ─────────────────
   gemini-3.1-flash-live-preview is Google's own "migrate immediately" target
   for our default model: it fixes the documented 1-in-5-10 WS-1008 kill at
   tool dispatch, and its tool-calling is the generation built for per-turn
   emission — the batch-at-end arrival Igor sees on the current model is that
   model's documented behaviour, not ours. Param-gated so ONE build A/Bs both
   models on a real phone with zero redeploys; the ?debug=1 overlay names the
   live model. 3.1 Live tools are SYNC-ONLY, so NON_BLOCKING declarations and
   SILENT scheduling are dropped whenever this switch is on (they degrade
   silently there — Ramble teardown trail, 2026-07-28). */
const MODEL_31 = 'gemini-3.1-flash-live-preview';
function m31Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('m31') === '1';
}
/** NON_BLOCKING + SILENT apply only where the model supports them. */
function nonBlockingTools(): boolean {
  return USE_NON_BLOCKING_TOOLS && !m31Enabled();
}

/* Audio capture lives in src/lib/brainDumpAudio.ts — ONE page-lifetime
   AudioContext at the hardware rate, AudioWorklet capture, 16k resample in
   code. The per-session `new AudioContext({sampleRate:16000})` + close() churn
   that used to live here produced SILENT second sessions on iOS Safari
   (device-confirmed 2026-07-28): socket up, UI "Listening", model hearing
   nothing. Sessions now attach to the engine; they never own audio. */

/* ── Production debug counters (?debug=1 overlay) ────────────────────────────
   Plain module-level mutations — no state, no renders, negligible cost — kept
   in the PRODUCTION bundle on purpose: "is the socket alive / is audio flowing"
   must be answerable on Igor's phone without a dev build. The overlay in
   Home.tsx polls this object; nothing else reads it. */
export const brainDumpDebug = {
  socketOpens: 0,
  socketCloses: 0,
  socketErrors: 0,
  reconnectsScheduled: 0,
  toolCallsReceived: 0,
  chunksSentLive: 0,
  chunksBuffered: 0,
  lastServerMessageAt: 0,
  lastCloseInfo: '',
  model: '',
  audio: () => getAudioDebugSnapshot(),
};
// Reachable from a Safari Web Inspector (USB) or an automation probe without
// the overlay mounted — same production-debuggability rationale as above.
if (typeof window !== 'undefined') (window as any).__bdDebug = brainDumpDebug;

// Get today's date info for the system prompt
function getTodayDateString(): string {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[now.getDay()];
  const iso = now.toISOString().split('T')[0];
  return `${iso} (${dayName})`;
}

/** protobuf Duration JSON ("9.5s") -> ms. */
function parseDurationMs(value: unknown): number | null {
  if (typeof value === 'number') return value * 1000;
  if (typeof value !== 'string') return null;
  const seconds = parseFloat(value);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/* ── DEV-ONLY transport shim ─────────────────────────────────────────────────
   Gated on import.meta.env.DEV, which Vite replaces with the literal `false` in
   a production build, so the whole mock path is dropped by dead-code
   elimination (same precedent as src/pages/BrainDumpRepro.tsx).

   With window.__mockLiveSession set, start() skips getUserMedia, the config
   edge function and ai.live.connect, and hands the callbacks to a fake session
   recorded on window.__brainDumpLiveMock. tests/braindump-live-transport.spec.ts
   then pushes wire messages — toolCall, a duplicate fc.id, toolCallCancellation,
   sessionResumptionUpdate, goAway, a synthetic close — with no Gemini, no
   microphone and no Supabase. */
type LiveCallbacks = {
  onopen: () => void;
  onmessage: (message: any) => void;
  onclose: () => void;
  onerror: (err: any) => void;
};

/** One entry per ai.live.connect the hook would have made. Everything a spec
 *  needs to assert about the setup payload without a socket. */
type MockConnectRecord = {
  model: string;
  handle: string | null;
  toolNames: string[];
  /** Distinct `behavior` values across the declarations — ['NON_BLOCKING'] in
   *  default mode, [] under ?m31=1 (3.1 tools are sync-only). */
  toolBehaviors: string[];
  vad: Record<string, unknown> | null;
  compression: Record<string, unknown> | null;
  systemInstructionChars: number;
  /** The prompt text itself, so a spec can assert WHICH register shipped (the
   *  act-immediately timing rule), not merely how long the payload is. */
  systemInstruction: string;
};

interface MockLiveHarness {
  connects: MockConnectRecord[];
  toolResponses: any[];
  realtimeChunks: number;
  clientCloses: number;
  emit: (message: unknown) => void;
  serverClose: () => void;
  serverError: (err?: unknown) => void;
}

function mockLiveEnabled(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined' && !!(window as any).__mockLiveSession;
}

function connectMockLiveSession(params: { model: string; config: any; callbacks: LiveCallbacks }) {
  const w = window as any;
  const harness: MockLiveHarness = w.__brainDumpLiveMock ?? (w.__brainDumpLiveMock = {
    connects: [],
    toolResponses: [],
    realtimeChunks: 0,
    clientCloses: 0,
    emit: () => {},
    serverClose: () => {},
    serverError: () => {},
  });

  harness.connects.push({
    model: params.model,
    handle: params.config?.sessionResumption?.handle ?? null,
    toolNames: (params.config?.tools?.[0]?.functionDeclarations ?? []).map((d: any) => d.name),
    toolBehaviors: [...new Set(
      (params.config?.tools?.[0]?.functionDeclarations ?? [])
        .map((d: any) => d.behavior)
        .filter(Boolean) as string[],
    )],
    vad: params.config?.realtimeInputConfig?.automaticActivityDetection ?? null,
    compression: params.config?.contextWindowCompression ?? null,
    systemInstructionChars: typeof params.config?.systemInstruction === 'string'
      ? params.config.systemInstruction.length
      : 0,
    systemInstruction: typeof params.config?.systemInstruction === 'string'
      ? params.config.systemInstruction
      : '',
  });

  const session = {
    sendRealtimeInput: () => { harness.realtimeChunks += 1; },
    sendToolResponse: (payload: any) => { harness.toolResponses.push(payload); },
    close: () => { harness.clientCloses += 1; },
  };

  harness.emit = (message: unknown) => params.callbacks.onmessage(message);
  harness.serverClose = () => params.callbacks.onclose();
  harness.serverError = (err?: unknown) => params.callbacks.onerror(err ?? new Error('mock live error'));

  // The real SDK resolves connect() before onopen fires; a macrotask keeps that
  // ordering so sessionRef is assigned by the time capture starts.
  setTimeout(() => params.callbacks.onopen(), 0);
  return session;
}

type ToolOutcome = {
  next: BrainDumpTask[];
  result: any;
  /** Set only when the call created a row, so toolCallCancellation can undo it. */
  createdTaskId?: string;
};

type ProcessedCall = { name: string; result: any; createdTaskId?: string };

type ConnectOptions = {
  /** Audio is NOT connect's business: the engine (src/lib/brainDumpAudio.ts)
   *  captures across connects and reconnects alike; start() owns it. */
  /** Reconnect resumes the server-side session state when a handle is in hand. */
  resumeHandle?: string;
  preserveTasks?: boolean;
};

type BrainDumpLiveOptions = {
  /** True while the caller is mid-save. The idle countdown keeps waiting rather
   *  than pulling the socket out from under a write in flight. */
  idleStopSuspended?: boolean;
};

export function useBrainDumpLive(options?: BrainDumpLiveOptions) {
  const [tasks, setTasks] = useState<BrainDumpTask[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [reconnecting, setReconnecting] = useState(false);
  /** The last stop was the silence auto-stop, not the user. STATE, not a ref:
   *  callers derive rendered output from it (react-router replays discardable
   *  renders, and a ref mutation survives a discard the setState does not). */
  const [idleStopped, setIdleStopped] = useState(false);

  const sessionRef = useRef<any>(null);

  const taskCounterRef = useRef(0);
  const tasksRef = useRef<BrainDumpTask[]>([]);
  const projectsRef = useRef<ProjectInfo[]>([]);
  const newProjectsRef = useRef<Map<string, string>>(new Map()); // normalized name -> display name

  // Transport control. None of these gate render output (connectionState and
  // reconnecting are the rendered facts) — they are socket bookkeeping.
  const activeRef = useRef(false);            // user is recording; a socket should exist
  const intentionalStopRef = useRef(false);   // deliberate teardown never reconnects
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const goAwayTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  /** Mirrored during render (idempotent, same precedent as connectRef below):
   *  the timer callback has to read the CURRENT value, not the one captured
   *  when it was armed. */
  const idleSuspendedRef = useRef(false);
  idleSuspendedRef.current = !!options?.idleStopSuspended;
  const resumeHandleRef = useRef<string | null>(null);
  const configRef = useRef<{ token: string; ephemeral: boolean; model: string } | null>(null);
  /** Bumped on every connect + teardown; callbacks from a superseded socket bail. */
  const connectSeqRef = useRef(0);
  const bufferedAudioRef = useRef<Array<{ mimeType: string; data: string }>>([]);
  const pendingToolResponsesRef = useRef<Array<{ seq: number; payload: any }>>([]);
  const processedCallsRef = useRef<Map<string, ProcessedCall>>(new Map());

  // Keep tasksRef in sync with tasks state
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (goAwayTimerRef.current !== null) {
      window.clearTimeout(goAwayTimerRef.current);
      goAwayTimerRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  /** Drop the current socket. Bumping the sequence orphans its callbacks first. */
  const closeSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    connectSeqRef.current += 1;
    try {
      session?.close?.();
    } catch {
      // A socket that is already gone is exactly what we wanted.
    }
  }, []);

  /** Full stop: no socket, no timers, no mic, nothing queued. Never the task list.
   *  The audio ENGINE releases the mic but keeps its AudioContext alive — the
   *  context churn is what killed second sessions. */
  const teardown = useCallback(() => {
    clearTimers();
    closeSession();
    engineStopCapture();
    bufferedAudioRef.current = [];
    pendingToolResponsesRef.current = [];
    setReconnecting(false);
  }, [clearTimers, closeSession]);

  useEffect(() => {
    return () => {
      intentionalStopRef.current = true;
      activeRef.current = false;
      teardown();
    };
  }, [teardown]);

  /**
   * The ONE stop path. Socket, mic and timers go down; the captured list is
   * never touched, so whatever was said is still staged for the caller's exits.
   * `reason` only decides whether the quiet toast fires and whether the idle
   * latch is raised — an idle stop is a deliberate stop in every other respect
   * (intentional, so onclose schedules no reconnect).
   */
  const stopSession = useCallback((reason: 'user' | 'idle') => {
    intentionalStopRef.current = true;
    activeRef.current = false;
    teardown();
    setConnectionState('idle');
    setIdleStopped(reason === 'idle');
    if (reason === 'idle') {
      toast('Stopped listening — you were quiet for a while');
    }
  }, [teardown]);

  /** Break the arm -> re-arm cycle without a self-referencing closure. */
  const armIdleTimerRef = useRef<(() => void) | null>(null);

  /** (Re)start the quiet-session countdown. Called on connect and after EVERY
   *  server message, so any activity at all pushes the deadline out. */
  const armIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (BISECT_DISABLE_IDLE_STOP) return;
    if (!activeRef.current || intentionalStopRef.current) return;

    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      // Re-checked at FIRE time, not at arm time: a save that started during
      // the wait, or a reconnect still in flight, both mean this is not an
      // abandoned session.
      if (!activeRef.current || intentionalStopRef.current) return;
      if (idleSuspendedRef.current) { armIdleTimerRef.current?.(); return; }
      if (!sessionRef.current) return;   // mid-reconnect; onopen arms a fresh one
      console.warn(`Gemini Live: no server activity for ${idleStopMs()}ms — auto-stopping`);
      stopSession('idle');
    }, idleStopMs());
  }, [stopSession]);

  // Idempotent latest-value holder, assigned during render (same precedent as
  // connectRef further down).
  armIdleTimerRef.current = armIdleTimer;

  /** Echo a function call. Queued (not dropped) if the socket is not up yet. */
  const sendToolResponse = useCallback((id: string | undefined, name: string, response: any) => {
    const payload = {
      functionResponses: {
        id,
        name,
        response,
        ...(nonBlockingTools() && { scheduling: FunctionResponseScheduling.SILENT }),
      },
    };
    const session = sessionRef.current;
    if (session) {
      try {
        session.sendToolResponse(payload);
        return;
      } catch (err) {
        // The socket died between the call and the echo. Fall through to the
        // queue so this generation's flush can still answer it — the caller
        // must never lose its own state-update because the send threw.
        console.warn('Gemini Live: sendToolResponse threw, queueing the echo', err);
      }
    }
    // Callbacks can fire before live.connect() resolves, and a reconnect leaves a
    // short gap. Hold the echo for THIS socket generation only — ids do not carry
    // across sessions, so a stale echo would be answering a call the new server
    // never made.
    const queue = pendingToolResponsesRef.current;
    queue.push({ seq: connectSeqRef.current, payload });
    if (queue.length > MAX_PENDING_TOOL_RESPONSES) queue.shift();
  }, []);

  /**
   * Applies one function call to `base` and returns the next list plus the echo
   * the model gets back. Pure with respect to the list: everything it needs is
   * derived here and now, so the caller never has to correct state afterwards.
   */
  const applyToolCall = useCallback((fc: any, base: BrainDumpTask[]): ToolOutcome => {
    const args = fc.args || {};

    const getCurrentTasksSummary = (tasksState: BrainDumpTask[]) =>
      tasksState.map(t => ({ task_id: t.id, title: t.title, priority: t.priority, destination: t.destination, projectName: t.projectName }));

    // DEDUPLICATION GUARD: only an EXACT title match (after normalisation) counts
    // as a duplicate — that still catches the model literally re-creating a task
    // after a reconnect replay, which is what this guard exists for. It used to
    // also match on substring containment, which silently swallowed legitimately
    // distinct tasks ("Call mum" ate "Call mum about the car") while echoing
    // success to the model so it never retried — device-confirmed 2026-07-28.
    // A title that normalises to '' (all punctuation, or a non-Latin script such
    // as Arabic) must never dedup at all: '' used to substring-match EVERY task.
    const findDuplicateTask = (title: string): BrainDumpTask | undefined => {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedTitle = normalize(title);
      if (!normalizedTitle) return undefined;
      return base.find(t => normalize(t.title) === normalizedTitle);
    };

    if (fc.name === 'add_task_to_today') {
      const title = args.title || 'Untitled Task';
      const existingTask = findDuplicateTask(title);

      if (existingTask) {
        // DEDUP: Merge into existing task instead of creating duplicate
        console.log(`DEDUP: "${title}" matches existing task "${existingTask.title}" (${existingTask.id}), updating instead`);
        const next = base.map(t => t.id === existingTask.id ? {
          ...t,
          ...(args.description && { description: args.description }),
          ...(args.priority && { priority: args.priority as TaskPriority }),
          ...(args.start_date && { startDate: args.start_date }),
          ...(args.end_date && { endDate: args.end_date }),
          ...(args.due_date && { dueDate: args.due_date }),
        } : t);
        return { next, result: { result: 'ok', task_id: existingTask.id, note: 'duplicate_prevented_updated_existing', current_tasks: getCurrentTasksSummary(next) } };
      }

      const taskId = `brain-dump-${++taskCounterRef.current}`;
      const newTask: BrainDumpTask = {
        id: taskId,
        title,
        description: args.description,
        priority: (args.priority as TaskPriority) || 'medium',
        destination: 'today',
        ...(args.start_date && { startDate: args.start_date }),
        ...(args.end_date && { endDate: args.end_date }),
        ...(args.due_date && { dueDate: args.due_date }),
      };
      const next = [...base, newTask];
      return { next, result: { result: 'ok', task_id: taskId, current_tasks: getCurrentTasksSummary(next) }, createdTaskId: taskId };
    }

    if (fc.name === 'add_task_to_project') {
      const projectName = args.project_name || '';
      const normalizedSearch = projectName.toLowerCase().trim();

      // Check existing DB projects first
      const existingMatch = projectsRef.current.find(
        p => p.name.toLowerCase() === normalizedSearch
      );

      // If not found in DB, check session-created new projects
      const newProjectMatch = !existingMatch ? newProjectsRef.current.get(normalizedSearch) : null;

      const isExistingProject = !!existingMatch;
      const isNewProject = !!newProjectMatch;
      const resolvedProjectName = existingMatch?.name || newProjectMatch || projectName;

      const title = args.title || 'Untitled Task';
      const existingTask = findDuplicateTask(title);

      if (existingTask) {
        console.log(`DEDUP: "${title}" matches existing task "${existingTask.title}" (${existingTask.id}), updating instead`);
        const next = base.map(t => t.id === existingTask.id ? {
          ...t,
          ...(args.description && { description: args.description }),
          ...(args.priority && { priority: args.priority as TaskPriority }),
          ...(isExistingProject && { destination: 'existing-project' as const, projectName: existingMatch!.name, projectId: existingMatch!.id }),
          ...(isNewProject && { destination: 'new-project' as const, projectName: resolvedProjectName }),
          ...(args.start_date && { startDate: args.start_date }),
          ...(args.end_date && { endDate: args.end_date }),
          ...(args.due_date && { dueDate: args.due_date }),
        } : t);
        return { next, result: { result: 'ok', task_id: existingTask.id, note: 'duplicate_prevented_updated_existing', current_tasks: getCurrentTasksSummary(next) } };
      }

      const taskId = `brain-dump-${++taskCounterRef.current}`;
      const destination = isExistingProject ? 'existing-project' : isNewProject ? 'new-project' : 'today';
      const newTask: BrainDumpTask = {
        id: taskId,
        title,
        description: args.description,
        priority: (args.priority as TaskPriority) || 'medium',
        destination,
        projectName: resolvedProjectName,
        projectId: existingMatch?.id,
        ...(args.start_date && { startDate: args.start_date }),
        ...(args.end_date && { endDate: args.end_date }),
        ...(args.due_date && { dueDate: args.due_date }),
      };
      const next = [...base, newTask];
      return { next, result: { result: 'ok', task_id: taskId, matched_project: resolvedProjectName, destination, current_tasks: getCurrentTasksSummary(next) }, createdTaskId: taskId };
    }

    if (fc.name === 'create_project_and_add_task') {
      const projectName = args.project_name || 'New Project';
      const normalizedName = projectName.toLowerCase().trim();

      if (!newProjectsRef.current.has(normalizedName)) {
        newProjectsRef.current.set(normalizedName, projectName);
      }

      const title = args.title || 'Untitled Task';
      const existingTask = findDuplicateTask(title);

      if (existingTask) {
        // DEDUP: Merge into existing task instead of creating duplicate
        console.log(`DEDUP: "${title}" matches existing task "${existingTask.title}" (${existingTask.id}), updating instead`);
        const next = base.map(t => t.id === existingTask.id ? {
          ...t,
          ...(args.description && { description: args.description }),
          ...(args.priority && { priority: args.priority as TaskPriority }),
          destination: 'new-project' as const,
          projectName: newProjectsRef.current.get(normalizedName) || projectName,
          ...(args.start_date && { startDate: args.start_date }),
          ...(args.end_date && { endDate: args.end_date }),
          ...(args.due_date && { dueDate: args.due_date }),
        } : t);
        return { next, result: { result: 'ok', task_id: existingTask.id, note: 'duplicate_prevented_updated_existing', current_tasks: getCurrentTasksSummary(next) } };
      }

      const taskId = `brain-dump-${++taskCounterRef.current}`;
      const newTask: BrainDumpTask = {
        id: taskId,
        title,
        description: args.description,
        priority: (args.priority as TaskPriority) || 'medium',
        destination: 'new-project',
        projectName: newProjectsRef.current.get(normalizedName) || projectName,
        ...(args.start_date && { startDate: args.start_date }),
        ...(args.end_date && { endDate: args.end_date }),
        ...(args.due_date && { dueDate: args.due_date }),
      };
      const next = [...base, newTask];
      return { next, result: { result: 'ok', task_id: taskId, new_project: projectName, current_tasks: getCurrentTasksSummary(next) }, createdTaskId: taskId };
    }

    if (fc.name === 'move_task') {
      const taskId = args.task_id as string;
      const destination = args.destination as BrainDumpTask['destination'];
      const projectName = args.project_name as string | undefined;

      const next = base.map(t => {
        if (t.id !== taskId) return t;

        if (destination === 'today') {
          return { ...t, destination: 'today' as const, projectName: undefined, projectId: undefined };
        } else if (destination === 'existing-project' && projectName) {
          const match = projectsRef.current.find(
            p => p.name.toLowerCase() === projectName.toLowerCase()
          );
          return {
            ...t,
            destination: 'existing-project' as const,
            projectName: match?.name || projectName,
            projectId: match?.id,
          };
        } else if (destination === 'new-project' && projectName) {
          const normalizedName = projectName.toLowerCase().trim();
          if (!newProjectsRef.current.has(normalizedName)) {
            newProjectsRef.current.set(normalizedName, projectName);
          }
          return {
            ...t,
            destination: 'new-project' as const,
            projectName: newProjectsRef.current.get(normalizedName) || projectName,
            projectId: undefined,
          };
        }
        return t;
      });
      return { next, result: { result: 'ok', task_id: taskId, current_tasks: getCurrentTasksSummary(next) } };
    }

    if (fc.name === 'update_task') {
      const taskId = args.task_id as string | undefined;
      const searchPhrase = (args.searchPhrase || '').toLowerCase();

      const next = base.map(t => {
        const isMatch = taskId
          ? t.id === taskId
          : searchPhrase && t.title.toLowerCase().includes(searchPhrase);

        if (!isMatch) return t;

        return {
          ...t,
          ...(args.title && { title: args.title }),
          ...(args.description !== undefined && { description: args.description }),
          ...(args.priority && { priority: args.priority as TaskPriority }),
          ...(args.start_date !== undefined && { startDate: args.start_date || undefined }),
          ...(args.end_date !== undefined && { endDate: args.end_date || undefined }),
          ...(args.due_date !== undefined && { dueDate: args.due_date || undefined }),
        };
      });
      return { next, result: { result: 'ok', task_id: taskId || 'matched_by_search', current_tasks: getCurrentTasksSummary(next) } };
    }

    if (fc.name === 'remove_task') {
      const taskId = args.task_id as string | undefined;
      const searchPhrase = (args.searchPhrase || '').toLowerCase();

      const next = base.filter(t => {
        if (taskId) return t.id !== taskId;
        return searchPhrase ? !t.title.toLowerCase().includes(searchPhrase) : true;
      });
      return { next, result: { result: 'ok', task_id: taskId || 'matched_by_search', current_tasks: getCurrentTasksSummary(next) } };
    }

    return { next: base, result: { result: 'ok' } };
  }, []);

  /** The engine's chunk sink: live socket if there is one, else the bounded
   *  buffer. Covers BOTH gaps — pre-connect (capture starts on the orb tap,
   *  before the socket exists) and mid-reconnect. Oldest chunks go first — a
   *  stale tail is worse than no tail. */
  const handleAudioChunk = useCallback((pcmBlob: { mimeType: string; data: string }) => {
    const session = sessionRef.current;
    if (session) {
      brainDumpDebug.chunksSentLive += 1;
      session.sendRealtimeInput({ media: pcmBlob });
      return;
    }
    brainDumpDebug.chunksBuffered += 1;
    const buffer = bufferedAudioRef.current;
    buffer.push(pcmBlob);
    if (buffer.length > MAX_BUFFERED_AUDIO_CHUNKS) buffer.shift();
  }, []);

  const fetchLiveConfig = useCallback(async () => {
    if (configRef.current && !configRef.current.ephemeral) return configRef.current;

    const { data, error } = await supabase.functions.invoke('focusos-get-brain-dump-config');
    if (error) throw new Error(error.message || 'Failed to get config');

    // The deployed function returns { apiKey, model }. `ephemeralToken` is the
    // optional forward-compatible field the drafted version can add without any
    // client change (supabase/functions/focusos-get-brain-dump-config/index.ts).
    const ephemeralToken: string | undefined = data?.ephemeralToken;
    const token: string | undefined = ephemeralToken || data?.apiKey;
    if (!token) throw new Error('Failed to get config');

    const config = { token, ephemeral: !!ephemeralToken, model: data?.model || DEFAULT_MODEL };
    // Ephemeral tokens are use-capped, so they are never cached across connects.
    configRef.current = config.ephemeral ? null : config;
    return config;
  }, []);

  /** Break the connect <-> reconnect cycle without stale closures. */
  const connectRef = useRef<((options: ConnectOptions) => Promise<void>) | null>(null);

  const scheduleReconnect = useCallback((reason: string) => {
    if (BISECT_DISABLE_RECONNECT) return;
    if (!activeRef.current || intentionalStopRef.current) return;
    if (reconnectTimerRef.current !== null) return; // onerror + onclose both fire; one retry

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`Gemini Live: giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts (${reason})`);
      activeRef.current = false;
      intentionalStopRef.current = true;
      teardown();
      setConnectionState('error');
      return;
    }

    const attempt = ++reconnectAttemptsRef.current;
    const delay = RECONNECT_BACKOFF_MS[attempt - 1] ?? RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];
    console.warn(`Gemini Live: reconnecting (attempt ${attempt}, ${reason}) in ${delay}ms`);
    brainDumpDebug.reconnectsScheduled += 1;
    setReconnecting(true);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current?.({
        resumeHandle: resumeHandleRef.current ?? undefined,
        preserveTasks: true,
      }).catch((err) => {
        console.error('Gemini Live: reconnect failed', err);
        scheduleReconnect('reconnect-threw');
      });
    }, delay);
  }, [teardown]);

  const connect = useCallback(async (options: ConnectOptions) => {
    // Orphan the previous socket's callbacks before anything else, so its close
    // never reads as a fresh failure.
    clearTimers();
    closeSession();
    const seq = connectSeqRef.current;

    const config = mockLiveEnabled()
      ? { token: 'mock', ephemeral: false, model: DEFAULT_MODEL }
      : await fetchLiveConfig();
    // ?m31=1 wins over BOTH the server-supplied model and the default — the
    // server always sends a truthy model, so an override anywhere later would
    // never fire (the line-700 precedence trap, war-room 2026-07-28).
    const effectiveModel = m31Enabled() ? MODEL_31 : (config.model || DEFAULT_MODEL);
    brainDumpDebug.model = effectiveModel;

    // Build system instruction with project list. BOUNDED (MAX_PROJECTS_IN_PROMPT):
    // the whole setup payload is re-prefilled on every turn, so quoting all of a
    // 300-project account here would tax every single utterance for the length of
    // the session. Names only, still quoted so the model matches them verbatim,
    // and the tail is acknowledged rather than silently dropped so the model does
    // not conclude an unlisted project cannot exist.
    const projects = projectsRef.current;
    const shownProjects = projects.slice(0, MAX_PROJECTS_IN_PROMPT);
    const hiddenProjects = projects.length - shownProjects.length;
    const projectListStr = projects.length > 0
      ? `\nExisting projects: ${shownProjects.map(p => `"${p.name}"`).join(', ')}${hiddenProjects > 0 ? ` (+${hiddenProjects} more not listed)` : ''}`
      : '\nNo existing projects yet.';

    const todayStr = getTodayDateString();

    // Build existing tasks context for resumed sessions. A reconnect always takes
    // this path: the list is the source of truth and the new socket has to be told
    // what already exists, or the model re-creates it.
    let existingTasksStr = '';
    if (options.preserveTasks && tasksRef.current.length > 0) {
      // BOUNDED (MAX_PREVIOUS_TASKS_IN_PROMPT), newest kept, and id + title +
      // destination ONLY. This block exists to stop the model re-creating what
      // already exists, not to mirror the list — priority and project text bought
      // nothing here and were re-prefilled on every turn after the reconnect.
      const all = tasksRef.current;
      const shown = all.slice(-MAX_PREVIOUS_TASKS_IN_PROMPT);
      const omitted = all.length - shown.length;
      const taskLines = shown.map(t => `  - "${t.id}" ${t.title} -> ${t.destination}`).join('\n');
      existingTasksStr = `\n\nPREVIOUSLY EXTRACTED TASKS (already exist — use update_task or move_task, NEVER re-create them):
${taskLines}${omitted > 0 ? `\n  (+${omitted} older, not listed)` : ''}
Use these task_ids for any updates, moves or removals. Do NOT create new tasks with these titles.`;
    }

    /* EXTRACTION TIMING — v40 register, REVERTED here 2026-07-28 after the P1/F1
       tuning wave failed Igor's feel gate twice ("worse than before" both times).
       The fire-immediately register + VAD/compression configs live in git
       (89c35bf / 1a059a6) for the measurement-rig autopsy; nothing returns to
       this prompt or the connect config without device-measured numbers first. */
    const timingRule = `TASK EXTRACTION TIMING:
- Wait until a task is complete before calling any tool. Complete = a clear action and a subject. A natural pause or silence is your signal that a thought is finished. Do NOT call tools mid-sentence or on partial utterances.`;

    const systemInstruction = `You extract tasks from speech for a productivity app, "Brain Dump", and route each one to the right destination.
${projectListStr}

Today is ${todayStr}. Convert relative dates ("next Friday", "end of the month", "in 3 days") to ISO YYYY-MM-DD against today.
${existingTasksStr}

ROUTING RULES:
- User names an existing project -> add_task_to_project with that project's name
- User says "new project", or names a project that does not exist -> create_project_and_add_task
- No project context -> add_task_to_today
- Act decisively. Do NOT ask clarifying questions. Just pick the best match.
- Close but not exact ("marketing" vs "Marketing Plan") -> match the closest existing project

${timingRule}

TASK EXTRACTION RULES:
- Titles: clear, actionable, under 10 words. Add a brief description only if the user gave extra context.
- Priority from urgency cues: "urgent", "important", "ASAP" → urgent/high; normal → medium; "whenever", "nice to have" → low
- A mentioned start, end or due date goes in start_date / end_date / due_date as ISO YYYY-MM-DD

CORRECTION RULES (CRITICAL — READ CAREFULLY):
- NEVER create a new task when the user wants to MODIFY an existing one. If a similar title already exists you MUST use update_task or move_task — NEVER add_task_to_today or add_task_to_project.
- Changing a property (priority, title, description, dates, project) on MULTIPLE existing tasks = ONE update_task call PER TASK, using each task_id. Do NOT call any add_task tool. Do NOT re-create them. "Make them all urgent" with 3 tasks means exactly 3 update_task calls — count them.
- MOVING a task = move_task with its task_id. Do NOT simulate a move with add_task + remove_task. That causes duplicates.
- "Actually put that in [project]" or "move [task] to [project]" is always move_task.
- For update_task, move_task and remove_task: ALWAYS use task_id. Only fall back to searchPhrase if you truly do not have it.
- If the user corrects or removes a task, use update_task or remove_task accordingly.
- EVERY tool response returns "current_tasks" listing all existing tasks with their task_ids. Use those ids for any later updates, moves or removals.

SILENT MODE:
- You are in SILENT mode. Do NOT speak. Execute tools and output as little audio as possible.`;

    // Define tools
    const dateProperties = {
      start_date: { type: Type.STRING, description: 'Task start date in ISO format (YYYY-MM-DD)' },
      end_date: { type: Type.STRING, description: 'Task end date in ISO format (YYYY-MM-DD)' },
      due_date: { type: Type.STRING, description: 'Task due date in ISO format (YYYY-MM-DD)' },
    };

    const toolBehavior = nonBlockingTools() ? { behavior: Behavior.NON_BLOCKING } : {};

    const tools = [{
      functionDeclarations: [
        {
          name: 'add_task_to_today',
          description: "Add a task to today's to-do list. Use when no specific project is mentioned.",
          ...toolBehavior,
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
              description: { type: Type.STRING, description: 'Brief task description' },
              priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
              ...dateProperties,
            },
            required: ['title', 'priority'],
          },
        },
        {
          name: 'add_task_to_project',
          description: 'Add a task to an existing project. Use when the user mentions a known project.',
          ...toolBehavior,
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
              description: { type: Type.STRING, description: 'Brief task description' },
              priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
              project_name: { type: Type.STRING, description: 'Name of the existing project to add the task to' },
              ...dateProperties,
            },
            required: ['title', 'priority', 'project_name'],
          },
        },
        {
          name: 'create_project_and_add_task',
          description: 'Create a new project and add a task to it. Use when the user mentions a project that does not exist or explicitly says "new project".',
          ...toolBehavior,
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Concise task title (under 10 words)' },
              description: { type: Type.STRING, description: 'Brief task description' },
              priority: { type: Type.STRING, description: 'Task priority: low, medium, high, or urgent' },
              project_name: { type: Type.STRING, description: 'Name for the new project' },
              ...dateProperties,
            },
            required: ['title', 'priority', 'project_name'],
          },
        },
        {
          name: 'move_task',
          description: 'Move an existing task to a different destination or project. Use this instead of add+remove when the user wants to relocate a task. Never use add_task + remove_task to simulate a move.',
          ...toolBehavior,
          parameters: {
            type: Type.OBJECT,
            properties: {
              task_id: { type: Type.STRING, description: 'The exact task_id returned when the task was created' },
              destination: { type: Type.STRING, description: 'New destination: today, existing-project, or new-project' },
              project_name: { type: Type.STRING, description: 'Name of the target project (required when destination is existing-project or new-project)' },
            },
            required: ['task_id', 'destination'],
          },
        },
        {
          name: 'update_task',
          description: 'Update an existing task if the user corrects it. Prefer task_id for precise matching.',
          ...toolBehavior,
          parameters: {
            type: Type.OBJECT,
            properties: {
              task_id: { type: Type.STRING, description: 'The exact task_id returned when the task was created. Use this for precise matching.' },
              searchPhrase: { type: Type.STRING, description: 'A word or phrase to find the existing task — only use if task_id is not available' },
              title: { type: Type.STRING, description: 'Updated task title' },
              description: { type: Type.STRING, description: 'Updated description' },
              priority: { type: Type.STRING, description: 'Updated priority: low, medium, high, or urgent' },
              ...dateProperties,
            },
            required: [],
          },
        },
        {
          name: 'remove_task',
          description: 'Remove a task if the user says to remove or cancel it. Prefer task_id for precise matching.',
          ...toolBehavior,
          parameters: {
            type: Type.OBJECT,
            properties: {
              task_id: { type: Type.STRING, description: 'The exact task_id returned when the task was created. Use this for precise matching.' },
              searchPhrase: { type: Type.STRING, description: 'A word or phrase to find the task to remove — only use if task_id is not available' },
            },
            required: [],
          },
        },
      ],
    }];

    const liveConfig: any = {
      responseModalities: [Modality.AUDIO],
      systemInstruction,
      tools,
      // Handles stay valid for ~2h, which is what lets an unexpected close or a
      // goAway be picked up mid-sentence instead of starting a blank session.
      sessionResumption: options.resumeHandle ? { handle: options.resumeHandle } : {},

      /* NO realtimeInputConfig and NO contextWindowCompression — REVERTED to the
         v40 wire behaviour (server defaults) 2026-07-28 after the P1/F1 tuning
         wave failed Igor's feel gate twice. Every VAD/compression value we sent
         made the felt latency WORSE on his device; the configs live in git
         (1a059a6 / 89c35bf) and nothing returns here without device-measured
         numbers from the PCM-injection rig first. */
    };

    // Flush what the gap collected, oldest first, then the echoes this socket
    // generation still owes. Called from onopen AND straight after the session is
    // assigned, because the SDK fires onopen BEFORE live.connect() resolves — at
    // onopen time there is not yet a session to send on.
    const flushQueues = () => {
      const session = sessionRef.current;
      if (!session) return;
      if (bufferedAudioRef.current.length > 0) {
        const buffered = bufferedAudioRef.current;
        bufferedAudioRef.current = [];
        for (const media of buffered) session.sendRealtimeInput({ media });
      }
      if (pendingToolResponsesRef.current.length > 0) {
        const pending = pendingToolResponsesRef.current;
        pendingToolResponsesRef.current = [];
        for (const entry of pending) {
          if (entry.seq !== seq) continue; // belonged to a socket that is gone
          session.sendToolResponse(entry.payload);
        }
      }
    };

    const callbacks: LiveCallbacks = {
      onopen: () => {
        if (connectSeqRef.current !== seq) return;
        console.log('Gemini Live connected');
        brainDumpDebug.socketOpens += 1;
        reconnectAttemptsRef.current = 0;
        setReconnecting(false);
        setConnectionState('listening');

        flushQueues();
        armIdleTimer();
      },
      onmessage: (message: any) => {
        if (connectSeqRef.current !== seq) return;
        brainDumpDebug.lastServerMessageAt = Date.now();

        if (message.sessionResumptionUpdate) {
          const update = message.sessionResumptionUpdate;
          if (update.resumable && update.newHandle) {
            resumeHandleRef.current = update.newHandle;
          }
        }

        if (message.goAway) {
          // The server is about to hang up. Get ahead of it: reconnect with the
          // stored handle a beat before the deadline it just gave us.
          const timeLeftMs = parseDurationMs(message.goAway.timeLeft);
          const delay = Math.max(0, (timeLeftMs ?? GO_AWAY_LEAD_MS) - GO_AWAY_LEAD_MS);
          console.warn(`Gemini Live: goAway, timeLeft=${message.goAway.timeLeft ?? 'unknown'}; reconnecting in ${delay}ms`);
          if (goAwayTimerRef.current === null && activeRef.current && !BISECT_DISABLE_RECONNECT) {
            setReconnecting(true);
            goAwayTimerRef.current = window.setTimeout(() => {
              goAwayTimerRef.current = null;
              if (!activeRef.current || intentionalStopRef.current) return;
              connectRef.current?.({
                resumeHandle: resumeHandleRef.current ?? undefined,
                preserveTasks: true,
              }).catch((err) => {
                console.error('Gemini Live: goAway reconnect failed', err);
                scheduleReconnect('goaway-reconnect-threw');
              });
            }, delay);
          }
        }

        if (message.toolCallCancellation) {
          // "Should have been not executed" — undo the rows those calls created.
          const ids: string[] = message.toolCallCancellation.ids || [];
          const cancelledTaskIds = new Set<string>();
          for (const id of ids) {
            const processed = processedCallsRef.current.get(id);
            if (processed?.createdTaskId) cancelledTaskIds.add(processed.createdTaskId);
          }
          if (cancelledTaskIds.size > 0) {
            console.warn('Gemini Live: cancelling tool calls', ids);
            const next = tasksRef.current.filter(t => !cancelledTaskIds.has(t.id));
            tasksRef.current = next;
            setTasks(next);
          }
        }

        if (message.toolCall) {
          const functionCalls = message.toolCall.functionCalls || [];
          brainDumpDebug.toolCallsReceived += functionCalls.length;
          for (const fc of functionCalls) {
            const callId: string | undefined = fc.id;
            const seen = callId && !BISECT_DISABLE_TOOLCALL_DEDUP
              ? processedCallsRef.current.get(callId)
              : undefined;

            if (seen) {
              // Known Live-API defect: the same function call arrives twice. Answer
              // it so the model is not left waiting on an id it already sent, but
              // never apply it twice — the list is the source of truth.
              console.warn(`Gemini Live: duplicate tool call ${callId} (${fc.name}) — re-answered, not re-applied`);
              sendToolResponse(callId, seen.name, seen.result);
              continue;
            }

            console.log('Tool call received:', fc.name, fc.args || {});
            // Derived from the list as it stands right now, not from a queued
            // updater: the echo carries task_id + current_tasks, and the next call
            // in this same batch sees the row this one just made.
            const outcome = applyToolCall(fc, tasksRef.current);
            tasksRef.current = outcome.next;

            if (callId) {
              processedCallsRef.current.set(callId, { name: fc.name, result: outcome.result, createdTaskId: outcome.createdTaskId });
              if (processedCallsRef.current.size > MAX_PROCESSED_CALLS) {
                const oldest = processedCallsRef.current.keys().next().value;
                if (oldest !== undefined) processedCallsRef.current.delete(oldest);
              }
            }

            // ACK FIRST, then paint. applyToolCall is pure and synchronous and
            // the echo needs its result, so it cannot be jumped — but nothing
            // else may sit in front of the send. setTasks is a scheduler
            // enqueue, and the next model (gemini-3.1-flash-live-preview) makes
            // tools SYNC-ONLY: every millisecond between the call and the echo
            // is dead air on the user's line. Zero awaits on this path, by
            // construction — tests/braindump-live-transport.spec.ts asserts the
            // mock sees the response in the SAME TICK as the delivery.
            sendToolResponse(callId, fc.name, outcome.result);
            setTasks(outcome.next);
          }
        }

        // Any message at all counts as "somebody is still there". Armed LAST so
        // nothing in here delays a tool ack; if a branch above throws, the timer
        // armed by the previous message keeps ticking, which stops the session
        // rather than stranding it.
        armIdleTimer();
      },
      onclose: () => {
        if (connectSeqRef.current !== seq) return;
        console.log('Gemini Live session closed');
        brainDumpDebug.socketCloses += 1;
        brainDumpDebug.lastCloseInfo = `close @${new Date().toISOString().slice(11, 19)}`;
        sessionRef.current = null;
        if (activeRef.current && !intentionalStopRef.current) {
          scheduleReconnect('socket-closed');
          return;
        }
        setConnectionState(prev => prev === 'connecting' ? 'error' : 'idle');
      },
      onerror: (err: any) => {
        if (connectSeqRef.current !== seq) return;
        console.error('Gemini Live error:', err);
        brainDumpDebug.socketErrors += 1;
        brainDumpDebug.lastCloseInfo = `error: ${err?.message ?? err ?? 'unknown'}`.slice(0, 120);
        if (activeRef.current && !intentionalStopRef.current) {
          scheduleReconnect('socket-error');
          return;
        }
        setConnectionState('error');
        teardown();
      },
    };

    const session = mockLiveEnabled()
      ? connectMockLiveSession({ model: effectiveModel, config: liveConfig, callbacks })
      : await new GoogleGenAI({
          apiKey: config.token,
          // Ephemeral tokens are a v1alpha-only path in @google/genai 1.41.0.
          ...(config.ephemeral && { httpOptions: { apiVersion: 'v1alpha' } }),
        }).live.connect({
          model: effectiveModel,
          config: liveConfig,
          callbacks,
        });

    if (connectSeqRef.current !== seq) {
      // Superseded while the socket was opening (stop() or another connect won).
      try { (session as any)?.close?.(); } catch { /* already gone */ }
      return;
    }
    sessionRef.current = session;
    flushQueues();
  }, [applyToolCall, armIdleTimer, clearTimers, closeSession, fetchLiveConfig, scheduleReconnect, sendToolResponse, teardown]);

  // Idempotent latest-value holder; assigning during render keeps a first-frame
  // close from finding an empty ref (an effect would run too late).
  connectRef.current = connect;

  const start = useCallback(async (projects: ProjectInfo[], options?: { preserveTasks?: boolean }) => {
    // Safety: release any leftover mic/session before starting fresh
    intentionalStopRef.current = true;
    activeRef.current = false;
    teardown();

    setConnectionState('connecting');
    setIdleStopped(false);
    if (!options?.preserveTasks) {
      setTasks([]);
      tasksRef.current = [];
      taskCounterRef.current = 0;
    }
    projectsRef.current = projects;
    newProjectsRef.current = new Map();
    processedCallsRef.current = new Map();
    resumeHandleRef.current = null;
    reconnectAttemptsRef.current = 0;
    intentionalStopRef.current = false;
    activeRef.current = true;

    try {
      // 0. Mic API only exists in secure contexts (https or localhost); a plain
      // http LAN address (e.g. http://192.168.x.x:8080) has no mediaDevices.
      if (!mockLiveEnabled() && !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Microphone unavailable on this address. Open the app via localhost or the HTTPS site — browsers only allow mic access on secure pages.'
        );
      }

      // 1. Audio FIRST, inside the tap gesture — iOS wants both the permission
      // prompt and AudioContext.resume() on a user-gesture stack. Capture runs
      // before the socket exists; handleAudioChunk buffers until onopen flushes,
      // so speech during the connect window is kept, not lost.
      if (!mockLiveEnabled()) {
        await engineStartCapture(handleAudioChunk);
      }

      await connect({ preserveTasks: options?.preserveTasks });
    } catch (error: any) {
      console.error('Brain dump start error:', error);
      intentionalStopRef.current = true;
      activeRef.current = false;
      teardown();
      setConnectionState('error');
      throw error;
    }
  }, [connect, teardown, handleAudioChunk]);

  const stop = useCallback(() => {
    // Deliberate teardown: stopSession marks it BEFORE the socket closes, so
    // onclose reads it as intentional and no reconnect is scheduled.
    stopSession('user');
  }, [stopSession]);


  const updateTask = useCallback((taskId: string, updates: Partial<BrainDumpTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const resetTasks = useCallback(() => {
    setTasks([]);
    tasksRef.current = [];
    taskCounterRef.current = 0;
    newProjectsRef.current = new Map();
    processedCallsRef.current = new Map();
    setIdleStopped(false);
  }, []);

  const setInitialTasks = useCallback((initialTasks: BrainDumpTask[]) => {
    setTasks(initialTasks);
    tasksRef.current = initialTasks;
    taskCounterRef.current = initialTasks.length;
  }, []);

  /** Undo-discard support: put a capture back on the stage without recording.
   *  Raising the idle latch reuses the whole "Paused — your capture is safe"
   *  surface (exits live, orb resumes with preserveTasks) — no new UI state. */
  const restoreStagedCapture = useCallback((restored: BrainDumpTask[]) => {
    setTasks(restored);
    tasksRef.current = restored;
    taskCounterRef.current = restored.length;
    setIdleStopped(true);
  }, []);

  return {
    tasks,
    connectionState,
    /** True between an unexpected close and the socket coming back. The mic stays
     *  open throughout; a bounded tail of audio is buffered across the gap. */
    reconnecting,
    /** The last stop was the silence auto-stop. The captured list is untouched —
     *  callers keep their capture surface up so the exits stay reachable.
     *  Cleared by start(), stop() and resetTasks(). */
    idleStopped,
    start,
    stop,
    updateTask,
    removeTask,
    resetTasks,
    restoreStagedCapture,
    setInitialTasks,
  };
}

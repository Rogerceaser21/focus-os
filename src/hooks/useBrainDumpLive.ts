import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, Type, Behavior, FunctionResponseScheduling } from '@google/genai';
import { supabase } from '@/integrations/supabase/client';
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
/** ~256ms of PCM per chunk (4096 frames @16kHz), so this is a ~6s tail. */
const MAX_BUFFERED_AUDIO_CHUNKS = 24;
const MAX_PENDING_TOOL_RESPONSES = 32;
/** Enough history to answer any re-delivery; bounded so a storm cannot balloon. */
const MAX_PROCESSED_CALLS = 200;

/* ── Bisect switches (house law: one suspect off, let the rig confess) ────────
   Flip either to true to prove the guard it names is what a test is measuring.
   tests/braindump-live-transport.spec.ts documents the expected failures. */
const BISECT_DISABLE_TOOLCALL_DEDUP = false;
const BISECT_DISABLE_RECONNECT = false;

/* Async function calling. Declaring the extraction tools NON_BLOCKING and
   answering SILENT means the model never stalls waiting on our echo and never
   speaks because of it — the mitigation for "closed 1008 mid-function-call".
   Both fields exist in @google/genai 1.41.0 (Behavior, FunctionResponseScheduling).
   One-line revert if a live call ever misbehaves on this model. */
const USE_NON_BLOCKING_TOOLS = true;

// Audio helpers
function createPcmBlob(float32Data: Float32Array): { mimeType: string; data: string } {
  const pcm16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Data[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const uint8 = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return { mimeType: 'audio/pcm;rate=16000', data: btoa(binary) };
}

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

interface MockLiveHarness {
  /** One entry per ai.live.connect the hook would have made. */
  connects: Array<{ model: string; handle: string | null; toolNames: string[] }>;
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
  /** false on a reconnect: the existing mic + audio graph are kept alive. */
  acquireMic: boolean;
  /** Reconnect resumes the server-side session state when a handle is in hand. */
  resumeHandle?: string;
  preserveTasks?: boolean;
};

export function useBrainDumpLive() {
  const [tasks, setTasks] = useState<BrainDumpTask[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [reconnecting, setReconnecting] = useState(false);

  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

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

  const teardownAudio = useCallback((options?: { keepMic?: boolean }) => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (!options?.keepMic && streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (goAwayTimerRef.current !== null) {
      window.clearTimeout(goAwayTimerRef.current);
      goAwayTimerRef.current = null;
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

  /** Full stop: no socket, no timers, no mic, nothing queued. Never the task list. */
  const teardown = useCallback(() => {
    clearTimers();
    closeSession();
    teardownAudio();
    bufferedAudioRef.current = [];
    pendingToolResponsesRef.current = [];
    setReconnecting(false);
  }, [clearTimers, closeSession, teardownAudio]);

  useEffect(() => {
    return () => {
      intentionalStopRef.current = true;
      activeRef.current = false;
      teardown();
    };
  }, [teardown]);

  /** Echo a function call. Queued (not dropped) if the socket is not up yet. */
  const sendToolResponse = useCallback((id: string | undefined, name: string, response: any) => {
    const payload = {
      functionResponses: {
        id,
        name,
        response,
        ...(USE_NON_BLOCKING_TOOLS && { scheduling: FunctionResponseScheduling.SILENT }),
      },
    };
    const session = sessionRef.current;
    if (session) {
      session.sendToolResponse(payload);
      return;
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

    // DEDUPLICATION GUARD: Check if a task with a very similar title already exists.
    // If so, merge/update instead of creating a duplicate. This prevents the LLM
    // from re-creating tasks during "Keep Talking" sessions.
    const findDuplicateTask = (title: string): BrainDumpTask | undefined => {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedTitle = normalize(title);
      return base.find(t => {
        const existing = normalize(t.title);
        // Exact match after normalization, or one contains the other
        return existing === normalizedTitle
          || existing.includes(normalizedTitle)
          || normalizedTitle.includes(existing);
      });
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

  /** Build (or re-attach) the mic -> PCM -> socket pipeline. Idempotent. */
  const attachAudio = useCallback(() => {
    if (!streamRef.current) return;      // mock transport, or the mic was never granted
    if (processorRef.current) return;    // a reconnect keeps the graph it already has

    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    inputAudioContextRef.current = inputCtx;

    const src = inputCtx.createMediaStreamSource(streamRef.current);
    sourceRef.current = src;

    // --- PCM processor for Gemini ---
    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData);
      const session = sessionRef.current;
      if (session) {
        session.sendRealtimeInput({ media: pcmBlob });
        return;
      }
      // Mid-reconnect: hold a bounded tail so a sentence spoken across the gap
      // survives. Oldest chunks go first — a stale tail is worse than no tail.
      const buffer = bufferedAudioRef.current;
      buffer.push(pcmBlob);
      if (buffer.length > MAX_BUFFERED_AUDIO_CHUNKS) buffer.shift();
    };

    src.connect(processor);
    processor.connect(inputCtx.destination);
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
    setReconnecting(true);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current?.({
        acquireMic: false,
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

    if (options.acquireMic && !mockLiveEnabled()) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
    }

    // Build system instruction with project list
    const projects = projectsRef.current;
    const projectListStr = projects.length > 0
      ? `\nExisting projects: ${projects.map(p => `"${p.name}"`).join(', ')}`
      : '\nNo existing projects yet.';

    const todayStr = getTodayDateString();

    // Build existing tasks context for resumed sessions. A reconnect always takes
    // this path: the list is the source of truth and the new socket has to be told
    // what already exists, or the model re-creates it.
    let existingTasksStr = '';
    if (options.preserveTasks && tasksRef.current.length > 0) {
      const taskLines = tasksRef.current.map(t =>
        `  - task_id: "${t.id}", title: "${t.title}", priority: "${t.priority}", destination: "${t.destination}"${t.projectName ? `, project: "${t.projectName}"` : ''}`
      ).join('\n');
      existingTasksStr = `\n\nPREVIOUSLY EXTRACTED TASKS (these already exist — use update_task or move_task to modify them, NEVER re-create them):
${taskLines}
You MUST use the task_ids listed above for any updates, moves, or removals. Do NOT create new tasks with the same titles.`;
    }

    const systemInstruction = `You are a task extraction assistant for a productivity app called "Brain Dump". The user will speak freely about tasks they need to do. Your job is to extract tasks and route them to the correct destination.
${projectListStr}

Today's date is: ${todayStr}.
When the user mentions relative dates like "next Friday", "end of the month", "in 3 days", convert them to ISO format (YYYY-MM-DD) based on today's date.
${existingTasksStr}

ROUTING RULES:
- If the user mentions a specific existing project name, use add_task_to_project with that project's name
- If the user says "new project" or mentions a project that doesn't exist, use create_project_and_add_task
- If no project context is given, default to add_task_to_today
- Act decisively. Do NOT ask clarifying questions. Just pick the best match.
- If a project name is close but not exact (e.g. "marketing" vs "Marketing Plan"), match to the closest existing project

TASK EXTRACTION RULES:
- Wait until the user has finished describing a complete task before calling any tool. A task is complete when it has a clear action and a subject. A natural pause or silence is your signal that a thought is complete. Do NOT call tools mid-sentence or on partial utterances.
- Extract clear, actionable task titles (keep them concise, under 10 words)
- Add a brief description if the user provides additional context
- Assign priority based on urgency cues: "urgent", "important", "ASAP" → urgent/high; normal items → medium; "whenever", "nice to have" → low
- If the user mentions a start date, end date, or due date, extract it as an ISO date (YYYY-MM-DD) and include start_date, end_date, and/or due_date in the tool call

CORRECTION RULES (CRITICAL — READ CAREFULLY):
- NEVER create a new task when the user wants to MODIFY an existing task. If a task with a similar title already exists, you MUST use update_task or move_task — NEVER add_task_to_today or add_task_to_project.
- When the user asks to change a property (priority, title, description, dates, project) of MULTIPLE existing tasks, you MUST call update_task ONCE PER TASK using the task_id you received when each task was created. Do NOT call any add_task tool. Do NOT re-create the tasks.
- When the user says "change all priorities to urgent" or "make them all urgent", that means call update_task for EACH existing task. Count them. If there are 3 tasks, you must make exactly 3 update_task calls.
- If the user asks to MOVE a task from one place to another, use the move_task tool with the task_id you received when that task was created. Do NOT simulate a move by calling add_task + remove_task. That causes duplicates.
- If the user says "actually put that in [project]" or "move [task] to [project]", this is always a move_task call.
- For update_task, move_task, and remove_task: ALWAYS use task_id. Only fall back to searchPhrase if you truly do not have the task_id.
- If the user corrects or removes a task, use update_task or remove_task accordingly.
- EVERY tool response includes a "current_tasks" field listing all existing tasks with their task_ids. Use these task_ids for any subsequent updates, moves, or removals.

SILENT MODE:
- You are in SILENT mode. Do NOT speak. Execute tools and output as little audio as possible.`;

    // Define tools
    const dateProperties = {
      start_date: { type: Type.STRING, description: 'Task start date in ISO format (YYYY-MM-DD)' },
      end_date: { type: Type.STRING, description: 'Task end date in ISO format (YYYY-MM-DD)' },
      due_date: { type: Type.STRING, description: 'Task due date in ISO format (YYYY-MM-DD)' },
    };

    const toolBehavior = USE_NON_BLOCKING_TOOLS ? { behavior: Behavior.NON_BLOCKING } : {};

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
        reconnectAttemptsRef.current = 0;
        setReconnecting(false);
        setConnectionState('listening');

        attachAudio();
        flushQueues();
      },
      onmessage: (message: any) => {
        if (connectSeqRef.current !== seq) return;

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
                acquireMic: false,
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
            setTasks(outcome.next);

            if (callId) {
              processedCallsRef.current.set(callId, { name: fc.name, result: outcome.result, createdTaskId: outcome.createdTaskId });
              if (processedCallsRef.current.size > MAX_PROCESSED_CALLS) {
                const oldest = processedCallsRef.current.keys().next().value;
                if (oldest !== undefined) processedCallsRef.current.delete(oldest);
              }
            }
            sendToolResponse(callId, fc.name, outcome.result);
          }
        }
      },
      onclose: () => {
        if (connectSeqRef.current !== seq) return;
        console.log('Gemini Live session closed');
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
        if (activeRef.current && !intentionalStopRef.current) {
          scheduleReconnect('socket-error');
          return;
        }
        setConnectionState('error');
        teardown();
      },
    };

    const session = mockLiveEnabled()
      ? connectMockLiveSession({ model: config.model, config: liveConfig, callbacks })
      : await new GoogleGenAI({
          apiKey: config.token,
          // Ephemeral tokens are a v1alpha-only path in @google/genai 1.41.0.
          ...(config.ephemeral && { httpOptions: { apiVersion: 'v1alpha' } }),
        }).live.connect({
          model: config.model || DEFAULT_MODEL,
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
  }, [applyToolCall, attachAudio, clearTimers, closeSession, fetchLiveConfig, scheduleReconnect, sendToolResponse, teardown]);

  // Idempotent latest-value holder; assigning during render keeps a first-frame
  // close from finding an empty ref (an effect would run too late).
  connectRef.current = connect;

  const start = useCallback(async (projects: ProjectInfo[], options?: { preserveTasks?: boolean }) => {
    // Safety: release any leftover mic/session before starting fresh
    intentionalStopRef.current = true;
    activeRef.current = false;
    teardown();

    setConnectionState('connecting');
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

      await connect({ acquireMic: true, preserveTasks: options?.preserveTasks });
    } catch (error: any) {
      console.error('Brain dump start error:', error);
      intentionalStopRef.current = true;
      activeRef.current = false;
      teardown();
      setConnectionState('error');
      throw error;
    }
  }, [connect, teardown]);

  const stop = useCallback(() => {
    // Deliberate teardown: mark it BEFORE the socket closes, so onclose reads it
    // as intentional and no reconnect is scheduled.
    intentionalStopRef.current = true;
    activeRef.current = false;
    teardown();
    setConnectionState('idle');
  }, [teardown]);


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
  }, []);

  const setInitialTasks = useCallback((initialTasks: BrainDumpTask[]) => {
    setTasks(initialTasks);
    tasksRef.current = initialTasks;
    taskCounterRef.current = initialTasks.length;
  }, []);

  return {
    tasks,
    connectionState,
    /** True between an unexpected close and the socket coming back. The mic stays
     *  open throughout; a bounded tail of audio is buffered across the gap. */
    reconnecting,
    start,
    stop,
    updateTask,
    removeTask,
    resetTasks,
    setInitialTasks,
  };
}

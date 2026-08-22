/**
 * Brain Dump audio engine — ONE AudioContext for the page's whole life.
 *
 * WHY THIS EXISTS (dead-second-session bug, 2026-07-28): the hook used to build
 * a fresh `new AudioContext({ sampleRate: 16000 })` per session and `close()`
 * it on stop. iOS Safari does not reliably survive that churn: a later context
 * created at a forced, non-hardware sample rate can capture PURE SILENCE while
 * everything else looks healthy — socket up, UI "Listening", zero errors. The
 * user speaks into a dead pipe. Igor hit exactly this on session 2 of a visit.
 *
 * The engine therefore:
 *  - creates ONE context at the HARDWARE rate (no sampleRate constraint — the
 *    forced-16k context was the trap) and NEVER closes it;
 *  - resamples to 16 kHz mono s16le in code, which works at any hardware rate;
 *  - captures via AudioWorklet (off the main thread, so streamed-task re-renders
 *    cannot starve the mic), with a ScriptProcessor fallback where worklets are
 *    unavailable;
 *  - starts capturing the moment `startCapture` is called — inside the orb-tap
 *    gesture, BEFORE the socket exists — so the caller can buffer early speech
 *    and flush it on open. First words are never lost to the connect window.
 *
 * Sessions come and go; the engine outlives them all. `stopCapture` releases
 * the microphone (the red indicator must go away) but keeps the context.
 *
 * Debug: every counter feeds getDebugSnapshot() for the ?debug=1 overlay —
 * "is audio actually flowing" must never be guesswork on a phone again.
 */

export interface PcmChunk {
  mimeType: string;
  data: string; // base64 s16le mono @16kHz
}

const OUTPUT_RATE = 16000;
/** 4096 samples @16kHz = ~256ms per chunk — the wire cadence the hook always used. */
const CHUNK_SAMPLES = 4096;

/** Worklet source, inlined as a Blob so no build plumbing is needed. Posts
 *  Float32 blocks of ~2048 frames at the context rate; all resampling stays on
 *  the main thread where it is testable. */
const WORKLET_SOURCE = `
class BrainDumpCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.len = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let off = 0;
      while (off < ch.length) {
        const take = Math.min(ch.length - off, this.buf.length - this.len);
        this.buf.set(ch.subarray(off, off + take), this.len);
        this.len += take; off += take;
        if (this.len === this.buf.length) {
          const out = this.buf;
          this.port.postMessage(out, [out.buffer]);
          this.buf = new Float32Array(2048);
          this.len = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('brain-dump-capture', BrainDumpCapture);
`;

interface EngineState {
  ctx: AudioContext | null;
  workletLoaded: boolean;
  workletFailed: boolean;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  node: AudioWorkletNode | ScriptProcessorNode | null;
  onChunk: ((chunk: PcmChunk) => void) | null;
  // Resampler carry-over between blocks (linear interpolation position).
  resamplePos: number;
  tail: Float32Array;
  // 16k accumulator up to CHUNK_SAMPLES.
  acc: Float32Array;
  accLen: number;
}

const state: EngineState = {
  ctx: null,
  workletLoaded: false,
  workletFailed: false,
  stream: null,
  source: null,
  node: null,
  onChunk: null,
  resamplePos: 0,
  tail: new Float32Array(0),
  acc: new Float32Array(CHUNK_SAMPLES),
  accLen: 0,
};

const stats = {
  captureStarts: 0,
  chunksEmitted: 0,
  lastRms: 0,
  peakRms: 0,
  workletActive: false,
  lastError: '' as string,
  contextRecreates: 0,
  /* Flight recorder (2026-08-21): which step of the tap path is in flight and
     how long each took. A tap that never comes back leaves `step` pointing at
     the hang, visible in the ?debug=1 overlay without any other tooling. */
  step: 'idle' as string,
  stepStartedAt: 0,
  micMs: 0,
  resumeMs: 0,
  graphMs: 0,
  trackMuted: false,
  trackState: '' as string,
  engineResets: 0,
  lastResetReason: '' as string,
  lastBackgroundGapMs: 0,
};

function setStep(step: string) {
  stats.step = step;
  stats.stepStartedAt = Date.now();
}

/** Thrown by startCapture when the audio path cannot be made to work inside
 *  this tap. Callers decide between a retry after resetEngine() and a visible
 *  "restart the app" surface — the one thing that must never happen again is
 *  a silent "Listening…" over a dead pipe (Igor's phone, 2026-08-20). */
export class AudioEngineError extends Error {
  code: 'context-dead' | 'mic-timeout';
  constructor(code: 'context-dead' | 'mic-timeout', message: string) {
    super(message);
    this.name = 'AudioEngineError';
    this.code = code;
  }
}

/** Test/tuning hooks read at call time (never cached): the Playwright harness
 *  shortens the bounds so a hang is provable in seconds, production keeps the
 *  defaults. */
function tuning(): { micTimeoutMs: number; workletTimeoutMs: number; longGapMs: number } {
  const t = (typeof window !== 'undefined' && (window as unknown as { __bdAudioTuning?: Partial<Record<'micTimeoutMs' | 'workletTimeoutMs' | 'longGapMs', number>> }).__bdAudioTuning) || {};
  return {
    micTimeoutMs: t.micTimeoutMs ?? MIC_TIMEOUT_MS,
    workletTimeoutMs: t.workletTimeoutMs ?? WORKLET_TIMEOUT_MS,
    longGapMs: t.longGapMs ?? LONG_BACKGROUND_GAP_MS,
  };
}

/* getUserMedia has no timeout of its own. The first-ever call waits on the
   permission prompt (a human), so the bound is generous — it exists to turn a
   FOREVER (reclaimed capture after a long background stay) into an error. */
const MIC_TIMEOUT_MS = 20000;
/* audioWorklet.addModule() after a long background stay is another observed
   forever on iOS; a bound here falls back to the ScriptProcessor path. */
const WORKLET_TIMEOUT_MS = 4000;
/* A page that sat hidden this long is treated as cold: its AudioContext is
   discarded so the next tap builds a fresh one INSIDE the gesture — the
   engine-layer equivalent of the kill-and-reopen that always works. */
const LONG_BACKGROUND_GAP_MS = 5 * 60 * 1000;

/* Live level feed for the hot-mic voice bars (Igor-approved 2026-07-29):
   per-BLOCK loudness at ~43Hz (a block is ~2048 frames at the hardware rate),
   kept as a tiny ring so the UI can render a few bars that move with the
   user's actual voice — the strongest possible "it hears you" signal. */
const LEVELS = 8;
const levelRing: number[] = new Array(LEVELS).fill(0);
let levelPos = 0;

function pushLevel(block: Float32Array) {
  let sumSq = 0;
  // Sample every 4th frame — plenty for a UI level, quarter the work.
  for (let i = 0; i < block.length; i += 4) sumSq += block[i] * block[i];
  levelRing[levelPos] = Math.sqrt(sumSq / (block.length / 4));
  levelPos = (levelPos + 1) % LEVELS;
}

/** Newest-first recent loudness samples (0..~1) for the voice bars. */
export function getLiveLevels(count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(count, LEVELS); i++) {
    out.push(levelRing[(levelPos - 1 - i + LEVELS) % LEVELS]);
  }
  return out;
}

function ensureContext(): AudioContext {
  if (!state.ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    state.ctx = new Ctor(); // hardware rate — never force 16k here
  }
  return state.ctx;
}

function base64FromPcm16(pcm16: Int16Array): string {
  const uint8 = new Uint8Array(pcm16.buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

/** Resample an input block (at ctx rate) to 16k by linear interpolation,
 *  carrying fractional position and a one-sample tail across calls. */
function pushBlock(block: Float32Array, inputRate: number) {
  pushLevel(block);
  const joined = state.tail.length
    ? (() => { const j = new Float32Array(state.tail.length + block.length); j.set(state.tail, 0); j.set(block, state.tail.length); return j; })()
    : block;

  const step = inputRate / OUTPUT_RATE;
  let pos = state.resamplePos;
  const out: number[] = [];
  while (pos + 1 < joined.length) {
    const i = Math.floor(pos);
    const frac = pos - i;
    out.push(joined[i] * (1 - frac) + joined[i + 1] * frac);
    pos += step;
  }
  // Keep the last sample as the tail for the next block's interpolation.
  const consumed = Math.max(0, joined.length - 1);
  state.tail = joined.slice(consumed);
  state.resamplePos = pos - consumed;

  // Accumulate into fixed-size chunks.
  for (const sample of out) {
    state.acc[state.accLen++] = sample;
    if (state.accLen === CHUNK_SAMPLES) emitChunk();
  }
}

function emitChunk() {
  const n = state.accLen;
  state.accLen = 0;
  if (n === 0 || !state.onChunk) return;

  const pcm16 = new Int16Array(n);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, state.acc[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / n);
  stats.lastRms = rms;
  if (rms > stats.peakRms) stats.peakRms = rms;
  stats.chunksEmitted += 1;

  state.onChunk({ mimeType: `audio/pcm;rate=${OUTPUT_RATE}`, data: base64FromPcm16(pcm16) });
}

async function attachNode(ctx: AudioContext) {
  // AudioWorklet first — capture keeps running however busy React gets.
  if (!state.workletFailed && !state.workletLoaded) {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      const { workletTimeoutMs } = tuning();
      await Promise.race([
        ctx.audioWorklet.addModule(url),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`addModule timeout after ${workletTimeoutMs}ms`)), workletTimeoutMs)),
      ]);
      URL.revokeObjectURL(url);
      state.workletLoaded = true;
    } catch (err) {
      state.workletFailed = true;
      stats.lastError = `worklet: ${(err as Error)?.message ?? err}`;
    }
  }

  if (state.workletLoaded) {
    const node = new AudioWorkletNode(ctx, 'brain-dump-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => pushBlock(e.data, ctx.sampleRate);
    stats.workletActive = true;
    return node;
  }

  // Fallback: the old main-thread path, but on the persistent context.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => pushBlock(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate);
  stats.workletActive = false;
  return node;
}

const RESUME_TIMEOUT_MS = 1500; // healthy resume() lands in <100ms; wedged = never

/** Bounded resume: true once the context is actually running. A resume() that
 *  neither resolves nor rejects (reclaimed iOS audio session) loses the race. */
async function resumeToRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${RESUME_TIMEOUT_MS}ms`)), RESUME_TIMEOUT_MS)),
    ]);
  } catch (err) {
    stats.lastError = `resume: ${(err as Error)?.message ?? err}`;
  }
  return (ctx.state as string) === 'running';
}

/**
 * Acquire the mic and start streaming 16k PCM chunks to `onChunk`.
 * Call from inside the user gesture — `ctx.resume()` and the permission prompt
 * both want it. Idempotent: a second call just swaps the sink.
 */
export async function startCapture(onChunk: (chunk: PcmChunk) => void): Promise<void> {
  state.onChunk = onChunk;
  if (state.node) return; // already capturing — new sink attached above

  stats.captureStarts += 1;
  stats.micMs = 0; stats.resumeMs = 0; stats.graphMs = 0;
  stats.trackMuted = false; stats.trackState = '';

  // Mic FIRST: getUserMedia must run while the tap's transient activation is
  // alive; the resume ladder below can burn seconds on a wedged context, and
  // a getUserMedia issued after that window hangs or prompts.
  // BOUNDED: a reclaimed capture after a long background stay can make this
  // call never settle — that was invisible before (no step, no error).
  setStep('mic');
  const micStartedAt = Date.now();
  const { micTimeoutMs } = tuning();
  const micPromise = navigator.mediaDevices.getUserMedia({
    // NO sampleRate constraint — hardware rate in, engine resamples.
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let micTimer: number | undefined;
  const stream = await Promise.race([
    micPromise,
    new Promise<MediaStream>((_, reject) => {
      micTimer = window.setTimeout(() => reject(new AudioEngineError('mic-timeout', `microphone did not answer within ${micTimeoutMs}ms`)), micTimeoutMs);
    }),
  ]).catch((err) => {
    if (err instanceof AudioEngineError) {
      // A late stream must not become a hot mic nobody owns.
      micPromise.then((late) => late.getTracks().forEach((t) => t.stop())).catch(() => { /* denied */ });
      stats.lastError = `mic: ${err.message}`;
      setStep('idle');
    }
    throw err;
  });
  window.clearTimeout(micTimer);
  stats.micMs = Date.now() - micStartedAt;
  state.stream = stream;
  const track = stream.getAudioTracks()[0];
  if (track) {
    stats.trackMuted = track.muted;
    stats.trackState = track.readyState;
    // iOS flips a reclaimed capture to muted rather than ending it — keep the
    // overlay truthful either way.
    track.onmute = () => { stats.trackMuted = true; };
    track.onunmute = () => { stats.trackMuted = false; };
    track.onended = () => { stats.trackState = 'ended'; };
  }
  try {
    setStep('resume');
    const resumeStartedAt = Date.now();
    let ctx = ensureContext();
    // iOS parks background/blurred contexts as 'suspended' (or 'interrupted');
    // resume() inside the gesture is the sanctioned wake-up. After a long
    // background stay the OS can reclaim the audio session entirely — then
    // resume() never settles (neither resolve nor reject), which used to hang
    // the awaited tap handler forever (Igor's warm-return "does nothing",
    // 2026-08-19). So: bounded resume, and a context that will not run is
    // replaced — once, inside the same tap. The page-lifetime-context rule
    // stays for healthy contexts; recreation happens only on a proven wedge.
    if (!(await resumeToRunning(ctx))) {
      stats.contextRecreates += 1;
      try { void ctx.close(); } catch { /* already dead */ }
      state.ctx = null;
      state.workletLoaded = false; // worklet modules are per-context
      state.workletFailed = false;
      ctx = ensureContext();
      if (!(await resumeToRunning(ctx))) {
        // v60 logged this and CARRIED ON — wiring the mic into a context that
        // will never produce a sample, opening the socket, and showing
        // "Listening… speak freely" over silence. A dead context is a FAILURE:
        // the engine is torn down so the caller can retry from nothing or tell
        // the user, never pretend.
        const reason = `replacement context stuck in '${ctx.state}'`;
        stats.lastError = `resume: ${reason}`;
        stats.resumeMs = Date.now() - resumeStartedAt;
        throw new AudioEngineError('context-dead', reason);
      }
    }
    stats.resumeMs = Date.now() - resumeStartedAt;

    state.resamplePos = 0;
    state.tail = new Float32Array(0);
    state.accLen = 0;

    setStep('graph');
    const graphStartedAt = Date.now();
    const source = ctx.createMediaStreamSource(stream);
    state.source = source;
    const node = await attachNode(ctx);
    state.node = node;

    source.connect(node as AudioNode);
    // Both node kinds must be pulled by the graph to produce data; a worklet with
    // one silent output and a ScriptProcessor both idle unless routed somewhere.
    (node as AudioNode).connect(ctx.destination);
    stats.graphMs = Date.now() - graphStartedAt;
    setStep('capturing');

  } catch (err) {
    // The mic is already live (acquired first, inside the gesture) — a failure
    // past that point must not leave a hot mic behind.
    stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    state.source = null;
    state.node = null;
    if (err instanceof AudioEngineError) {
      resetEngine(err.code);
    }
    setStep('idle');
    throw err;
  }
}

/** Throw the whole engine away: capture released, context closed, worklet
 *  flags cleared. The next startCapture builds a fresh context INSIDE its
 *  gesture — the cold-start path, which is the one that always works. */
export function resetEngine(reason: string): void {
  stopCapture();
  if (state.ctx) {
    try { void state.ctx.close(); } catch { /* already dead */ }
    state.ctx = null;
  }
  state.workletLoaded = false;
  state.workletFailed = false;
  stats.engineResets += 1;
  stats.lastResetReason = reason;
}

/* Long-background guard: a page hidden for LONG_BACKGROUND_GAP_MS or more comes
   back with its context discarded (unless a capture is live — the hook owns
   that case). Igor's rule of thumb "5 minutes fine, 30 minutes dead, kill the
   app and it works" is exactly the cold-vs-warm split; this makes every warm
   return past the threshold behave like the cold start. */
let hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (!hiddenAt) return;
    const gap = Date.now() - hiddenAt;
    hiddenAt = 0;
    stats.lastBackgroundGapMs = gap;
    if (gap >= tuning().longGapMs && !state.node && state.ctx) {
      resetEngine('long-background');
    }
  });
}

/** Release the microphone and the graph. The context stays — closing it is the
 *  churn that produced silent second sessions in the first place. */
export function stopCapture(): void {
  state.onChunk = null;
  if (state.node) {
    try { (state.node as AudioNode).disconnect(); } catch { /* already gone */ }
    if ('port' in state.node) (state.node as AudioWorkletNode).port.onmessage = null;
    if ('onaudioprocess' in state.node) (state.node as ScriptProcessorNode).onaudioprocess = null;
    state.node = null;
  }
  if (state.source) {
    try { state.source.disconnect(); } catch { /* already gone */ }
    state.source = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  state.accLen = 0;
  state.tail = new Float32Array(0);
  levelRing.fill(0);
  setStep('idle');
}

export function isCapturing(): boolean {
  return state.node !== null;
}

/** Everything the ?debug=1 overlay needs to answer "is audio flowing?". */
export function getDebugSnapshot() {
  return {
    ctxState: state.ctx?.state ?? 'none',
    ctxRate: state.ctx?.sampleRate ?? 0,
    capturing: state.node !== null,
    worklet: stats.workletActive,
    captureStarts: stats.captureStarts,
    chunksEmitted: stats.chunksEmitted,
    lastRms: Number(stats.lastRms.toFixed(4)),
    peakRms: Number(stats.peakRms.toFixed(4)),
    lastError: stats.lastError,
    contextRecreates: stats.contextRecreates,
    step: stats.step,
    stepMs: stats.step === 'idle' || stats.step === 'capturing' ? 0 : Date.now() - stats.stepStartedAt,
    micMs: stats.micMs,
    resumeMs: stats.resumeMs,
    graphMs: stats.graphMs,
    trackMuted: stats.trackMuted,
    trackState: stats.trackState,
    engineResets: stats.engineResets,
    lastResetReason: stats.lastResetReason,
    lastBackgroundGapMs: stats.lastBackgroundGapMs,
  };
}

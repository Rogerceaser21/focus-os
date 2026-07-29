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
};

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
      await ctx.audioWorklet.addModule(url);
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

/**
 * Acquire the mic and start streaming 16k PCM chunks to `onChunk`.
 * Call from inside the user gesture — `ctx.resume()` and the permission prompt
 * both want it. Idempotent: a second call just swaps the sink.
 */
export async function startCapture(onChunk: (chunk: PcmChunk) => void): Promise<void> {
  state.onChunk = onChunk;
  if (state.node) return; // already capturing — new sink attached above

  stats.captureStarts += 1;
  const ctx = ensureContext();
  try {
    // iOS parks background/blurred contexts as 'suspended' (or 'interrupted');
    // resume() inside the gesture is the sanctioned wake-up.
    if (ctx.state !== 'running') await ctx.resume();
  } catch (err) {
    stats.lastError = `resume: ${(err as Error)?.message ?? err}`;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    // NO sampleRate constraint — hardware rate in, engine resamples.
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  state.stream = stream;

  state.resamplePos = 0;
  state.tail = new Float32Array(0);
  state.accLen = 0;

  const source = ctx.createMediaStreamSource(stream);
  state.source = source;
  const node = await attachNode(ctx);
  state.node = node;

  source.connect(node as AudioNode);
  // Both node kinds must be pulled by the graph to produce data; a worklet with
  // one silent output and a ScriptProcessor both idle unless routed somewhere.
  (node as AudioNode).connect(ctx.destination);
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
  };
}

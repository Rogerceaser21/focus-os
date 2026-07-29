/**
 * ?debug=1 — production-safe diagnostic overlay for Brain Dump Live.
 *
 * Exists so "is the socket alive / is audio flowing / which build is this" is
 * never guesswork on a phone again (the 2026-07-28 regression hunt burned a day
 * on exactly those three unknowns). Param-gated, NOT DEV-gated: it must ship in
 * the production bundle Igor actually tests. Renders nothing without the param.
 *
 * Pure read-side: polls the module-level counters in useBrainDumpLive
 * (brainDumpDebug) and the audio engine snapshot on a timer. No Radix, no
 * portal-with-animation — a plain fixed div (drawer laws don't apply to a
 * static, always-mounted-while-enabled box, but stay boring anyway).
 */
import { useEffect, useState } from 'react';
import { brainDumpDebug, debugFlagEnabled } from '@/hooks/useBrainDumpLive';

declare const __BUILD_ID__: string;

export function BrainDumpDebugOverlay() {
  // Redirect-proof: the router strips the query on /preview/ -> /home, so the
  // flag is snapshotted at module load (see useBrainDumpLive.debugFlagEnabled).
  const enabled = debugFlagEnabled();

  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const audio = brainDumpDebug.audio();
      const sinceMsg = brainDumpDebug.lastServerMessageAt
        ? `${Math.round((Date.now() - brainDumpDebug.lastServerMessageAt) / 1000)}s ago`
        : 'never';
      setSnapshot({
        build: typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?',
        model: brainDumpDebug.model || '—',
        'socket o/c/e': `${brainDumpDebug.socketOpens}/${brainDumpDebug.socketCloses}/${brainDumpDebug.socketErrors}`,
        reconnects: brainDumpDebug.reconnectsScheduled,
        'last close': brainDumpDebug.lastCloseInfo || '—',
        'server msg': sinceMsg,
        toolCalls: brainDumpDebug.toolCallsReceived,
        'chunks live/buf': `${brainDumpDebug.chunksSentLive}/${brainDumpDebug.chunksBuffered}`,
        'audio ctx': `${audio.ctxState} @${audio.ctxRate}`,
        capture: `${audio.capturing ? 'ON' : 'off'} ${audio.worklet ? 'worklet' : 'scriptproc'} x${audio.captureStarts}`,
        'rms last/peak': `${audio.lastRms}/${audio.peakRms}`,
        'audio err': audio.lastError || '—',
      });
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled || !snapshot) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 8, left: 8, zIndex: 9999, pointerEvents: 'none',
        background: 'rgba(0,0,0,0.72)', color: '#9f9', borderRadius: 8,
        font: '10px/1.5 ui-monospace, Menlo, monospace', padding: '6px 8px',
        maxWidth: '78vw', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
      {Object.entries(snapshot).map(([k, v]) => `${k}: ${String(v)}`).join('\n')}
    </div>
  );
}

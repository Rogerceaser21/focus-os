/**
 * Hot-mic voice bars (Igor-approved 2026-07-29): four tiny bars that move with
 * the user's ACTUAL voice, fed by the audio engine's per-block level ring —
 * the truthful "it hears you, speak now" signal, live from the tap, before the
 * socket even opens.
 *
 * Motion laws respected: the bars are a persistent element inside the already-
 * mounted listen row (no layer born mid-animation), animated with scaleY
 * transforms only (no layout), and prefers-reduced-motion collapses them to a
 * steady live dot. Levels are polled — never rendered per-audio-callback — so
 * the mic path is never coupled to React.
 */
import { useEffect, useRef, useState } from 'react';
import { getLiveLevels } from '@/lib/brainDumpAudio';

const BAR_COUNT = 4;
const POLL_MS = 90;
/** Speech RMS is roughly 0.02–0.3; map that range onto bar height. */
const GAIN = 6;
const MIN_SCALE = 0.25;

export function BrainDumpVoiceBars({ active }: { active: boolean }) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const reduceMotion = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  ).current;

  useEffect(() => {
    if (!active || reduceMotion) return;
    const id = window.setInterval(() => setLevels(getLiveLevels(BAR_COUNT)), POLL_MS);
    return () => window.clearInterval(id);
  }, [active, reduceMotion]);

  if (!active) return null;

  if (reduceMotion) {
    return <span className="lg-voicedot" aria-label="Microphone live" />;
  }

  return (
    <div className="lg-voicebars" aria-hidden="true">
      {levels.map((level, i) => (
        <span
          key={i}
          style={{ transform: `scaleY(${Math.min(1, MIN_SCALE + level * GAIN)})` }}
        />
      ))}
    </div>
  );
}

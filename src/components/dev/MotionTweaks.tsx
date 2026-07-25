import React, { useState } from 'react';

/* Motion tweaks panel — Igor's live feel-tuning rig. Mounted only when the
   URL carries ?tweaks (App.tsx gate), renders nothing otherwise; ships in
   the bundle but is inert dead weight without the flag. Sliders write the
   motion tokens (index.css :root) as inline custom properties on <html>,
   so every token-driven surface (lg-modal, lg-overlay, lg-reveal, drawer,
   pills) retunes live — open a dialog, feel it, drag, reopen. COPY puts
   the current values on the clipboard for baking into index.css.
   Plain divs only (no Radix, no frost, no animation of its own): a dev
   tool must never participate in the motion it measures. */

type Token = {
  varName: string;
  label: string;
  min: number;
  max: number;
  def: number;
};

const DUR_TOKENS: Token[] = [
  { varName: '--dur-panel-in', label: 'Dialog in', min: 150, max: 700, def: 420 },
  { varName: '--dur-panel-out', label: 'Dialog out', min: 100, max: 500, def: 280 },
  { varName: '--dur-reveal-in', label: 'Reveal in', min: 150, max: 700, def: 360 },
  { varName: '--dur-reveal-out', label: 'Reveal out', min: 100, max: 500, def: 280 },
  { varName: '--dur-drawer-in', label: 'Drawer in', min: 200, max: 700, def: 380 },
  { varName: '--dur-drawer-out', label: 'Drawer out', min: 100, max: 500, def: 260 },
  { varName: '--dur-quick', label: 'Popup in', min: 80, max: 350, def: 200 },
  { varName: '--dur-quick-out', label: 'Popup out', min: 60, max: 300, def: 150 },
  { varName: '--dur-micro', label: 'Micro', min: 60, max: 300, def: 140 },
];

const EASINGS: { label: string; value: string }[] = [
  { label: 'iOS sheet (Vaul)', value: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  { label: 'Confident arrival', value: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  { label: 'Gentle glide', value: 'cubic-bezier(0.22, 1, 0.36, 1)' },
];

const setVar = (name: string, value: string) =>
  document.documentElement.style.setProperty(name, value);
const clearVar = (name: string) => document.documentElement.style.removeProperty(name);

const MotionTweaks = () => {
  const [open, setOpen] = useState(false);
  const [durs, setDurs] = useState<Record<string, number>>(() =>
    Object.fromEntries(DUR_TOKENS.map((t) => [t.varName, t.def])),
  );
  const [ease, setEase] = useState(EASINGS[0].value);
  const [copied, setCopied] = useState(false);

  const onDur = (t: Token, v: number) => {
    setDurs((d) => ({ ...d, [t.varName]: v }));
    setVar(t.varName, `${v}ms`);
  };

  const onEase = (v: string) => {
    setEase(v);
    setVar('--ease-sheet', v);
  };

  const reset = () => {
    DUR_TOKENS.forEach((t) => clearVar(t.varName));
    clearVar('--ease-sheet');
    setDurs(Object.fromEntries(DUR_TOKENS.map((t) => [t.varName, t.def])));
    setEase(EASINGS[0].value);
  };

  const copy = async () => {
    const lines = DUR_TOKENS.map((t) => `  ${t.varName}: ${durs[t.varName]}ms;`);
    lines.push(`  --ease-sheet: ${ease};`);
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed bottom-28 right-3 z-[500] font-mono text-[11px] text-white">
      {open && (
        <div className="mb-2 w-64 rounded-xl bg-black/85 p-3 shadow-2xl backdrop-blur-none">
          <div className="mb-2 font-bold tracking-wider">MOTION TWEAKS</div>
          {DUR_TOKENS.map((t) => (
            <label key={t.varName} className="mb-1.5 block">
              <span className="flex justify-between">
                <span>{t.label}</span>
                <span>{durs[t.varName]}ms</span>
              </span>
              <input
                type="range"
                min={t.min}
                max={t.max}
                step={10}
                value={durs[t.varName]}
                onChange={(e) => onDur(t, Number(e.target.value))}
                className="w-full"
              />
            </label>
          ))}
          <label className="mb-2 block">
            <span className="mb-0.5 block">Sheet easing</span>
            <select
              value={ease}
              onChange={(e) => onEase(e.target.value)}
              className="w-full rounded bg-white/15 p-1 text-white"
            >
              {EASINGS.map((o) => (
                <option key={o.value} value={o.value} className="text-black">
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button onClick={copy} className="flex-1 rounded bg-white/20 py-1.5 font-bold">
              {copied ? 'COPIED ✓' : 'COPY CSS'}
            </button>
            <button onClick={reset} className="flex-1 rounded bg-white/20 py-1.5 font-bold">
              RESET
            </button>
          </div>
          <div className="mt-1.5 text-white/50">
            Completion fade is timer-locked at 1s — not tunable here.
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="ml-auto block rounded-full bg-black/85 px-3 py-2 font-bold shadow-2xl"
      >
        {open ? '× MOTION' : '⏱ MOTION'}
      </button>
    </div>
  );
};

export default MotionTweaks;

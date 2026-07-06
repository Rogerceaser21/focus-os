/**
 * Liquid Glass — shared preview theme (Phase C, throwaway location).
 * Single adaptive design: the chosen wallpaper decides the material state
 * (frost = bright art, smoke = dark art, solid = plain) and the accent.
 * These token blocks are the draft of the production `.liquid-glass` theme
 * that lands in src/index.css during Phase D.
 * Wallpaper choice persists in localStorage so /preview and /preview/app share it.
 */
import { useEffect, useState } from 'react';

export type Material = 'frost' | 'smoke' | 'solid';
export type WallpaperId = 'lilies' | 'wave' | 'starry' | 'plain';

export const WALLPAPERS: Record<WallpaperId, {
  src: string | null; material: Material; accent: string; name: string;
}> = {
  lilies: { src: '/preview-art/water-lilies.jpg', material: 'frost', accent: '#0a84ff', name: 'Monet' },
  wave:   { src: '/preview-art/great-wave.jpg',   material: 'frost', accent: '#0f7490', name: 'Hokusai' },
  starry: { src: '/preview-art/starry-night.jpg', material: 'smoke', accent: '#7dd3fc', name: 'Van Gogh' },
  plain:  { src: null,                            material: 'solid', accent: '#16191d', name: 'Plain' },
};

const LS_KEY = 'pw-wallpaper';

export function useWallpaper(): [WallpaperId, (id: WallpaperId) => void] {
  const [id, setId] = useState<WallpaperId>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
    return saved && saved in WALLPAPERS ? (saved as WallpaperId) : 'wave';
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ } }, [id]);
  return [id, setId];
}

export function WallpaperBar({ value, onChange }: { value: WallpaperId; onChange: (id: WallpaperId) => void }) {
  return (
    <div className="pw-switch">
      <div className="pw-switch-row">
        <span className="name">Liquid Glass</span>
        {(Object.keys(WALLPAPERS) as WallpaperId[]).map((id) => (
          <button key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
            {WALLPAPERS[id].name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* Base tokens + primitives shared by every preview page. */
export const BASE_CSS = `
.pw-root {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  position: relative;
  overflow: hidden;
}
.pw-bg { position: fixed; inset: 0; background-size: cover; background-position: center; z-index: 0; }

/* ---------- material tokens ---------- */
.pw-frost {
  --t1: #22303a; --t2: rgba(34,48,58,.55); --t3: rgba(34,48,58,.35);
  --gbg: linear-gradient(135deg, rgba(255,255,255,.62) 0%, rgba(255,255,255,.36) 100%);
  --gbg-strong: linear-gradient(135deg, rgba(255,255,255,.72) 0%, rgba(255,255,255,.5) 100%);
  --gbrd: rgba(255,255,255,.62);
  --gshadow: 0 8px 32px rgba(10,30,40,.16), inset 0 1px 1px rgba(255,255,255,.85);
  --blur: 26px; --sat: 180%;
  --row-line: rgba(34,48,58,.1);
  --hover: rgba(255,255,255,.45);
  --chip: rgba(255,255,255,.55); --chip-brd: rgba(255,255,255,.7);
  --onbg: #fff; --onbg-shadow: 0 2px 24px rgba(0,20,30,.5), 0 1px 2px rgba(0,20,30,.3);
}
.pw-smoke {
  --t1: rgba(238,244,255,.95); --t2: rgba(214,226,255,.55); --t3: rgba(214,226,255,.35);
  --gbg: linear-gradient(135deg, rgba(44,52,78,.46) 0%, rgba(16,20,36,.42) 100%);
  --gbg-strong: linear-gradient(135deg, rgba(54,64,94,.6) 0%, rgba(20,24,42,.55) 100%);
  --gbrd: rgba(255,255,255,.16);
  --gshadow: 0 16px 48px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.26);
  --blur: 34px; --sat: 160%;
  --row-line: rgba(214,226,255,.1);
  --hover: rgba(255,255,255,.06);
  --chip: rgba(125,211,252,.12); --chip-brd: rgba(125,211,252,.28);
  --onbg: #f4f7ff; --onbg-shadow: 0 2px 32px rgba(0,0,0,.6);
}
.pw-solid {
  --t1: #1b1f24; --t2: rgba(27,31,36,.5); --t3: rgba(27,31,36,.32);
  --gbg: rgba(255,255,255,.78);
  --gbg-strong: rgba(255,255,255,.92);
  --gbrd: rgba(20,24,40,.08);
  --gshadow: 0 2px 16px rgba(20,24,40,.07), inset 0 1px 0 rgba(255,255,255,.95);
  --blur: 18px; --sat: 120%;
  --row-line: rgba(20,24,40,.07);
  --hover: rgba(20,24,40,.04);
  --chip: rgba(20,24,40,.05); --chip-brd: rgba(20,24,40,.07);
  --onbg: #16191d; --onbg-shadow: none;
}
.pw-solid .pw-bg {
  background:
    radial-gradient(90% 60% at 12% 6%, rgba(46,196,201,.09) 0%, transparent 60%),
    radial-gradient(80% 55% at 92% 92%, rgba(255,150,110,.09) 0%, transparent 60%),
    #f3f4f6;
}
.pw-frost .pw-bg::after, .pw-smoke .pw-bg::after { content: ''; position: absolute; inset: 0; }
.pw-frost .pw-bg::after { background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(0,0,0,.14)); }
.pw-smoke .pw-bg::after { background: radial-gradient(120% 90% at 50% 0%, rgba(6,10,26,.32), rgba(4,6,16,.64) 80%); }

.pw-glass {
  background: var(--gbg);
  backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  -webkit-backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  border: 1px solid var(--gbrd);
  box-shadow: var(--gshadow);
}

/* ---------- wallpaper switcher ---------- */
.pw-switch {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 60; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px;
  max-width: 96vw;
}
.pw-switch-row {
  display: flex; gap: 4px; align-items: center;
  background: rgba(10,12,18,.75); backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,.14); border-radius: 999px;
  padding: 4px 6px; font-size: 11px; color: rgba(255,255,255,.65);
}
.pw-switch-row button {
  min-width: 26px; height: 26px; border-radius: 999px; border: none; cursor: pointer;
  background: transparent; color: rgba(255,255,255,.6); font-size: 12px; font-weight: 600; padding: 0 10px;
}
.pw-switch-row button.on { background: #fff; color: #111; }
.pw-switch-row .name { padding: 0 8px 0 6px; white-space: nowrap; }

/* ---------- shared primitives ---------- */
.pw-btn {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  border-radius: 999px; border: 1px solid var(--gbrd);
  background: var(--chip); color: var(--t1);
  font-size: 12.5px; font-weight: 600; padding: 8px 12px;
}
.pw-btn.acc { background: var(--pw-ac); border-color: transparent; color: #fff; box-shadow: 0 4px 16px color-mix(in srgb, var(--pw-ac) 40%, transparent); }
.pw-iconbtn {
  width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--gbrd);
  background: var(--chip); color: var(--t2); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pw-dot { width: 9px; height: 9px; border-radius: 999px; flex: none; }
`;

/**
 * /preview — throwaway design-taste mock for the iOS liquid-glass redesign.
 * No auth, no data. Three divergent takes switched via ?take=a|b|c.
 *   A — "Gallery Glass": faithful iOS 26 liquid glass over public-domain art
 *   B — "visionOS Night": dark spatial glass over Starry Night
 *   C — "Porcelain": clean minimal iOS, no art, near-white
 * Delete this file (and public/preview-art/) once tokens are locked.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Video, FolderOpen, Calendar, ListTodo, Settings, Check,
} from 'lucide-react';

type TakeId = 'a' | 'b' | 'c';

const MOCK_TASKS = [
  { id: 1, title: 'Finalise IRL automation spec', project: 'TRS', color: '#e8a33d', due: 'Today', done: false },
  { id: 2, title: 'Review Lovable exit plan', project: 'Focus OS', color: '#2ec4c9', due: 'Tomorrow', done: false },
  { id: 3, title: 'Prep Wednesday demo', project: 'AIS', color: '#b07de8', due: 'Wed', done: true },
];

const SUBTITLE = 'Ready to capture your thoughts?';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/* ---------------------------------------------------------------- styles */

const CSS = `
.pv-root {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  position: relative;
  overflow: hidden;
}
.pv-col {
  position: relative;
  max-width: 430px;
  margin: 0 auto;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 48px 20px 0;
  overflow: hidden;
}
.pv-bg {
  position: fixed; inset: 0;
  background-size: cover;
  background-position: center;
  z-index: 0;
}
.pv-content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; }

/* switcher (not part of the design — dev control) */
.pv-switch {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 50; display: flex; gap: 4px; align-items: center;
  background: rgba(10,12,18,.72); backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,.14); border-radius: 999px;
  padding: 4px 6px; font-size: 11px; color: rgba(255,255,255,.65);
}
.pv-switch button {
  width: 26px; height: 26px; border-radius: 999px; border: none; cursor: pointer;
  background: transparent; color: rgba(255,255,255,.6);
  font-size: 12px; font-weight: 600;
}
.pv-switch button.on { background: #fff; color: #111; }
.pv-switch .name { padding: 0 8px 0 4px; letter-spacing: .02em; white-space: nowrap; }

/* ============================== TAKE A — Gallery Glass ============ */
.pv-a .pv-bg {
  background-image:
    linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 30%, rgba(0,0,0,.16) 100%),
    url('/preview-art/water-lilies.jpg');
}
.pv-a .pv-greet {
  color: #fff; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
  text-shadow: 0 2px 28px rgba(0,20,30,.55), 0 1px 2px rgba(0,20,30,.35);
  margin: 18px 0 6px; text-align: center;
}
.pv-a .pv-sub {
  color: rgba(255,255,255,.92); font-size: 17px; text-align: center;
  text-shadow: 0 1px 14px rgba(0,20,30,.5);
}
.pv-a .pv-glass {
  background: linear-gradient(135deg, rgba(255,255,255,.60) 0%, rgba(255,255,255,.34) 100%);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255,255,255,.62);
  border-radius: 28px;
  box-shadow:
    0 8px 32px rgba(10,30,40,.18),
    inset 0 1px 1px rgba(255,255,255,.85),
    inset 0 -1px 1px rgba(255,255,255,.18);
}
.pv-a .pv-card-title { color: #26333b; }
.pv-a .pv-task-title { color: #1d2930; }
.pv-a .pv-task-meta  { color: rgba(29,41,48,.55); }
.pv-a .pv-chip {
  background: rgba(255,255,255,.55); color: #26333b;
  border: 1px solid rgba(255,255,255,.7);
}
.pv-a .pv-orb {
  background: linear-gradient(135deg, rgba(255,255,255,.55), rgba(255,255,255,.22));
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(255,255,255,.75);
  box-shadow:
    0 16px 48px rgba(10,30,40,.28),
    inset 0 2px 2px rgba(255,255,255,.9),
    inset 0 -8px 24px rgba(255,255,255,.25);
}
.pv-a .pv-orb-core {
  background: radial-gradient(circle at 38% 32%, #ff5a52, #c81e1e 70%);
  box-shadow: 0 2px 14px rgba(200,30,30,.55), inset 0 1px 2px rgba(255,255,255,.5);
}
.pv-a .pv-orb-label {
  color: #fff; text-shadow: 0 1px 12px rgba(0,20,30,.55);
}
.pv-a .pv-pill {
  background: rgba(255,255,255,.32);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255,255,255,.55);
  color: #fff; text-shadow: 0 1px 8px rgba(0,20,30,.4);
  box-shadow: 0 4px 20px rgba(10,30,40,.15), inset 0 1px 1px rgba(255,255,255,.6);
}
.pv-a .pv-dock {
  background: linear-gradient(135deg, rgba(255,255,255,.55), rgba(255,255,255,.30));
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255,255,255,.65);
  box-shadow: 0 12px 40px rgba(10,30,40,.25), inset 0 1px 1px rgba(255,255,255,.85);
}
.pv-a .pv-dock-item { color: rgba(29,41,48,.52); }
.pv-a .pv-dock-item.on { color: #0a84ff; }
.pv-a .pv-dock-item.on .pv-dock-bub { background: rgba(10,132,255,.14); }

/* ============================== TAKE B — visionOS Night =========== */
.pv-b .pv-bg {
  background-image:
    radial-gradient(120% 90% at 50% 0%, rgba(6,10,26,.30) 0%, rgba(4,6,16,.62) 78%),
    url('/preview-art/starry-night.jpg');
}
.pv-b .pv-greet {
  color: #f4f7ff; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
  text-shadow: 0 2px 32px rgba(0,0,0,.6);
  margin: 18px 0 6px; text-align: center;
}
.pv-b .pv-sub { color: rgba(214,226,255,.75); font-size: 17px; text-align: center; }
.pv-b .pv-glass {
  background: linear-gradient(135deg, rgba(46,54,80,.42) 0%, rgba(18,22,38,.38) 100%);
  backdrop-filter: blur(36px) saturate(160%);
  -webkit-backdrop-filter: blur(36px) saturate(160%);
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 28px;
  box-shadow:
    0 16px 48px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.28),
    inset 0 -1px 0 rgba(255,255,255,.05);
}
.pv-b .pv-card-title { color: rgba(228,238,255,.92); }
.pv-b .pv-task-title { color: rgba(240,246,255,.95); }
.pv-b .pv-task-meta  { color: rgba(214,226,255,.5); }
.pv-b .pv-chip {
  background: rgba(120,200,255,.12); color: #9ddcff;
  border: 1px solid rgba(120,200,255,.28);
}
.pv-b .pv-orb {
  background: linear-gradient(135deg, rgba(52,62,92,.5), rgba(14,18,34,.55));
  backdrop-filter: blur(30px) saturate(150%);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
  border: 1.5px solid rgba(255,255,255,.22);
  box-shadow:
    0 20px 60px rgba(0,0,0,.6),
    0 0 44px rgba(125,211,252,.18),
    inset 0 2px 1px rgba(255,255,255,.3),
    inset 0 -10px 30px rgba(80,120,220,.12);
  animation: pv-breathe 3.6s ease-in-out infinite;
}
.pv-b .pv-orb-core {
  background: radial-gradient(circle at 38% 32%, #ff6a5e, #b31414 72%);
  box-shadow: 0 0 22px rgba(255,80,60,.65), 0 0 44px rgba(255,80,60,.3);
}
.pv-b .pv-orb-label { color: rgba(214,226,255,.85); }
.pv-b .pv-pill {
  background: rgba(26,32,54,.45);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: 1px solid rgba(255,255,255,.16);
  color: rgba(228,238,255,.9);
  box-shadow: 0 8px 28px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.22);
}
.pv-b .pv-dock {
  background: linear-gradient(135deg, rgba(40,48,74,.5), rgba(14,18,34,.55));
  backdrop-filter: blur(36px) saturate(160%);
  -webkit-backdrop-filter: blur(36px) saturate(160%);
  border: 1px solid rgba(255,255,255,.18);
  box-shadow: 0 16px 48px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.28);
}
.pv-b .pv-dock-item { color: rgba(214,226,255,.45); }
.pv-b .pv-dock-item.on { color: #7dd3fc; }
.pv-b .pv-dock-item.on .pv-dock-bub {
  background: rgba(125,211,252,.14);
  box-shadow: 0 0 18px rgba(125,211,252,.35);
}
@keyframes pv-breathe {
  0%, 100% { box-shadow: 0 20px 60px rgba(0,0,0,.6), 0 0 44px rgba(125,211,252,.18), inset 0 2px 1px rgba(255,255,255,.3), inset 0 -10px 30px rgba(80,120,220,.12); }
  50%      { box-shadow: 0 20px 60px rgba(0,0,0,.6), 0 0 64px rgba(125,211,252,.32), inset 0 2px 1px rgba(255,255,255,.3), inset 0 -10px 30px rgba(80,120,220,.12); }
}

/* ============================== TAKE C — Porcelain ================ */
.pv-c .pv-bg {
  background:
    radial-gradient(90% 60% at 15% 8%,  rgba(46,196,201,.10) 0%, rgba(46,196,201,0) 60%),
    radial-gradient(80% 55% at 90% 90%, rgba(255,150,110,.10) 0%, rgba(255,150,110,0) 60%),
    #f4f5f7;
}
.pv-c .pv-greet {
  color: #16191d; font-size: 31px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.15;
  margin: 18px 0 6px; text-align: center;
}
.pv-c .pv-sub { color: rgba(22,25,29,.5); font-size: 16px; text-align: center; }
.pv-c .pv-glass {
  background: rgba(255,255,255,.74);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(20,24,40,.07);
  border-radius: 24px;
  box-shadow:
    0 2px 16px rgba(20,24,40,.06),
    inset 0 1px 0 rgba(255,255,255,.95);
}
.pv-c .pv-card-title { color: #3a4149; }
.pv-c .pv-task-title { color: #1b1f24; }
.pv-c .pv-task-meta  { color: rgba(27,31,36,.45); }
.pv-c .pv-chip {
  background: rgba(20,24,40,.05); color: #3a4149;
  border: 1px solid rgba(20,24,40,.06);
}
.pv-c .pv-orb {
  background: linear-gradient(160deg, #ffffff, #eef0f3);
  border: 1px solid rgba(20,24,40,.08);
  box-shadow:
    0 10px 36px rgba(20,24,40,.12),
    inset 0 1.5px 1px rgba(255,255,255,1),
    inset 0 -6px 16px rgba(20,24,40,.04);
}
.pv-c .pv-orb-core {
  background: radial-gradient(circle at 38% 32%, #f4564d, #c1201d 72%);
  box-shadow: 0 2px 10px rgba(193,32,29,.35);
}
.pv-c .pv-orb-label { color: rgba(22,25,29,.55); }
.pv-c .pv-pill {
  background: rgba(255,255,255,.8);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(20,24,40,.08);
  color: #3a4149;
  box-shadow: 0 2px 12px rgba(20,24,40,.06), inset 0 1px 0 rgba(255,255,255,.95);
}
.pv-c .pv-dock {
  background: rgba(255,255,255,.78);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(20,24,40,.07);
  box-shadow: 0 8px 32px rgba(20,24,40,.10), inset 0 1px 0 rgba(255,255,255,.95);
}
.pv-c .pv-dock-item { color: rgba(27,31,36,.38); }
.pv-c .pv-dock-item.on { color: #16191d; }
.pv-c .pv-dock-item.on .pv-dock-bub { background: rgba(20,24,40,.06); }

/* ============================== shared skeleton =================== */
.pv-uphead {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 16px 18px 2px;
}
.pv-card-title { font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.pv-count { font-size: 12px; opacity: .55; }
.pv-task {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px;
}
.pv-task + .pv-task { border-top: 1px solid rgba(127,127,127,.12); }
.pv-tick {
  width: 24px; height: 24px; border-radius: 999px; flex: none;
  border: 1.5px solid rgba(127,127,127,.4);
  display: flex; align-items: center; justify-content: center;
}
.pv-tick.done { border-color: transparent; background: #34c759; color: #fff; }
.pv-task-title { font-size: 15.5px; font-weight: 500; line-height: 1.25; }
.pv-task-title.done { text-decoration: line-through; opacity: .45; }
.pv-task-meta { font-size: 12.5px; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.pv-dot { width: 7px; height: 7px; border-radius: 999px; flex: none; }
.pv-chip {
  font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; flex: none;
}
.pv-orb {
  width: 118px; height: 118px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform .18s ease;
}
.pv-orb:active { transform: scale(.94); }
.pv-orb-core { width: 30px; height: 30px; border-radius: 999px; }
.pv-orb-label { font-size: 12.5px; font-weight: 500; text-align: center; }
.pv-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 22px; border-radius: 999px;
  font-size: 14px; font-weight: 500; cursor: pointer;
}
.pv-dock {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  z-index: 20; display: flex; gap: 6px; align-items: center;
  padding: 8px 10px; border-radius: 999px;
}
.pv-dock-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: none; background: transparent; cursor: pointer; padding: 0;
}
.pv-dock-bub {
  width: 52px; height: 40px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
}
.pv-dock-item span { font-size: 10px; font-weight: 600; letter-spacing: .01em; }
.pv-upnext { margin-top: 24px; }
.pv-spacer { flex: 1; min-height: 16px; }
.pv-actions {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; margin-bottom: 108px;
}

/* -------- tablet: wider centred column, bigger type -------- */
@media (min-width: 640px) {
  .pv-col { max-width: 620px; padding: 84px 40px 0; }
  .pv-root .pv-greet { font-size: 40px; }
  .pv-upnext { margin-top: 36px; }
  .pv-root .pv-orb { width: 132px; height: 132px; }
  .pv-root .pv-orb-core { width: 33px; height: 33px; }
  .pv-root .pv-orb-label { font-size: 13.5px; }
}

/* -------- desktop / landscape: two-column composition -------- */
@media (min-width: 1000px) {
  .pv-col { max-width: 1060px; padding: 0 56px; }
  .pv-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    grid-template-rows: 1fr auto auto 1.15fr;
    column-gap: 64px;
  }
  .pv-head { grid-column: 1; grid-row: 2; }
  .pv-root .pv-greet { font-size: 48px; text-align: left; margin-top: 0; }
  .pv-root .pv-sub { text-align: left; font-size: 18px; }
  .pv-actions { grid-column: 1; grid-row: 3; margin: 56px 0 0; }
  .pv-upnext { grid-column: 2; grid-row: 1 / span 4; align-self: center; margin-top: 0; }
  .pv-spacer { display: none; }
  .pv-root .pv-orb { width: 150px; height: 150px; }
  .pv-root .pv-orb-core { width: 36px; height: 36px; }
  .pv-root .pv-task { padding: 12px 20px; }
  .pv-root .pv-uphead { padding: 18px 20px 4px; }
}
`;

/* ------------------------------------------------------------ skeleton */

function HeroSkeleton() {
  return (
    <div className="pv-content">
      <div className="pv-head">
        <h1 className="pv-greet">{greeting()}, Igor</h1>
        <p className="pv-sub">{SUBTITLE}</p>
      </div>

      <div className="pv-glass pv-upnext">
        <div className="pv-uphead">
          <span className="pv-card-title">Up next</span>
          <span className="pv-count pv-task-meta">2 open</span>
        </div>
        <div style={{ paddingBottom: 8 }}>
          {MOCK_TASKS.map((t) => (
            <div key={t.id} className="pv-task">
              <div className={`pv-tick ${t.done ? 'done' : ''}`}>
                {t.done && <Check size={14} strokeWidth={3} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={`pv-task-title ${t.done ? 'done' : ''}`}>{t.title}</div>
                <div className="pv-task-meta">
                  <span className="pv-dot" style={{ background: t.color }} />
                  {t.project}
                </div>
              </div>
              <span className="pv-chip">{t.due}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pv-spacer" />

      <div className="pv-actions">
        <button className="pv-orb" aria-label="Brain dump">
          <div className="pv-orb-core" />
        </button>
        <span className="pv-orb-label">Tap to capture your thoughts into tasks</span>
        <button className="pv-pill" style={{ marginTop: 6 }}>
          <Video size={16} />
          Record Meeting
        </button>
      </div>

      <nav className="pv-dock">
        {[
          { icon: ListTodo, label: 'Tasks', on: true },
          { icon: FolderOpen, label: 'Projects', on: false },
          { icon: Calendar, label: 'Meetings', on: false },
          { icon: Settings, label: 'Settings', on: false },
        ].map(({ icon: Icon, label, on }) => (
          <button key={label} className={`pv-dock-item ${on ? 'on' : ''}`}>
            <div className="pv-dock-bub"><Icon size={21} /></div>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------ page */

const TAKE_NAMES: Record<TakeId, string> = {
  a: 'A · Gallery Glass',
  b: 'B · visionOS Night',
  c: 'C · Porcelain',
};

const Preview = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get('take');
  const take: TakeId = raw === 'b' || raw === 'c' ? raw : 'a';
  const [, force] = useState(0);

  // re-render every minute so the greeting stays honest during long sessions
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={`pv-root pv-${take}`}>
      <style>{CSS}</style>
      <div className="pv-bg" />
      <div className="pv-switch">
        {(['a', 'b', 'c'] as TakeId[]).map((id) => (
          <button
            key={id}
            className={take === id ? 'on' : ''}
            onClick={() => setParams({ take: id }, { replace: true })}
          >
            {id.toUpperCase()}
          </button>
        ))}
        <span className="name">{TAKE_NAMES[take]}</span>
      </div>
      <div className="pv-col">
        <HeroSkeleton />
      </div>
    </div>
  );
};

export default Preview;

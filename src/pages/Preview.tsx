/**
 * /preview — Liquid Glass hero mock (Phase C, throwaway).
 * One adaptive design: pick a wallpaper, the glass/text/accent retune themselves.
 * Shares tokens + wallpaper choice with /preview/app via previewTheme.
 * Delete together with PreviewApp.tsx and previewTheme.tsx once Phase D ships.
 */
import { Link } from 'react-router-dom';
import {
  Video, FolderOpen, Calendar, ListTodo, Settings, Check, ArrowRight,
} from 'lucide-react';
import { BASE_CSS, WALLPAPERS, WallpaperBar, useWallpaper } from './previewTheme';

const MOCK_TASKS = [
  { id: 1, title: 'Finalise IRL automation spec', project: 'TRS', color: '#e8a33d', due: 'Today', done: false },
  { id: 2, title: 'Review Lovable exit plan', project: 'Focus OS', color: '#2ec4c9', due: 'Tomorrow', done: false },
  { id: 3, title: 'Prep Wednesday demo', project: 'AIS', color: '#b07de8', due: 'Wed', done: true },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

const HERO_CSS = `
.pw-hero-col {
  position: relative; z-index: 1;
  max-width: 430px; margin: 0 auto; height: 100vh;
  display: flex; flex-direction: column;
  padding: 64px 20px 0; overflow: hidden;
}
.pw-hero-greet {
  font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
  margin: 12px 0 6px; text-align: center;
  color: var(--onbg); text-shadow: var(--onbg-shadow);
}
.pw-hero-sub { font-size: 16px; text-align: center; color: var(--onbg); opacity: .85; text-shadow: var(--onbg-shadow); }
.pw-solid .pw-hero-sub { opacity: .55; }

.pw-upnext { margin-top: 24px; border-radius: 26px; }
.pw-uphead { display: flex; align-items: baseline; justify-content: space-between; padding: 16px 18px 2px; }
.pw-uphead .ttl { font-size: 12px; font-weight: 700; letter-spacing: .1em; color: var(--t2); }
.pw-uphead .cnt { font-size: 12px; color: var(--t3); }
.pw-utask { display: flex; align-items: center; gap: 12px; padding: 10px 18px; }
.pw-utask + .pw-utask { border-top: 1px solid var(--row-line); }
.pw-tick {
  width: 23px; height: 23px; border-radius: 999px; flex: none;
  border: 1.5px solid var(--t3); display: flex; align-items: center; justify-content: center;
  background: transparent; color: transparent;
}
.pw-tick.done { border-color: transparent; background: #34c759; color: #fff; }
.pw-utitle { font-size: 15px; font-weight: 500; color: var(--t1); line-height: 1.25; }
.pw-utitle.done { text-decoration: line-through; opacity: .45; }
.pw-umeta { font-size: 12px; color: var(--t2); display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.pw-uchip {
  font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; flex: none;
  background: var(--chip); border: 1px solid var(--chip-brd); color: var(--t1);
}

.pw-spacer { flex: 1; min-height: 16px; }
.pw-actions { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 108px; }
.pw-orb {
  width: 118px; height: 118px; border-radius: 999px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: var(--gbg); border: 1.5px solid var(--gbrd);
  backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  -webkit-backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  box-shadow: var(--gshadow), 0 16px 48px rgba(0,0,0,.18);
  transition: transform .18s ease;
}
.pw-orb:active { transform: scale(.94); }
.pw-orb-core {
  width: 30px; height: 30px; border-radius: 999px;
  background: radial-gradient(circle at 38% 32%, #ff5a52, #c81e1e 70%);
  box-shadow: 0 2px 14px rgba(200,30,30,.55), inset 0 1px 2px rgba(255,255,255,.5);
}
.pw-orb-label { font-size: 12.5px; font-weight: 500; text-align: center; color: var(--onbg); opacity: .9; text-shadow: var(--onbg-shadow); }
.pw-solid .pw-orb-label { opacity: .6; }
.pw-recpill { margin-top: 6px; padding: 11px 22px; font-size: 14px; }

.pw-hero-dock {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  z-index: 20; display: flex; gap: 6px; align-items: center;
  padding: 8px 10px; border-radius: 999px;
}
.pw-hero-dock button {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: none; background: transparent; cursor: pointer; padding: 0 6px; color: var(--t2);
}
.pw-hero-dock button.on { color: var(--pw-ac); }
.pw-hero-dock .bub { width: 52px; height: 40px; border-radius: 999px; display: flex; align-items: center; justify-content: center; }
.pw-hero-dock button.on .bub { background: color-mix(in srgb, var(--pw-ac) 14%, transparent); }
.pw-hero-dock span { font-size: 10px; font-weight: 600; }

.pw-applink {
  position: fixed; right: 14px; bottom: 18px; z-index: 30;
  display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
  font-size: 12px; font-weight: 600; color: var(--t1);
  border-radius: 999px; padding: 9px 14px;
}

@media (min-width: 640px) {
  .pw-hero-col { max-width: 620px; padding: 84px 40px 0; }
  .pw-hero-greet { font-size: 40px; }
  .pw-upnext { margin-top: 36px; }
  .pw-orb { width: 132px; height: 132px; }
}
@media (min-width: 1000px) {
  .pw-hero-col { max-width: 1060px; padding: 0 56px; display: grid; grid-template-columns: minmax(0,1fr) 420px; grid-template-rows: 1fr auto auto 1.15fr; column-gap: 64px; }
  .pw-hero-head { grid-column: 1; grid-row: 2; }
  .pw-hero-greet { font-size: 48px; text-align: left; margin-top: 0; }
  .pw-hero-sub { text-align: left; font-size: 18px; }
  .pw-upnext { grid-column: 2; grid-row: 1 / span 4; align-self: center; margin-top: 0; }
  .pw-actions { grid-column: 1; grid-row: 3; margin: 56px 0 0; }
  .pw-spacer { display: none; }
  .pw-orb { width: 150px; height: 150px; }
  .pw-orb-core { width: 36px; height: 36px; }
}
`;

const Preview = () => {
  const [wp, setWp] = useWallpaper();
  const bg = WALLPAPERS[wp];

  return (
    <div className={`pw-root pw-${bg.material}`} style={{ ['--pw-ac' as string]: bg.accent }}>
      <style>{BASE_CSS}</style>
      <style>{HERO_CSS}</style>
      <div className="pw-bg" style={bg.src ? { backgroundImage: `url('${bg.src}')` } : undefined} />
      <WallpaperBar value={wp} onChange={setWp} />

      <div className="pw-hero-col">
        <div className="pw-hero-head">
          <h1 className="pw-hero-greet">{greeting()}, Igor</h1>
          <p className="pw-hero-sub">Ready to capture your thoughts?</p>
        </div>

        <div className="pw-glass pw-upnext">
          <div className="pw-uphead">
            <span className="ttl">UP NEXT</span>
            <span className="cnt">2 open</span>
          </div>
          <div style={{ paddingBottom: 8 }}>
            {MOCK_TASKS.map((t) => (
              <div key={t.id} className="pw-utask">
                <div className={`pw-tick ${t.done ? 'done' : ''}`}>{t.done && <Check size={13} strokeWidth={3} />}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={`pw-utitle ${t.done ? 'done' : ''}`}>{t.title}</div>
                  <div className="pw-umeta"><span className="pw-dot" style={{ background: t.color }} />{t.project}</div>
                </div>
                <span className="pw-uchip">{t.due}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pw-spacer" />

        <div className="pw-actions">
          <button className="pw-orb" aria-label="Brain dump"><div className="pw-orb-core" /></button>
          <span className="pw-orb-label">Tap to capture your thoughts into tasks</span>
          <button className="pw-btn pw-recpill"><Video size={16} />Record Meeting</button>
        </div>

        <nav className="pw-hero-dock pw-glass">
          {[
            { icon: ListTodo, label: 'Tasks', on: true },
            { icon: FolderOpen, label: 'Projects', on: false },
            { icon: Calendar, label: 'Meetings', on: false },
            { icon: Settings, label: 'Settings', on: false },
          ].map(({ icon: Icon, label, on }) => (
            <button key={label} className={on ? 'on' : ''}>
              <div className="bub"><Icon size={21} /></div>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <Link to="/preview/app" className="pw-applink pw-glass">Main app mock <ArrowRight size={13} /></Link>
    </div>
  );
};

export default Preview;

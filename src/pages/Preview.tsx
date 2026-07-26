/**
 * /preview — Liquid Glass home hero mock (Phase C/D, throwaway).
 * Centred layout at every size (no split view). Tapping the Brain Dump orb
 * starts a mock recording: on wide screens the orb glides LEFT and captured
 * tasks stream in live on the RIGHT; on mobile the stream opens below.
 * Shares tokens + wallpaper choice with /preview/app via previewTheme.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Video, FolderOpen, Calendar, ListTodo, Settings, Check, ArrowRight,
  Mic, Square, Plus,
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
  transition: max-width .5s cubic-bezier(.4,0,.2,1);
}
.pw-hero-greet {
  font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15;
  margin: 12px 0 6px; text-align: center;
  color: var(--onbg); text-shadow: var(--onbg-shadow);
}
.pw-hero-sub { font-size: 16px; text-align: center; color: var(--onbg); opacity: .85; text-shadow: var(--onbg-shadow); }
.pw-solid .pw-hero-sub { opacity: .55; }

/* up next card (fades away while recording) */
.pw-upnext { margin-top: 24px; border-radius: 26px; transition: opacity .35s ease, transform .35s ease; }
.rec .pw-upnext {
  /* fade out AND leave the flow so the stream can take this slot */
  position: absolute; left: 20px; right: 20px;
  opacity: 0; transform: translateY(8px) scale(.98); pointer-events: none;
}
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

/* orb + actions (the orb glides left while recording on wide screens) */
.pw-actions {
  display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 108px;
  transition: transform .55s cubic-bezier(.4,0,.2,1), margin .4s ease;
}
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
  transition: border-radius .3s ease;
}
.rec .pw-orb-core { animation: pw-corepulse 1.6s ease-in-out infinite; border-radius: 9px; }
@keyframes pw-corepulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(.8); } }
.pw-orb-label {
  font-size: 12.5px; font-weight: 500; text-align: center;
  color: var(--onbg); opacity: .9; text-shadow: var(--onbg-shadow);
}
.pw-solid .pw-orb-label { opacity: .6; }
.pw-recpill { margin-top: 6px; padding: 11px 22px; font-size: 14px; }
.pw-recbtns { display: flex; gap: 8px; margin-top: 6px; }
.pw-recbtns .pw-btn { padding: 10px 18px; font-size: 13px; }

/* live task stream (brain dump) */
.pw-stream { border-radius: 26px; padding: 4px 14px 12px; opacity: 0; max-height: 0; overflow: hidden;
  margin-top: 0; transition: opacity .35s ease, max-height .45s ease, margin .3s ease; }
.rec .pw-stream { opacity: 1; max-height: 52vh; overflow-y: auto; margin-top: 24px; }
.pw-stream-listen { display: flex; align-items: center; gap: 12px; padding: 12px 6px 6px; }
.pw-mic {
  width: 42px; height: 42px; border-radius: 999px; flex: none; position: relative;
  background: var(--pw-ac); color: #fff; display: flex; align-items: center; justify-content: center;
}
.pw-mic::before, .pw-mic::after {
  content: ''; position: absolute; inset: 0; border-radius: 999px;
  border: 2px solid var(--pw-ac); animation: pw-ping 1.8s ease-out infinite;
}
.pw-mic::after { animation-delay: .9s; }
@keyframes pw-ping { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.9); opacity: 0; } }
.pw-stream-listen .lbl { font-size: 13.5px; font-weight: 600; color: var(--t1); }
.pw-stream-listen .sub { font-size: 11.5px; color: var(--t2); margin-top: 1px; }
.pw-sgroup { margin-top: 10px; }
.pw-sglabel { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: var(--t2); padding: 2px 4px; display: flex; align-items: center; gap: 6px; }
.pw-stask {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px; margin-top: 6px;
  border-radius: 14px; background: var(--gbg-strong); border: 1px solid var(--gbrd);
  animation: pw-rise .35s ease both;
}
@keyframes pw-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.pw-stask .tt { font-size: 13.5px; font-weight: 500; color: var(--t1); flex: 1; }
.pw-schip { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; flex: none;
  background: var(--chip); border: 1px solid var(--chip-brd); color: var(--t2); }

/* dock */
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
@media (max-width: 639px) {
  .pw-applink { bottom: 88px; right: 14px; padding: 10px; }
  .pw-applink .txt { display: none; }
}

@media (min-width: 640px) {
  .pw-hero-col { max-width: 620px; padding: 84px 40px 0; }
  .pw-hero-greet { font-size: 40px; }
  .pw-upnext { margin-top: 36px; }
  .pw-orb { width: 132px; height: 132px; }
}

/* wide screens: centred by default; recording opens the side-by-side stage */
@media (min-width: 1000px) {
  .pw-hero-col { max-width: 640px; }
  .pw-hero-col.rec { max-width: 1120px; }
  .pw-hero-greet { font-size: 46px; }
  .pw-hero-sub { font-size: 18px; }
  .pw-orb { width: 150px; height: 150px; }
  .pw-orb-core { width: 36px; height: 36px; }
  .rec .pw-actions { transform: translateX(-280px); }
  .pw-stream {
    position: absolute; right: 44px; top: 50%; width: 460px; max-height: none;
    transform: translateY(-46%) translateX(36px); overflow: hidden;
    transition: opacity .4s ease .12s, transform .55s cubic-bezier(.4,0,.2,1) .08s;
  }
  .rec .pw-stream { max-height: 72vh; overflow-y: auto; transform: translateY(-46%) translateX(0); margin-top: 0; }
}
`;

/* streamed mock tasks: [group, icon, title, chip, colour] appearing in order */
const STREAM = [
  { group: "TODAY'S TO-DO", icon: 'cal', title: 'Email Sarah the Q3 numbers', chip: 'Urgent', color: '#e5484d' },
  { group: 'FOCUS OS', icon: 'folder', title: 'Renew SSL certificates before Friday', chip: 'High', color: '#2ec4c9' },
  { group: '🆕 NEW PROJECT: BALI HOLIDAY', icon: 'plus', title: 'Book flights for October', chip: 'Medium', color: '#67c264' },
  { group: '🆕 NEW PROJECT: BALI HOLIDAY', icon: 'plus', title: 'Research villas in Ubud', chip: 'Low', color: '#67c264' },
];

const Preview = () => {
  const [wp, setWp] = useWallpaper();
  const [rec, setRec] = useState(false);
  const [n, setN] = useState(0);
  const bg = WALLPAPERS[wp];

  useEffect(() => {
    if (!rec) return;
    setN(0);
    const ts = [700, 1600, 2600, 3400].map((ms, i) => setTimeout(() => setN(i + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, [rec]);

  const groups = STREAM.slice(0, n).reduce<Record<string, typeof STREAM>>((acc, t) => {
    (acc[t.group] = acc[t.group] || []).push(t);
    return acc;
  }, {});

  return (
    <div className={`pw-root pw-${bg.material}`} style={{ ['--pw-ac' as string]: bg.accent }}>
      <style>{BASE_CSS}</style>
      <style>{HERO_CSS}</style>
      <div className="pw-bg" style={bg.src ? { backgroundImage: `url('${bg.src}')` } : undefined} />
      <WallpaperBar value={wp} onChange={setWp} />

      <div className={`pw-hero-col ${rec ? 'rec' : ''}`}>
        <div className="pw-hero-head">
          <h1 className="pw-hero-greet">{greeting()}, Igor</h1>
          <p className="pw-hero-sub">{rec ? 'Capturing your thoughts…' : 'Ready to capture your thoughts?'}</p>
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

        {/* live brain-dump stream — takes the card's slot; right column on wide screens */}
        <div className="pw-stream pw-glass">
          <div className="pw-stream-listen">
            <div className="pw-mic"><Mic size={18} /></div>
            <div>
              <div className="lbl">Listening… speak freely</div>
              <div className="sub">Tasks appear here as you talk.</div>
            </div>
          </div>
          {Object.entries(groups).map(([label, tasks]) => (
            <div key={label} className="pw-sgroup">
              <div className="pw-sglabel">
                {tasks[0].icon === 'cal' && <Calendar size={11} />}
                {tasks[0].icon === 'folder' && <FolderOpen size={11} />}
                {tasks[0].icon === 'plus' && <Plus size={11} />}
                {label}
              </div>
              {tasks.map((t) => (
                <div key={t.title} className="pw-stask">
                  <span className="pw-dot" style={{ background: t.color }} />
                  <span className="tt">{t.title}</span>
                  <span className="pw-schip">{t.chip}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="pw-spacer" />

        <div className="pw-actions">
          <button className="pw-orb" aria-label="Brain dump" onClick={() => setRec((r) => !r)}>
            <div className="pw-orb-core" />
          </button>
          <span className="pw-orb-label">
            {rec ? 'Listening… speak freely' : 'Tap to capture your thoughts into tasks'}
          </span>
          {rec ? (
            <div className="pw-recbtns">
              <button className="pw-btn" onClick={() => setRec(false)}><Square size={12} />Stop</button>
              <button className="pw-btn acc" onClick={() => setRec(false)}><Check size={14} />Save All Tasks ({n})</button>
            </div>
          ) : (
            <button className="pw-btn pw-recpill"><Video size={16} />Record Meeting</button>
          )}
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

      <Link to="/preview/app" className="pw-applink pw-glass"><span className="txt">Main app mock&nbsp;</span><ArrowRight size={13} /></Link>
    </div>
  );
};

export default Preview;

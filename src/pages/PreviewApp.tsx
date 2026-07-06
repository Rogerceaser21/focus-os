/**
 * /preview/app — throwaway design prototype of the REAL workhorse screen (/app),
 * restyled in 4 candidate designs. Mock data only, no real app code touched.
 *   A — Gallery Glass (bright iOS-26 frost over art)
 *   B — visionOS Night (dark spatial glass)
 *   C — Porcelain (clean minimal, no art)
 *   D — Adaptive (one design + background picker; material/accent retune per background)
 * Switch styles with the pill at the top, or ?take=a|b|c|d.
 * Delete together with Preview.tsx once tokens are locked.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BASE_CSS, WALLPAPERS, WallpaperBar, useWallpaper } from './previewTheme';
import {
  Plus, Search, HelpCircle, Mic, Video, ListTodo, AlertTriangle, Inbox,
  FolderOpen, Calendar, Settings, LogOut, Play, Pause, Check, Share2,
  CalendarPlus, Trash2, UserPlus, MoveVertical, LayoutGrid, List,
  GanttChartSquare, Clock3, Menu, X, Paperclip, Brain, Square,
} from 'lucide-react';

/* config + tokens live in previewTheme.tsx */

/* ------------------------------------------------------------ mock data */

const PROJECTS = [
  { id: 'trs', name: 'TRS Automation', color: '#e8a33d', count: 2 },
  { id: 'fos', name: 'Focus OS', color: '#2ec4c9', count: 3 },
  { id: 'ais', name: 'AIS', color: '#b07de8', count: 2 },
  { id: 'hol', name: 'Holiday Jobs', color: '#67c264', count: 1 },
  { id: 'shp', name: 'Shopping List', color: '#f43f5e', count: 2 },
];

type Task = {
  id: number; title: string; desc?: string; project?: string; due?: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'todo' | 'in-progress' | 'completed';
  timer?: string; running?: boolean; images?: number; shared?: string; changeMsg?: string;
};

const TASKS: Task[] = [
  { id: 1, title: 'Send TRS report to leadership', desc: 'Final numbers + variance commentary', project: 'trs', due: 'Today', priority: 'urgent', status: 'in-progress', timer: '1:12:33', running: true },
  { id: 2, title: 'Fix login redirect bug', desc: 'Users land on /auth after Google OAuth', project: 'fos', due: 'Today', priority: 'urgent', status: 'todo', shared: '1A 1P' },
  { id: 3, title: 'Prep Wednesday demo', desc: 'Slides + live walkthrough for the exec team', project: 'ais', due: 'Wed', priority: 'high', status: 'todo', images: 2, timer: '0:45:10' },
  { id: 4, title: 'Renew SSL certificates', project: 'fos', due: 'Tomorrow', priority: 'high', status: 'todo' },
  { id: 5, title: 'Draft Q3 budget', desc: 'https://sheets.example.com/q3-budget', project: 'ais', due: 'Fri', priority: 'medium', status: 'todo', changeMsg: 'Please add the Q3 travel numbers' },
  { id: 6, title: 'Update onboarding docs', project: 'fos', priority: 'medium', status: 'in-progress', timer: '0:22:04' },
  { id: 7, title: 'Order stationery', project: 'shp', priority: 'medium', status: 'completed' },
  { id: 8, title: 'Research standing desks', project: 'shp', priority: 'low', status: 'todo' },
  { id: 9, title: 'Clean downloads folder', priority: 'low', status: 'todo' },
  { id: 10, title: 'Book dentist appointment', priority: 'low', status: 'completed' },
  { id: 11, title: 'Chase supplier invoice', project: 'trs', due: 'Yesterday', priority: 'high', status: 'todo' },
  { id: 12, title: 'Collect visa photos', project: 'hol', due: 'Sat', priority: 'low', status: 'todo' },
];

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const;

/* ------------------------------------------------------------ styles */

const CSS = `
/* ---------- shell ---------- */
.pw-shell { position: relative; z-index: 1; display: flex; height: 100vh; padding: 58px 14px 14px; gap: 14px; }

/* ---------- sidebar ---------- */
.pw-side {
  width: 264px; flex: none; border-radius: 26px; padding: 16px 12px 12px;
  display: flex; flex-direction: column; gap: 4px; overflow-y: auto;
}
.pw-side-head { display: flex; align-items: center; justify-content: space-between; padding: 0 8px 8px; }
.pw-side-title { font-size: 19px; font-weight: 700; color: var(--t1); letter-spacing: -0.02em; }
.pw-side-cta { display: flex; gap: 8px; padding: 0 4px 10px; }
.pw-search {
  display: flex; align-items: center; gap: 8px; margin: 0 4px 10px;
  border-radius: 999px; border: 1px solid var(--gbrd); background: var(--chip);
  padding: 8px 12px; color: var(--t2); font-size: 13px;
}
.pw-search input { background: transparent; border: none; outline: none; color: var(--t1); font-size: 13px; width: 100%; }
.pw-search input::placeholder { color: var(--t3); }
.pw-navitem {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 14px;
  color: var(--t2); font-size: 13.5px; font-weight: 500; cursor: pointer; border: 1px solid transparent;
}
.pw-navitem:hover { background: var(--hover); }
.pw-navitem.on { background: var(--gbg-strong); color: var(--t1); border-color: var(--gbrd); box-shadow: var(--gshadow); }
.pw-navitem .cnt { margin-left: auto; font-size: 11.5px; color: var(--t3); font-weight: 600; }
.pw-navitem .pastdue { color: #e5484d; }
.pw-sec { font-size: 10.5px; font-weight: 700; letter-spacing: .1em; color: var(--t3); padding: 12px 10px 4px; }

/* ---------- main column ---------- */
.pw-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding-bottom: 84px; }

.pw-row1 { display: flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 10px; }
.pw-burger { display: none; }
.pw-row1 .pw-search { margin: 0; flex: 1; min-width: 0; border: none; background: transparent; padding: 4px 8px; }
.pw-seg { display: flex; gap: 2px; background: var(--chip); border: 1px solid var(--gbrd); border-radius: 999px; padding: 3px; }
.pw-seg button {
  display: inline-flex; align-items: center; gap: 5px; border: none; cursor: pointer;
  background: transparent; color: var(--t2); font-size: 12px; font-weight: 600;
  border-radius: 999px; padding: 6px 11px;
}
.pw-seg button.on { background: var(--pw-ac); color: #fff; box-shadow: 0 2px 10px color-mix(in srgb, var(--pw-ac) 35%, transparent); }
.pw-seg button span { display: inline; }

.pw-tabs { display: flex; gap: 4px; border-radius: 999px; padding: 5px; }
.pw-tabs button {
  flex: 1; border: none; cursor: pointer; background: transparent; color: var(--t2);
  font-size: 13px; font-weight: 600; border-radius: 999px; padding: 8px 0;
}
.pw-tabs button.on { background: var(--gbg-strong); color: var(--t1); box-shadow: var(--gshadow); }

.pw-projbar { display: flex; align-items: center; gap: 6px; border-radius: 999px; padding: 8px 14px; flex-wrap: wrap; }
.pw-projbar .pname { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: var(--t1); margin-right: auto; }
.pw-projbar .pw-btn { padding: 6px 10px; font-size: 12px; }
.pw-projbar .danger { color: #e5484d; }

/* ---------- task list ---------- */
.pw-content { flex: 1; overflow-y: auto; border-radius: 26px; padding: 6px 0 12px; }
.pw-phead { display: flex; align-items: center; gap: 10px; padding: 14px 20px 6px; }
.pw-phead .lbl { font-size: 11px; font-weight: 800; letter-spacing: .12em; }
.pw-phead .line { flex: 1; height: 1px; background: var(--row-line); }
.pw-phead .n { font-size: 11px; color: var(--t3); font-weight: 700; }
.pw-task { display: flex; align-items: flex-start; gap: 12px; padding: 11px 20px; position: relative; }
.pw-task:hover { background: var(--hover); }
.pw-task + .pw-task::before { content: ''; position: absolute; top: 0; left: 52px; right: 20px; height: 1px; background: var(--row-line); }
.pw-tick {
  width: 22px; height: 22px; border-radius: 999px; flex: none; margin-top: 1px; cursor: pointer;
  border: 1.5px solid var(--t3); display: flex; align-items: center; justify-content: center;
  background: transparent; color: transparent;
}
.pw-tick.done { border-color: transparent; background: #34c759; color: #fff; }
.pw-ttl { font-size: 14.5px; font-weight: 600; color: var(--t1); line-height: 1.3; }
.pw-ttl.done { text-decoration: line-through; opacity: .45; }
.pw-desc { font-size: 12.5px; color: var(--t2); margin-top: 2px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-desc a { color: var(--pw-ac); text-decoration: none; }
.pw-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; flex-wrap: wrap; }
.pw-mchip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; color: var(--t2);
  background: var(--chip); border: 1px solid var(--chip-brd); border-radius: 999px; padding: 3px 9px;
}
.pw-mchip.shared { color: #a78bfa; border-color: rgba(167,139,250,.35); background: rgba(167,139,250,.1); }
.pw-mchip.imgs { gap: 4px; }
.pw-right { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: none; }
.pw-due { font-size: 11.5px; font-weight: 700; color: var(--t2); background: var(--chip); border: 1px solid var(--chip-brd); border-radius: 999px; padding: 4px 10px; }
.pw-play {
  width: 30px; height: 30px; border-radius: 999px; border: none; cursor: pointer;
  background: var(--chip); border: 1px solid var(--chip-brd); color: var(--t1);
  display: flex; align-items: center; justify-content: center;
}
.pw-play.running { background: var(--pw-ac); border-color: transparent; color: #fff; box-shadow: 0 0 14px color-mix(in srgb, var(--pw-ac) 45%, transparent); }
.pw-acts { display: none; align-items: center; gap: 2px; }
.pw-task:hover .pw-acts { display: flex; }
.pw-acts button { width: 28px; height: 28px; border-radius: 999px; border: none; background: transparent; color: var(--t3); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.pw-acts button:hover { color: var(--t1); background: var(--hover); }
.pw-change {
  margin-top: 6px; font-size: 12px; color: #92400e; background: rgba(251,191,36,.18);
  border: 1px solid rgba(251,191,36,.4); border-radius: 10px; padding: 6px 10px;
}
.pw-smoke .pw-change { color: #fcd34d; background: rgba(251,191,36,.12); }
.pw-prio-urgent { color: #e5484d; } .pw-prio-high { color: #f0883e; }
.pw-prio-medium { color: var(--t2); } .pw-prio-low { color: var(--t3); }

/* grid view */
.pw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 12px 16px; }
.pw-card { border-radius: 20px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.pw-card .pw-meta { margin-top: 0; }

/* gantt / time mocks */
.pw-mockviz { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.pw-mockviz .note { font-size: 12px; color: var(--t3); }
.pw-gantt-row { display: flex; align-items: center; gap: 10px; }
.pw-gantt-row .nm { width: 160px; flex: none; font-size: 12.5px; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-gantt-track { flex: 1; height: 26px; border-radius: 8px; background: var(--hover); position: relative; }
.pw-gantt-bar { position: absolute; top: 4px; bottom: 4px; border-radius: 6px; opacity: .85; }
.pw-time-wrap { display: flex; align-items: flex-end; gap: 14px; height: 180px; padding: 0 8px; }
.pw-time-bar { flex: 1; border-radius: 10px 10px 4px 4px; opacity: .85; }
.pw-time-lbl { font-size: 10.5px; color: var(--t3); text-align: center; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- dock ---------- */
.pw-dock {
  position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
  z-index: 40; display: flex; gap: 4px; align-items: center; padding: 7px 9px; border-radius: 999px;
}
.pw-dock button {
  display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 56px;
  border: none; background: transparent; cursor: pointer; color: var(--t2); padding: 4px 6px; border-radius: 14px;
}
.pw-dock button.on { color: var(--pw-ac); }
.pw-dock button.danger { color: #e5484d; }
.pw-dock button span { font-size: 9.5px; font-weight: 700; }

/* ---------- add-task panel ---------- */
.pw-addpanel {
  position: fixed; top: 58px; right: 14px; bottom: 14px; width: 360px; z-index: 45;
  border-radius: 26px; padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;
}
.pw-addpanel h3 {
  font-size: 16px; font-weight: 700; color: var(--t1); margin: 0;
  display: flex; justify-content: space-between; align-items: center;
}
.pw-field label { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; color: var(--t3); display: block; margin-bottom: 6px; }
.pw-input, .pw-textarea {
  width: 100%; border-radius: 14px; border: 1px solid var(--gbrd); background: var(--chip);
  color: var(--t1); font-size: 13.5px; padding: 10px 12px; outline: none; font-family: inherit; box-sizing: border-box;
}
.pw-input::placeholder, .pw-textarea::placeholder { color: var(--t3); }
.pw-textarea { min-height: 72px; resize: none; }
.pw-chiprow { display: flex; flex-wrap: wrap; gap: 6px; }
.pw-choice {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  border-radius: 999px; border: 1px solid var(--gbrd); background: var(--chip);
  color: var(--t1); font-size: 12px; font-weight: 600; padding: 6px 11px;
}
.pw-choice.on { background: var(--pw-ac); border-color: transparent; color: #fff; }

/* ---------- record FAB ---------- */
.pw-fab { position: fixed; right: 20px; bottom: 14px; z-index: 42; }
.pw-fab-veil { display: none; }
.pw-fab-veil.open { display: block; position: fixed; inset: 0; z-index: 41; background: rgba(0,0,0,.18); }
.pw-fab-main {
  position: relative; z-index: 43;
  width: 56px; height: 56px; border-radius: 999px; cursor: pointer;
  background: var(--gbg-strong); border: 3px solid var(--t2);
  backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  -webkit-backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  box-shadow: var(--gshadow), 0 10px 30px rgba(0,0,0,.2);
  display: flex; align-items: center; justify-content: center;
  transition: transform .2s ease;
}
.pw-fab-main.open { transform: rotate(45deg); }
.pw-fab-main .dot { width: 15px; height: 15px; border-radius: 999px; background: radial-gradient(circle at 38% 32%, #ff5a52, #c81e1e 70%); box-shadow: 0 2px 10px rgba(200,30,30,.5); }
.pw-fab-sat {
  position: absolute; z-index: 43; width: 46px; height: 46px; right: 5px; bottom: 5px;
  border-radius: 999px; cursor: pointer; border: 1px solid var(--gbrd);
  background: var(--gbg-strong); color: var(--pw-ac);
  backdrop-filter: blur(var(--blur)); -webkit-backdrop-filter: blur(var(--blur));
  box-shadow: var(--gshadow); display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: transform .22s ease, opacity .18s ease;
}
.pw-fab.open .pw-fab-sat { opacity: 1; pointer-events: auto; }
.pw-fab.open .pw-fab-sat.up { transform: translateY(-64px); }
.pw-fab.open .pw-fab-sat.left { transform: translateX(-64px); transition-delay: .04s; }
.pw-fab-hint {
  position: absolute; right: 122px; bottom: 16px; white-space: nowrap;
  font-size: 11px; font-weight: 600; color: var(--onbg); text-shadow: var(--onbg-shadow);
  opacity: 0; transition: opacity .2s ease .1s;
}
.pw-fab.open .pw-fab-hint { opacity: .85; }

/* ---------- brain dump dialog ---------- */
.pw-brain-veil {
  position: fixed; inset: 0; z-index: 70; background: rgba(4,8,16,.5);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.pw-brain {
  width: 100%; max-width: 560px; max-height: 86vh; border-radius: 28px;
  display: flex; flex-direction: column; overflow: hidden;
}
.pw-brain-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 6px; }
.pw-brain-head h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--t1); }
.pw-brain-listen {
  display: flex; align-items: center; gap: 14px; padding: 14px 20px;
  margin: 8px 16px; border-radius: 20px; background: var(--chip); border: 1px solid var(--chip-brd);
}
.pw-mic {
  width: 48px; height: 48px; border-radius: 999px; flex: none;
  background: var(--pw-ac); color: #fff; display: flex; align-items: center; justify-content: center;
  position: relative;
}
.pw-mic::before, .pw-mic::after {
  content: ''; position: absolute; inset: 0; border-radius: 999px;
  border: 2px solid var(--pw-ac); animation: pw-ping 1.8s ease-out infinite;
}
.pw-mic::after { animation-delay: .9s; }
@keyframes pw-ping { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.9); opacity: 0; } }
.pw-brain-listen .lbl { font-size: 14px; font-weight: 600; color: var(--t1); }
.pw-brain-listen .sub { font-size: 12px; color: var(--t2); margin-top: 2px; }
.pw-brain-body { overflow-y: auto; padding: 6px 16px 12px; }
.pw-brain-group { margin-top: 12px; }
.pw-brain-glabel { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: var(--t2); padding: 4px 6px; display: flex; align-items: center; gap: 6px; }
.pw-brain-task {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-top: 6px;
  border-radius: 14px; background: var(--gbg); border: 1px solid var(--gbrd);
  animation: pw-rise .35s ease both;
}
@keyframes pw-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.pw-brain-task .tt { font-size: 14px; font-weight: 500; color: var(--t1); flex: 1; }
.pw-brain-foot { display: flex; gap: 8px; padding: 12px 20px 18px; border-top: 1px solid var(--row-line); }

/* ---------- responsive ---------- */
.pw-sideveil { display: none; }
@media (max-width: 999px) {
  .pw-shell { padding: 56px 10px 10px; }
  .pw-side {
    position: fixed; z-index: 55; top: 0; bottom: 0; left: 0; width: 280px;
    border-radius: 0 26px 26px 0; transform: translateX(-105%); transition: transform .25s ease;
  }
  .pw-side.open { transform: translateX(0); }
  .pw-sideveil.open { display: block; position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.35); }
  .pw-burger { display: flex; }
  .pw-seg button span { display: none; }
  .pw-seg button { padding: 6px 9px; }
  .pw-row1 { flex-wrap: nowrap; }
  .pw-projbar .pw-btn span { display: none; }
  .pw-projbar .pw-btn { padding: 6px 8px; }
  .pw-main { padding-bottom: 78px; }
  .pw-fab { right: 16px; bottom: 90px; }
  .pw-addpanel { top: auto; left: 10px; right: 10px; bottom: 10px; width: auto; max-height: 76vh; }
  .pw-dock { left: 10px; right: 10px; transform: none; justify-content: space-between; }
  .pw-dock button { min-width: 0; flex: 1; }
  .pw-gantt-row .nm { width: 90px; }
}
@media (max-width: 520px) {
  .pw-density { display: none; }
}
`;

/* ------------------------------------------------------------ pieces */

function TaskRow({ t, density }: { t: Task; density: 'full' | 'compact' | 'minimal' }) {
  const proj = PROJECTS.find((p) => p.id === t.project);
  const done = t.status === 'completed';
  if (density === 'minimal') {
    return (
      <div className="pw-task" style={{ alignItems: 'center' }}>
        <div className={`pw-tick ${done ? 'done' : ''}`}>{done && <Check size={13} strokeWidth={3} />}</div>
        <div className={`pw-ttl ${done ? 'done' : ''}`} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
        <div className="pw-right">
          <button className={`pw-play ${t.running ? 'running' : ''}`}>{t.running ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pw-task">
      <div className={`pw-tick ${done ? 'done' : ''}`}>{done && <Check size={13} strokeWidth={3} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={`pw-ttl ${done ? 'done' : ''}`}>{t.title}</div>
        {t.desc && density !== 'minimal' && (
          <div className="pw-desc">{t.desc.startsWith('http') ? <a href="#">{t.desc}</a> : t.desc}</div>
        )}
        <div className="pw-meta">
          {proj && <span className="pw-mchip"><span className="pw-dot" style={{ background: proj.color }} />{proj.name}</span>}
          {t.timer && <span className="pw-mchip"><Clock3 size={11} />{t.timer}</span>}
          {t.images && <span className="pw-mchip imgs"><Paperclip size={11} />{t.images}</span>}
          {t.shared && <span className="pw-mchip shared"><Share2 size={11} />{t.shared}</span>}
          {density === 'full' && t.due && <span className="pw-mchip">Start Mon · End Thu</span>}
        </div>
        {t.changeMsg && <div className="pw-change">Changes needed — {t.changeMsg}</div>}
      </div>
      <div className="pw-right">
        <div className="pw-acts">
          <button><Share2 size={14} /></button>
          <button><CalendarPlus size={14} /></button>
          <button><Trash2 size={14} /></button>
        </div>
        {t.due && <span className="pw-due">{t.due}</span>}
        <button className={`pw-play ${t.running ? 'running' : ''}`}>{t.running ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ page */

const PreviewApp = () => {
  const [wp, setWp] = useWallpaper();
  const [addOpen, setAddOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [brainCount, setBrainCount] = useState(0);
  const navigate = useNavigate();
  const lastTapRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // same interaction as the real RecordFAB: single tap toggles the menu
  // (debounced), double tap goes to the home screen
  const handleFabMain = () => {
    const now = Date.now();
    const isDouble = now - lastTapRef.current < 300;
    lastTapRef.current = now;
    if (isDouble) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      setFabOpen(false);
      navigate('/preview');
      return;
    }
    tapTimerRef.current = setTimeout(() => setFabOpen((o) => !o), 300);
  };

  // simulate tasks arriving live while "listening"
  useEffect(() => {
    if (!brainOpen) return;
    setBrainCount(0);
    const ts = [700, 1600, 2600, 3400].map((ms, i) => setTimeout(() => setBrainCount(i + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, [brainOpen]);
  const [view, setView] = useState<'list' | 'grid' | 'gantt' | 'time'>('list');
  const [density, setDensity] = useState<'full' | 'compact' | 'minimal'>('compact');
  const [tab, setTab] = useState<'all' | 'todo' | 'in-progress' | 'completed'>('all');
  const [selProj, setSelProj] = useState<string | null>('fos');
  const [selList, setSelList] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);

  const bg = WALLPAPERS[wp];
  const material = bg.material;

  const shown = useMemo(() => {
    let list = TASKS;
    if (selProj) list = list.filter((t) => t.project === selProj);
    if (selList === 'unassigned') list = list.filter((t) => !t.project);
    if (selList === 'today') list = list.filter((t) => t.due === 'Today');
    if (selList === 'past-due') list = list.filter((t) => t.due === 'Yesterday');
    if (tab !== 'all') list = list.filter((t) => t.status === tab);
    return list;
  }, [selProj, selList, tab]);

  const counts = useMemo(() => {
    const base = selProj ? TASKS.filter((t) => t.project === selProj)
      : selList === 'unassigned' ? TASKS.filter((t) => !t.project)
      : selList === 'today' ? TASKS.filter((t) => t.due === 'Today')
      : selList === 'past-due' ? TASKS.filter((t) => t.due === 'Yesterday')
      : TASKS;
    return {
      all: base.length,
      todo: base.filter((t) => t.status === 'todo').length,
      prog: base.filter((t) => t.status === 'in-progress').length,
      done: base.filter((t) => t.status === 'completed').length,
    };
  }, [selProj, selList]);

  const groups = PRIORITY_ORDER.map((p) => ({ p, tasks: shown.filter((t) => t.priority === p) })).filter((g) => g.tasks.length);
  const proj = PROJECTS.find((p) => p.id === selProj);

  const pickProject = (id: string | null, list: string | null = null) => {
    setSelProj(id); setSelList(list); setSideOpen(false);
  };

  return (
    <div className={`pw-root pw-${material}`} style={{ ['--pw-ac' as string]: bg.accent }}>
      <style>{BASE_CSS}</style>
      <style>{CSS}</style>
      <div className="pw-bg" style={bg.src ? { backgroundImage: `url('${bg.src}')` } : undefined} />

      <WallpaperBar value={wp} onChange={setWp} />

      <div className="pw-shell">
        {/* sidebar */}
        <div className={`pw-sideveil ${sideOpen ? 'open' : ''}`} onClick={() => setSideOpen(false)} />
        <aside className={`pw-side pw-glass ${sideOpen ? 'open' : ''}`}>
          <div className="pw-side-head">
            <span className="pw-side-title">Projects</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="pw-iconbtn"><HelpCircle size={15} /></button>
              <button className="pw-iconbtn" onClick={() => setSideOpen(false)} style={{ display: sideOpen ? 'flex' : undefined }}><X size={15} /></button>
            </span>
          </div>
          <div className="pw-side-cta">
            <button className="pw-btn acc"><Plus size={14} />New Project</button>
            <button className="pw-btn"><Mic size={13} />Meetings</button>
          </div>
          <div className="pw-search"><Search size={13} /><input placeholder="Search projects…" /></div>

          <div className={`pw-navitem ${selList === 'today' ? 'on' : ''}`} onClick={() => pickProject(null, 'today')}>
            <ListTodo size={16} />Today's To-Do<span className="cnt">2</span>
          </div>
          <div className={`pw-navitem ${selList === 'past-due' ? 'on' : ''}`} onClick={() => pickProject(null, 'past-due')}>
            <AlertTriangle size={16} className="pastdue" />Past Due<span className="cnt pastdue">1</span>
          </div>
          <div className={`pw-navitem ${selList === 'unassigned' ? 'on' : ''}`} onClick={() => pickProject(null, 'unassigned')}>
            <Inbox size={16} />Unassigned<span className="cnt">2</span>
          </div>

          <div className="pw-sec">MY PROJECTS</div>
          {PROJECTS.map((p) => (
            <div key={p.id} className={`pw-navitem ${selProj === p.id ? 'on' : ''}`} onClick={() => pickProject(p.id)}>
              <span className="pw-dot" style={{ background: p.color }} />{p.name}<span className="cnt">{p.count}</span>
            </div>
          ))}

          <div className="pw-sec">SHARED WITH ME</div>
          <div className="pw-navitem">
            <span className="pw-dot" style={{ background: '#f59e0b' }} />Marketing Launch<span className="cnt">Sarah</span>
          </div>
        </aside>

        {/* main */}
        <main className="pw-main">
          <div className="pw-row1 pw-glass">
            <button className="pw-iconbtn pw-burger" onClick={() => setSideOpen(true)}><Menu size={15} /></button>
            <div className="pw-search"><Search size={13} /><input placeholder="Search tasks…" /></div>
            <div className="pw-seg">
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={13} /><span>List</span></button>
              <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}><LayoutGrid size={13} /><span>Grid</span></button>
              <button className={view === 'gantt' ? 'on' : ''} onClick={() => setView('gantt')}><GanttChartSquare size={13} /><span>Gantt</span></button>
              <button className={view === 'time' ? 'on' : ''} onClick={() => setView('time')}><Clock3 size={13} /><span>Time</span></button>
            </div>
            {view === 'list' && (
              <div className="pw-seg pw-density">
                <button className={density === 'full' ? 'on' : ''} onClick={() => setDensity('full')}><span>Full</span></button>
                <button className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')}><span>Compact</span></button>
                <button className={density === 'minimal' ? 'on' : ''} onClick={() => setDensity('minimal')}><span>Minimal</span></button>
              </div>
            )}
            <button className="pw-btn acc" style={{ flex: 'none' }} onClick={() => setAddOpen(true)}><Plus size={14} />Add Task</button>
          </div>

          <div className="pw-tabs pw-glass">
            <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All ({counts.all})</button>
            <button className={tab === 'todo' ? 'on' : ''} onClick={() => setTab('todo')}>To Do ({counts.todo})</button>
            <button className={tab === 'in-progress' ? 'on' : ''} onClick={() => setTab('in-progress')}>Progress ({counts.prog})</button>
            <button className={tab === 'completed' ? 'on' : ''} onClick={() => setTab('completed')}>Done ({counts.done})</button>
          </div>

          {proj && (
            <div className="pw-projbar pw-glass">
              <span className="pname"><span className="pw-dot" style={{ background: proj.color }} />{proj.name}</span>
              <button className="pw-btn"><UserPlus size={13} /><span>Invite</span></button>
              <button className="pw-btn"><MoveVertical size={13} /><span>Move Tasks</span></button>
              <button className="pw-btn"><Video size={13} /><span>Meetings</span></button>
              <button className="pw-btn"><Share2 size={13} /><span>Share</span></button>
              <button className="pw-btn danger"><Trash2 size={13} /><span>Delete</span></button>
            </div>
          )}

          <div className="pw-content pw-glass">
            {view === 'list' && groups.map((g) => (
              <div key={g.p}>
                <div className="pw-phead">
                  <span className={`lbl pw-prio-${g.p}`}>{g.p.toUpperCase()}</span>
                  <span className="line" /><span className="n">{g.tasks.length}</span>
                </div>
                {g.tasks.map((t) => <TaskRow key={t.id} t={t} density={density} />)}
              </div>
            ))}
            {view === 'list' && !groups.length && (
              <div className="pw-mockviz"><span className="note">No tasks in this filter.</span></div>
            )}

            {view === 'grid' && (
              <div className="pw-grid">
                {shown.map((t) => {
                  const p = PROJECTS.find((x) => x.id === t.project);
                  const done = t.status === 'completed';
                  return (
                    <div key={t.id} className="pw-card pw-glass">
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div className={`pw-tick ${done ? 'done' : ''}`}>{done && <Check size={13} strokeWidth={3} />}</div>
                        <div className={`pw-ttl ${done ? 'done' : ''}`}>{t.title}</div>
                      </div>
                      {t.desc && <div className="pw-desc" style={{ whiteSpace: 'normal' }}>{t.desc}</div>}
                      <div className="pw-meta">
                        {p && <span className="pw-mchip"><span className="pw-dot" style={{ background: p.color }} />{p.name}</span>}
                        {t.due && <span className="pw-mchip">{t.due}</span>}
                        {t.timer && <span className="pw-mchip"><Clock3 size={11} />{t.timer}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'gantt' && (
              <div className="pw-mockviz">
                {shown.filter((t) => t.status !== 'completed').slice(0, 6).map((t, i) => {
                  const p = PROJECTS.find((x) => x.id === t.project);
                  return (
                    <div key={t.id} className="pw-gantt-row">
                      <span className="nm">{t.title}</span>
                      <div className="pw-gantt-track">
                        <div className="pw-gantt-bar" style={{ left: `${(i * 11) % 45}%`, width: `${18 + (i * 9) % 30}%`, background: p?.color ?? 'var(--pw-ac)' }} />
                      </div>
                    </div>
                  );
                })}
                <span className="note">Gantt mock — bars indicative only; full chart gets styled in Phase D.</span>
              </div>
            )}

            {view === 'time' && (
              <div className="pw-mockviz">
                <div className="pw-time-wrap">
                  {PROJECTS.map((p, i) => (
                    <div key={p.id} style={{ flex: 1 }}>
                      <div className="pw-time-bar" style={{ height: `${[72, 48, 88, 30, 55][i]}%`, background: p.color, minHeight: 12 }} />
                      <div className="pw-time-lbl">{p.name}</div>
                    </div>
                  ))}
                </div>
                <span className="note">Time-tracking mock — full chart gets styled in Phase D.</span>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* record FAB — single tap expands, brain-dump satellite opens the dialog */}
      <div className={`pw-fab-veil ${fabOpen ? 'open' : ''}`} onClick={() => setFabOpen(false)} />
      <div className={`pw-fab ${fabOpen ? 'open' : ''}`}>
        <button className="pw-fab-sat up" aria-label="Brain dump"
          onClick={() => { setFabOpen(false); setBrainOpen(true); }}>
          <Brain size={20} />
        </button>
        <button className="pw-fab-sat left" aria-label="Record meeting" onClick={() => setFabOpen(false)}>
          <Video size={19} />
        </button>
        <span className="pw-fab-hint">Brain Dump ↑ · Record Meeting ←</span>
        <button className={`pw-fab-main ${fabOpen ? 'open' : ''}`} onClick={handleFabMain} title="Tap: menu · Double-tap: home">
          <span className="dot" />
        </button>
      </div>

      {/* brain dump dialog (mock: tasks appear as you "speak") */}
      {brainOpen && (
        <div className="pw-brain-veil" onClick={() => setBrainOpen(false)}>
          <div className="pw-brain pw-glass" onClick={(e) => e.stopPropagation()}>
            <div className="pw-brain-head">
              <h3>Brain Dump</h3>
              <button className="pw-iconbtn" onClick={() => setBrainOpen(false)}><X size={15} /></button>
            </div>
            <div className="pw-brain-listen">
              <div className="pw-mic"><Mic size={20} /></div>
              <div>
                <div className="lbl">Listening… speak freely</div>
                <div className="sub">Tasks appear below as you talk. Stop when you're done.</div>
              </div>
            </div>
            <div className="pw-brain-body">
              {brainCount >= 1 && (
                <div className="pw-brain-group">
                  <div className="pw-brain-glabel"><Calendar size={12} />TODAY'S TO-DO</div>
                  <div className="pw-brain-task">
                    <span className="pw-dot" style={{ background: '#e5484d' }} />
                    <span className="tt">Email Sarah the Q3 numbers</span>
                    <span className="pw-mchip">Urgent</span>
                  </div>
                </div>
              )}
              {brainCount >= 2 && (
                <div className="pw-brain-group">
                  <div className="pw-brain-glabel"><FolderOpen size={12} />FOCUS OS</div>
                  <div className="pw-brain-task">
                    <span className="pw-dot" style={{ background: '#2ec4c9' }} />
                    <span className="tt">Renew SSL certificates before Friday</span>
                    <span className="pw-mchip">High</span>
                  </div>
                </div>
              )}
              {brainCount >= 3 && (
                <div className="pw-brain-group">
                  <div className="pw-brain-glabel"><Plus size={12} />🆕 NEW PROJECT: BALI HOLIDAY</div>
                  <div className="pw-brain-task">
                    <span className="pw-dot" style={{ background: '#67c264' }} />
                    <span className="tt">Book flights for October</span>
                    <span className="pw-mchip">Medium</span>
                  </div>
                  {brainCount >= 4 && (
                    <div className="pw-brain-task">
                      <span className="pw-dot" style={{ background: '#67c264' }} />
                      <span className="tt">Research villas in Ubud</span>
                      <span className="pw-mchip">Low</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="pw-brain-foot">
              <button className="pw-btn" style={{ flex: 1, justifyContent: 'center' }}>
                <Square size={12} />Stop listening
              </button>
              <button className="pw-btn acc" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setBrainOpen(false)}>
                <Check size={14} />Save All Tasks ({brainCount})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* add-task panel (docked on desktop, sheet on mobile) */}
      {addOpen && (
        <div className="pw-addpanel pw-glass">
          <h3>New Task <button className="pw-iconbtn" onClick={() => setAddOpen(false)}><X size={15} /></button></h3>
          <div className="pw-field"><label>TITLE</label><input className="pw-input" placeholder="What needs doing?" /></div>
          <div className="pw-field"><label>DESCRIPTION</label><textarea className="pw-textarea" placeholder="Details, links…" /></div>
          <div className="pw-field"><label>PRIORITY</label>
            <div className="pw-chiprow">
              {['Low', 'Medium', 'High', 'Urgent'].map((p) => (
                <button key={p} className={`pw-choice ${p === 'Medium' ? 'on' : ''}`}>{p}</button>
              ))}
            </div>
          </div>
          <div className="pw-field"><label>PROJECT</label>
            <div className="pw-chiprow">
              {PROJECTS.map((p) => (
                <button key={p.id} className={`pw-choice ${p.id === 'fos' ? 'on' : ''}`}>
                  <span className="pw-dot" style={{ background: p.color }} />{p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="pw-field"><label>DUE</label>
            <div className="pw-chiprow">
              <button className="pw-choice on">Today</button>
              <button className="pw-choice">Tomorrow</button>
              <button className="pw-choice">Pick date…</button>
            </div>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
            <button className="pw-btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="pw-btn acc" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddOpen(false)}><Plus size={14} />Add Task</button>
          </div>
        </div>
      )}

      {/* dock */}
      <nav className="pw-dock pw-glass">
        <button onClick={() => setSideOpen(true)}><FolderOpen size={18} /><span>Projects</span></button>
        <button><Calendar size={18} /><span>Meetings</span></button>
        <button className="on"><ListTodo size={18} /><span>Today</span></button>
        <button><AlertTriangle size={18} /><span>Past Due</span></button>
        <button><Settings size={18} /><span>Settings</span></button>
        <button className="danger"><LogOut size={18} /><span>Log Out</span></button>
      </nav>
    </div>
  );
};

export default PreviewApp;

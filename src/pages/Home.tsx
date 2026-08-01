import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';

if (import.meta.env.DEV) (window as any).__gsap = gsap;
import { Video, HelpCircle, Check, Mic, Pencil, Trash2, Loader2, Calendar, FolderOpen, Plus, ArrowDown, ArrowLeft, ArrowRight, Clock, Play, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePrefetchAppData } from '@/hooks/usePrefetchAppData';
import { APP_DATA_STALE_TIME, appDataKeys } from '@/lib/appDataFetchers';
import type { Task, Project } from '@/types/task';
import { EditTaskDialog } from '@/components/EditTaskDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { saveBrainDumpTasks } from '@/lib/brainDumpSave';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import BottomNav from '@/components/BottomNav';
import { HomeTour } from '@/components/HomeTour';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useBrainDumpLive, type BrainDumpTask, type ProjectInfo } from '@/hooks/useBrainDumpLive';
import { BrainDumpDebugOverlay } from '@/components/BrainDumpDebugOverlay';
import { BrainDumpVoiceBars } from '@/components/BrainDumpVoiceBars';
import { useStickToBottom } from '@/hooks/useStickToBottom';

const SUBTITLES = [
"Ready to capture your thoughts?",
"Ready to convert them into tasks or projects?",
"Do you have a new project in mind?",
"What's on your mind?"];


function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

interface UpNextTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  project_id: string | null;
  priority: string;
}

/* ── "Today's Focus" ranking (Dynamic Bar step 2, 2026-08-01) ────────────────
   Replaces the placeholder "soonest due first" pick, which let the longest-
   overdue fossils squat the card forever. Tiers:
     0 — due today or newly overdue (1..7 days): today's plate.
     1 — everything else open: future dues, no due date, 8..30 days overdue.
     2 — fossils (>30 days overdue): demoted so they can't pin the card.
   Within a tier: priority (urgent→low), then nearest due date (no date last).
   Pure function of (tasks, todayYmd) so the render derives it — no effects. */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
export const rankTodaysFocus = (tasks: UpNextTask[], todayYmd: string): UpNextTask[] => {
  const dayMs = 86400000;
  const t0 = new Date(`${todayYmd}T00:00:00`).getTime();
  const meta = (t: UpNextTask) => {
    if (!t.due_date) return { tier: 1, due: Number.POSITIVE_INFINITY };
    // due_date arrives as a full timestamp ('2025-11-20T20:00:00+00:00') from
    // the DB, or date-only in older rows/tests — slice to the day either way
    // (day-level maths; appending T00:00:00 to a timestamp would yield NaN
    // and silently randomise every tier, live-data-proven 2026-08-01).
    const due = new Date(`${t.due_date.slice(0, 10)}T00:00:00`).getTime();
    const daysLate = Math.floor((t0 - due) / dayMs);
    const tier = daysLate > 30 ? 2 : daysLate >= 0 && daysLate <= 7 ? 0 : 1;
    return { tier, due };
  };
  return [...tasks].sort((a, b) => {
    const ma = meta(a);
    const mb = meta(b);
    if (ma.tier !== mb.tier) return ma.tier - mb.tier;
    const pa = PRIORITY_RANK[a.priority] ?? 4;
    const pb = PRIORITY_RANK[b.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return ma.due - mb.due;
  });
};

/* ── A2: swipe gestures on the Today's Focus rows (2026-08-01) ───────────────
   Touch only, since desktop keeps the buttons A1 gave it. Right past +72px
   completes through the SAME handler the tick fires; left past -72px sets aside
   for TODAY, which is a per-day localStorage key the ranked memo re-reads during
   render. Intent threshold: the finger is only ours once it has travelled more
   than 12px across AND 1.5x further across than down, so a tap still opens the
   edit pane and a vertical drag still scrolls .lg-uprows natively (touch-action:
   pan-y hands the browser the vertical axis outright, so the threshold only ever
   arbitrates the horizontal one). */
const SWIPE_INTENT_PX = 12;    // under this the gesture is still undecided
const SWIPE_ACTION_PX = 72;    // release past this and the action fires
const SWIPE_RESIST_PX = 120;   // past this the row drags at 35% of the finger
const SWIPE_SETTLE_MS = 420;   // belt for a transitionend that never arrives
const DISMISS_KEY_PREFIX = 'fos-dismissed:';

/** Rubber band past SWIPE_RESIST_PX, so a long drag never tracks the finger all
 *  the way to the edge of the screen. */
function swipeResist(dx: number): number {
  const a = Math.abs(dx);
  if (a <= SWIPE_RESIST_PX) return dx;
  return Math.sign(dx) * (SWIPE_RESIST_PX + (a - SWIPE_RESIST_PX) * 0.35);
}

/** Today's "set aside" ids. PURE read, called from the ranked memo during render
 *  and never from an effect. A missing key, private mode or a corrupt value all
 *  read as "nothing dismissed" rather than throwing the card away. */
function readDismissed(ymd: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${DISMISS_KEY_PREFIX}${ymd}`);
    const list = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(list) ? (list as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Add one id to today's set and drop every OTHER day's key in the same pass
 *  (lazy cleanup: yesterday's set is dead the moment today writes). Called
 *  synchronously from the release handler, so the render that follows reads back
 *  exactly what was written. */
function writeDismissed(ymd: string, id: string): void {
  try {
    const key = `${DISMISS_KEY_PREFIX}${ymd}`;
    const next = readDismissed(ymd);
    next.add(id);
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(DISMISS_KEY_PREFIX) && k !== key) window.localStorage.removeItem(k);
    }
    window.localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    /* private mode / quota: the dismissal then lives only as long as this render */
  }
}

/** One gesture, one state object (latches are STATE here, never refs).
 *  pending = finger down, intent undecided · drag = ours, tracking the finger ·
 *  settle = released short, springing back · exit = released past the threshold,
 *  sliding out. `base` is where the row already sat when the finger landed, so a
 *  new touch can take over a spring-back mid-flight. */
type SwipeMode = 'pending' | 'drag' | 'settle' | 'exit';
interface SwipeState {
  id: string;
  startX: number;
  startY: number;
  base: number;
  dx: number;
  mode: SwipeMode;
}

/* ── ?fakedump=N — URL-param-gated dev/demo affordance ───────────────────────
   Same gate shape as ?tweaks (App.tsx): read straight off the query string,
   completely inert without the param, zero cost to the normal path. With it,
   Home enters the recording VISUAL state and N synthetic tasks stream in at
   700ms intervals — no microphone, no Gemini, no network — which is both the
   Playwright driver (tests/braindump-stream.spec.ts) and the sim / deployed
   preview demo path. It also bypasses the /auth redirect (and only that), so
   the stage is reachable on a signed-out device. */
const FAKE_DUMP_TITLES = [
  'Draft the Q3 board update',
  'Call the plumber about the leak',
  'Book flights for the Dubai trip',
  'Review the new pricing page copy',
  'Send the invoice to Marcus',
  'Order a replacement laptop charger',
  'Prep the Monday stand-up agenda',
  'Chase the signed contract from legal',
  'Renew the domain before it lapses',
  'Write up the retro notes',
];
const FAKE_DUMP_PRIORITIES = ['high', 'medium', 'low'] as const;
const FAKE_DUMP_PROJECT = 'Kitchen Reno';

/* BISECT switch (house law) — flip to true and "Save All (N)" falls back to the
   old behaviour (stop + open the review dialog) instead of writing directly.
   tests/braindump-direct-save.spec.ts then FAILS on its "/app shows both titles"
   assertion, because the run never leaves /home. Restore to false -> green. */
const BISECT_DISABLE_DIRECT_SAVE = false;

/** Synthetic stream row. The first half go to Today and the rest to one new
 *  project, so the groups fill in RUNS — every new task therefore appends at
 *  the end of the DOM, exactly like a real dump, which is what the follow
 *  behaviour has to cope with. */
function makeFakeTask(index: number, total: number): BrainDumpTask {
  const toToday = index <= Math.ceil(total / 2);
  return {
    id: `fake-${index}`,
    title: `${index}. ${FAKE_DUMP_TITLES[(index - 1) % FAKE_DUMP_TITLES.length]}`,
    priority: FAKE_DUMP_PRIORITIES[index % FAKE_DUMP_PRIORITIES.length],
    destination: toToday ? 'today' : 'new-project',
    projectName: toToday ? undefined : FAKE_DUMP_PROJECT,
  };
}

/* Row -> Task mapping for the edit pane. VERBATIM copy of Index.tsx's
   transformDbTask (src/pages/Index.tsx:304) so a task opened from Home is the
   same object shape /app hands EditTaskDialog. Copied, not imported: Index is a
   page component and importing it here would drag its whole module in. */
function transformDbTask(dbTask: any): Task {
  return {
    id: dbTask.id,
    title: dbTask.title,
    description: dbTask.description,
    priority: dbTask.priority,
    status: dbTask.status,
    startDate: dbTask.start_date ? new Date(dbTask.start_date) : undefined,
    endDate: dbTask.end_date ? new Date(dbTask.end_date) : undefined,
    dueDate: dbTask.due_date ? new Date(dbTask.due_date) : undefined,
    images: dbTask.images ? (dbTask.images as string[]) : [],
    timer: {
      totalSeconds: dbTask.timer_total_seconds,
      isRunning: dbTask.timer_is_running,
      startTime: dbTask.timer_start_time,
    },
    projectId: dbTask.project_id,
    sortOrder: dbTask.sort_order ?? 0,
    completedByEmail: dbTask.completed_by_email ?? undefined,
    assignedToEmail: dbTask.assigned_to_email ?? undefined,
    changeRequestMessage: dbTask.change_request_message ?? undefined,
    googleCalendarEventId: dbTask.google_calendar_event_id ?? undefined,
  };
}

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'Past due';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return due.toLocaleDateString(undefined, { weekday: 'short' });
}

const Home = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [reviewTasks, setReviewTasks] = useState<BrainDumpTask[] | undefined>(undefined);
  // Direct-save (no review dialog) spinner.
  const [isSaving, setIsSaving] = useState(false);
  const { preferences, markHomeTourComplete } = useUserPreferences(user?.id);

  // Live brain-dump session runs inline on the hero (the approved recording stage):
  // the orb glides left and captured tasks stream in on the right while you talk.
  // `idleStopSuspended` holds the hook's 90s quiet-session auto-stop off while a
  // direct save is in flight — the socket must not be pulled out from under a write.
  const { tasks: liveTasks, connectionState, reconnecting, captureLive, idleStopped, start, stop, resetTasks, restoreStagedCapture } =
    useBrainDumpLive({ idleStopSuspended: isSaving });

  // ?fakedump=N (see makeFakeTask above): synthetic stream, no mic / no network.
  const fakeDumpCount = useMemo(() => {
    const raw = searchParams.get('fakedump');
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return 8; // bare ?fakedump (or junk) -> the default demo
    return n > 0 ? Math.min(n, 40) : 0; // ?fakedump=0 -> explicitly off
  }, [searchParams]);
  const fakeDump = fakeDumpCount > 0;
  const [fakeTasks, setFakeTasks] = useState<BrainDumpTask[]>([]);

  // The hook auto-stopped a quiet session. DERIVED during render, never corrected
  // after paint: the stage stays up with the capture intact, so all three exits
  // are still reachable. An auto-stop must cost the user nothing they already said
  // — it is the orb-tap/finish path, never Discard.
  const idleStaged = idleStopped && liveTasks.length > 0;
  const rec = fakeDump || idleStaged || connectionState === 'connecting' || connectionState === 'listening';
  const streamTasks = fakeDump ? fakeTasks : liveTasks;

  // Follow the newest task while the user is at the bottom; never yank them back
  // if they have scrolled up (iOS Safari has no overflow-anchor — see the hook).
  const stream = useStickToBottom<HTMLDivElement, HTMLDivElement>(streamTasks.length, rec);

  const colRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<gsap.core.Tween | null>(null);

  // Silently prefetch all data for /app and /meetings while user is on Home screen
  usePrefetchAppData(user?.id);

  useEffect(() => {
    // ?fakedump bypasses ONLY this redirect, so the demo stage renders signed out.
    if (!authLoading && !user && !fakeDump) navigate('/auth');
  }, [user, authLoading, navigate, fakeDump]);

  // Synthetic tasks arrive one every 700ms until N. Re-running (strict mode's
  // double-invoke, or a param change) resets the list first, so no duplicates.
  useEffect(() => {
    if (!fakeDump) return;
    setFakeTasks([]);
    let issued = 0;
    const timer = window.setInterval(() => {
      issued += 1;
      const n = issued;
      setFakeTasks((prev) => (prev.length >= fakeDumpCount ? prev : [...prev, makeFakeTask(n, fakeDumpCount)]));
      if (issued >= fakeDumpCount) window.clearInterval(timer);
    }, 700);
    return () => window.clearInterval(timer);
  }, [fakeDump, fakeDumpCount]);


  // Home data via React Query with staleTime: switching /app <-> /home within staleTime
  // now serves from cache instead of the raw fetch-on-mount these effects used before.
  const { data: firstName = '' } = useQuery({
    queryKey: ['focusos-home-profile', user?.id],
    enabled: !!user,
    staleTime: APP_DATA_STALE_TIME,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('focusos_profiles').select('first_name').eq('user_id', user!.id).maybeSingle();
      return data?.first_name ?? '';
    },
  });

  const { data: projects = [] } = useQuery<(ProjectInfo & { color?: string })[]>({
    queryKey: ['focusos-home-projects', user?.id],
    enabled: !!user,
    staleTime: APP_DATA_STALE_TIME,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('focusos_projects').select('id, name, color').eq('user_id', user!.id).order('name');
      return (data ?? []) as (ProjectInfo & { color?: string })[];
    },
  });

  // Today's Focus card: bounded slim fetch of open tasks; the pick order is
  // derived during render (rankTodaysFocus) so it rolls over at midnight
  // without effects and stays testable as a pure function.
  const { data: upNextData } = useQuery({
    queryKey: ['focusos-home-upnext', user?.id],
    enabled: !!user,
    staleTime: APP_DATA_STALE_TIME,
    queryFn: async () => {
      const { data, count } = await (supabase as any)
        .from('focusos_tasks')
        .select('id, title, status, due_date, project_id, priority', { count: 'exact' })
        .eq('user_id', user!.id)
        .neq('status', 'completed')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(500);
      return {
        openTasks: (data ?? []) as UpNextTask[],
        openCount: typeof count === 'number' ? count : 0,
      };
    },
  });
  // en-CA locale = YYYY-MM-DD in the user's own timezone
  const todayYmd = new Date().toLocaleDateString('en-CA');
  // A2: bumped by a swipe-left dismissal, from the release handler and never
  // from an effect. It is only the memo's re-derivation trigger: localStorage
  // stays the single source of truth and is re-read during render, so a same-day
  // reload lands on the same list with no mirror state to drift out of step.
  const [dismissedRev, setDismissedRev] = useState(0);
  // 10 rows now (was 3): the card scrolls internally (.lg-uprows), so the extra
  // rows cost height only up to the card's own max-height. Tasks set aside today
  // are filtered here, during render, so no effect ever removes a row after paint.
  const upNext = useMemo(() => {
    void dismissedRev;
    const dismissed = readDismissed(todayYmd);
    const open = (upNextData?.openTasks ?? []).filter((t) => !dismissed.has(t.id));
    return rankTodaysFocus(open, todayYmd).slice(0, 10);
  }, [upNextData, todayYmd, dismissedRev]);
  const openCount = upNextData?.openCount ?? 0;

  /* ── A1: interactive Today's Focus rows ────────────────────────────────────
     Tick completes, Play starts the timer, X deletes (house confirm), and the
     task text opens the shared edit pane over Home. Every write is the same
     field set the project rows write through Index.handleUpdateTask /
     handleDeleteTask; the refill is pure invalidation -> refetch -> re-rank
     during render (rankTodaysFocus), never a post-paint correction. */
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  // Set in the click handlers (never in an effect): the row shows its result
  // immediately and the invalidated query then removes/refreshes it for real.
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [timerStartedIds, setTimerStartedIds] = useState<Set<string>>(new Set());

  // Both key families: Home's own card AND the /app task caches (inactive while
  // Home is mounted, so this marks them stale for the next visit: no starved
  // fetch, no fabricated data).
  const invalidateTaskCaches = useCallback(() => {
    if (!user) return;
    queryClient.invalidateQueries({ queryKey: ['focusos-home-upnext', user.id] });
    queryClient.invalidateQueries({ queryKey: appDataKeys.tasks(user.id) });
    queryClient.invalidateQueries({ queryKey: appDataKeys.completedTasks(user.id) });
  }, [queryClient, user]);

  // Complete: status 'completed' is the ONLY field a completion changes; the
  // rest of Index's payload echoes the row back unchanged (Index.tsx:1514-1532),
  // and completed_at is set by the DB trigger, never by the client (the MCP
  // complete_task tool writes exactly this too, focusos-mcp/index.ts:380).
  // Returns whether the write landed, so A2's swipe can un-park a row whose
  // completion failed. The payload itself is untouched.
  const handleCompleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (completingIds.has(taskId)) return false;
    setCompletingIds((prev) => new Set(prev).add(taskId));
    const { error } = await (supabase as any)
      .from('focusos_tasks')
      .update({ status: 'completed' })
      .eq('id', taskId);
    if (error) {
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      toast.error('Failed to update task');
      return false;
    }
    invalidateTaskCaches();
    return true;
  }, [completingIds, invalidateTaskCaches]);

  // Start the timer: the exact start-branch writes of TaskListItem.handleStartStop
  // (TaskListItem.tsx:355-362) once Index maps them to columns (Index.tsx:1518-1528)
  // i.e. status 'in-progress', timer_is_running true, timer_start_time = Date.now().
  // timer_total_seconds is deliberately NOT written: the start branch keeps it
  // unchanged, and Home's slim row does not carry it. Project rows never stop
  // another task's timer (no global single-timer rule anywhere), so neither does
  // this. The row latches locally so a second tap cannot reset an accruing start.
  const handleStartTimer = useCallback(async (taskId: string) => {
    if (timerStartedIds.has(taskId)) return;
    const startTime = Date.now();
    setTimerStartedIds((prev) => new Set(prev).add(taskId));
    const { error } = await (supabase as any).from('focusos_tasks').update({
      status: 'in-progress',
      timer_is_running: true,
      timer_start_time: startTime,
    }).eq('id', taskId);
    if (error) {
      setTimerStartedIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      toast.error('Failed to start the timer');
      return;
    }
    invalidateTaskCaches();
  }, [timerStartedIds, invalidateTaskCaches]);

  // Delete: same sequence as Index.handleDeleteTask (Index.tsx:1717-1749):
  // recipient clones go first, the shared_items rows are neutralised, then the
  // task row is hard-deleted.
  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      const { data: sharedRows } = await (supabase as any)
        .from('focusos_shared_items')
        .select('id, recipient_task_id')
        .eq('item_id', taskId)
        .eq('item_type', 'task');

      if (sharedRows && sharedRows.length > 0) {
        const recipientTaskIds = sharedRows.map((r: any) => r.recipient_task_id).filter(Boolean);
        if (recipientTaskIds.length > 0) {
          await (supabase as any).from('focusos_tasks').delete().in('id', recipientTaskIds);
        }
        await (supabase as any)
          .from('focusos_shared_items')
          .update({ recipient_task_id: null, status: 'declined' })
          .in('id', sharedRows.map((r: any) => r.id));
      }

      const { error } = await (supabase as any).from('focusos_tasks').delete().eq('id', taskId);
      if (error) throw error;
      toast.success('Task deleted');
      invalidateTaskCaches();
    } catch (err: any) {
      console.error('Delete task error:', err);
      toast.error('Failed to delete task');
    }
  }, [invalidateTaskCaches]);

  // Tapping the task TEXT: the card's rows are slim (six columns), so the pane
  // needs the full row. ONE row, by id, so no new broad fetch.
  const handleOpenTask = useCallback(async (taskId: string) => {
    const { data, error } = await (supabase as any)
      .from('focusos_tasks')
      .select('*')
      .eq('id', taskId)
      .limit(1);
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      toast.error('Could not open that task');
      return;
    }
    setEditingTask(transformDbTask(row));
  }, []);

  /* ── A2: the swipe gesture itself ──────────────────────────────────────────
     Touch events only, so a mouse never drags anything (desktop has buttons).
     Everything the gesture knows lives in ONE state object: the row's transform
     is derived from it during render, and the release handler writes through
     the A1 completion path or the per-day dismiss key. No effect anywhere. */
  const [swipe, setSwipe] = useState<SwipeState | null>(null);

  /** A finger that became a swipe must not also fire the tap it lands on. */
  const swipeBlocksTap = useCallback(
    (id: string) => !!swipe && swipe.id === id && swipe.mode !== 'pending',
    [swipe],
  );

  const onRowTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>, id: string) => {
    if (e.touches.length !== 1) return;         // pinch / second finger: not a swipe
    // Let a leaving row leave, but ONLY while it is still rendered. Once the
    // refill has unmounted it, its transitionend can never arrive; a stale
    // 'exit' here must not block the next gesture forever (device-found
    // 2026-08-01: one successful swipe, then the feature was dead).
    if (swipe && swipe.mode === 'exit' && upNext.some((t) => t.id === swipe.id)) return;
    const touch = e.touches[0];
    // Take over a spring-back mid-flight: start from where the row IS on screen,
    // read live off the transform, not from the value the state settled on.
    const tr = window.getComputedStyle(e.currentTarget).transform;
    let base = 0;
    if (tr && tr !== 'none') {
      try { base = new DOMMatrixReadOnly(tr).m41; } catch { base = 0; }
    }
    setSwipe({ id, startX: touch.clientX, startY: touch.clientY, base, dx: base, mode: 'pending' });
  }, [swipe, upNext]);

  const onRowTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>, id: string) => {
    const s = swipe;
    if (!s || s.id !== id || s.mode === 'settle' || s.mode === 'exit') return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - s.startX;
    const dy = touch.clientY - s.startY;
    if (s.mode === 'pending') {
      // Down the list, not across it: hand the whole gesture back to the scroll
      // box and never look at it again (a tap ends here too, untouched).
      if (Math.abs(dy) > SWIPE_INTENT_PX && Math.abs(dx) <= 1.5 * Math.abs(dy)) {
        setSwipe(null);
        return;
      }
      if (Math.abs(dx) <= SWIPE_INTENT_PX || Math.abs(dx) <= 1.5 * Math.abs(dy)) return;
      setSwipe({ ...s, mode: 'drag', dx: swipeResist(s.base + dx) });
      return;
    }
    setSwipe({ ...s, dx: swipeResist(s.base + dx) });
  }, [swipe]);

  const onRowTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>, id: string) => {
    const s = swipe;
    if (!s || s.id !== id) return;
    if (s.mode !== 'drag') {
      if (s.mode === 'pending') setSwipe(null); // it was a tap: leave the click alone
      return;
    }
    const out = (e.currentTarget.offsetWidth || 360) + 48;
    if (s.dx >= SWIPE_ACTION_PX) {
      // Slide out right on the EXISTING row element (transform only), then the
      // invalidation -> refetch -> re-rank refill takes the row away for real.
      setSwipe({ ...s, mode: 'exit', dx: out });
      // The SAME write the tick fires: one completion path, one field set.
      void handleCompleteTask(id).then((ok) => {
        if (!ok) setSwipe((cur) => (cur && cur.id === id ? null : cur));
      });
      // Success belt: the refill usually unmounts the row BEFORE its exit
      // transition ends, so transitionend never arrives and the 'exit' state
      // would block every later swipe (device-found 2026-08-01). Clear it.
      window.setTimeout(
        () => setSwipe((cur) => (cur && cur.id === id && cur.mode === 'exit' ? null : cur)),
        SWIPE_SETTLE_MS,
      );
      return;
    }
    if (s.dx <= -SWIPE_ACTION_PX) {
      writeDismissed(todayYmd, id);   // synchronous: the memo re-reads this
      setSwipe({ ...s, mode: 'exit', dx: -out });
      // The row leaves the ranked list when its exit transform lands
      // (onRowTransitionEnd); this is the belt for a transitionend that never
      // arrives, and it ALSO clears the exit state (same stale-'exit' trap as
      // the right swipe).
      window.setTimeout(() => {
        setDismissedRev((n) => n + 1);
        setSwipe((cur) => (cur && cur.id === id && cur.mode === 'exit' ? null : cur));
      }, SWIPE_SETTLE_MS);
      return;
    }
    setSwipe({ ...s, mode: 'settle', dx: 0 });
    window.setTimeout(
      () => setSwipe((cur) => (cur && cur.id === id && cur.mode === 'settle' ? null : cur)),
      SWIPE_SETTLE_MS,
    );
  }, [swipe, handleCompleteTask, todayYmd]);

  const onRowTouchCancel = useCallback((id: string) => {
    setSwipe((cur) => (cur && cur.id === id && cur.mode !== 'exit' ? { ...cur, mode: 'settle', dx: 0 } : cur));
  }, []);

  const onRowTransitionEnd = useCallback((e: React.TransitionEvent<HTMLDivElement>, id: string) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    const s = swipe;
    if (!s || s.id !== id) return;
    if (s.mode === 'settle') { setSwipe(null); return; }         // idle again
    if (s.mode === 'exit') {
      if (s.dx < 0) setDismissedRev((n) => n + 1); // set aside
      setSwipe(null); // the exit landed: the engine is idle for the next gesture
    }
  }, [swipe]);

  // Save from the pane: the column mapping of Index.handleUpdateTask's DB update
  // (Index.tsx:1514-1532). Index's local-state choreography (optimistic list
  // patch, collaborator gating, project-move sort_order) stays in Index:
  // Home has no task list to keep in step, it re-reads via invalidation.
  const handleUpdateTaskFromPane = useCallback(async (updatedTask: Task) => {
    const { error } = await (supabase as any).from('focusos_tasks').update({
      title: updatedTask.title,
      description: updatedTask.description,
      priority: updatedTask.priority,
      status: updatedTask.status,
      start_date: updatedTask.startDate?.toISOString(),
      end_date: updatedTask.endDate?.toISOString(),
      due_date: updatedTask.dueDate?.toISOString(),
      // The pane was opened from a select('*'), so images here are the stored
      // ones, so the pre-hydration ambiguity Index guards against cannot occur.
      images: updatedTask.images || [],
      timer_total_seconds: updatedTask.timer.totalSeconds,
      timer_is_running: updatedTask.timer.isRunning,
      timer_start_time: updatedTask.timer.startTime,
      project_id: updatedTask.projectId || null,
      sort_order: updatedTask.sortOrder ?? 0,
      completed_by_email: updatedTask.completedByEmail || null,
    }).eq('id', updatedTask.id);
    if (error) {
      toast.error('Failed to update task');
      return;
    }
    setEditingTask(null);
    invalidateTaskCaches();
  }, [invalidateTaskCaches]);

  // EditTaskDialog wants full Project objects; Home's projects query is slim
  // (id/name/color), so the timer stub mirrors Index.applyProjectRows.
  const editProjects = useMemo<Project[]>(
    () => projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color || '#8a94a6',
      timer: { totalSeconds: 0, isRunning: false },
    })),
    [projects],
  );

  useEffect(() => {
    const interval = setInterval(() => setSubtitleIndex((p) => (p + 1) % SUBTITLES.length), 4000);
    return () => clearInterval(interval);
  }, []);

  // GSAP: on wide screens the hero column expands and the orb glides left while
  // recording. Widths are computed from real geometry (viewport, stream panel),
  // clamped so the orb can never leave the column — no magic mock numbers.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1000px)').matches;
    const col = colRef.current;
    if (col && wide) {
      // idle 760 MUST match .lg-hero-col max-width in the @media(min-width:1000px)
      // block — the rec-exit animation lands here before clearProps hands back to CSS
      const targetW = rec ? Math.min(1120, window.innerWidth - 16) : 760;
      gsap.to(col, {
        maxWidth: targetW,
        duration: 0.55,
        ease: 'power3.inOut',
        onComplete: () => {
          if (!rec) gsap.set(col, { clearProps: 'maxWidth' });
        },
      });
      // stream panel: 460px wide, 44px from the column's right edge; the orb
      // centres in the remaining left region, and stays >= 95px from the edge
      const shift = rec ? -Math.min((460 + 44) / 2, targetW / 2 - 95) : 0;
      if (actionsRef.current) {
        gsap.to(actionsRef.current, { x: shift, duration: 0.65, ease: 'expo.inOut' });
      }
    } else if (actionsRef.current) {
      gsap.to(actionsRef.current, { x: 0, duration: 0.4, ease: 'power2.out' });
    }
    if (rec && coreRef.current) {
      pulseRef.current = gsap.to(coreRef.current, { scale: 0.78, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    } else {
      pulseRef.current?.kill();
      pulseRef.current = null;
      if (coreRef.current) gsap.to(coreRef.current, { scale: 1, duration: 0.3, ease: 'power2.out' });
    }
    return () => {
      pulseRef.current?.kill();
      pulseRef.current = null;
    };
  }, [rec]);

  // FABs elsewhere send ?braindump=1 — auto-start the inline recording stage.
  // Deliberately NO effect cleanup: stripping the param re-runs the effect and
  // a cleanup would kill the pending timer before it ever fires. The ref guards
  // strict-mode double-invoke and re-runs instead.
  const autoStartRef = useRef(false);
  useEffect(() => {
    if (!user || autoStartRef.current) return;
    if (searchParams.get('braindump') !== '1') return;
    autoStartRef.current = true;
    setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      next.delete('braindump');
      setSearchParams(next, { replace: true });
      handleOrbTap();
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  // Auto-launch the Home tour for first-time users, or when triggered via
  // ?tour=home. Same shape as the ?braindump=1 effect above, for the same
  // reason (audit 2026-07-29, rig-proven dead): stripping the param re-runs
  // the effect, and a cleanup killed the pending timer before it fired — the
  // deep link never opened the tour. Ref-latched, no cleanup on the param arm.
  const tourLaunchRef = useRef(false);
  useEffect(() => {
    if (searchParams.get('tour') === 'home' && !tourLaunchRef.current) {
      tourLaunchRef.current = true;
      setTimeout(() => {
        const next = new URLSearchParams(window.location.search);
        next.delete('tour');
        setSearchParams(next, { replace: true });
        setTourOpen(true);
      }, 400);
      return;
    }
    if (preferences && !preferences.has_completed_home_tour) {
      const t = setTimeout(() => setTourOpen(true), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences, searchParams, setSearchParams]);

  const handleTourComplete = useCallback(() => {
    setTourOpen(false);
    markHomeTourComplete();
  }, [markHomeTourComplete]);

  // Brain Dump wrote new rows straight to Postgres. The shared /app caches are patched by
  // the dialog itself; Home's own cards are separate useQuery-observed keys, and Home is
  // still mounted while the dialog saves, so invalidating them refetches live (an observed
  // key is safe to invalidate — no fabrication, no starved fetch).
  const handleTasksCreated = useCallback(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ['focusos-home-upnext', user.id] });
      queryClient.invalidateQueries({ queryKey: ['focusos-home-projects', user.id] });
    }
    navigate('/app');
  }, [navigate, queryClient, user]);

  // Stop the live session; captured tasks go to the review dialog for edit + save.
  // This is "Edit Tasks", and it stays the orb's behaviour too.
  const finishSession = useCallback(() => {
    stop();
    if (liveTasks.length > 0) {
      setReviewTasks(liveTasks.map((t) => ({ ...t })));
      setBrainDumpOpen(true);
    }
    resetTasks();
  }, [stop, liveTasks, resetTasks]);

  /* Save All (N) — the DIRECT exit: write straight through the shared saver (the
     same inserts + cache patches the review dialog uses) and land on /app. The
     dialog is skipped entirely; nothing is re-fetched, because saveBrainDumpTasks
     patched the shared caches /app seeds from during render.
     On failure NOTHING is torn down: the session is still live and the captured
     list is still on screen, so a retry costs the user nothing. */
  const handleSaveAllDirect = useCallback(async () => {
    if (fakeDump) return;                      // demo stage: never touches the network
    if (isSaving || liveTasks.length === 0) return;
    if (BISECT_DISABLE_DIRECT_SAVE) { finishSession(); return; }

    const captured = liveTasks.map((t) => ({ ...t }));
    setIsSaving(true);
    try {
      await saveBrainDumpTasks({ queryClient, tasks: captured });
      stop();
      resetTasks();
      toast.success(`Added ${captured.length} task${captured.length > 1 ? 's' : ''}`);
      // Home's own cards are useQuery-observed, so invalidating them refetches live
      // (no fabrication, no starved fetch) — identical to handleTasksCreated.
      if (user) {
        queryClient.invalidateQueries({ queryKey: ['focusos-home-upnext', user.id] });
        queryClient.invalidateQueries({ queryKey: ['focusos-home-projects', user.id] });
      }
      navigate('/app');
    } catch (error: any) {
      toast.error('Failed to save tasks', { description: error?.message });
    } finally {
      setIsSaving(false);
    }
  }, [fakeDump, isSaving, liveTasks, queryClient, stop, resetTasks, user, navigate, finishSession]);

  /* Discard — ONE tap, wrongness is free (2026-07-28 redesign). The two-step
     "Sure? (N)" latch was mechanically sound and humanly wrong: on Igor's phone
     a silent red pill read as a dead button, twice. Now the tap discards
     immediately and a toast offers Undo — restoreStagedCapture puts the list
     back on the paused stage, so a slip costs nothing. Plain sonner toast: no
     modal layer, nothing Radix, no compositing layer born mid-animation. */
  const handleDiscard = useCallback(() => {
    if (fakeDump) { setFakeTasks([]); return; } // demo: reset the fake stream
    if (isSaving) return;
    const discarded = liveTasks.map((t) => ({ ...t }));
    stop();
    resetTasks();
    if (discarded.length > 0) {
      // Fixed id: the toast is dismissed the moment its Undo can no longer be
      // honoured (new session starting, Home unmounting) — audit 2026-07-29,
      // rig-proven: it used to outlive both and either overwrite a newer live
      // capture or silently restore nothing after a dock navigation.
      toast(`Discarded ${discarded.length} task${discarded.length > 1 ? 's' : ''}`, {
        id: 'bd-discard-undo',
        action: {
          label: 'Undo',
          onClick: () => {
            if (!restoreStagedCapture(discarded)) {
              toast('Too late to undo — a new capture already started', { id: 'bd-discard-undo' });
            }
          },
        },
        duration: 6000,
      });
    }
  }, [fakeDump, isSaving, liveTasks, stop, resetTasks, restoreStagedCapture]);

  // The Undo window closes when Home unmounts — the hook (and the discarded
  // capture's restore path) die with it.
  useEffect(() => () => { toast.dismiss('bd-discard-undo'); }, []);

  const handleEditTasks = useCallback(() => {
    if (fakeDump) return; // demo stage: never opens the review dialog
    if (isSaving) return;
    finishSession();
  }, [fakeDump, isSaving, finishSession]);

  const handleOrbTap = useCallback(async () => {
    if (orbRef.current) {
      gsap.fromTo(orbRef.current, { scale: 0.92 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    }
    if (fakeDump) return; // demo stage: the orb presses, nothing is captured
    if (isSaving) return; // a direct save is already in flight
    // Starting (or reviewing) closes the Undo window — see handleDiscard.
    toast.dismiss('bd-discard-undo');
    // Still live -> the orb reviews. Auto-stopped on silence -> the orb resumes,
    // and the capture rides into the new session instead of being replaced.
    if (rec && !idleStaged) {
      finishSession();
      return;
    }
    try {
      // A restart NEVER silently wipes an unsaved capture (Igor lost 3 staged
      // tasks to exactly that, 2026-07-28): anything still on the list rides
      // into the new session. Saves and Discard both reset the list, so a
      // genuinely fresh dump still starts clean.
      await start(projects, (idleStaged || liveTasks.length > 0) ? { preserveTasks: true } : undefined);
    } catch (error: any) {
      let msg = 'Could not start Brain Dump. ';
      if (error?.name === 'NotAllowedError') msg += 'Please allow microphone access in your browser settings.';else
      if (error?.name === 'NotFoundError') msg += 'No microphone found on this device.';else
      msg += error?.message || 'Please try again.';
      toast.error(msg);
    }
  }, [rec, idleStaged, liveTasks, start, projects, finishSession, fakeDump, isSaving]);

  // Group the live stream by destination, mirroring the review dialog's grouping
  const streamGroups = useMemo(() => {
    const groups: Record<string, { label: string; icon: 'today' | 'existing' | 'new'; tasks: BrainDumpTask[] }> = {};
    for (const task of streamTasks) {
      let key: string, label: string, icon: 'today' | 'existing' | 'new';
      if (task.destination === 'today') {
        key = '__today__';label = "TODAY'S TO-DO";icon = 'today';
      } else if (task.destination === 'existing-project') {
        key = `existing:${task.projectId}`;label = (task.projectName || 'Project').toUpperCase();icon = 'existing';
      } else {
        key = `new:${(task.projectName || '').toLowerCase().trim()}`;label = `NEW PROJECT: ${(task.projectName || 'New Project').toUpperCase()}`;icon = 'new';
      }
      if (!groups[key]) groups[key] = { label, icon, tasks: [] };
      groups[key].tasks.push(task);
    }
    return groups;
  }, [streamTasks]);

  const projectColor = (id: string | null | undefined) =>
  projects.find((p) => p.id === id)?.color || '#8a94a6';

  // DEV-only: hand the specs the live QueryClient so they can read the shared
  // caches directly (same precedent as __gsap above and BrainDumpRepro.tsx).
  // Idempotent assignment, so it is safe during render, and import.meta.env.DEV
  // is the literal `false` in a production build — the line is dead-code-stripped.
  if (import.meta.env.DEV) (window as any).__qc = queryClient;

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>;
  }

  if (!user && !fakeDump) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Redirecting...</div>
      </div>);

  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      <div className={`lg-hero-col ${rec ? 'rec' : ''}`} ref={colRef}>
        {/* Greeting */}
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground lg-onbg">
            {getGreeting()}{firstName ? `, ${firstName}` : fakeDump ? ', Igor' : ''}
          </h1>
          <div className="h-8 mt-3 relative">
            <AnimatePresence mode="wait">
              <motion.p
                key={rec ? 'rec' : subtitleIndex}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                className="text-base sm:text-lg absolute inset-0 flex items-center justify-center text-muted-foreground lg-onbg">

                {rec
                ? idleStaged ? 'Paused — your capture is safe' : 'Capturing your thoughts…'
                : SUBTITLES[subtitleIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* Today's Focus — ranked open tasks (fades away while recording).
            A1 (2026-08-01): the rows WORK here. Tick completes, Play starts the
            timer, X deletes behind the house confirm, and the task text opens
            the shared edit pane over Home. Nothing navigates away. */}
        {upNext.length > 0 &&
        <div className="lg-glass lg-upnext">
            <div className="lg-uphead">
              <span className="ttl">TODAY'S FOCUS</span>
              <span className="cnt">{openCount} open</span>
            </div>
            {/* .lg-uprows is the scroll box: flex:1/min-height:0/overflow-y:auto
                so rows scroll INSIDE the card instead of spilling past its
                max-height. Rows stay its DIRECT children, which is what the
                @media(max-height:800px) nth-child(n+3) hide rule matches. */}
            <div className="lg-uprows">
              {upNext.map((t) => {
              const done = completingIds.has(t.id);
              // A2: the row's own gesture state, derived during render. `moving`
              // is 0 until the gesture is decided, so a tap never nudges a pixel.
              const sw = swipe && swipe.id === t.id ? swipe : null;
              const moving = sw && sw.mode !== 'pending' ? sw.dx : 0;
              const reveal = Math.min(1, Math.abs(moving) / SWIPE_ACTION_PX);
              return (
                <div
                  key={t.id}
                  className={`lg-utask${sw && (sw.mode === 'settle' || sw.mode === 'exit') ? ' lg-uspring' : ''}`}
                  style={sw ? { transform: `translateX(${moving}px)` } : undefined}
                  onTouchStart={(e) => onRowTouchStart(e, t.id)}
                  onTouchMove={(e) => onRowTouchMove(e, t.id)}
                  onTouchEnd={(e) => onRowTouchEnd(e, t.id)}
                  onTouchCancel={() => onRowTouchCancel(t.id)}
                  onTransitionEnd={(e) => onRowTransitionEnd(e, t.id)}>
                  {/* Swipe affordance. ALWAYS mounted (never born mid-gesture,
                      per the white-flash law), invisible until the drag drives its
                      opacity, and counter-translated so the tint stays put in
                      the card while the row slides off it. */}
                  <div
                    className="lg-uswipe"
                    aria-hidden="true"
                    data-dir={moving > 0 ? 'right' : moving < 0 ? 'left' : undefined}
                    style={sw ? { transform: `translateX(${-moving}px)`, opacity: reveal } : undefined}>
                    <Check className="i done" size={14} strokeWidth={3} />
                    <Clock className="i later" size={13} strokeWidth={2.5} />
                  </div>
                  <button
                    type="button"
                    className={`lg-tick${done ? ' done' : ''}`}
                    aria-label={`Complete ${t.title}`}
                    onClick={() => { if (swipeBlocksTap(t.id)) return; handleCompleteTask(t.id); }}>
                    <Check size={13} strokeWidth={3} />
                  </button>
                  <div
                    className="lg-utap"
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (swipeBlocksTap(t.id)) return; handleOpenTask(t.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpenTask(t.id); }}>
                    <div className={`lg-utitle${done ? ' done' : ''}`}>{t.title}</div>
                    {t.project_id &&
                    <div className="lg-umeta">
                        <span className="lg-udot" style={{ background: projectColor(t.project_id) }} />
                        {projects.find((p) => p.id === t.project_id)?.name}
                      </div>}
                  </div>
                  {/* Igor 2026-08-01: no due chip on the card, X before play
                      (project-row order), tight button pair. */}
                  <div className="lg-uacts">
                    {/* Same AlertDialog the project rows use (TaskListItem.tsx:1012),
                        same copy, same house liquid-glass restyle. */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        {/* preventDefault is how a Radix trigger is stopped: it
                            composes our handler first and skips its own once the
                            event is defaulted. The swipe must not also open the
                            confirm behind itself. */}
                        <button
                          type="button"
                          className="lg-uact del"
                          aria-label={`Delete ${t.title}`}
                          title="Delete task"
                          onClick={(e) => { if (swipeBlocksTap(t.id)) e.preventDefault(); }}>
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete the task. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteTask(t.id)}>
                            Yes, Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <button
                      type="button"
                      className={`lg-uact play${timerStartedIds.has(t.id) ? ' on' : ''}`}
                      aria-label={`Start timer for ${t.title}`}
                      title={timerStartedIds.has(t.id) ? 'Timer running' : 'Start timer'}
                      onClick={() => { if (swipeBlocksTap(t.id)) return; handleStartTimer(t.id); }}>
                      <Play size={14} />
                    </button>
                  </div>
                </div>);
            })}
            </div>
            {/* A2 gesture hint. ONE persistent line on the card's bottom edge:
                mounted for as long as the card is, so it is never born or killed
                mid-transition (white-flash law), and it fades with the card
                during recording exactly like every other pixel of it. Motion is
                CSS keyframes on transform/opacity only, and it is hidden on
                pointer-fine devices, which swipe nothing and have the buttons. */}
            <div className="lg-uhint" aria-hidden="true">
              <span className="l"><ArrowLeft size={11} strokeWidth={2.5} />set aside</span>
              <span className="w">swipe</span>
              <span className="r">complete<ArrowRight size={11} strokeWidth={2.5} /></span>
            </div>
          </div>}

        {/* Live brain-dump stream — takes the card's slot; right column on wide screens */}
        <div className="lg-stream lg-glass" ref={stream.scrollRef}>
          <div className="lg-stream-listen">
            <div className="lg-mic"><Mic size={18} /></div>
            <div>
              <div className="lbl">
                {/* HOT MIC (2026-07-29): capture starts at the tap and pre-socket
                    speech is buffered, so the moment the mic is live the stage
                    truthfully says speak — "Connecting…" only covers the brief
                    mic acquisition (or the first-run permission prompt). */}
                {connectionState === 'connecting' ? (captureLive ? 'Listening… speak freely' : 'Getting the mic ready…')
                : reconnecting ? 'Reconnecting…'
                : idleStaged ? 'Paused — you went quiet'
                : 'Listening… speak freely'}
              </div>
              <div className="sub">
                {connectionState === 'connecting' && !captureLive ? 'One moment — allow the microphone if asked.'
                : reconnecting ? 'The line dropped — hold that thought, it comes right back.'
                : idleStaged ? 'Tap the orb to keep talking.'
                : 'Tasks appear here as you talk.'}
              </div>
            </div>
            {/* Live loudness from the engine — the "it hears you" signal. */}
            <BrainDumpVoiceBars active={captureLive && !idleStaged} />
          </div>
          {/* role="log" = implicit polite live region: rows are announced as they
              land. Unstyled wrapper on purpose — it exists so the ResizeObserver
              has the growing content to watch, and must not alter the box. */}
          <div className="lg-stream-list" role="log" ref={stream.contentRef}>
            {Object.entries(streamGroups).map(([key, group]) =>
            <div key={key} className="lg-sgroup">
                <div className="lg-sglabel">
                  {group.icon === 'today' && <Calendar size={11} />}
                  {group.icon === 'existing' && <FolderOpen size={11} />}
                  {group.icon === 'new' && <Plus size={11} />}
                  {group.label}
                </div>
                {group.tasks.map((t) =>
              <div key={t.id} className="lg-stask">
                    <span className="lg-udot" style={{ background: t.destination === 'today' ? '#e5484d' : projectColor(t.projectId) }} />
                    <span className="tt">{t.title}</span>
                    <span className="lg-schip">{t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}</span>
                  </div>)}
              </div>)}
          </div>
          {/* Only while the user has scrolled away from the newest task. Outside
              the log region so it is never announced as stream content. */}
          {!stream.pinned && stream.overflowing &&
          <button type="button" className="lg-stream-jump" onClick={stream.jumpToLatest}>
              <ArrowDown size={12} />Jump to latest
            </button>}
        </div>

        <div className="lg-hero-spacer" />

        {/* Orb + actions (GSAP glides this left while recording on wide screens) */}
        <div className="lg-hero-actions" ref={actionsRef}>
          <button
            ref={orbRef}
            className="lg-orb"
            aria-label="Brain dump"
            data-home-tour-step="brain-dump"
            onClick={handleOrbTap}>

            <div className="lg-orb-core" ref={coreRef} />
          </button>
          <span className="text-sm font-medium text-center text-muted-foreground lg-onbg">
            {rec
            ? idleStaged ? 'Paused — tap the orb to keep talking, or pick below' : 'Listening… tap the orb to review, or pick below'
            : 'Tap to capture your thoughts into tasks'}
          </span>
          {rec ?
          /* Three exits, ONE row (Fix A budget: a second row costs ~45px the
             393x852 icon-app does not have). Left to right = destructive,
             neutral, primary — the house order, acc last. */
          <div className="lg-recbtns">
              <button
              className="lg-btn"
              onClick={handleDiscard}
              disabled={isSaving}
              aria-label="Discard captured tasks">
                <Trash2 size={13} />Discard
              </button>
              <button className="lg-btn" onClick={handleEditTasks} disabled={isSaving || streamTasks.length === 0}>
                <Pencil size={13} />Edit Tasks
              </button>
              <button className="lg-btn acc" onClick={handleSaveAllDirect} disabled={isSaving || streamTasks.length === 0}>
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {isSaving ? 'Saving…' : `Save All (${streamTasks.length})`}
              </button>
            </div> :

          /* Idle row: Record Meeting + the tour button share the line (step-1
             Dynamic Bar prep). Both ride the same rec-flip swap as before —
             the pattern the stage transition was device-proven with. */
          <div className="lg-idlerow">
              <button
              data-home-tour-step="record-meeting"
              onClick={() => navigate('/meetings')}
              className="lg-btn"
              style={{ padding: '11px 22px', fontSize: 14 }}>
                <Video size={16} />
                <span>Record Meeting</span>
              </button>
              <button
              onClick={() => setTourOpen(true)}
              aria-label="Take the Home tour"
              className="lg-btn lg-helpbtn">
                <HelpCircle size={16} />
              </button>
            </div>}
        </div>
      </div>

      {/* ?debug=1 — production-safe live diagnostics (renders nothing without the param) */}
      <BrainDumpDebugOverlay />

      <BottomNav projects={projects} />

      <HomeTour isOpen={tourOpen} onComplete={handleTourComplete} />

      {/* Task edit pane, opened by tapping a Today's Focus row's text. Mounted
          ONLY while a task is open (Radix law: never forceMount a modal layer),
          the same conditional-render pattern Index uses for its mobile pane.
          No `desktopDocked`, so it is the plain modal dialog on every width;
          closing leaves the user on /home, nothing navigates. */}
      {editingTask &&
      <EditTaskDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => { if (!open) setEditingTask(null); }}
        onUpdateTask={handleUpdateTaskFromPane}
        projects={editProjects}
        currentUserId={user?.id}
        onDeleteTask={(task) => handleDeleteTask(task.id)} />}

      {/* Review + save: the existing dialog machinery, fed by the inline session.
          `user &&` only ever matters in the signed-out ?fakedump demo — on the
          real path the guard above guarantees a user for the whole mount. */}
      {user &&
      <BrainDumpLiveDialog
        open={brainDumpOpen}
        onOpenChange={(open) => {
          setBrainDumpOpen(open);
          if (!open) setReviewTasks(undefined);
        }}
        userId={user.id}
        projects={projects}
        initialTasks={reviewTasks}
        onTasksCreated={handleTasksCreated} />}

    </div>);

};

export default Home;

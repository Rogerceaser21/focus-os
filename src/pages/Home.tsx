import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';

if (import.meta.env.DEV) (window as any).__gsap = gsap;
import { Video, HelpCircle, Check, Mic, Pencil, Trash2, Loader2, Calendar, FolderOpen, Plus, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePrefetchAppData } from '@/hooks/usePrefetchAppData';
import { APP_DATA_STALE_TIME } from '@/lib/appDataFetchers';
import { saveBrainDumpTasks } from '@/lib/brainDumpSave';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import BottomNav from '@/components/BottomNav';
import { HomeTour } from '@/components/HomeTour';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useBrainDumpLive, type BrainDumpTask, type ProjectInfo } from '@/hooks/useBrainDumpLive';
import { BrainDumpDebugOverlay } from '@/components/BrainDumpDebugOverlay';
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
  const { tasks: liveTasks, connectionState, reconnecting, idleStopped, start, stop, resetTasks, restoreStagedCapture } =
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

  // Up Next card: the next few open tasks (soonest due first) + the total open count.
  const { data: upNextData } = useQuery({
    queryKey: ['focusos-home-upnext', user?.id],
    enabled: !!user,
    staleTime: APP_DATA_STALE_TIME,
    queryFn: async () => {
      const { data, count } = await (supabase as any)
        .from('focusos_tasks')
        .select('id, title, status, due_date, project_id', { count: 'exact' })
        .eq('user_id', user!.id)
        .neq('status', 'completed')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(3);
      return {
        upNext: (data ?? []) as UpNextTask[],
        openCount: typeof count === 'number' ? count : 0,
      };
    },
  });
  const upNext = upNextData?.upNext ?? [];
  const openCount = upNextData?.openCount ?? 0;

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
      const targetW = rec ? Math.min(1120, window.innerWidth - 16) : 640;
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

        {/* Up Next — real open tasks (fades away while recording) */}
        {upNext.length > 0 &&
        <div className="lg-glass lg-upnext">
            <div className="lg-uphead">
              <span className="ttl">UP NEXT</span>
              <span className="cnt">{openCount} open</span>
            </div>
            <div style={{ paddingBottom: 8 }}>
              {upNext.map((t) =>
            <div key={t.id} className="lg-utask">
                  <div className="lg-tick" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="lg-utitle">{t.title}</div>
                    {t.project_id &&
                <div className="lg-umeta">
                        <span className="lg-udot" style={{ background: projectColor(t.project_id) }} />
                        {projects.find((p) => p.id === t.project_id)?.name}
                      </div>}
                  </div>
                  {dueLabel(t.due_date) && <span className="lg-uchip">{dueLabel(t.due_date)}</span>}
                </div>)}
            </div>
          </div>}

        {/* Live brain-dump stream — takes the card's slot; right column on wide screens */}
        <div className="lg-stream lg-glass" ref={stream.scrollRef}>
          <div className="lg-stream-listen">
            <div className="lg-mic"><Mic size={18} /></div>
            <div>
              <div className="lbl">
                {connectionState === 'connecting' ? 'Connecting…'
                : reconnecting ? 'Reconnecting…'
                : idleStaged ? 'Paused — you went quiet'
                : 'Listening… speak freely'}
              </div>
              <div className="sub">
                {reconnecting ? 'The line dropped — hold that thought, it comes right back.'
                : idleStaged ? 'Tap the orb to keep talking.'
                : 'Tasks appear here as you talk.'}
              </div>
            </div>
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

          <button
            data-home-tour-step="record-meeting"
            onClick={() => navigate('/meetings')}
            className="lg-btn"
            style={{ padding: '11px 22px', fontSize: 14 }}>
              <Video size={16} />
              <span>Record Meeting</span>
            </button>}
        </div>
      </div>

      {/* ?debug=1 — production-safe live diagnostics (renders nothing without the param) */}
      <BrainDumpDebugOverlay />

      {/* Help / replay tour button */}
      <button
        onClick={() => setTourOpen(true)}
        aria-label="Take the Home tour"
        className="lg-helpfab fixed right-4 z-30 flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors shadow-md"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>

        <HelpCircle className="w-5 h-5" />
      </button>

      <BottomNav projects={projects} />

      <HomeTour isOpen={tourOpen} onComplete={handleTourComplete} />

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

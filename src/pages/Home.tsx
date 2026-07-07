import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import { Video, HelpCircle, Check, Mic, Square, Calendar, FolderOpen, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePrefetchAppData } from '@/hooks/usePrefetchAppData';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import BottomNav from '@/components/BottomNav';
import { HomeTour } from '@/components/HomeTour';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useBrainDumpLive, type BrainDumpTask, type ProjectInfo } from '@/hooks/useBrainDumpLive';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [firstName, setFirstName] = useState<string>('');
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [projects, setProjects] = useState<(ProjectInfo & { color?: string })[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const [upNext, setUpNext] = useState<UpNextTask[]>([]);
  const [openCount, setOpenCount] = useState<number>(0);
  const [reviewTasks, setReviewTasks] = useState<BrainDumpTask[] | undefined>(undefined);
  const { preferences, markHomeTourComplete } = useUserPreferences(user?.id);

  // Live brain-dump session runs inline on the hero (the approved recording stage):
  // the orb glides left and captured tasks stream in on the right while you talk.
  const { tasks: liveTasks, connectionState, start, stop, resetTasks } = useBrainDumpLive();
  const rec = connectionState === 'connecting' || connectionState === 'listening';

  const actionsRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<gsap.core.Tween | null>(null);

  // Silently prefetch all data for /app and /meetings while user is on Home screen
  usePrefetchAppData(user?.id);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);


  useEffect(() => {
    if (!user) return;
    (supabase as any).from('focusos_profiles').select('first_name').eq('user_id', user.id).maybeSingle().
    then(({ data }: any) => {if (data?.first_name) setFirstName(data.first_name);});
    (supabase as any).from('focusos_projects').select('id, name, color').eq('user_id', user.id).order('name').
    then(({ data }: any) => {if (data) setProjects(data);});
  }, [user]);

  // Up Next card: the next few open tasks (soonest due first)
  useEffect(() => {
    if (!user) return;
    (supabase as any).
    from('focusos_tasks').
    select('id, title, status, due_date, project_id', { count: 'exact' }).
    eq('user_id', user.id).
    neq('status', 'completed').
    order('due_date', { ascending: true, nullsFirst: false }).
    limit(3).
    then(({ data, count }: any) => {
      if (data) setUpNext(data);
      if (typeof count === 'number') setOpenCount(count);
    });
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => setSubtitleIndex((p) => (p + 1) % SUBTITLES.length), 4000);
    return () => clearInterval(interval);
  }, []);

  // GSAP: orb glides left on wide screens while recording; red core breathes
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1000px)').matches;
    if (actionsRef.current) {
      gsap.to(actionsRef.current, { x: rec && wide ? -280 : 0, duration: 0.65, ease: 'expo.inOut' });
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

  // Auto-launch the Home tour for first-time users, or when triggered via ?tour=home
  useEffect(() => {
    if (searchParams.get('tour') === 'home') {
      const t = setTimeout(() => setTourOpen(true), 400);
      const next = new URLSearchParams(searchParams);
      next.delete('tour');
      setSearchParams(next, { replace: true });
      return () => clearTimeout(t);
    }
    if (preferences && !preferences.has_completed_home_tour) {
      const t = setTimeout(() => setTourOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [preferences, searchParams, setSearchParams]);

  const handleTourComplete = useCallback(() => {
    setTourOpen(false);
    markHomeTourComplete();
  }, [markHomeTourComplete]);

  const handleTasksCreated = useCallback(() => navigate('/app'), [navigate]);

  // Stop the live session; captured tasks go to the review dialog for edit + save
  const finishSession = useCallback(() => {
    stop();
    if (liveTasks.length > 0) {
      setReviewTasks(liveTasks.map((t) => ({ ...t })));
      setBrainDumpOpen(true);
    }
    resetTasks();
  }, [stop, liveTasks, resetTasks]);

  const handleOrbTap = useCallback(async () => {
    if (orbRef.current) {
      gsap.fromTo(orbRef.current, { scale: 0.92 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    }
    if (rec) {
      finishSession();
      return;
    }
    try {
      await start(projects);
    } catch (error: any) {
      let msg = 'Could not start Brain Dump. ';
      if (error?.name === 'NotAllowedError') msg += 'Please allow microphone access in your browser settings.';else
      if (error?.name === 'NotFoundError') msg += 'No microphone found on this device.';else
      msg += error?.message || 'Please try again.';
      toast.error(msg);
    }
  }, [rec, start, projects, finishSession]);

  // Group the live stream by destination, mirroring the review dialog's grouping
  const streamGroups = useMemo(() => {
    const groups: Record<string, { label: string; icon: 'today' | 'existing' | 'new'; tasks: BrainDumpTask[] }> = {};
    for (const task of liveTasks) {
      let key: string, label: string, icon: 'today' | 'existing' | 'new';
      if (task.destination === 'today') {
        key = '__today__';label = "TODAY'S TO-DO";icon = 'today';
      } else if (task.destination === 'existing-project') {
        key = `existing:${task.projectId}`;label = (task.projectName || 'Project').toUpperCase();icon = 'existing';
      } else {
        key = `new:${(task.projectName || '').toLowerCase().trim()}`;label = `🆕 NEW PROJECT: ${(task.projectName || 'New Project').toUpperCase()}`;icon = 'new';
      }
      if (!groups[key]) groups[key] = { label, icon, tasks: [] };
      groups[key].tasks.push(task);
    }
    return groups;
  }, [liveTasks]);

  const projectColor = (id: string | null | undefined) =>
  projects.find((p) => p.id === id)?.color || '#8a94a6';

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Redirecting...</div>
      </div>);

  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      <div className={`lg-hero-col ${rec ? 'rec' : ''}`}>
        {/* Greeting */}
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground lg-onbg">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
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

                {rec ? 'Capturing your thoughts…' : SUBTITLES[subtitleIndex]}
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
        <div className="lg-stream lg-glass">
          <div className="lg-stream-listen">
            <div className="lg-mic"><Mic size={18} /></div>
            <div>
              <div className="lbl">{connectionState === 'connecting' ? 'Connecting…' : 'Listening… speak freely'}</div>
              <div className="sub">Tasks appear here as you talk.</div>
            </div>
          </div>
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
            {rec ? 'Listening… tap the orb or Stop when done' : 'Tap to capture your thoughts into tasks'}
          </span>
          {rec ?
          <div className="lg-recbtns">
              <button className="lg-btn" onClick={finishSession}><Square size={12} />Stop</button>
              <button className="lg-btn acc" onClick={finishSession}>
                <Check size={14} />Save All Tasks ({liveTasks.length})
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

      {/* Help / replay tour button */}
      <button
        onClick={() => setTourOpen(true)}
        aria-label="Take the Home tour"
        className="fixed right-4 z-30 flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors shadow-md"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>

        <HelpCircle className="w-5 h-5" />
      </button>

      <BottomNav projects={projects} />

      <HomeTour isOpen={tourOpen} onComplete={handleTourComplete} />

      {/* Review + save: the existing dialog machinery, fed by the inline session */}
      <BrainDumpLiveDialog
        open={brainDumpOpen}
        onOpenChange={(open) => {
          setBrainDumpOpen(open);
          if (!open) setReviewTasks(undefined);
        }}
        userId={user.id}
        projects={projects}
        initialTasks={reviewTasks}
        onTasksCreated={handleTasksCreated} />

    </div>);

};

export default Home;

// DEV-ONLY reproduction harness for the Brain Dump save path (and, under
// ?mocklive=1, for the live TRANSPORT — see BrainDumpTransportHarness below).
//
// Routed only when import.meta.env.DEV (see App.tsx). It mirrors Home.tsx's
// brain-dump surface — usePrefetchAppData warming the shared /app caches, the same
// `focusos-home-projects` query, and the same handleTasksCreated (invalidate the Home
// cards, then navigate('/app')) — but feeds BrainDumpLiveDialog through its
// `initialTasks` prop, so tests/braindump-save.spec.ts can click "Save All Tasks" with
// NO live Gemini session and NO microphone. Keep this in lockstep with Home.tsx's
// brain-dump wiring: whatever Home hands the dialog and does on onTasksCreated, this does.
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePrefetchAppData } from '@/hooks/usePrefetchAppData';
import { APP_DATA_STALE_TIME } from '@/lib/appDataFetchers';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import { useBrainDumpLive, type BrainDumpTask, type ProjectInfo } from '@/hooks/useBrainDumpLive';

const todayIso = () => new Date().toISOString().split('T')[0];

// Two captured tasks, one per destination branch of handleSave: 'today' (task insert
// only) and 'new-project' (also forces the focusos_projects insert whose row has to
// reach the projects cache). Both carry an explicit due date so they land in the
// default Today view once /app takes over.
const REPRO_TASKS: BrainDumpTask[] = [
  {
    id: 'repro-task-today',
    title: 'Repro dumped task today',
    priority: 'high',
    destination: 'today',
    dueDate: todayIso(),
  },
  {
    id: 'repro-task-new-project',
    title: 'Repro dumped task in new project',
    priority: 'medium',
    destination: 'new-project',
    projectName: 'Repro New Project',
    dueDate: todayIso(),
  },
];

/* ── Live TRANSPORT harness (?mocklive=1) ────────────────────────────────────
   Drives useBrainDumpLive with window.__mockLiveSession set, so start() skips
   getUserMedia, the config edge function and ai.live.connect entirely: no
   Gemini, no microphone, no Supabase session needed. The spec
   (tests/braindump-live-transport.spec.ts) pushes wire messages through
   window.__brainDumpLiveMock and reads the resulting list off these testids. */
const TRANSPORT_PROJECTS: ProjectInfo[] = [{ id: 'proj-alpha', name: 'Alpha' }];

const BrainDumpTransportHarness = () => {
  const { tasks, connectionState, reconnecting, start, stop } = useBrainDumpLive();
  const [startError, setStartError] = useState('');

  const handleStart = useCallback(async () => {
    setStartError('');
    try {
      await start(TRANSPORT_PROJECTS);
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : String(err));
    }
  }, [start]);

  return (
    <div className="p-6 space-y-3">
      <div data-testid="transport-ready">ready</div>
      <div>
        <button data-testid="transport-start" onClick={handleStart}>start</button>
        <button data-testid="transport-stop" onClick={stop}>stop</button>
      </div>
      <div data-testid="transport-state">{connectionState}</div>
      <div data-testid="transport-reconnecting">{reconnecting ? 'yes' : 'no'}</div>
      <div data-testid="transport-error">{startError}</div>
      <ol data-testid="transport-tasks">
        {tasks.map((t) => (
          <li key={t.id} data-testid="transport-task" data-task-id={t.id} data-destination={t.destination}>
            {t.title}
          </li>
        ))}
      </ol>
    </div>
  );
};

const BrainDumpRepro = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(true);
  const mockLive = searchParams.get('mocklive') === '1';

  // Same silent warm-up Home runs, so the shared /app caches hold a baseline set
  // before Save All Tasks is clicked — the exact precondition the bug needs.
  usePrefetchAppData(user?.id);

  // Mirrors Home.tsx's projects query (same key, same shape).
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

  // Mirrors Home.tsx's handleTasksCreated exactly.
  const handleTasksCreated = useCallback(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ['focusos-home-upnext', user.id] });
      queryClient.invalidateQueries({ queryKey: ['focusos-home-projects', user.id] });
    }
    navigate('/app');
  }, [navigate, queryClient, user]);

  // Hand the spec the live QueryClient so it can read the shared caches directly
  // (same DEV-only window-exposure precedent as Home.tsx's __gsap). Idempotent
  // assignment, so it is safe during render.
  if (import.meta.env.DEV) (window as any).__qc = queryClient;

  // Transport mode needs no auth and no dialog — every hook above still ran, so
  // the branch is only in the returned tree.
  if (mockLive) return <BrainDumpTransportHarness />;

  return (
    <div className="p-6">
      <div data-testid="repro-ready">{user ? 'signed-in' : 'no-user'}</div>
      {user && (
        <BrainDumpLiveDialog
          open={open}
          onOpenChange={setOpen}
          userId={user.id}
          projects={projects}
          onTasksCreated={handleTasksCreated}
          initialTasks={REPRO_TASKS}
        />
      )}
    </div>
  );
};

export default BrainDumpRepro;

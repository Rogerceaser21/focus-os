// DEV-ONLY reproduction harness for the Brain Dump save path.
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
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePrefetchAppData } from '@/hooks/usePrefetchAppData';
import { APP_DATA_STALE_TIME } from '@/lib/appDataFetchers';
import { BrainDumpLiveDialog } from '@/components/BrainDumpLiveDialog';
import type { BrainDumpTask, ProjectInfo } from '@/hooks/useBrainDumpLive';

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

const BrainDumpRepro = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(true);

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

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
import { Button } from '@/components/ui/button';
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

/* ── Confirm-dialog harness (?confirm=1 | ?confirm=2) ────────────────────────
   Renders the SHARED Radix AlertDialog (src/components/ui/alert-dialog.tsx)
   over a stack of dummy rows — the exact framing of the screenshot that flagged
   the see-through panel. Needs no auth and touches no data: nothing is wired to
   a delete. confirm=1 is the two-action delete-task shape (TaskListItem,
   TaskCard, EditTaskDialog, Index); confirm=2 is the THREE-action meeting shape
   (Meetings, MeetingDetail), which is the layout most at risk from a restyle. */
const ConfirmHarness = ({ variant }: { variant: '1' | '2' }) => (
  <div className="p-4 space-y-2">
    <div data-testid="confirm-ready">ready</div>
    {['Draft the Q3 handover note', 'Chase the vendor invoice', 'Book the studio for Thursday',
      'Review the onboarding copy', 'Send the recap to the team', 'Rebuild the pricing sheet'].map((t) => (
      <div key={t} className="lg-stask"><span className="tt">{t}</span><span className="lg-schip">todo</span></div>
    ))}
    {/* Opened by a TAP, exactly like the real delete X — an auto-open dialog
        takes programmatic focus with no prior pointer event, which makes the
        Cancel pill match :focus-visible and paint a ring users never see. */}
    <AlertDialog>
      <AlertDialogTrigger className="lg-btn danger">Delete task</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{variant === '2' ? 'Delete Meeting' : 'Delete this task?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {variant === '2'
              ? 'This will permanently delete the meeting recording, transcript, and all metadata. What would you like to do with associated action items/tasks?'
              : 'This will permanently delete the task and remove it from all recipients you shared it with. This action cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {variant === '2' ? (
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" className="lg-btn">Keep Tasks &amp; Delete Meeting</Button>
            <Button variant="destructive" className="lg-btn danger">Delete Everything</Button>
          </AlertDialogFooter>
        ) : (
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  </div>
);

/* ── Review-dialog harness (?review=1) ───────────────────────────────────────
   The same BrainDumpLiveDialog the save harness drives, but with no auth and no
   caches: `userId` is inert in the component (nothing reads it) and the tasks
   come straight from initialTasks, so this renders the review surface on a
   device that has no session. Screenshot-only; Save/Cancel are never clicked
   here and the spec suite keeps using the signed-in path above. */
const ReviewHarness = () => {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-4">
      <div data-testid="review-ready">ready</div>
      <BrainDumpLiveDialog
        open={open}
        onOpenChange={setOpen}
        userId="00000000-0000-4000-8000-000000000000"
        projects={[{ id: 'proj-alpha', name: 'Alpha' }]}
        onTasksCreated={() => {}}
        initialTasks={REPRO_TASKS}
      />
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
  const confirmVariant = searchParams.get('confirm');

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

  // Transport / confirm modes need no auth and no dialog — every hook above
  // still ran, so the branch is only in the returned tree.
  if (mockLive) return <BrainDumpTransportHarness />;
  if (confirmVariant === '1' || confirmVariant === '2') return <ConfirmHarness variant={confirmVariant} />;
  if (searchParams.get('review') === '1') return <ReviewHarness />;

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

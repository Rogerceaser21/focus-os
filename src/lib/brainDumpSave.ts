import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { appDataKeys, mergeByIdDesc, slimTaskRow } from '@/lib/appDataFetchers';
import type { BrainDumpTask } from '@/hooks/useBrainDumpLive';

/* ── The one home of the Brain Dump write path (Deploy 1, 2026-07-28) ────────
   Lifted verbatim out of BrainDumpLiveDialog.handleSave so BOTH exits from a
   dump — the review dialog and Home's direct "Save All" — write through the
   SAME code: same inserts, same date fallbacks, and above all the same two
   guarded cache patches (Fix B). Two copies of a cache patch is how a cache
   patch goes stale on one path only; there is exactly one here.

   Framework-agnostic on purpose (a plain async function taking the
   QueryClient): no React imports, no toasts, no navigation. The choreography
   around it — spinner, toast wording, dialog close, onProjectCreated /
   onTasksCreated callbacks, where to navigate — belongs to the caller.
   -------------------------------------------------------------------------- */

export interface SaveBrainDumpTasksParams {
  queryClient: QueryClient;
  /** The captured list, exactly as the live hook / review dialog holds it. */
  tasks: BrainDumpTask[];
  /** Only set from the meeting surfaces; stamps meeting_id on every row. */
  meetingId?: string;
}

export interface SaveBrainDumpTasksResult {
  /** The PostgREST insert echo (full rows, `images` included — slim before caching). */
  insertedRows: any[];
  /** normalized new-project name -> created project id, in creation order. */
  newProjectIds: Map<string, string>;
}

export async function saveBrainDumpTasks({
  queryClient,
  tasks,
  meetingId,
}: SaveBrainDumpTasksParams): Promise<SaveBrainDumpTasksResult> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('User not authenticated');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Collect unique new project names to create
  const newProjectNames = new Map<string, string>();
  for (const task of tasks) {
    if (task.destination === 'new-project' && task.projectName) {
      const key = task.projectName.toLowerCase().trim();
      if (!newProjectNames.has(key)) {
        newProjectNames.set(key, task.projectName);
      }
    }
  }

  // Create new projects
  const newProjectIds = new Map<string, string>(); // normalized name -> id
  for (const [key, name] of newProjectNames) {
    const { data: project, error: projectError } = await (supabase as any)
      .from('focusos_projects')
      .insert({ name: name.trim(), user_id: user.id, color: '#3b82f6' })
      .select()
      .single();
    if (projectError) throw projectError;
    newProjectIds.set(key, project.id);
    // Mirror the new project into the shared projects cache. /app seeds DURING RENDER
    // from these caches (Index.tsx warm start), and nothing else writes them from
    // /home — without this the next /app paint shows the pre-insert snapshot for the
    // whole 60-min gcTime. Only patch a cache that already holds data: fabricating one
    // would mark it fresh and starve the real fetch. mergeByIdDesc dedupes by id and
    // keeps created_at desc — the order loadProjects produces.
    queryClient.setQueryData(appDataKeys.projects(user.id), (prev: any[] | undefined) =>
      prev ? mergeByIdDesc([project, ...prev]) : prev,
    );
  }

  // Build task inserts
  const tasksToInsert = tasks.map(task => {
    let projectId: string | null = null;

    if (task.destination === 'existing-project' && task.projectId) {
      projectId = task.projectId;
    } else if (task.destination === 'new-project' && task.projectName) {
      projectId = newProjectIds.get(task.projectName.toLowerCase().trim()) || null;
    }

    // Dates: explicit Gemini-extracted dates take priority; fall back to today for today-tasks
    const explicitDueDate = task.dueDate ? new Date(task.dueDate).toISOString() : null;
    const fallbackDueDate = task.destination === 'today' && !explicitDueDate ? today.toISOString() : null;

    return {
      title: task.title.trim(),
      description: task.description?.trim() || null,
      priority: task.priority,
      status: 'todo' as const,
      user_id: user.id,
      project_id: projectId,
      due_date: explicitDueDate || fallbackDueDate,
      ...(task.startDate ? { start_date: new Date(task.startDate).toISOString() } : {}),
      ...(task.endDate ? { end_date: new Date(task.endDate).toISOString() } : {}),
      ...(meetingId ? { meeting_id: meetingId } : {}),
      timer_total_seconds: 0,
      timer_is_running: false,
    };
  });

  const { data: insertedRows, error: tasksError } = await (supabase as any)
    .from('focusos_tasks')
    .insert(tasksToInsert)
    .select();
  if (tasksError) throw tasksError;

  // Same guarded patch for the open-task list cache (new rows are status 'todo', so
  // appDataKeys.completedTasks is deliberately left alone). slimTaskRow FIRST: the
  // bare .select() above returns the heavy inline-base64 `images` column, which must
  // never enter the hot task-list cache the slim load exists to avoid.
  if (insertedRows && insertedRows.length > 0) {
    queryClient.setQueryData(appDataKeys.tasks(user.id), (prev: any[] | undefined) =>
      prev ? mergeByIdDesc([...insertedRows.map(slimTaskRow), ...prev]) : prev,
    );
  }

  return { insertedRows: insertedRows ?? [], newProjectIds };
}

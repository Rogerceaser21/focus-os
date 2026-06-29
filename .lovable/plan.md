# Move-to-top on project change

When a task is moved to a different project, set its `sort_order` to `min(existing sort_order in destination project for the same priority) - 1` so it appears at the TOP of its priority group (ascending sort).

## 1. Shared helper

Add a small async helper (co-located in each file to avoid a new shared module, mirroring existing inline-helper style; identical implementation in both):

```ts
async function getTopSortOrderForProject(projectId: string, priority: string): Promise<number> {
  const { data, error } = await supabase
    .from('focusos_tasks')
    .select('sort_order')
    .eq('project_id', projectId)
    .eq('priority', priority)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return 0;
  return (data.sort_order ?? 0) - 1;
}
```

Queried from DB (not local state) so both Index and MeetingDetail behave identically, per the brief.

## 2. `handleUpdateTask` in `src/pages/Index.tsx`

- Look up the original task from current state (`allTasks`/`tasks`) before the update to capture its previous `projectId`.
- Compute `const projectChanged = updatedTask.projectId !== original.projectId`.
- If `projectChanged`: `newSortOrder = await getTopSortOrderForProject(updatedTask.projectId, updatedTask.priority)`. Else keep `updatedTask.sortOrder ?? 0`.
- Use `newSortOrder` in the supabase update payload (replacing the existing `sort_order` line).
- Update the optimistic local state merge so the moved task carries `sortOrder: newSortOrder`, so the UI re-sorts it to the top immediately (no wait for realtime).
- No other behavior changes.

## 3. `handleSavedTaskUpdate` in `src/pages/MeetingDetail.tsx`

- Fetch the original `project_id` (either from the passed task object if available, or a quick `select project_id` by id) and compare with the new one.
- If changed: compute `newSortOrder` via the helper and include `sort_order: newSortOrder` in the update payload. If unchanged: do NOT include `sort_order` (preserve current behavior of omitting it).

## Out of scope (unchanged)

- Sorting/display logic, create path, drag-and-drop reordering, schema, RLS, realtime subscriptions, prior fixes.
- No edits when project did not change.

## Verification

- Move a task across projects from the edit dialog on `/app` → appears at top of its priority group in destination.
- Same from MeetingDetail's saved-task edit → top of group in destination project.
- Edit title/due/priority without changing project → position unchanged.
- `tsgo` type check clean.

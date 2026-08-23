# MCP: cascade archive/unarchive + strict empty-string parent guard

## What this does
Updates the `focusos-mcp` Supabase Edge Function so its archive/unarchive tools mirror the web app's cascade behaviour (top-level project archives/restores its sub-projects together) and rejects an explicit empty-string `parent_project_id` instead of silently treating it as top-level.

## Changes
1. In `supabase/functions/focusos-mcp/index.ts`, inside `create_project`:
   - Change the guard from `if (args.parent_project_id) {` to `if (args.parent_project_id !== undefined) {` so `parent_project_id: ""` is validated and refused.

2. Replace the existing `archive_project` tool with a version that:
   - Fetches the target project with `id` and `parent_project_id`.
   - If the project is a sub-project, archives only that row.
   - If the project is top-level, archives the project and every project whose `parent_project_id` equals it in one statement.
   - Returns the archived row plus a `subs_archived` array.

3. Replace the existing `unarchive_project` tool with the mirror-image logic:
   - Restores only the sub-project if it has a parent.
   - Restores the top-level project and all its sub-projects if it is top-level.
   - Returns the restored row plus a `subs_restored` array.

4. Deploy the function via `supabase--deploy_edge_functions`.

## Acceptance
- `create_project` with `parent_project_id: ""` returns "Parent project not found".
- `archive_project` on a top-level project archives it and all its sub-projects, returning them in `subs_archived`.
- `archive_project` on a sub-project archives only that sub-project (`subs_archived` empty).
- `unarchive_project` mirrors the above for restoration.
- Foreign/unknown project IDs still return "Project not found".
- No other files or schema are changed.

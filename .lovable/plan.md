# MCP: create_project with sub-project support + delete_project

## What this does
Updates the `focusos-mcp` Supabase Edge Function so MCP clients can create sub-projects (one level deep) and permanently delete archived projects, matching the web app's upcoming archive/sub-project feature.

## Changes
1. Replace `create_project` in `supabase/functions/focusos-mcp/index.ts`:
   - Accept optional `parent_project_id`.
   - Validate the parent belongs to the user, is active, and is top-level.
   - Return validation errors: "Parent project not found", "Parent must be a top-level project...", "Parent project is archived...".
   - Create the project with `parent_project_id` set when valid.

2. Add `delete_project` tool immediately before `create_task`:
   - Accept `id` and `confirm: true`.
   - Require the project to be archived; refuse otherwise.
   - Delete all tasks in the project, then delete the project.
   - Promote any sub-projects to top level (FK is `ON DELETE SET NULL`).
   - Return `deleted`, `tasks_deleted`, and `sub_projects_promoted`.

3. Deploy the function via `supabase--deploy_edge_functions`.

## Acceptance
- `create_project` rejects foreign/unknown parents, archived parents, and sub-project parents.
- `create_project` creates a row with `parent_project_id` when validation passes.
- `delete_project` returns "Project not found" for foreign IDs, refuses non-archived projects, and requires `confirm: true`.
- `delete_project` deletes the project and its tasks, promotes sub-projects, and reports counts.
- No other files or schema are changed.

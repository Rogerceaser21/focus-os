# MCP: archive/unarchive projects + archived-aware list_projects

## What this does
Updates the `focusos-mcp` Supabase Edge Function so MCP clients can archive/unarchive projects and see archived status in project listings, matching the web app's existing archive capability.

## Changes
1. Replace `list_projects` in `supabase/functions/focusos-mcp/index.ts`:
   - Accept optional `include_archived: boolean` (default false).
   - Exclude rows where `archived_at` is not null unless requested.
   - Return columns `id, name, color, archived_at, parent_project_id, created_at, updated_at`.

2. Add two new tools immediately before `create_task`:
   - `archive_project(id)` — sets `archived_at` to current ISO timestamp for the owner's project.
   - `unarchive_project(id)` — clears `archived_at` for the owner's project.
   - Both owner-scope via `.eq("user_id", userId)` and return `"Project not found"` when no row matches.

3. Deploy the function via `supabase--deploy_edge_functions`.

## Acceptance
- `list_projects` excludes archived projects by default and includes them when `include_archived: true`.
- Each `list_projects` row includes `archived_at` and `parent_project_id`.
- `archive_project` sets `archived_at` and returns the row; `unarchive_project` clears it.
- Foreign/unknown project IDs return `"Project not found"`.
- No other files or schema are changed.

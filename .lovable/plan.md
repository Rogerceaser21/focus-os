# Add `update_project` tool to focusos-mcp

## Goal
Expose project rename/recolour/move operations to MCP clients by adding an `update_project` tool to `supabase/functions/focusos-mcp/index.ts`, then deploying the function.

## Change
1. Insert the provided `mcp.tool("update_project", ...)` block immediately **before** the existing `delete_project` tool (i.e. directly after `unarchive_project`).
2. The tool follows existing conventions:
   - Owner-scoped via `getUserId(ctx)` and `.eq("user_id", userId)` on every query.
   - Uses `admin` client, `ok()`/`err()` helpers, and Zod `inputSchema`.
   - Validates that a project with sub-projects cannot be nested, the target parent must be an owned active top-level project, and a project cannot be its own parent.
3. Deploy the `focusos-mcp` edge function.

## Acceptance
- `update_project` renames/recolours an owned project.
- `parent_project_id` set to an owned active top-level project id moves the project under that parent.
- `parent_project_id: null` moves the project back to top level.
- Returns errors when: project has sub-projects and is being nested; parent is a sub-project, archived, foreign, or unknown; no fields are passed; or project is foreign/unknown.
- No other files, tables, migrations, or web app code are touched.

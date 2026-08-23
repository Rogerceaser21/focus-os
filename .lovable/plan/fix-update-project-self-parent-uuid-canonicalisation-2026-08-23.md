# Fix update_project self-parent uuid canonicalisation

## Goal
Close a one-line hole in `focusos-mcp`'s `update_project` tool where uppercase or braced spellings of a project's own id could bypass the raw-string self-parent check.

## Change
In `supabase/functions/focusos-mcp/index.ts`, inside the `update_project` handler, insert a canonical uuid comparison immediately after the `Parent project not found` check and before the top-level/archived parent validations.

```text
Before:
  if (parentError) return err(parentError.message);
  if (!parent) return err("Parent project not found");
  if (parent.parent_project_id) return err("Parent must be a top-level project (sub-projects cannot have sub-projects)");

After:
  if (parentError) return err(parentError.message);
  if (!parent) return err("Parent project not found");
  // Compare CANONICAL ids (the DB lookup accepts uppercase/braced uuid
  // spellings that the raw string compare above does not).
  if (parent.id === project.id) return err("A project cannot be its own parent");
  if (parent.parent_project_id) return err("Parent must be a top-level project (sub-projects cannot have sub-projects)");
```

## Deployment
Deploy the `focusos-mcp` edge function after the edit.

## Acceptance
- `update_project` with `parent_project_id` equal to the project's own id in lowercase, UPPERCASE, or `{braced}` form returns `Error: A project cannot be its own parent` and writes nothing.
- All other `update_project` behaviour (rename, recolour, move under valid parent, move to top level, rejections for sub-project parent, archived parent, project with subs, no fields, foreign id) remains unchanged.
- No other file, table, migration, or tool is touched.

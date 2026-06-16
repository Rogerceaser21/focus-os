# MCP Server Plan — Focus OS

Goal: expose Focus OS data (projects, tasks, meetings, brain dumps) to external AI clients (Claude Code, Claude Desktop, Cursor, etc.) via Model Context Protocol, so the user's AI of choice can read/write into their Focus OS account.

## Architecture
- **Transport**: Remote MCP server over HTTP/SSE, hosted as Supabase Edge Function `focusos-mcp`.
- **Auth**: Per-user API tokens. Table `focusos_api_tokens` (user_id, name, token_hash, last_used_at). User generates token in Settings → "MCP / API Tokens", pastes into Claude Code config as Bearer header.
- **Authorization**: Every MCP call resolves user_id from token, then scopes every DB query by that user_id (service role internally, no leakage).

## MCP Tools (v1)
Read: list_projects, list_tasks (filters), get_task, list_meetings, get_meeting (transcript+summary+actions), search.
Write: create_project, create_task, update_task, complete_task, delete_task, create_meeting, brain_dump (reuses focusos-extract-tasks pipeline).

## Schema
```sql
create table public.focusos_api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
-- grants to authenticated + service_role; RLS scoped to auth.uid()
```

## Client setup
```json
{
  "mcpServers": {
    "focusos": {
      "url": "https://mshlbsgsyzzfxyxramjj.supabase.co/functions/v1/focusos-mcp",
      "headers": { "Authorization": "Bearer <user-token>" }
    }
  }
}
```

## Out of scope v1
Realtime subscriptions, file uploads, OAuth-based MCP.

## Build order (after Google Calendar ships)
1. Migration: focusos_api_tokens
2. Settings UI: API Tokens panel
3. Edge function focusos-mcp (read tools)
4. Write tools
5. Docs page with copy-paste config

Status: **PLAN ONLY — build after Google Calendar feature.**

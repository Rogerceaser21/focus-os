

## Problem Analysis

Two distinct issues:

### Issue 1: Flash/Flicker on Load
The loading guard at line 1078 checks `authLoading || prefsLoading || (user && !initialLoadComplete)`. The problem: `prefsLoading` depends on `useUserPreferences(user?.id)` which only starts loading AFTER `user` becomes available. There's a brief window where:
- `authLoading` = false (auth done)
- `prefsLoading` = false (hasn't started yet because `user?.id` just arrived)
- `user` = truthy, `initialLoadComplete` = false

During this gap, `prefsLoading` is momentarily false before the preferences hook reacts to the new userId, letting the component fall through to the main UI briefly before preferences loading kicks in and the spinner reappears.

**Fix**: Track a single `isReady` flag that only becomes true once all sequential dependencies are resolved. Specifically, add a check for `preferences` being loaded: `authLoading || prefsLoading || (user && !preferences) || (user && !initialLoadComplete)`.

### Issue 2: Stale JS Bundles on Normal Refresh
The `<meta>` cache-control tags added to `index.html` do NOT actually control browser caching. Browsers respect HTTP response headers from the server, not meta tags, for caching decisions. These meta tags are effectively useless for this purpose.

The real fix: Vite already hashes JS/CSS filenames in production builds. The problem is that `index.html` itself is being cached by the browser or CDN, so it keeps referencing old hashed JS files. We need to either:
- Remove the useless meta tags (they do nothing)
- The actual caching of `index.html` is controlled by the hosting platform (Lovable's CDN). However, we CAN force cache-busting by adding a timestamp query param to the script tag in `index.html`.

Wait -- actually the script tag is `/src/main.tsx` which Vite processes. In dev mode this isn't hashed. In production builds, Vite generates hashed filenames. The issue is likely that `index.html` is being served from cache by the CDN/browser.

**Fix**: Add a version query string to the module script tag in `index.html` that changes with each build, forcing the browser to re-fetch. We can use Vite's `html` transform to inject a build timestamp. Alternatively, a simpler approach: use a Vite plugin to add cache-busting headers.

Actually, the simplest and most effective approach: configure Vite to generate a unique `index.html` on each build by injecting a build hash into the HTML. But since we can't control CDN headers...

Let me reconsider. The cleanest fix for the caching issue is to ensure Vite outputs hashed asset names (it already does) AND that `index.html` isn't cached. Since we can't control server headers, we should remove the ineffective meta tags and instead use a Vite plugin that injects a build timestamp into the script tag.

## Proposed Changes

### 1. Fix the flash (`src/pages/Index.tsx`)
Change line 1078 from:
```
if (authLoading || prefsLoading || (user && !initialLoadComplete))
```
to:
```
if (authLoading || prefsLoading || (user && !preferences) || (user && !initialLoadComplete))
```

This closes the gap where `prefsLoading` is momentarily false before the preferences hook starts fetching.

### 2. Fix stale bundles (`index.html` + `vite.config.ts`)
- Remove the useless `<meta>` cache-control tags from `index.html` (they don't work for this purpose)
- Add a Vite `htmlPlugin` that injects a build timestamp as a query parameter on the main script tag, so each deploy produces a unique `index.html` that references a fresh entry point
- This forces the browser to load the new bundle even if `index.html` is served from cache

```text
Before: <script type="module" src="/src/main.tsx"></script>
After:  <script type="module" src="/src/main.tsx?v=1709712345678"></script>
```

In `vite.config.ts`, add a custom plugin:
```typescript
{
  name: 'html-cache-bust',
  transformIndexHtml(html) {
    return html.replace(
      /src="\/src\/main\.tsx"/,
      `src="/src/main.tsx?v=${Date.now()}"`
    );
  }
}
```

Both changes are small and targeted. The first fixes the flash. The second ensures new code is always loaded on refresh.

## Diagnostic Findings (2026-03-06)

### The Problem
After publishing, the app serves STALE cached code on normal refresh. Users must hard-refresh (Cmd+Shift+R) to get the latest version. This is unacceptable — **the app must always serve fresh code on every normal refresh, on every device, every browser, no exceptions.**

### Observed Behavior
- **Chrome Desktop (Mac, heavy load):** `tasks.thefeedbackapp.net` only works after hard refresh. `focusos.thefeedbackapp.net` doesn't load properly at all.
- **Safari Desktop (Mac):** `tasks.thefeedbackapp.net` works correctly.
- **Chrome Desktop (Windows, light load):** Everything works correctly.
- **Mobile Safari:** Works fine.
- **Preview mode:** Same stale-code issue — only shows new features after hard refresh.

### Root Cause Analysis
1. The `configureServer` middleware in `vite.config.ts` ONLY applies to the Vite dev server — it has **zero effect** in production or preview deployments.
2. The `transformIndexHtml` cache-bust (appending `?v=timestamp` to main.tsx) works at build time, but the **CDN caches the built `index.html` itself**, so returning visitors get the old `index.html` with the old timestamp, defeating the purpose.
3. The real problem: **there is no client-side mechanism to detect and bust stale cached content in production.**
4. This is NOT a device/resource issue — it's a fundamental missing cache invalidation strategy for production builds.

### What Needs to Happen
The app needs a **client-side cache invalidation mechanism** that works regardless of CDN caching behavior. Two approaches:
1. **Service Worker Killer** (already planned) — unregister any lingering service workers from legacy PWA
2. **Client-side version check** — an inline script in `index.html` that checks a version endpoint or uses a cache-busting redirect when it detects stale content

### Current State of Fixes
- ✅ `setLoading(true)` in useUserPreferences — fixes the flash/flicker
- ✅ `transformIndexHtml` cache-bust — helps for fresh builds but CDN can cache the HTML
- ⚠️ `configureServer` middleware — dev-only, useless in production
- ❌ No production cache invalidation strategy exists yet

---

## Collaborative Project Sharing Plan

### Overview
Transition from snapshot-cloning to a **membership-based collaborative model** for shared projects. Tasks within a shared project are a single source of truth — all members see and edit the same tasks in real-time. External delegation (to non-members) continues to use the existing snapshot-clone model.

### Database Changes

#### 1. New Table: `focusos_project_members`
```sql
CREATE TABLE public.focusos_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.focusos_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'collaborator', -- 'owner', 'collaborator', 'viewer'
  invited_by uuid NOT NULL,
  invited_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
```

#### 2. RLS Policy Updates
- **`focusos_projects`**: Add SELECT policy so members can view projects they belong to.
- **`focusos_tasks`**: Add SELECT/UPDATE policies so project members can read/edit tasks in shared projects.
  - Collaborators: Can edit title, description, status, images, timer. Can delegate to external users.
  - Viewers: Read-only access.
- **Owner-only fields**: Due date, priority, and member management are restricted to the project owner via RLS or edge function checks.

#### 3. Realtime
- Subscribe to `focusos_tasks` changes filtered by `project_id` for shared projects.
- Subscribe to `focusos_project_members` for invitation status updates.

### Permission Matrix

| Action                        | Owner | Collaborator | Viewer | External Assignee |
|-------------------------------|-------|-------------|--------|-------------------|
| View tasks                    | ✅    | ✅          | ✅     | Own clone only    |
| Add tasks                     | ✅    | ✅          | ❌     | ❌                |
| Edit title/description        | ✅    | ✅          | ❌     | ❌                |
| Edit priority/due date        | ✅    | ❌          | ❌     | ❌                |
| Start/stop timer              | ✅    | ✅          | ❌     | ❌                |
| Complete tasks                | ✅    | ✅          | ❌     | Own clone only    |
| Delegate to external user     | ✅    | ✅          | ❌     | ❌                |
| Manage members                | ✅    | ❌          | ❌     | ❌                |
| Delete project                | ✅    | ❌          | ❌     | ❌                |

### Conflict Prevention: Optimistic Locking

To prevent silent overwrites when two collaborators edit the same task simultaneously:

1. **Mechanism**: Every task update includes a check against `updated_at`. The update query uses:
   ```sql
   .update({ ... })
   .eq('id', taskId)
   .eq('updated_at', originalUpdatedAt)
   ```
   If 0 rows are affected, another user modified the task in between.

2. **Client handling**: When a conflict is detected (0 rows returned), show a toast: *"This task was just updated by another collaborator. Your changes could not be saved — please review and try again."* Then refresh the task data from the server.

3. **Scope**: Applied to all user-initiated field edits (title, description, priority, status, timer, due date). NOT applied to system-driven updates (realtime sync, completion sync) which use service-role and are authoritative.

### Implementation Phases

#### Phase 1: Database & Backend
- Create `focusos_project_members` table with RLS
- Create edge function `focusos-invite-project-member` (sends email invitation)
- Create edge function `focusos-accept-project-invite` (accepts and sets user_id)
- Update RLS on `focusos_tasks` and `focusos_projects` for member access

#### Phase 2: Frontend — Project Sharing UI
- Add "Invite Members" button in project sidebar (owner only)
- Show member avatars/names on shared projects
- Invitation accept/decline flow in sidebar notifications

#### Phase 3: Frontend — Collaborative Editing
- Add optimistic locking to all task update operations
- Add Realtime subscriptions for shared project tasks
- Enforce permission matrix in UI (disable fields based on role)
- Show "Shared by" indicators and member presence

#### Phase 4: External Delegation from Shared Projects
- Allow collaborators to delegate tasks to non-members via existing email/clone flow
- Completion sync from external assignees updates the shared task (visible to all members)

### What This Does NOT Change
- Individual task sharing (non-project) continues to use snapshot cloning
- Meeting sharing continues as-is
- The existing `focusos_shared_items` table remains for external delegation and individual shares


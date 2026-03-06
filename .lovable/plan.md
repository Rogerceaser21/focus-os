

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

### Environment-Specific Behavior
Key observation: the caching/loading issues are **resource-dependent**, not purely a code bug.

**Chrome on Mac (heavy load — ~75 tabs, Claude Code, other apps):**
- `tasks.thefeedbackapp.net` — only works after hard refresh; normal refresh serves stale content
- `focusos.thefeedbackapp.net` — does not load properly at all
- Hypothesis: Chrome under heavy memory pressure may aggressively serve from disk/memory cache or fail to complete network requests for updated assets

**Safari on Mac Desktop:**
- `tasks.thefeedbackapp.net` — **works correctly**
- This contradicts the earlier assumption that Safari Desktop was universally broken

**Windows machine (Chrome, light load):**
- Everything works correctly — all domains, no hard refresh needed

**Mobile Safari:**
- Works fine

### Conclusions
1. The issue is NOT a universal browser/CDN caching problem — it's exacerbated (or possibly caused) by **resource-constrained environments** (heavy Chrome usage on Mac)
2. Safari Desktop works, disproving the earlier theory that Safari had a fundamental SW/cache issue
3. The `configureServer` middleware fix in vite.config.ts only helps dev mode — it has no effect in production
4. The Service Worker killer script in index.html is still important as a safety net for legacy PWA remnants
5. Before implementing aggressive cache-busting (which could hurt performance for all users), we should consider whether the real fix is simply ensuring proper CDN cache headers on the Lovable hosting side


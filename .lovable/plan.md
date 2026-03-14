

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


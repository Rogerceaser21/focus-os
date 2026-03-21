

## Plan: Fix Blank Cream Screen on /app

### What's Happening

The browser confirms the issue. When navigating to `/app` without a session, Index.tsx line 1488-1490 calls `navigate('/auth')` **during render** — this is the React error in the console:

> "Cannot update a component (BrowserRouter) while rendering a different component (Index)"

This means `navigate()` fires during the render phase, which is illegal in React. The result: the component returns `null`, and because the redirect doesn't actually complete reliably (React suppresses state updates during render), the user sees a blank screen with the cream background applied from `bg-background`.

### Two Problems to Fix

1. **`navigate('/auth')` called during render in Index.tsx** (line 1488-1490) — causes blank screen. Must be moved into a `useEffect`.

2. **Same pattern in Home.tsx** (line 59-61) — `navigate('/auth')` during render after the loading gate. Same bug, same blank screen risk.

### Changes

**File: `src/pages/Index.tsx`**
- Remove the direct `navigate('/auth'); return null;` block at line 1488-1490
- Replace with a `useEffect` that redirects when `!authLoading && !user`
- The render gate for `!user` should show a loading spinner (same as the authLoading gate) instead of returning `null`

**File: `src/pages/Home.tsx`**  
- Remove the direct `navigate('/auth'); return null;` block at line 59-61
- The existing `useEffect` at line 33-35 already handles the redirect correctly — just remove the redundant render-phase navigate

### Technical Detail

The fix moves navigation out of the render phase and into effects, which is the correct React pattern. The loading/redirect states will show the spinner UI (with proper `bg-background` theming) instead of returning `null` (which renders nothing — the blank screen).


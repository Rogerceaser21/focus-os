

# Welcome / Home Screen — Implementation Plan

## What I Understand From the Screenshot

The screenshot shows a **mobile-first "Home" screen** that becomes the default landing page after login. Here's every element annotated:

1. **Greeting header** — Time-dependent: "Good Morning", "Good Afternoon", "Good Evening" + user's first name (e.g. "Good Morning Igor"). Subtitle rotates between prompts: "Ready to capture your thoughts?", "Ready to convert them into tasks or projects?", "Do you have a new project in mind?", "What's on your mind?"
2. **Brain Dump button** — Large, centered tap-to-record button. This is the Brain Dump Live feature. **Only appears on this Home screen**; on all other screens the Brain Dump button lives in the bottom dock.
3. **Record Meetings button** — Below the Brain Dump button. Navigates to the meetings/recording flow.
4. **NO "Recent Entries" section** — Explicitly called out as unwanted.
5. **Left side buttons** — Two small navigation buttons: "Projects" (top) and "Meetings" (bottom).
6. **Right side buttons** — Two small navigation buttons: "Today's To-Do" and "Past Due List".
7. **Bottom navigation** — "Home" (left) and "Journal" (right) — the brain dump dock button does NOT exist on this screen.
8. **Warm color palette** — Cream/beige/warm tones (will be addressed in a future theme change, not this task).

## What Changes

### 1. New route & page: `/home` → `src/pages/Home.tsx`
- Authenticated-only (redirects to `/auth` if not logged in)
- Fetches user's first name from `focusos_profiles`
- Time-based greeting (Morning < 12, Afternoon < 17, Evening otherwise)
- Rotating subtitle text with animation
- Large centered Brain Dump button (opens `BrainDumpLiveDialog`)
- "Record Meeting" button below it (navigates to `/meetings` with record intent)
- Left side: "Projects" button → navigates to `/app`, "Meetings" button → navigates to `/meetings`
- Right side: "Today's To-Do" button → navigates to `/app` with today selected, "Past Due List" → navigates to `/app` with past-due selected
- Bottom nav: "Home" (active) and "Journal" (navigates to `/app`)
- Brain Dump dock button is **hidden** on this screen

### 2. Routing changes in `App.tsx`
- Add `/home` route pointing to `Home.tsx`
- After auth, redirect to `/home` instead of `/app`

### 3. Auth redirect update in `Auth.tsx`
- Change post-login redirect from `/` to `/home`

### 4. Landing page redirect update
- When logged-in user hits `/`, redirect to `/home` instead of `/app`

### 5. Settings update
- Add "Home" as a new default view option in `SettingsDialog.tsx`
- Add it to the `useUserPreferences` default: `default_view: 'home'`
- When `default_view === 'home'`, after login route to `/home`

### 6. Dock/navigation changes
- On the Home screen, the bottom dock shows Home + Journal only (no brain dump button)
- On all other screens, the dock continues to show the brain dump button as it does now

### 7. Plan file
- Save this plan as `.lovable/welcome_screen.md`

## Technical Approach

- `Home.tsx` is a standalone page component, not embedded in Index.tsx
- It uses `useAuth` for auth gating and `supabase` to fetch `focusos_profiles.first_name`
- Navigation buttons pass query params or state to `/app` to pre-select the right view (e.g. `/app?view=today`, `/app?view=past-due`, `/app?view=projects`)
- The rotating subtitle uses a simple interval + `AnimatePresence` from framer-motion
- The Brain Dump button reuses `BrainDumpLiveDialog` (same as current usage in Index.tsx)
- Warm styling will use Tailwind classes approximating the screenshot's palette (cream backgrounds, warm accents) scoped to this page only for now — full theme change comes later


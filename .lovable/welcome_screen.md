# Welcome / Home Screen — Implementation Plan

## Overview
A mobile-first "Home" screen that becomes the default landing page after login.

## Elements
1. **Greeting header** — Time-dependent: "Good Morning/Afternoon/Evening, [Name]"
2. **Rotating subtitle** — Cycles between prompts every 4 seconds
3. **Brain Dump button** — Large centered mic button, opens BrainDumpLiveDialog
4. **Record Meetings button** — Below brain dump, navigates to /meetings
5. **Left side buttons** — Projects (→ /app?view=projects), Meetings (→ /meetings)
6. **Right side buttons** — Today's To-Do (→ /app?view=today), Past Due (→ /app?view=past-due)
7. **Bottom nav** — Home (active) + Journal (→ /app). No brain dump button in dock on this screen.
8. **NO "Recent Entries" section**

## Routes
- `/home` → `src/pages/Home.tsx` (authenticated only)
- Post-login redirect goes to `/home`
- Landing page (`/`) redirects logged-in users to `/home`

## Settings
- "Home" added as a default_view option in SettingsDialog
- When default_view === 'home', auth redirects to /home

## Navigation
- `/app?view=today` — pre-selects Today's To-Do
- `/app?view=past-due` — pre-selects Past Due
- `/app?view=projects` — opens projects sidebar

## Future
- Warm color palette theme change (separate task)

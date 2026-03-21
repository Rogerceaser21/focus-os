

## Plan: Remove ThemeSyncer Component

Remove the `ThemeSyncer` component entirely from the codebase. This eliminates one `onAuthStateChange` subscription and its async DB query inside the callback — one of the identified causes of the auth deadlock.

### Changes

1. **Delete `src/components/ThemeSyncer.tsx`**

2. **`src/App.tsx`** — Remove the ThemeSyncer import and `<ThemeSyncer />` from the render tree

That's it. Two changes, nothing else touched.


# FocusOS Migration Plan
## Migrating from `ujwmqwmsqklocvzlqpbm` → `mshlbsgsyzzfxyxramjj`

---

## Phase 1: Set up new project ⬜
- [ ] **1a.** User provides anon key for `mshlbsgsyzzfxyxramjj`
- [ ] **1b.** Update `.env` — change `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- [ ] **1c.** Update `supabase/config.toml` — change `project_id`
- [ ] **1d.** Run `focusos_combined_migration.sql` in new project's SQL Editor to create all `focusos_` tables, triggers, RLS policies, and onboarding functions

## Phase 2: Migrate data ⬜
- [ ] **2a.** User exports 6 CSVs from old project (`ujwmqwmsqklocvzlqpbm`):
  - `projects` → will become `focusos_projects`
  - `tasks` → will become `focusos_tasks`
  - `meetings` → will become `focusos_meetings`
  - `profiles` → will become `focusos_profiles`
  - `user_preferences` → will become `focusos_user_preferences`
  - `recording_sessions` → will become `focusos_recording_sessions`
- [ ] **2b.** User uploads CSVs here
- [ ] **2c.** AI writes INSERT statements mapping old data → new `focusos_` tables (preserving all IDs and relationships)
- [ ] **2d.** Run inserts against new project

## Phase 3: Google OAuth ⬜ (user does this)
- [ ] **3a.** Google Cloud Console → Credentials → OAuth client → add redirect URI:
  `https://mshlbsgsyzzfxyxramjj.supabase.co/auth/v1/callback`
- [ ] **3b.** Supabase Dashboard (`mshlbsgsyzzfxyxramjj`) → Authentication → Providers → Google → add OAuth client ID + secret

## Phase 4: Edge function secrets ⬜ (user does this)
- [ ] **4a.** Supabase Dashboard → Edge Functions → Secrets → add:
  - `GEMINI_API_KEY`
  - `GCS_SERVICE_ACCOUNT_KEY`
  - `GCS_BUCKET_NAME`
  - `RESEND_API_KEY`

## Phase 5: Verify ⬜ (both)
- [ ] **5a.** Test Google sign-in works
- [ ] **5b.** Test creating tasks, projects, meetings
- [ ] **5c.** Confirm migrated data appears correctly
- [ ] **5d.** Confirm edge functions respond (brain dump, meeting recording, etc.)

---

## Notes
- Export CSVs BEFORE switching the connection so we don't lose access to old data
- Column names are the same between old and new tables, only table names changed (added `focusos_` prefix)
- Edge functions are already prefixed with `focusos-` in the codebase
- All frontend code already uses `focusos_` table names via `(supabase as any).from('focusos_...')`

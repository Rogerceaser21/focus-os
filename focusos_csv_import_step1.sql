-- ============================================================
-- FocusOS CSV Import Helper
-- Run STEP 1 BEFORE importing CSVs
-- Run STEP 2 AFTER importing all CSVs
-- ============================================================

-- ========================
-- STEP 1: Drop FK constraints so CSVs with old UUIDs can be imported
-- Run this BEFORE importing CSVs
-- ========================

ALTER TABLE public.focusos_tasks DROP CONSTRAINT IF EXISTS focusos_tasks_user_id_fkey;
ALTER TABLE public.focusos_tasks DROP CONSTRAINT IF EXISTS focusos_tasks_project_id_fkey;
ALTER TABLE public.focusos_tasks DROP CONSTRAINT IF EXISTS focusos_tasks_meeting_id_fkey;
ALTER TABLE public.focusos_projects DROP CONSTRAINT IF EXISTS focusos_projects_user_id_fkey;
ALTER TABLE public.focusos_meetings DROP CONSTRAINT IF EXISTS focusos_meetings_user_id_fkey;
ALTER TABLE public.focusos_meetings DROP CONSTRAINT IF EXISTS focusos_meetings_project_id_fkey;
ALTER TABLE public.focusos_profiles DROP CONSTRAINT IF EXISTS focusos_profiles_user_id_fkey;
ALTER TABLE public.focusos_user_preferences DROP CONSTRAINT IF EXISTS focusos_user_preferences_user_id_fkey;
ALTER TABLE public.focusos_recording_sessions DROP CONSTRAINT IF EXISTS focusos_recording_sessions_user_id_fkey;

-- Also temporarily disable RLS so imports don't fail on policy checks
ALTER TABLE public.focusos_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_user_preferences DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_meetings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_recording_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_tasks DISABLE ROW LEVEL SECURITY;

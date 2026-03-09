-- ============================================================
-- FocusOS Combined Migration Script
-- Run this in your Supabase SQL Editor (mshlbsgsyzzfxyxramjj)
-- All tables prefixed with focusos_ to avoid conflicts
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.focusos_handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- TABLE: focusos_projects
-- ============================================================

CREATE TABLE public.focusos_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.focusos_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focusos_users_can_view_own_projects"
  ON public.focusos_projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_create_own_projects"
  ON public.focusos_projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_update_own_projects"
  ON public.focusos_projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_delete_own_projects"
  ON public.focusos_projects FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_focusos_projects_updated_at
  BEFORE UPDATE ON public.focusos_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();

-- ============================================================
-- TABLE: focusos_tasks
-- ============================================================

CREATE TABLE public.focusos_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.focusos_projects(id) ON DELETE SET NULL,
  meeting_id UUID,  -- FK added after focusos_meetings is created
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  due_date TIMESTAMP WITH TIME ZONE,
  images JSONB DEFAULT '[]'::jsonb,
  timer_total_seconds INTEGER NOT NULL DEFAULT 0,
  timer_is_running BOOLEAN NOT NULL DEFAULT false,
  timer_start_time BIGINT,
  sort_order INTEGER DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  assigned_to_email TEXT,
  share_token UUID DEFAULT gen_random_uuid(),
  completed_by_email TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.focusos_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focusos_users_can_view_own_tasks"
  ON public.focusos_tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_create_own_tasks"
  ON public.focusos_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_update_own_tasks"
  ON public.focusos_tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_delete_own_tasks"
  ON public.focusos_tasks FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_focusos_tasks_updated_at
  BEFORE UPDATE ON public.focusos_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();

-- Enable realtime
ALTER TABLE public.focusos_tasks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.focusos_tasks;

-- Index for sort order
CREATE INDEX idx_focusos_tasks_sort_order ON public.focusos_tasks (user_id, priority, sort_order);

-- Index for share token
CREATE INDEX idx_focusos_tasks_share_token ON public.focusos_tasks (share_token);

-- Task completion trigger
CREATE OR REPLACE FUNCTION public.focusos_handle_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    NEW.completed_at = now();
  ELSIF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER focusos_on_task_status_change
  BEFORE UPDATE ON public.focusos_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_task_completion();

-- ============================================================
-- TABLE: focusos_user_preferences
-- ============================================================

CREATE TABLE public.focusos_user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  default_view TEXT NOT NULL DEFAULT 'today',
  default_display_mode TEXT NOT NULL DEFAULT 'list',
  default_task_filter TEXT NOT NULL DEFAULT 'all',
  default_task_card_view TEXT DEFAULT 'full' CHECK (default_task_card_view IN ('full', 'compact')),
  has_completed_onboarding BOOLEAN NOT NULL DEFAULT false,
  has_completed_task_tour BOOLEAN NOT NULL DEFAULT false,
  has_completed_projects_tour BOOLEAN NOT NULL DEFAULT false,
  theme TEXT NOT NULL DEFAULT 'dark',
  notify_due_date BOOLEAN NOT NULL DEFAULT false,
  notify_timer BOOLEAN NOT NULL DEFAULT false,
  timer_alert_interval_minutes INTEGER NOT NULL DEFAULT 45,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.focusos_user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focusos_users_can_view_own_preferences"
  ON public.focusos_user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_insert_own_preferences"
  ON public.focusos_user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_update_own_preferences"
  ON public.focusos_user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_focusos_user_preferences_updated_at
  BEFORE UPDATE ON public.focusos_user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();

-- ============================================================
-- TABLE: focusos_meetings
-- ============================================================

CREATE TABLE public.focusos_meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.focusos_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Meeting',
  duration_seconds INTEGER DEFAULT 0,
  summary TEXT,
  action_items JSONB DEFAULT '[]'::jsonb,
  participants JSONB DEFAULT '[]'::jsonb,
  transcript_gcs_path TEXT,
  recording_gcs_path TEXT,
  share_token UUID DEFAULT gen_random_uuid(),
  processing_status TEXT NOT NULL DEFAULT 'done',
  processing_error TEXT,
  gemini_file_uri TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.focusos_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focusos_users_can_view_own_meetings"
  ON public.focusos_meetings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_create_own_meetings"
  ON public.focusos_meetings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_update_own_meetings"
  ON public.focusos_meetings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_delete_own_meetings"
  ON public.focusos_meetings FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_focusos_meetings_updated_at
  BEFORE UPDATE ON public.focusos_meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();

CREATE INDEX idx_focusos_meetings_share_token ON public.focusos_meetings (share_token);

-- Now add the FK from tasks to meetings
ALTER TABLE public.focusos_tasks
  ADD CONSTRAINT focusos_tasks_meeting_id_fkey
  FOREIGN KEY (meeting_id) REFERENCES public.focusos_meetings(id) ON DELETE SET NULL;

CREATE INDEX idx_focusos_tasks_meeting_id ON public.focusos_tasks(meeting_id);

-- ============================================================
-- TABLE: focusos_profiles
-- ============================================================

CREATE TABLE public.focusos_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.focusos_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focusos_users_can_view_own_profile"
  ON public.focusos_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_insert_own_profile"
  ON public.focusos_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_update_own_profile"
  ON public.focusos_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_focusos_profiles_updated_at
  BEFORE UPDATE ON public.focusos_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();

-- Auto-create profile on new user signup
CREATE OR REPLACE FUNCTION public.focusos_handle_new_user_profile()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.focusos_profiles (user_id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER focusos_on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_new_user_profile();

-- ============================================================
-- TABLE: focusos_recording_sessions
-- ============================================================

CREATE TABLE public.focusos_recording_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  gcs_folder_path TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recording',
  mime_type TEXT NOT NULL DEFAULT 'audio/webm',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.focusos_recording_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "focusos_users_can_view_own_sessions"
  ON public.focusos_recording_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_create_own_sessions"
  ON public.focusos_recording_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_update_own_sessions"
  ON public.focusos_recording_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "focusos_users_can_delete_own_sessions"
  ON public.focusos_recording_sessions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_focusos_recording_sessions_updated_at
  BEFORE UPDATE ON public.focusos_recording_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();

-- ============================================================
-- ONBOARDING TRIGGER (creates sample project + tasks for new users)
-- ============================================================

CREATE OR REPLACE FUNCTION public.focusos_handle_new_user_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  INSERT INTO public.focusos_projects (user_id, name, color)
  VALUES (NEW.id, 'Try THIS Project', '#3b82f6')
  RETURNING id INTO new_project_id;

  INSERT INTO public.focusos_tasks (user_id, project_id, title, priority, due_date, status)
  VALUES 
    (NEW.id, new_project_id, 'Use the Purple microphone to add tasks to the Today''s to do list.', 'high', CURRENT_DATE, 'todo'),
    (NEW.id, new_project_id, 'Use the Green microphone to add Tasks to a particular Project (Group)', 'medium', CURRENT_DATE, 'todo'),
    (NEW.id, new_project_id, 'Use the Blue microphone to create a new Project with tasks.', 'low', CURRENT_DATE, 'todo');

  RETURN NEW;
END;
$$;

CREATE TRIGGER focusos_on_auth_user_created_onboarding
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_new_user_onboarding();

-- ============================================================
-- DONE! All tables and functions prefixed with focusos_
-- ============================================================

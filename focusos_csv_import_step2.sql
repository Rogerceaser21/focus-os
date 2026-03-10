-- ============================================================
-- STEP 2: Remap old user_ids to correct new ones, then restore constraints
-- Run this AFTER importing ALL CSVs
-- ============================================================

-- Create temporary mapping of old_user_id → email
CREATE TEMP TABLE old_user_map (old_id UUID, email TEXT);
INSERT INTO old_user_map VALUES
('4f97eb51-30fb-4cb0-b82e-10b40eea090e', 't.oliva@outlook.es'),
('6a1e1a18-d517-4864-a850-245f1f409757', 'stephenjames7025@hotmail.co.uk'),
('cb0f9ba7-cbbf-458e-9cbd-7ab047352a8c', 'charlotte.hilton@ais.ae'),
('c256a26d-5daf-42d9-a34b-8070b8b8decf', 'toby.ayres@gmail.com'),
('4b27bb68-0c45-4fcd-96d2-41f3d22ac2e3', 'jasmina.sesar1@outlook.com'),
('9ad083ff-2a17-4a8b-a309-5b8894e10126', 'boyd.telford@ais.ae'),
('137f60f8-c870-44a8-87f7-5e202cf9c65b', 'arezoo.alavi@gmail.com'),
('35c41be3-1a20-450a-ae0f-0cfb9d7822ed', 'sara.seifen@ais.ae'),
('d78e4c0a-bcdc-4c93-9a3f-2d0f68665409', 'alisja.debruyn@ais.ae'),
('d0eb1596-7704-4bdf-b2de-a96d96172677', 'lauren.jordaan@ais.ae'),
('6b5a4910-b0ef-4926-9554-c9b3a460b111', 'odene.truter@ais.ae'),
('4feaa2b6-73b0-4e42-ad6a-301c2c38a561', 'brooke.pickett@ais.ae'),
('37682c71-cc67-4c17-bf65-0a5d33c6cc43', 'andrew.brown@ais.ae'),
('c5ba00c7-c167-4644-b8fe-4db632cb251e', 'ava.alavi@gmail.com'),
('774d56f9-f81b-46c6-9a1f-30c94e244cd8', 'igor.sesar@ais.ae'),
('fc803ed5-0c10-449f-b3d9-a1122c0a9c11', 'toby.ayres@ais.ae');

-- Remap user_ids in all focusos_ tables
UPDATE public.focusos_profiles p
SET user_id = au.id
FROM old_user_map m
JOIN auth.users au ON au.email = m.email
WHERE p.user_id = m.old_id AND m.old_id != au.id;

UPDATE public.focusos_user_preferences up
SET user_id = au.id
FROM old_user_map m
JOIN auth.users au ON au.email = m.email
WHERE up.user_id = m.old_id AND m.old_id != au.id;

UPDATE public.focusos_projects pr
SET user_id = au.id
FROM old_user_map m
JOIN auth.users au ON au.email = m.email
WHERE pr.user_id = m.old_id AND m.old_id != au.id;

UPDATE public.focusos_meetings mt
SET user_id = au.id
FROM old_user_map m
JOIN auth.users au ON au.email = m.email
WHERE mt.user_id = m.old_id AND m.old_id != au.id;

UPDATE public.focusos_recording_sessions rs
SET user_id = au.id
FROM old_user_map m
JOIN auth.users au ON au.email = m.email
WHERE rs.user_id = m.old_id AND m.old_id != au.id;

UPDATE public.focusos_tasks t
SET user_id = au.id
FROM old_user_map m
JOIN auth.users au ON au.email = m.email
WHERE t.user_id = m.old_id AND m.old_id != au.id;

-- Drop temp table
DROP TABLE old_user_map;

-- Re-add FK constraints
ALTER TABLE public.focusos_profiles
  ADD CONSTRAINT focusos_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.focusos_user_preferences
  ADD CONSTRAINT focusos_user_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.focusos_projects
  ADD CONSTRAINT focusos_projects_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.focusos_meetings
  ADD CONSTRAINT focusos_meetings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.focusos_recording_sessions
  ADD CONSTRAINT focusos_recording_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.focusos_tasks
  ADD CONSTRAINT focusos_tasks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.focusos_tasks
  ADD CONSTRAINT focusos_tasks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.focusos_projects(id) ON DELETE SET NULL;

ALTER TABLE public.focusos_tasks
  ADD CONSTRAINT focusos_tasks_meeting_id_fkey
  FOREIGN KEY (meeting_id) REFERENCES public.focusos_meetings(id) ON DELETE SET NULL;

-- Re-enable RLS
ALTER TABLE public.focusos_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_recording_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focusos_tasks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DONE! All user_ids remapped and constraints restored.
-- ============================================================

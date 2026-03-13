INSERT INTO public.focusos_profiles (user_id, user_email, first_name, last_name)
SELECT fu.user_id, fu.email, NULL, NULL
FROM public.focusos_users fu
WHERE NOT EXISTS (
  SELECT 1 FROM public.focusos_profiles fp WHERE fp.user_id = fu.user_id
);
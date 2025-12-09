-- Create the onboarding function that runs when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  -- Create the "Try THIS Project" project
  INSERT INTO public.projects (user_id, name, color)
  VALUES (NEW.id, 'Try THIS Project', '#3b82f6')
  RETURNING id INTO new_project_id;

  -- Create the 3 instructional tasks
  INSERT INTO public.tasks (user_id, project_id, title, priority, due_date, status)
  VALUES 
    (NEW.id, new_project_id, 'Use the Purple microphone to add tasks to the Today''s to do list.', 'high', CURRENT_DATE, 'todo'),
    (NEW.id, new_project_id, 'Use the Green microphone to add Tasks to a particular Project (Group)', 'medium', CURRENT_DATE, 'todo'),
    (NEW.id, new_project_id, 'Use the Blue microphone to create a new Project with tasks.', 'low', CURRENT_DATE, 'todo');

  RETURN NEW;
END;
$$;

-- Create the trigger on auth.users
CREATE TRIGGER on_auth_user_created_onboarding
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_onboarding();
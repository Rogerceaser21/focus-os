-- Create user_preferences table to store user settings
create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  default_view text not null default 'today',
  default_display_mode text not null default 'list',
  default_task_filter text not null default 'all',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(user_id)
);

-- Enable RLS
alter table public.user_preferences enable row level security;

-- RLS Policies
create policy "Users can view their own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert their own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);

-- Add trigger for updated_at
create trigger update_user_preferences_updated_at
  before update on public.user_preferences
  for each row
  execute function public.handle_updated_at();
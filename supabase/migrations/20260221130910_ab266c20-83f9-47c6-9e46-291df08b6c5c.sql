
ALTER TABLE public.user_preferences 
ADD COLUMN notify_due_date boolean NOT NULL DEFAULT false,
ADD COLUMN notify_timer boolean NOT NULL DEFAULT false,
ADD COLUMN timer_alert_interval_minutes integer NOT NULL DEFAULT 45;

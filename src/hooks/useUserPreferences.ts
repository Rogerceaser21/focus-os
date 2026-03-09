import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface UserPreferences {
  id: string;
  user_id: string;
  default_view: string;
  default_display_mode: 'list' | 'grid' | 'gantt' | 'time';
  default_task_filter: 'all' | 'todo' | 'in-progress' | 'completed';
  default_task_card_view: 'full' | 'compact';
  theme: 'dark' | 'light';
  has_completed_onboarding: boolean;
  has_completed_task_tour: boolean;
  has_completed_projects_tour: boolean;
  notify_due_date: boolean;
  notify_timer: boolean;
  timer_alert_interval_minutes: number;
  created_at: string;
  updated_at: string;
}

export const useUserPreferences = (userId?: string | null) => {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPreferences = async (uid: string) => {
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        await createDefaultPreferences(uid);
      } else {
        setPreferences(data as UserPreferences);
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
      toast.error('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  };

  const createDefaultPreferences = async (uid: string) => {
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .insert({
          user_id: uid,
          default_view: 'today',
          default_display_mode: 'list',
          default_task_filter: 'all',
          default_task_card_view: 'full',
          theme: 'dark',
          has_completed_onboarding: false,
          has_completed_task_tour: false,
          has_completed_projects_tour: false
        })
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error creating default preferences:', error);
    }
  };

  const markOnboardingComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_onboarding: true })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error marking onboarding complete:', error);
    }
  };

  const markTaskTourComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_task_tour: true })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error marking task tour complete:', error);
    }
  };

  const markProjectsTourComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_projects_tour: true })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error marking projects tour complete:', error);
    }
  };

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    if (!userId || !preferences) return;
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      setPreferences(data as UserPreferences);
      toast.success('Preferences saved successfully');
    } catch (error) {
      console.error('Error updating preferences:', error);
      toast.error('Failed to save preferences');
    }
  };

  useEffect(() => {
    if (userId) {
      setLoading(true);
      fetchPreferences(userId);
    } else {
      setLoading(false);
    }
  }, [userId]);

  return { preferences, loading, updatePreferences, markOnboardingComplete, markTaskTourComplete, markProjectsTourComplete };
};

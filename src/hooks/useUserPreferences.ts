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
  has_completed_onboarding: boolean;
  has_completed_task_tour: boolean;
  created_at: string;
  updated_at: string;
}

export const useUserPreferences = () => {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // Create default preferences
        await createDefaultPreferences(user.id);
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

  const createDefaultPreferences = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .insert({
          user_id: userId,
          default_view: 'today',
          default_display_mode: 'list',
          default_task_filter: 'all',
          default_task_card_view: 'full',
          has_completed_onboarding: false,
          has_completed_task_tour: false
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
    // Silently update onboarding status without showing toast
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !preferences) return;

      const { data, error } = await supabase
        .from('user_preferences')
        .update({ has_completed_onboarding: true })
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error marking onboarding complete:', error);
    }
  };

  const markTaskTourComplete = async () => {
    // Silently update task tour status without showing toast
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !preferences) return;

      const { data, error } = await supabase
        .from('user_preferences')
        .update({ has_completed_task_tour: true })
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error marking task tour complete:', error);
    }
  };

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !preferences) return;

      const { data, error } = await supabase
        .from('user_preferences')
        .update(updates)
        .eq('user_id', user.id)
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
    fetchPreferences();
  }, []);

  return { preferences, loading, updatePreferences, markOnboardingComplete, markTaskTourComplete };
};

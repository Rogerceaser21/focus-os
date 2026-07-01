import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface UserPreferences {
  id: string;
  user_id: string;
  default_view: string;
  default_display_mode: 'list' | 'grid' | 'gantt' | 'time';
  default_task_filter: 'all' | 'todo' | 'in-progress' | 'completed';
  default_task_card_view: 'full' | 'compact' | 'minimal';
  default_task_card_view_mobile: 'full' | 'compact' | 'minimal';
  theme: 'dark' | 'light' | 'cream';
  has_completed_onboarding: boolean;
  has_completed_task_tour: boolean;
  has_completed_projects_tour: boolean;
  has_completed_home_tour: boolean;
  has_completed_meetings_tour: boolean;
  notify_due_date: boolean;
  notify_timer: boolean;
  timer_alert_interval_minutes: number;
  ai_handoff_default_provider: 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | null;
  ai_handoff_image_mode: 'public_link' | 'clipboard' | 'skip';
  created_at: string;
  updated_at: string;
}

export const useUserPreferences = (userId?: string | null) => {
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPreferences = async (uid: string) => {
    const delays = [0, 300, 800, 1500];
    let data: any = null;
    let error: any = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
      const res = await (supabase as any)
        .from('focusos_user_preferences')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      data = res.data;
      error = res.error;
      if (!error) break;
    }
    if (error) {
      console.warn('Failed to load preferences after retries:', error);
    } else if (!data) {
      await createDefaultPreferences(uid);
    } else {
      setPreferences(data as UserPreferences);
      if (data.theme) setTheme(data.theme);
    }
    setLoading(false);
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
          default_task_card_view: 'compact',
          default_task_card_view_mobile: 'minimal',
          theme: 'cream',
          has_completed_onboarding: false,
          has_completed_task_tour: false,
          has_completed_projects_tour: false,
          has_completed_home_tour: false,
          has_completed_meetings_tour: false
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

  const markHomeTourComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_home_tour: true })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
    } catch (error) {
      console.error('Error marking home tour complete:', error);
    }
  };

  const markMeetingsTourComplete = async () => {
    if (!userId) return null;

    const previousPreferences = preferences;
    setPreferences(current => current ? { ...current, has_completed_meetings_tour: true } : current);

    try {
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_meetings_tour: true })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      setPreferences(data as UserPreferences);
      return data as UserPreferences;
    } catch (error) {
      if (previousPreferences) setPreferences(previousPreferences);
      console.error('Error marking meetings tour complete:', error);
      return null;
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
      const { data, error } = await (supabase as any)
        .from('focusos_user_preferences')
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
      const cached = queryClient.getQueryData(['focusos-preferences', userId]);
      if (cached) {
        setPreferences(cached as UserPreferences);
        if ((cached as any).theme) setTheme((cached as any).theme);
        setLoading(false);
        fetchPreferences(userId);
      } else {
        setLoading(true);
        fetchPreferences(userId);
      }
    } else {
      setLoading(false);
    }
  }, [userId, queryClient]);

  return { preferences, loading, updatePreferences, markOnboardingComplete, markTaskTourComplete, markProjectsTourComplete, markHomeTourComplete, markMeetingsTourComplete };
};

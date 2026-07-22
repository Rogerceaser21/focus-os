import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  APP_DATA_STALE_TIME,
  appDataKeys,
  loadPreferences,
  ensureDefaultPreferences,
} from '@/lib/appDataFetchers';

export interface UserPreferences {
  id: string;
  user_id: string;
  default_view: string;
  default_display_mode: 'list' | 'grid' | 'gantt' | 'time';
  default_task_filter: 'all' | 'todo' | 'in-progress' | 'completed';
  default_task_card_view: 'full' | 'compact' | 'minimal';
  default_task_card_view_mobile: 'full' | 'compact' | 'minimal';
  /** Legacy column. Liquid Glass is the only theme now; the DB value is ignored. */
  theme: string;
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

// Preferences read through a single shared query key. Every hook instance (Index,
// BottomNav, and one per TaskCard / TaskListItem / dialog) subscribes to the SAME
// cache entry, so N instances collapse to ONE request and every write (setQueryData)
// propagates to all of them. Replaces the old per-instance useState + fetch-on-mount,
// which fetched focusos_user_preferences once per mounted instance.
export const useUserPreferences = (userId?: string | null) => {
  const queryClient = useQueryClient();
  const prefKey = appDataKeys.preferences(userId ?? '');

  const { data, isLoading } = useQuery({
    queryKey: prefKey,
    queryFn: () => loadPreferences(userId as string),
    enabled: !!userId,
    staleTime: APP_DATA_STALE_TIME,
  });

  const preferences = (data ?? null) as UserPreferences | null;

  // Brand-new account: loadPreferences resolved to null (no row). Create the default
  // row exactly once — single-flight across every instance via the module guard.
  useEffect(() => {
    if (!userId) return;
    if (data === null) {
      ensureDefaultPreferences(queryClient, userId).catch((error) =>
        console.error('Error creating default preferences:', error),
      );
    }
  }, [userId, data, queryClient]);

  const markOnboardingComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data: updated, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_onboarding: true })
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      queryClient.setQueryData(prefKey, updated);
    } catch (error) {
      console.error('Error marking onboarding complete:', error);
    }
  };

  const markTaskTourComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data: updated, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_task_tour: true })
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      queryClient.setQueryData(prefKey, updated);
    } catch (error) {
      console.error('Error marking task tour complete:', error);
    }
  };

  const markHomeTourComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data: updated, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_home_tour: true })
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      queryClient.setQueryData(prefKey, updated);
    } catch (error) {
      console.error('Error marking home tour complete:', error);
    }
  };

  const markMeetingsTourComplete = async () => {
    if (!userId) return null;

    const previous = queryClient.getQueryData(prefKey) as UserPreferences | null;
    // Optimistic — flip locally so the tour dismisses instantly.
    queryClient.setQueryData(prefKey, (current: any) =>
      current ? { ...current, has_completed_meetings_tour: true } : current,
    );

    try {
      const { data: updated, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_meetings_tour: true })
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      queryClient.setQueryData(prefKey, updated);
      return updated as UserPreferences;
    } catch (error) {
      if (previous) queryClient.setQueryData(prefKey, previous);
      console.error('Error marking meetings tour complete:', error);
      return null;
    }
  };

  const markProjectsTourComplete = async () => {
    if (!userId || !preferences) return;
    try {
      const { data: updated, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update({ has_completed_projects_tour: true })
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      queryClient.setQueryData(prefKey, updated);
    } catch (error) {
      console.error('Error marking projects tour complete:', error);
    }
  };

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    if (!userId || !preferences) return;
    try {
      const { data: updated, error } = await (supabase as any)
        .from('focusos_user_preferences')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      queryClient.setQueryData(prefKey, updated);
      toast.success('Preferences saved successfully');
    } catch (error) {
      console.error('Error updating preferences:', error);
      toast.error('Failed to save preferences');
    }
  };

  return {
    preferences,
    loading: isLoading,
    updatePreferences,
    markOnboardingComplete,
    markTaskTourComplete,
    markProjectsTourComplete,
    markHomeTourComplete,
    markMeetingsTourComplete,
  };
};

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  APP_DATA_STALE_TIME,
  APP_DATA_GC_TIME,
  appDataKeys,
  loadPreferences,
  ensureDefaultPreferences,
} from '@/lib/appDataFetchers';
import {
  connectWallpaperSync,
  reconcileWallpaperPrefs,
  type WallpaperPrefs,
} from '@/lib/wallpaper';

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
  /** The account's wallpaper choice (jsonb, null = never synced). The device
   *  cache in src/lib/wallpaper.tsx still owns first paint; this column is what
   *  makes the choice follow the account onto another device. */
  wallpaper_prefs?: WallpaperPrefs | null;
  created_at: string;
  updated_at: string;
}

// Wallpaper reconciliation is once per account per session, the same
// single-flight shape as ensureDefaultPreferences, because every mounted
// useUserPreferences instance (Index, BottomNav, one per card) runs this effect.
const wallpaperReconciled = new Set<string>();

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
    gcTime: APP_DATA_GC_TIME,
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

  // `silent` is for writes the user did not press Save for (the wallpaper choice
  // syncs itself on every pick). The row still updates, it just does not
  // announce itself with the Settings toast.
  const updatePreferences = async (
    updates: Partial<UserPreferences>,
    opts?: { silent?: boolean },
  ) => {
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
      if (!opts?.silent) toast.success('Preferences saved successfully');
    } catch (error) {
      console.error('Error updating preferences:', error);
      if (!opts?.silent) toast.error('Failed to save preferences');
    }
  };

  // Wallpaper account sync (see the "Account sync" block in src/lib/wallpaper.tsx).
  // Post-paint by design: the device cache already painted from localStorage
  // during render, and the account's copy cannot be known before the network
  // answers, so this is a genuine late arrival, not a post-paint correction of
  // something that was derivable (house render-phase laws). It adds no state to
  // any load path; the swap, if there is one, goes through the wallpaper setters.
  useEffect(() => {
    if (!userId || !preferences) return;
    const push = (prefs: WallpaperPrefs) => {
      void updatePreferences({ wallpaper_prefs: prefs }, { silent: true });
    };
    connectWallpaperSync(userId, push);
    if (wallpaperReconciled.has(userId)) return;
    wallpaperReconciled.add(userId);
    reconcileWallpaperPrefs(userId, preferences.wallpaper_prefs, push).catch((error) => {
      wallpaperReconciled.delete(userId);
      console.error('Error syncing wallpaper preferences:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, preferences]);

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

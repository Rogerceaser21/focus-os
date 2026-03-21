import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Silently prefetches all data that /app and /meetings will need,
 * warming the React Query cache so navigation feels instant.
 * No UI impact — no loading states, no spinners.
 */
export const usePrefetchAppData = (userId?: string | null) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // Prefetch all tasks
    queryClient.prefetchQuery({
      queryKey: ['focusos-all-tasks', userId],
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('focusos_tasks')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000, // 5 min
    });

    // Prefetch all projects
    queryClient.prefetchQuery({
      queryKey: ['focusos-projects', userId],
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('focusos_projects')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch sender shared items
    queryClient.prefetchQuery({
      queryKey: ['focusos-sender-shared-items', userId],
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('focusos_shared_items')
          .select('id, item_id, item_type, recipient_email, recipient_user_id, recipient_task_id, status')
          .eq('sender_user_id', userId)
          .in('item_type', ['task', 'project'])
          .neq('status', 'cancelled');
        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch meetings
    queryClient.prefetchQuery({
      queryKey: ['focusos-meetings', userId],
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('focusos_meetings')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch user preferences
    queryClient.prefetchQuery({
      queryKey: ['focusos-preferences', userId],
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('focusos_user_preferences')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      staleTime: 5 * 60 * 1000,
    });
  }, [userId, queryClient]);
};

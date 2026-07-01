import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const RETRY_DELAYS = [0, 300, 800, 1500];

async function retryQuery<T>(fn: () => Promise<{ data: T | null; error: any }>): Promise<T | null> {
  let data: T | null = null;
  let error: any = null;
  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    if (RETRY_DELAYS[i] > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
    const res = await fn();
    data = res.data;
    error = res.error;
    if (!error) break;
  }
  if (error) throw error;
  return data;
}

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
        const data = await retryQuery(() =>
          (supabase as any)
            .from('focusos_tasks')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1000)
        );
        return data || [];
      },
      staleTime: 5 * 60 * 1000, // 5 min
    });

    // Prefetch all projects
    queryClient.prefetchQuery({
      queryKey: ['focusos-projects', userId],
      queryFn: async () => {
        const data = await retryQuery(() =>
          (supabase as any)
            .from('focusos_projects')
            .select('*')
            .order('created_at', { ascending: false })
        );
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch sender shared items
    queryClient.prefetchQuery({
      queryKey: ['focusos-sender-shared-items', userId],
      queryFn: async () => {
        const data = await retryQuery(() =>
          (supabase as any)
            .from('focusos_shared_items')
            .select('id, item_id, item_type, recipient_email, recipient_user_id, recipient_task_id, status')
            .eq('sender_user_id', userId)
            .in('item_type', ['task', 'project'])
            .neq('status', 'cancelled')
        );
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch meetings
    queryClient.prefetchQuery({
      queryKey: ['focusos-meetings', userId],
      queryFn: async () => {
        const data = await retryQuery(() =>
          (supabase as any)
            .from('focusos_meetings')
            .select('*')
            .order('created_at', { ascending: false })
        );
        return data || [];
      },
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch user preferences
    queryClient.prefetchQuery({
      queryKey: ['focusos-preferences', userId],
      queryFn: async () => {
        const data = await retryQuery(() =>
          (supabase as any)
            .from('focusos_user_preferences')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle()
        );
        return data;
      },
      staleTime: 5 * 60 * 1000,
    });
  }, [userId, queryClient]);
};

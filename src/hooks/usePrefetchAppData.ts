import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  APP_DATA_STALE_TIME,
  APP_DATA_GC_TIME,
  prefetchTasks,
  prefetchCompletedTasks,
  prefetchProjects,
  prefetchPreferences,
  prefetchSenderSharedItems,
} from '@/lib/appDataFetchers';

/**
 * Silently prefetches all data that /app and /meetings will need,
 * warming the React Query cache so navigation feels instant.
 * No UI impact — no loading states, no spinners.
 *
 * Tasks / projects / preferences all route through the shared single-flight fetchers
 * (src/lib/appDataFetchers) under the same keys Index and ProjectSidebar peek, so a
 * prefetch that is still in flight when the user reaches /app is REUSED, not raced.
 * Member ids are warmed as a side effect of the task/project loaders (same shared key).
 */
export const usePrefetchAppData = (userId?: string | null) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // Shared single-flight loads (own + shared merged under the shared keys).
    prefetchTasks(queryClient, userId);
    // Completed tasks warm the Done view; kept off the /app critical path by loading them
    // here on Home (background), so /app's deferred completed-hydration reuses this cache.
    prefetchCompletedTasks(queryClient, userId);
    prefetchProjects(queryClient, userId);
    prefetchPreferences(queryClient, userId);

    // Prefetch sender shared items (Index's warm-path peek AND Home's own useQuery
    // both read appDataKeys.senderSharedItems, O3 fix-round, 2026-08-23).
    prefetchSenderSharedItems(queryClient, userId);

    // Prefetch meetings
    queryClient.prefetchQuery({
      queryKey: ['focusos-meetings', userId],
      queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('focusos_meetings')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (error) throw error; // don't cache a bad-empty on a cold-start error
        return data || [];
      },
      staleTime: APP_DATA_STALE_TIME,
      gcTime: APP_DATA_GC_TIME,
    });
  }, [userId, queryClient]);
};

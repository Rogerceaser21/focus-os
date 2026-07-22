import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { APP_DATA_STALE_TIME } from '@/lib/appDataFetchers';
import { toast } from 'sonner';

interface PushArgs {
  taskIds?: string[];
  meetingIds?: string[];
  action?: 'sync' | 'unsync';
  attendees?: string[];
  sendInvites?: boolean;
  recipientUserId?: string;
  silent?: boolean;
  calendarPlacement?: {
    allDay: boolean;
    date?: string;
    startDateTime?: string;
    endDateTime?: string;
    timeZone?: string;
  };
  title?: string;
  description?: string;
}

export function useGoogleCalendar() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  // This hook mounts once per task row (GoogleCalendarButton in TaskListItem/TaskCard),
  // so per-instance work here MUST be network-free: getSession reads localStorage
  // (getUser hit /auth/v1/user per row — 217 calls on one /app remount, live-measured),
  // and the connected check is single-flighted through a shared 5-min cache key.
  const refresh = useCallback(async (opts?: { fresh?: boolean }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) { setIsConnected(false); return; }
    try {
      const connected = await queryClient.fetchQuery({
        queryKey: ['focusos-google-connected', uid],
        queryFn: async () => {
          const { data } = await supabase
            .from('focusos_google_tokens')
            .select('user_id')
            .eq('user_id', uid)
            .maybeSingle();
          return !!data;
        },
        staleTime: opts?.fresh ? 0 : APP_DATA_STALE_TIME,
      });
      setIsConnected(connected);
    } catch {
      setIsConnected(false);
    }
  }, [queryClient]);

  useEffect(() => { refresh(); }, [refresh]);

  const push = useCallback(async (args: PushArgs) => {
    if (isConnected === false) {
      toast.error('Connect Google Calendar in Settings first.');
      return { ok: false };
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-push-to-calendar', { body: args });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (!args.silent) {
        const verb = args.action === 'unsync' ? 'removed from' : 'sent to';
        toast.success(`${(args.taskIds?.length ?? 0) + (args.meetingIds?.length ?? 0)} item(s) ${verb} Google Calendar`);
      }
      return { ok: true, data };
    } catch (e: any) {
      console.error('push-to-calendar', e);
      toast.error(e?.message || 'Google Calendar sync failed');
      return { ok: false, error: e };
    } finally {
      setBusy(false);
    }
  }, [isConnected]);

  return { isConnected, busy, refresh, push };
}
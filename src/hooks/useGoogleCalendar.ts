import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PushArgs {
  taskIds?: string[];
  meetingIds?: string[];
  action?: 'sync' | 'unsync';
  attendees?: string[];
  sendInvites?: boolean;
  recipientUserId?: string;
  silent?: boolean;
}

export function useGoogleCalendar() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIsConnected(false); return; }
    const { data } = await supabase
      .from('focusos_google_tokens')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    setIsConnected(!!data);
  }, []);

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
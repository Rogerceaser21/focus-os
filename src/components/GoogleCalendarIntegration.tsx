import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Calendar, Loader2, CheckCircle2 } from 'lucide-react';
import { SHELL_CAL } from '@/lib/shell';
import {
  postShellOauthUrl,
  SHELL_CALENDAR_CONNECTED_EVENT,
  SHELL_OAUTH_SETTLED_EVENT,
} from '@/lib/shellOauth';

interface TokenRow {
  user_id: string;
  expires_at: string;
  focusos_calendar_id: string | null;
  updated_at: string;
}

export default function GoogleCalendarIntegration() {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [token, setToken] = useState<TokenRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('focusos_google_tokens')
      .select('user_id, expires_at, focusos_calendar_id, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    setToken(data ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Poll once on focus (callback opens in popup; user returns here)
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Shell only: the consent runs in a native sheet outside this webview, so
  // there is no popup to watch and no window 'focus' to trust. The bridge
  // reports back instead — connected on focusos://calendar-done, settled on a
  // cancel or an unusable bridge (src/lib/shellOauth.ts).
  useEffect(() => {
    const onConnected = () => { setWorking(false); load(); };
    const onSettled = () => setWorking(false);
    window.addEventListener(SHELL_CALENDAR_CONNECTED_EVENT, onConnected);
    window.addEventListener(SHELL_OAUTH_SETTLED_EVENT, onSettled);
    return () => {
      window.removeEventListener(SHELL_CALENDAR_CONNECTED_EVENT, onConnected);
      window.removeEventListener(SHELL_OAUTH_SETTLED_EVENT, onSettled);
    };
  }, []);

  const handleConnect = async () => {
    // Shell build 3+: mobile:true makes the edge function mint a consent URL
    // whose callback 302s to focusos://calendar-done, which is what closes the
    // native sheet. No window.open here — a WKWebView popup would land on
    // Google's disallowed_useragent.
    if (SHELL_CAL) {
      setWorking(true);
      try {
        const { data, error } = await supabase.functions.invoke('focusos-google-oauth-start', {
          body: { mobile: true },
        });
        if (error) throw error;
        const url = (data as any)?.url;
        if (!url) throw new Error('No auth URL returned');
        // working stays true while the sheet is up; the bridge events above
        // clear it.
        postShellOauthUrl(url);
      } catch (e: any) {
        console.error(e);
        toast.error(e.message || 'Could not start Google sign-in');
        setWorking(false);
      }
      return;
    }

    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke('focusos-google-oauth-start');
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error('No auth URL returned');
      const popup = window.open(url, 'google-oauth', 'width=520,height=680');
      if (!popup) {
        // Popup blocked — fall back to same-tab redirect
        window.location.href = url;
        return;
      }
      // Watch for popup close, then refresh state
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          load();
        }
      }, 800);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Could not start Google sign-in');
    } finally {
      setWorking(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Existing Google events will remain in your calendar but will no longer sync.')) return;
    setWorking(true);
    try {
      const { error } = await supabase.functions.invoke('focusos-google-disconnect');
      if (error) throw error;
      toast.success('Google Calendar disconnected');
      setToken(null);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to disconnect');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label className="text-base font-semibold flex items-center gap-2">
        <Calendar className="h-4 w-4" /> Google Calendar
      </Label>
      <p className="text-sm text-muted-foreground">
        Send Focus OS tasks and meetings to a dedicated "Focus OS" calendar in your Google account.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking connection...
        </div>
      ) : token ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> Connected
          </div>
          <p className="text-xs text-muted-foreground">
            Calendar: {token.focusos_calendar_id ? 'Focus OS' : '(not yet created)'}<br/>
            Last updated: {new Date(token.updated_at).toLocaleString()}
          </p>
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={working}>
            {working ? 'Working...' : 'Disconnect'}
          </Button>
        </div>
      ) : (
        <Button onClick={handleConnect} disabled={working} size="sm">
          {working ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Opening Google…</> : 'Connect Google Calendar'}
        </Button>
      )}
    </div>
  );
}
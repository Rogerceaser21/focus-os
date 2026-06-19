import { useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GoogleConnected() {
  const [params] = useSearchParams();
  const status = params.get('status'); // 'success' | 'error'
  const message = params.get('message') || '';
  const success = status === 'success';

  useEffect(() => {
    // If opened in a popup, notify the opener and auto-close.
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage({ type: 'focusos-google-oauth', success }, window.location.origin);
      } catch {}
      const t = setTimeout(() => { try { window.close(); } catch {} }, 1500);
      return () => clearTimeout(t);
    }
  }, [success]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        {success ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500 mb-4" />
            <h1 className="text-xl font-semibold mb-2">Google Calendar Connected</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Your Google Calendar is now linked to Focus OS. You can close this window.
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
            <h1 className="text-xl font-semibold mb-2">Connection Failed</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {message || 'Something went wrong connecting your Google Calendar.'}
            </p>
          </>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to="/app">Return to Focus OS</Link>
        </Button>
      </div>
    </div>
  );
}
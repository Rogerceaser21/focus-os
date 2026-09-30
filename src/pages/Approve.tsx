import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/* /approve?token=... : the owner's one-click page from the approval email.
   Outside the approval gate and needs no sign-in (the function checks the
   token). Page load does ONE thing: a GET that says who is asking. Nothing is
   decided until a button is pressed. */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://mshlbsgsyzzfxyxramjj.supabase.co';
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zaGxic2dzeXp6Znh5eHJhbWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMyNDQ3NDEsImV4cCI6MjA1ODgyMDc0MX0.iyucDGqQuYmJbvejLpCEoSpHP--HsHMw1ZablfMQKmY';
const FN_URL = `${SUPABASE_URL}/functions/v1/focusos-decide-approval`;
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

type Request = { email: string; name?: string; status: string };
type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ask'; req: Request }
  | { kind: 'done'; req: Request; status: string; justDecided: boolean };

const readError = async (res: Response): Promise<string> => {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    /* fall through */
  }
  return 'This link could not be opened.';
};

const Approve = () => {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setView({ kind: 'error', message: 'This link is missing its token.' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          headers: HEADERS,
        });
        if (!res.ok) {
          if (!cancelled) setView({ kind: 'error', message: await readError(res) });
          return;
        }
        const req = (await res.json()) as Request;
        if (cancelled) return;
        setView(
          req.status === 'pending'
            ? { kind: 'ask', req }
            : { kind: 'done', req, status: req.status, justDecided: false },
        );
      } catch {
        if (!cancelled) setView({ kind: 'error', message: 'Could not reach the server. Try the link again.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const decide = async (action: 'approve' | 'decline') => {
    if (!token || view.kind !== 'ask') return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action }),
      });
      if (!res.ok) {
        setActionError(await readError(res));
      } else {
        const body = (await res.json()) as { status?: string };
        setView({
          kind: 'done',
          req: view.req,
          status: body.status ?? (action === 'approve' ? 'approved' : 'declined'),
          justDecided: true,
        });
      }
    } catch {
      setActionError('Could not reach the server. Try again.');
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md relative z-10 backdrop-blur-sm bg-card/90 border-2">
        <CardContent className="pt-6 space-y-4" data-testid="approve-card">
          <h2 className="text-2xl font-semibold leading-none tracking-tight">Focus OS</h2>
          {view.kind === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
          {view.kind === 'error' && <p className="text-sm text-muted-foreground">{view.message}</p>}
          {view.kind === 'ask' && (
            <>
              <p className="text-sm text-muted-foreground">Someone has asked for a Focus OS account.</p>
              <div className="rounded-lg border border-border/60 px-3 py-2">
                {view.req.name && <p className="text-sm font-medium">{view.req.name}</p>}
                <p className="text-sm text-muted-foreground">{view.req.email}</p>
              </div>
              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
              <div className="flex gap-2">
                <Button className="flex-1" disabled={busy} onClick={() => decide('approve')}>
                  Approve
                </Button>
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide('decline')}>
                  Decline
                </Button>
              </div>
            </>
          )}
          {view.kind === 'done' && (
            <p className="text-sm text-muted-foreground">
              {!view.justDecided
                ? `Already ${view.status}.`
                : view.status === 'approved'
                  ? `Approved. ${view.req.email} has been told by email.`
                  : view.status === 'declined'
                    ? 'Declined.'
                    : `Already ${view.status}.`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Approve;

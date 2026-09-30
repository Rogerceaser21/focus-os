import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppBootSkeleton } from '@/components/AppSkeletons';

/* Account-approval gate (layout route in App.tsx). Every NEW Focus OS account
   waits until the owner clicks Approve in an email. Signed out (or auth still
   resolving) renders the Outlet untouched, so each page's own redirect to
   /auth keeps working. Signed in: read the caller's own row in
   focusos_account_approvals; missing or pending asks focusos-request-approval
   once per session and shows the waiting screen; declined shows the declined
   screen. Read or network trouble with no cached approval shows a retry
   state, never the app.

   Approved accounts are remembered per user id in localStorage so a cold start
   with no network (or a slow one) opens the app at once; the row is still
   re-read in the background, and a pending/declined answer flips to that
   screen and clears the memory. This is a convenience only: the server and
   the database refuse unapproved accounts on their own. */

type Status = 'pending' | 'approved' | 'declined';
type GateState = 'checking' | Status | 'error';

// Session-scoped memory (module level, survives route changes): an account the
// server confirmed as approved in this page load is not re-queried, and the
// request is sent once per user.
const verifiedUsers = new Set<string>();
const requestedUsers = new Set<string>();
// In-flight request per user: React StrictMode (dev) and quick remounts can run
// two checks at once; they share one request instead of emailing twice.
const inFlightRequests = new Map<string, Promise<Status>>();

const requestApproval = (id: string): Promise<Status> => {
  const existing = inFlightRequests.get(id);
  if (existing) return existing;
  const p = (async () => {
    const res = await supabase.functions.invoke('focusos-request-approval', { body: {} });
    if (res.error) throw res.error;
    requestedUsers.add(id);
    return asStatus((res.data as { status?: unknown } | null)?.status) ?? 'pending';
  })().finally(() => inFlightRequests.delete(id));
  inFlightRequests.set(id, p);
  return p;
};

// Remembered approval, one key per user id (never a shared flag).
const CACHE_PREFIX = 'focusos-approved:';
const readCachedApproval = (id: string): boolean => {
  try {
    return localStorage.getItem(CACHE_PREFIX + id) === '1';
  } catch {
    return false;
  }
};
const writeCachedApproval = (id: string) => {
  try {
    localStorage.setItem(CACHE_PREFIX + id, '1');
  } catch {
    /* private mode / quota: the cache is optional */
  }
};
const clearCachedApproval = (id: string) => {
  try {
    localStorage.removeItem(CACHE_PREFIX + id);
  } catch {
    /* ignore */
  }
};
const clearAllCachedApprovals = () => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
};

// Sign-out (from any screen) forgets every remembered approval on this device.
// Module level so it is live from app start, whichever page does the sign-out.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') clearAllCachedApprovals();
});

const isApprovedLocally = (id: string) => verifiedUsers.has(id) || readCachedApproval(id);

const asStatus = (v: unknown): Status | null =>
  v === 'approved' || v === 'pending' || v === 'declined' ? v : null;

const ApprovalGate = () => {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  // Gate state is keyed by user id: a different user (sign-out then another
  // sign-in on the same device, no unmount) never inherits the last one's state.
  const [gate, setGate] = useState<{ id: string | null; value: GateState }>({
    id: userId,
    value: userId && isApprovedLocally(userId) ? 'approved' : 'checking',
  });
  const runRef = useRef(0);

  const check = useCallback(async (id: string) => {
    const run = ++runRef.current;
    const settle = (next: GateState) => {
      if (run !== runRef.current) return;
      if (next === 'approved') {
        verifiedUsers.add(id);
        writeCachedApproval(id);
      } else if (next === 'pending' || next === 'declined') {
        verifiedUsers.delete(id);
        clearCachedApproval(id);
      }
      setGate({ id, value: next });
    };
    if (verifiedUsers.has(id)) {
      settle('approved');
      return;
    }
    // A remembered approval keeps the app on screen while the row is re-read.
    const remembered = readCachedApproval(id);
    if (!remembered) setGate({ id, value: 'checking' });
    try {
      // focusos_account_approvals is not in the generated types file yet.
      const { data, error } = await supabase
        .from('focusos_account_approvals' as never)
        .select('status')
        .eq('user_id', id)
        .limit(1);
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as { status?: unknown }[];
      const status = asStatus(rows[0]?.status);
      if (status === 'approved' || status === 'declined') {
        settle(status);
        return;
      }
      // Missing or pending: make sure the owner has been asked (once).
      if (!requestedUsers.has(id)) {
        settle(await requestApproval(id));
        return;
      }
      settle('pending');
    } catch (err) {
      console.error('[ApprovalGate] check failed:', err);
      // Remembered approval + a failed re-read (offline, slow): keep the app.
      if (remembered && run === runRef.current) setGate({ id, value: 'approved' });
      else settle('error');
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      runRef.current++;
      return;
    }
    void check(userId);
  }, [userId, check]);

  // Signed out (or auth still resolving with no known user): the pages' own
  // redirect to /auth runs. A user is present: the app shows only once THIS
  // user is approved; until then the boot skeleton, never the app.
  // Test-only bypass. `import.meta.env.DEV` is a compile-time false in every
  // production build, so Vite drops this whole branch and the env name with it.
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_SKIP_APPROVAL === '1') return <Outlet />;
  if (!userId) return <Outlet />;
  const state: GateState =
    gate.id === userId ? gate.value : isApprovedLocally(userId) ? 'approved' : 'checking';
  if (state === 'approved') return <Outlet />;
  if (state === 'checking') {
    return (
      <div data-testid="approval-check">
        <AppBootSkeleton />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <GateShell title="Couldn't check your account" email={user?.email}>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <GateActions onCheck={() => void check(userId)} checkLabel="Retry" />
      </GateShell>
    );
  }
  if (state === 'declined') {
    return (
      <GateShell title="Access not approved" email={user?.email}>
        <p className="text-sm text-muted-foreground">
          Igor has not approved this account. If you think this is a mistake, contact him.
        </p>
        <GateActions />
      </GateShell>
    );
  }
  return (
    <GateShell title="Waiting for approval" email={user?.email}>
      <p className="text-sm text-muted-foreground">
        Thanks for signing up. Igor will be asked to approve your account. You'll get an email when
        it's done.
      </p>
      <GateActions onCheck={() => void check(userId)} checkLabel="Check again" />
    </GateShell>
  );
};

const GateShell = ({
  title,
  email,
  children,
}: {
  title: string;
  email?: string | null;
  children: React.ReactNode;
}) => (
  <div
    data-testid="approval-gate"
    className="min-h-screen relative flex items-center justify-center p-4 bg-background"
  >
    <Card className="w-full max-w-md relative z-10 backdrop-blur-sm bg-card/90 border-2">
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-1.5 text-left">
          <h2 className="text-2xl font-semibold leading-none tracking-tight">{title}</h2>
        </div>
        {children}
        {email && <p className="text-xs text-muted-foreground">{email}</p>}
      </CardContent>
    </Card>
  </div>
);

const GateActions = ({ onCheck, checkLabel }: { onCheck?: () => void; checkLabel?: string }) => {
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };
  return (
    <div className="flex flex-col gap-2">
      {onCheck && (
        <Button className="w-full" onClick={onCheck}>
          {checkLabel}
        </Button>
      )}
      <Button variant="outline" className="w-full" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
};

export default ApprovalGate;

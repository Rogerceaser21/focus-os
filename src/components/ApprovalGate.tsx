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
   screen. Read or network trouble shows a retry state, never the app. */

type Status = 'pending' | 'approved' | 'declined';
type GateState = 'checking' | Status | 'error';

// Session-scoped memory (module level, survives route changes): an approved
// account is never re-queried, and the request is sent once per user.
const approvedUsers = new Set<string>();
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

const asStatus = (v: unknown): Status | null =>
  v === 'approved' || v === 'pending' || v === 'declined' ? v : null;

const ApprovalGate = () => {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<GateState>(() =>
    userId && approvedUsers.has(userId) ? 'approved' : 'checking',
  );
  const runRef = useRef(0);

  const check = useCallback(async (id: string) => {
    const run = ++runRef.current;
    const settle = (next: GateState) => {
      if (run !== runRef.current) return;
      if (next === 'approved') approvedUsers.add(id);
      setState(next);
    };
    if (approvedUsers.has(id)) {
      settle('approved');
      return;
    }
    setState('checking');
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
      settle('error');
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      runRef.current++;
      return;
    }
    void check(userId);
  }, [userId, check]);

  if (loading || !userId) return <Outlet />;
  // The effect flips a user change to 'checking' one commit late; a cached
  // approval is honoured immediately so navigation never blinks.
  if (approvedUsers.has(userId) || state === 'approved') return <Outlet />;
  if (state === 'checking') return <AppBootSkeleton />;
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
        Thanks for signing up. Igor has been sent your request and will approve your account soon.
        You'll get an email when it's done.
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

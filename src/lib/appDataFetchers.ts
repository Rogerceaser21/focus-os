import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Single-flight app-data fetchers. Index, ProjectSidebar, useUserPreferences and
// usePrefetchAppData all route their cold-load reads through these, keyed on the
// shared query keys below, so React Query's fetchQuery/useQuery dedupe concurrent
// callers to ONE request and serve staleTime-fresh cache. Framework-agnostic: plain
// functions taking (client, userId) — no React imports.

export const APP_DATA_STALE_TIME = 5 * 60 * 1000; // 5 min

// Shared cache keys — the single source of truth. Any caller peeking, invalidating
// or refetching this data must key off these, or the dedup silently breaks.
export const appDataKeys = {
  tasks: (userId: string) => ['focusos-all-tasks', userId] as const,
  projects: (userId: string) => ['focusos-projects', userId] as const,
  preferences: (userId: string) => ['focusos-preferences', userId] as const,
  memberIds: (userId: string) => ['focusos-member-ids', userId] as const,
};

// Slim projection for the task-list load path: every column transformDbTask (Index.tsx)
// reads, EXCLUDING `images`. Legacy rows hold inline base64 data URLs in `images`, which
// bloats a full select to ~21.5 MB / 7.3s for large accounts; the slim list is ~241 KB.
// `created_at` is not read by transformDbTask but IS required so mergeByIdDesc can order
// the merged own+shared rows. Images are hydrated separately after first paint (see the
// deferred hydration effect in Index.tsx).
export const TASK_LIST_COLUMNS =
  'id,title,description,priority,status,start_date,end_date,due_date,' +
  'timer_total_seconds,timer_is_running,timer_start_time,project_id,sort_order,' +
  'completed_by_email,assigned_to_email,change_request_message,' +
  'google_calendar_event_id,created_at';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Backoff on ERROR (cold-start auth races on mobile Safari), and — for own-data —
// extra backoff on empty-SUCCESS (a tokenless RLS read succeeds with 0 rows).
const ERROR_RETRY_DELAYS = [0, 300, 800, 1500];
const EMPTY_RETRY_DELAYS = [500, 1500];

async function runWithErrorRetry<T>(
  run: () => Promise<{ data: T | null; error: any }>,
): Promise<{ data: T | null; error: any }> {
  let res: { data: T | null; error: any } = { data: null, error: null };
  for (let i = 0; i < ERROR_RETRY_DELAYS.length; i++) {
    if (ERROR_RETRY_DELAYS[i] > 0) await sleep(ERROR_RETRY_DELAYS[i]);
    res = await run();
    if (!res.error) break;
  }
  return res;
}

// Own-data reads drive the "did this account load" decision. Return null only on a
// persistent error (caller throws → query stays retryable). On success, retry a couple
// of times when 0 rows come back so a transient tokenless-RLS empty is not mistaken for
// a genuinely empty account — after the retries an empty set is accepted as truth.
async function fetchOwnRows(
  run: () => Promise<{ data: any[] | null; error: any }>,
): Promise<any[] | null> {
  let res = await runWithErrorRetry<any[]>(run);
  if (res.error) return null;
  let rows = res.data || [];
  for (let i = 0; i < EMPTY_RETRY_DELAYS.length && rows.length === 0; i++) {
    await sleep(EMPTY_RETRY_DELAYS[i]);
    res = await runWithErrorRetry<any[]>(run);
    if (res.error) break; // keep the earlier success ([]) rather than failing the load
    rows = res.data || [];
  }
  return rows;
}

// Shared (accepted-member) reads are best-effort: a failure must never hide the user's
// own rows, so an error degrades to [] rather than throwing.
async function fetchSharedRows(
  run: () => Promise<{ data: any[] | null; error: any }>,
): Promise<any[]> {
  const res = await runWithErrorRetry<any[]>(run);
  if (res.error) return [];
  return res.data || [];
}

// Merge raw DB rows by id (first occurrence wins) and sort created_at desc — the same
// shape/order the previous single unfiltered RLS query returned, now that own and shared
// rows arrive from two separate requests.
export function mergeByIdDesc(rows: any[]): any[] {
  const byId = new Map<string, any>();
  for (const r of rows) {
    if (r && !byId.has(r.id)) byId.set(r.id, r);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// Gate the FIRST query of a cold load on a live session. getSession() reads localStorage
// (no network) and resolves instantly once a session exists; before that — the cold-start
// window where onAuthStateChange has not yet restored/refreshed the token — wait briefly
// for INITIAL_SESSION/SIGNED_IN (capped) so queries never fire tokenless and latch empty.
// Memoised: it resolves the moment a session is present and stays resolved, so only the
// genuine first cold call ever waits.
const SESSION_WAIT_CAP_MS = 3000;
let sessionReadyPromise: Promise<void> | null = null;

export function ensureSession(): Promise<void> {
  if (sessionReadyPromise) return sessionReadyPromise;
  sessionReadyPromise = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session) return;
    } catch {
      // fall through to the listener wait
    }
    await new Promise<void>((resolve) => {
      let done = false;
      let sub: { subscription: { unsubscribe: () => void } } | null = null;
      const timer = setTimeout(() => finish(), SESSION_WAIT_CAP_MS);
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          sub?.subscription.unsubscribe();
        } catch {
          /* no-op */
        }
        resolve();
      };
      const res = supabase.auth.onAuthStateChange((event, session) => {
        if (session || event === 'INITIAL_SESSION' || event === 'SIGNED_IN') finish();
      });
      sub = res.data;
    });
  })();
  return sessionReadyPromise;
}

// ---- Loaders (the queryFn bodies) — plain async, no cache awareness. ----

async function loadMemberProjectIds(userId: string): Promise<string[]> {
  await ensureSession();
  // A member-id failure degrades to own-only (matches the prior graceful behaviour); it
  // never throws, so the whole task/project load is not sunk by a memberships hiccup.
  const res = await runWithErrorRetry<any[]>(() =>
    (supabase as any)
      .from('focusos_project_members')
      .select('project_id')
      .eq('user_id', userId)
      .eq('status', 'accepted'),
  );
  if (res.error || !res.data) return [];
  return res.data.map((m: any) => m.project_id);
}

async function loadAllTasks(client: QueryClient, userId: string): Promise<any[]> {
  await ensureSession();
  const memberIds = await fetchMemberProjectIds(client, userId);
  const [own, shared] = await Promise.all([
    fetchOwnRows(() =>
      (supabase as any)
        .from('focusos_tasks')
        .select(TASK_LIST_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1000),
    ),
    memberIds.length
      ? fetchSharedRows(() =>
          (supabase as any)
            .from('focusos_tasks')
            .select(TASK_LIST_COLUMNS)
            .in('project_id', memberIds)
            .order('created_at', { ascending: false })
            .limit(1000),
        )
      : Promise.resolve([] as any[]),
  ]);
  if (own === null) throw new Error('[appDataFetchers] own tasks failed after retries');
  return mergeByIdDesc([...own, ...shared]);
}

async function loadProjects(client: QueryClient, userId: string): Promise<any[]> {
  await ensureSession();
  const memberIds = await fetchMemberProjectIds(client, userId);
  const [own, shared] = await Promise.all([
    fetchOwnRows(() =>
      (supabase as any)
        .from('focusos_projects')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ),
    memberIds.length
      ? fetchSharedRows(() =>
          (supabase as any)
            .from('focusos_projects')
            .select('*')
            .in('id', memberIds)
            .order('created_at', { ascending: false }),
        )
      : Promise.resolve([] as any[]),
  ]);
  if (own === null) throw new Error('[appDataFetchers] own projects failed after retries');
  return mergeByIdDesc([...own, ...shared]);
}

export async function loadPreferences(userId: string): Promise<any | null> {
  await ensureSession();
  const res = await runWithErrorRetry<any>(() =>
    (supabase as any)
      .from('focusos_user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
  );
  if (res.error) throw res.error;
  return res.data ?? null; // null = no preferences row yet (see ensureDefaultPreferences)
}

// ---- fetchQuery wrappers (single-flight through the shared cache). ----
// `fresh: true` forces a network refetch (staleTime 0) for the event-driven paths
// (post-mutation / resync / tour) that must not read the 5-min stale snapshot; concurrent
// callers still dedupe. Omit it for the cold load so an in-flight prefetch is REUSED.

interface FetchOpts {
  fresh?: boolean;
}

export function fetchMemberProjectIds(
  client: QueryClient,
  userId: string,
  opts?: FetchOpts,
): Promise<string[]> {
  return client.fetchQuery({
    queryKey: appDataKeys.memberIds(userId),
    queryFn: () => loadMemberProjectIds(userId),
    staleTime: opts?.fresh ? 0 : APP_DATA_STALE_TIME,
  });
}

export function fetchAllTasks(
  client: QueryClient,
  userId: string,
  opts?: FetchOpts,
): Promise<any[]> {
  return client.fetchQuery({
    queryKey: appDataKeys.tasks(userId),
    queryFn: () => loadAllTasks(client, userId),
    staleTime: opts?.fresh ? 0 : APP_DATA_STALE_TIME,
  });
}

export function fetchProjects(
  client: QueryClient,
  userId: string,
  opts?: FetchOpts,
): Promise<any[]> {
  return client.fetchQuery({
    queryKey: appDataKeys.projects(userId),
    queryFn: () => loadProjects(client, userId),
    staleTime: opts?.fresh ? 0 : APP_DATA_STALE_TIME,
  });
}

// ---- prefetch (silent warming for /home → /app). Never throws into the caller. ----

export function prefetchTasks(client: QueryClient, userId: string): Promise<void> {
  return client.prefetchQuery({
    queryKey: appDataKeys.tasks(userId),
    queryFn: () => loadAllTasks(client, userId),
    staleTime: APP_DATA_STALE_TIME,
  });
}

export function prefetchProjects(client: QueryClient, userId: string): Promise<void> {
  return client.prefetchQuery({
    queryKey: appDataKeys.projects(userId),
    queryFn: () => loadProjects(client, userId),
    staleTime: APP_DATA_STALE_TIME,
  });
}

export function prefetchPreferences(client: QueryClient, userId: string): Promise<void> {
  return client.prefetchQuery({
    queryKey: appDataKeys.preferences(userId),
    queryFn: () => loadPreferences(userId),
    staleTime: APP_DATA_STALE_TIME,
  });
}

// Create the default preferences row exactly once for an account that has none. Guarded
// by a module-level in-flight map so the N concurrent hook instances that all observe
// data === null collapse to a SINGLE insert (a per-user unique constraint would otherwise
// make the losers error). On success the new row is written straight into the shared
// cache, so every observer re-renders with it.
const defaultsInFlight = new Map<string, Promise<any>>();

export function ensureDefaultPreferences(client: QueryClient, userId: string): Promise<any> {
  const existing = defaultsInFlight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    await ensureSession();
    const { data, error } = await (supabase as any)
      .from('focusos_user_preferences')
      .insert({
        user_id: userId,
        default_view: 'today',
        default_display_mode: 'list',
        default_task_filter: 'all',
        default_task_card_view: 'compact',
        default_task_card_view_mobile: 'minimal',
        theme: 'liquid-glass',
        has_completed_onboarding: false,
        has_completed_task_tour: false,
        has_completed_projects_tour: false,
        has_completed_home_tour: false,
        has_completed_meetings_tour: false,
      })
      .select()
      .single();
    if (error) throw error;
    client.setQueryData(appDataKeys.preferences(userId), data);
    return data;
  })();
  defaultsInFlight.set(userId, p);
  // Allow a retry if the insert failed; keep the success cached.
  p.catch(() => {}).finally(() => {
    defaultsInFlight.delete(userId);
  });
  return p;
}

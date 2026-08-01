/**
 * Hermetic Brain Dump test environment (shared by braindump-save.spec.ts and
 * braindump-direct-save.spec.ts).
 *
 * No Gemini, no microphone, no real Supabase: auth is a seeded localStorage
 * session plus intercepted /auth/v1, and every PostgREST read and write is
 * intercepted (same strategy as tests/investigate-4bugs.spec.ts, minus the
 * throwaway signup). Not a *.spec.ts, so Playwright never collects it.
 */
import type { BrowserContext, Page } from '@playwright/test';

export const PROJECT_REF = 'mshlbsgsyzzfxyxramjj';
export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const USER_EMAIL = 'braindump.probe@example.test';

export const BASE_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
export const BASE_TASK_A = '33333333-3333-4333-8333-333333333333';
export const BASE_TASK_B = '44444444-4444-4444-8444-444444444444';

export const BASE_TASK_TITLES = ['Baseline task alpha', 'Baseline task beta'];

// Noon UTC: the browser contexts below are pinned to UTC, so this always lands on
// "today" for Index's Today-view filter regardless of the host machine's timezone.
export function todayNoonIso(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

// A full slim task-list row (every column in TASK_LIST_COLUMNS) plus the heavy
// `images` column the real .select() on an insert also returns — present here on
// purpose, so a spec can prove slimTaskRow strips it before the cache write.
export const baseTaskRow = (id: string, title: string, createdAtMsAgo: number) => ({
  id,
  title,
  description: null,
  priority: 'medium',
  status: 'todo',
  start_date: null,
  end_date: null,
  due_date: todayNoonIso(),
  timer_total_seconds: 0,
  timer_is_running: false,
  timer_start_time: null,
  project_id: BASE_PROJECT_ID,
  sort_order: 0,
  completed_by_email: null,
  assigned_to_email: null,
  change_request_message: null,
  google_calendar_event_id: null,
  created_at: new Date(Date.now() - createdAtMsAgo).toISOString(),
  images: [],
});

export const baseProjectRow = () => ({
  id: BASE_PROJECT_ID,
  name: 'Baseline project',
  color: '#B8572E',
  is_shared: false,
  user_id: USER_ID,
  created_at: new Date(Date.now() - 600_000).toISOString(),
});

export const prefRow = () => ({
  id: '55555555-5555-4555-8555-555555555555',
  user_id: USER_ID,
  default_view: 'today',
  default_display_mode: 'list',
  default_task_filter: 'all',
  default_task_card_view: 'compact',
  default_task_card_view_mobile: 'minimal',
  theme: 'liquid-glass',
  has_completed_onboarding: true,
  has_completed_task_tour: true,
  has_completed_projects_tour: true,
  has_completed_home_tour: true,
  has_completed_meetings_tour: true,
});

export interface Counts {
  /** GETs of the SHARED slim task list (TASK_LIST_COLUMNS) — the refetch counter. */
  taskListGets: number;
  /** GETs of Home's own three-row "Up Next" card. Counted apart from the list
   *  above: Home observes it, so a save deliberately invalidates and refetches
   *  it, and that must never read as a task-LIST refetch. */
  upNextGets: number;
  insertedProjects: any[];
  insertedTasks: any[];
}

export function createCounts(): Counts {
  return { taskListGets: 0, upNextGets: 0, insertedProjects: [], insertedTasks: [] };
}

export function resetCounts(counts: Counts): void {
  counts.taskListGets = 0;
  counts.upNextGets = 0;
  counts.insertedProjects = [];
  counts.insertedTasks = [];
}

// Seed a valid-looking Supabase session in localStorage before any app code runs, so
// getSession() resolves offline and useAuth has a user at first render.
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ ref, userId, email }) => {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
        sub: userId,
        email,
        aud: 'authenticated',
        role: 'authenticated',
        exp: expiresAt,
      })}.probe-signature`;
      const user = {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: new Date(0).toISOString(),
      };
      localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: jwt,
          refresh_token: 'probe-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: expiresAt,
          user,
        }),
      );
    },
    { ref: PROJECT_REF, userId: USER_ID, email: USER_EMAIL },
  );
}

export async function installIntercepts(context: BrowserContext, counts: Counts): Promise<void> {
  // /auth/v1 — getUser() (called by the saver) and any token refresh.
  await context.route('**/auth/v1/**', (route) => {
    const url = route.request().url();
    const user = {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: USER_EMAIL,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    };
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'probe-refreshed',
        refresh_token: 'probe-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      }),
    });
  });

  await context.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (method !== 'GET' && method !== 'HEAD') {
      const payload = req.postDataJSON();
      if (url.includes('focusos_projects')) {
        const row = {
          id: `99999999-0000-4000-8000-${String(counts.insertedProjects.length).padStart(12, '0')}`,
          color: '#3b82f6',
          is_shared: false,
          created_at: new Date().toISOString(),
          ...(Array.isArray(payload) ? payload[0] : payload),
        };
        counts.insertedProjects.push(row);
        return reply(wantsObject ? row : [row]);
      }
      if (url.includes('focusos_tasks')) {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((p: any, i: number) => ({
          ...baseTaskRow(`88888888-0000-4000-8000-${String(counts.insertedTasks.length + i).padStart(12, '0')}`, p.title, 0),
          ...p,
          // The real PostgREST insert echo carries the heavy `images` column; the fix
          // must strip it via slimTaskRow before the row reaches the hot cache.
          images: ['data:image/png;base64,PROBE-HEAVY-PAYLOAD'],
        }));
        counts.insertedTasks.push(...rows);
        return reply(wantsObject ? rows[0] : rows);
      }
      if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
      return reply(wantsObject ? {} : []);
    }

    if (url.includes('focusos_user_preferences')) return reply(wantsObject ? prefRow() : [prefRow()]);
    if (url.includes('focusos_tasks')) {
      if (url.includes('status=neq.completed')) {
        // `description` is in TASK_LIST_COLUMNS but not in Home's Up Next
        // projection (which since the timer-visuals fix carries the timer
        // columns too), so it tells the shared list load from the card read.
        if (url.includes('description')) counts.taskListGets += 1;
        else counts.upNextGets += 1;
        // The real list read selects TASK_LIST_COLUMNS, which excludes `images` —
        // mirror that projection so a stray `images` key can only have come from
        // the insert echo (i.e. from a missing slimTaskRow).
        return reply(
          [
            baseTaskRow(BASE_TASK_A, BASE_TASK_TITLES[0], 120_000),
            baseTaskRow(BASE_TASK_B, BASE_TASK_TITLES[1], 240_000),
          ].map(({ images, ...slim }) => slim),
        );
      }
      return reply([]); // completed hydration + image hydration
    }
    if (url.includes('focusos_projects')) {
      return reply([baseProjectRow(), ...counts.insertedProjects]);
    }
    return reply(wantsObject ? {} : []);
  });

  await context.route('**/functions/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

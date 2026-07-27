/**
 * Brain Dump live TRANSPORT regression (Fix C, 2026-07-27).
 *
 * What it guards: the Gemini Live socket is not reliable and never will be —
 * this model closes 1008 mid-function-call, re-delivers function calls, cancels
 * them after the fact, announces `goAway`, and dies of old age at ~10 min. The
 * hardening in src/hooks/useBrainDumpLive.ts says none of that may cost the user
 * their captured list. This spec proves the four load-bearing behaviours.
 *
 * HERMETIC — no Gemini, no microphone, no Supabase, no auth. The DEV-only
 * transport shim in useBrainDumpLive.ts (window.__mockLiveSession, gated on
 * import.meta.env.DEV so it is dropped from production builds) swaps
 * ai.live.connect for a fake session recorded on window.__brainDumpLiveMock, and
 * src/pages/BrainDumpRepro.tsx renders the bare hook under ?mocklive=1.
 *
 * WHAT THIS RIG CANNOT PROVE (stated, not buried): it exercises the client's
 * reaction to wire messages, not the wire. It says nothing about whether the
 * real service accepts `behavior: NON_BLOCKING` / `scheduling: SILENT` on
 * gemini-2.5-flash-native-audio-preview-12-2025, whether a resumption handle is
 * actually honoured server-side, whether audio buffered across a reconnect is
 * transcribed, or how long a real reconnect takes. Only a real phone call with
 * live audio settles those.
 *
 * BISECT PROOF (house law) — both documented in the tests below:
 *   - src/hooks/useBrainDumpLive.ts BISECT_DISABLE_TOOLCALL_DEDUP = true
 *     -> "duplicate fc.id is answered but applied once" FAILS.
 *   - src/hooks/useBrainDumpLive.ts BISECT_DISABLE_RECONNECT = true
 *     -> "unexpected close reconnects" FAILS.
 */
import { test, expect, type Page } from '@playwright/test';

type WireMessage = Record<string, unknown>;

/** Everything the DEV shim records about the connection. */
async function harness(page: Page) {
  return page.evaluate(() => {
    const mock = (window as { __brainDumpLiveMock?: any }).__brainDumpLiveMock;
    return {
      connects: mock?.connects ?? [],
      toolResponses: mock?.toolResponses ?? [],
      clientCloses: mock?.clientCloses ?? 0,
    } as {
      connects: Array<{ model: string; handle: string | null; toolNames: string[] }>;
      toolResponses: Array<{ functionResponses: { id?: string; name?: string; response?: any; scheduling?: string } }>;
      clientCloses: number;
    };
  });
}

function emit(page: Page, message: WireMessage) {
  return page.evaluate((m) => (window as any).__brainDumpLiveMock.emit(m), message);
}

/** Boot the transport harness with a live session already open. */
async function boot(page: Page) {
  // Nothing in this spec should touch the network; the hook skips the config
  // edge function in mock mode, and there is no signed-in user to fetch for.
  await page.route('**/*.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.addInitScript(() => {
    (window as any).__mockLiveSession = true;
  });

  await page.goto('/dev/braindump-repro?mocklive=1');
  await expect(page.getByTestId('transport-ready')).toHaveText('ready');
  await page.getByTestId('transport-start').click();
  await expect(page.getByTestId('transport-state')).toHaveText('listening');
  await expect(page.getByTestId('transport-error')).toHaveText('');
}

const addBuyMilk = (id: string): WireMessage => ({
  toolCall: {
    functionCalls: [
      { id, name: 'add_task_to_today', args: { title: 'Buy milk', priority: 'high' } },
    ],
  },
});

test.describe('brain dump live transport', () => {
  test('a duplicate fc.id is answered twice but applied once', async ({ page }) => {
    await boot(page);

    await emit(page, addBuyMilk('call-1'));
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    // Upstream re-delivers the identical function call.
    await emit(page, addBuyMilk('call-1'));
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    const { toolResponses } = await harness(page);
    const forCall1 = toolResponses.filter((r) => r.functionResponses.id === 'call-1');
    // Answered both times — the model is never left waiting on an id it sent.
    expect(forCall1).toHaveLength(2);
    // ...with the SAME echo. This is the bisect discriminator: with
    // BISECT_DISABLE_TOOLCALL_DEDUP = true the second call is re-applied, the
    // title guard merges it, and the second echo comes back carrying
    // note: 'duplicate_prevented_updated_existing' instead of matching the first.
    expect(forCall1[1].functionResponses.response).toEqual(forCall1[0].functionResponses.response);
    expect(forCall1[0].functionResponses.response.note).toBeUndefined();
    expect(forCall1[0].functionResponses.response.current_tasks).toHaveLength(1);
  });

  test('toolCallCancellation removes the task the cancelled call created', async ({ page }) => {
    await boot(page);

    await emit(page, addBuyMilk('call-1'));
    await emit(page, {
      toolCall: {
        functionCalls: [
          { id: 'call-2', name: 'add_task_to_today', args: { title: 'Cancel me', priority: 'low' } },
        ],
      },
    });
    await expect(page.getByTestId('transport-task')).toHaveCount(2);

    await emit(page, { toolCallCancellation: { ids: ['call-2'] } });

    await expect(page.getByTestId('transport-task')).toHaveCount(1);
    await expect(page.getByTestId('transport-task')).toHaveText('Buy milk');
  });

  test('an unexpected close reconnects with the resumption handle and keeps the list', async ({ page }) => {
    await boot(page);

    await emit(page, addBuyMilk('call-1'));
    await emit(page, { sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } });
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    // The socket dies under the user mid-session.
    await page.evaluate(() => (window as any).__brainDumpLiveMock.serverClose());

    // With BISECT_DISABLE_RECONNECT = true this never reaches 2 and the test fails.
    await expect.poll(async () => (await harness(page)).connects.length).toBe(2);
    await expect(page.getByTestId('transport-state')).toHaveText('listening');
    await expect(page.getByTestId('transport-reconnecting')).toHaveText('no');

    const { connects } = await harness(page);
    expect(connects[1].handle).toBe('handle-abc');
    // The reconnect is a real session, tools and all.
    expect(connects[1].toolNames).toContain('add_task_to_today');

    // The list is component state, never rebuilt from the wire.
    await expect(page.getByTestId('transport-task')).toHaveCount(1);
    await expect(page.getByTestId('transport-task')).toHaveText('Buy milk');
  });

  test('goAway reconnects before the server hangs up', async ({ page }) => {
    await boot(page);

    await emit(page, { sessionResumptionUpdate: { newHandle: 'handle-goaway', resumable: true } });
    await emit(page, { goAway: { timeLeft: '0.05s' } });

    await expect.poll(async () => (await harness(page)).connects.length).toBe(2);
    const { connects, clientCloses } = await harness(page);
    expect(connects[1].handle).toBe('handle-goaway');
    // The old socket was closed by us, not left dangling.
    expect(clientCloses).toBeGreaterThanOrEqual(1);
  });

  test('a deliberate stop never reconnects', async ({ page }) => {
    await boot(page);

    await emit(page, addBuyMilk('call-1'));
    await page.getByTestId('transport-stop').click();
    await expect(page.getByTestId('transport-state')).toHaveText('idle');

    // Well past the 250ms first-attempt backoff.
    await page.waitForTimeout(1200);
    const { connects } = await harness(page);
    expect(connects).toHaveLength(1);
    await expect(page.getByTestId('transport-state')).toHaveText('idle');
  });

  test('every tool response is scheduled SILENT for the NON_BLOCKING declarations', async ({ page }) => {
    await boot(page);

    await emit(page, addBuyMilk('call-1'));
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    const { toolResponses } = await harness(page);
    expect(toolResponses).toHaveLength(1);
    expect(toolResponses[0].functionResponses.scheduling).toBe('SILENT');
  });
});

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
 * BISECT PROOF (house law) — all documented in the tests below:
 *   - src/hooks/useBrainDumpLive.ts BISECT_DISABLE_TOOLCALL_DEDUP = true
 *     -> "duplicate fc.id is answered but applied once" FAILS.
 *   - src/hooks/useBrainDumpLive.ts BISECT_DISABLE_RECONNECT = true
 *     -> "unexpected close reconnects" FAILS.
 *   - src/hooks/useBrainDumpLive.ts BISECT_DISABLE_IDLE_STOP = true
 *     -> "a quiet session auto-stops and keeps the capture staged" FAILS.
 *   - src/hooks/useBrainDumpLive.ts BISECT_RESTORE_WAIT_RULE = true
 *     -> "the system instruction ships the act-immediately timing register" FAILS.
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
      connects: Array<{
        model: string;
        handle: string | null;
        toolNames: string[];
        vad: Record<string, unknown> | null;
        compression: Record<string, unknown> | null;
        systemInstructionChars: number;
        systemInstruction: string;
      }>;
      toolResponses: Array<{ functionResponses: { id?: string; name?: string; response?: any; scheduling?: string } }>;
      clientCloses: number;
    };
  });
}

function emit(page: Page, message: WireMessage) {
  return page.evaluate((m) => (window as any).__brainDumpLiveMock.emit(m), message);
}

/**
 * Boot the transport harness with a live session already open.
 *
 * `idleStopMs` sets ?idlestop=<ms>, the DEV-only override for the hook's 90s
 * quiet-session auto-stop — same gating precedent as the bisect switches, and
 * dead-code-eliminated from production builds along with the rest of the shim.
 * Without it the idle path would cost 90s of wall clock per spec.
 */
async function boot(page: Page, opts?: { idleStopMs?: number }) {
  // Nothing in this spec should touch the network; the hook skips the config
  // edge function in mock mode, and there is no signed-in user to fetch for.
  await page.route('**/*.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.addInitScript(() => {
    (window as any).__mockLiveSession = true;
  });

  const idleParam = opts?.idleStopMs ? `&idlestop=${opts.idleStopMs}` : '';
  await page.goto(`/dev/braindump-repro?mocklive=1${idleParam}`);
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

  /* ── P1/F1: live consistency + instant-feel config ────────────────────── */

  test('the connect config carries the VAD tuning and context-window compression', async ({ page }) => {
    await boot(page);

    const { connects } = await harness(page);
    expect(connects).toHaveLength(1);

    // Server defaults are LOW/LOW, which on a noisy line can hold one turn open
    // indefinitely — and a turn that never ends emits no function calls at all.
    // F1: the end-of-speech gap is 500ms (dead air the user feels on every
    // sentence), and prefixPaddingMs is GONE — the server default is tuned for
    // this model and the 150ms override only clipped speech onsets.
    expect(connects[0].vad).toEqual({
      startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
      endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
      silenceDurationMs: 500,
    });
    expect(connects[0].vad).not.toHaveProperty('prefixPaddingMs');
    // `disabled` must NEVER appear: it hands VAD to the client and this model
    // then hangs. Asserted explicitly so a future edit cannot slip it in.
    expect(connects[0].vad).not.toHaveProperty('disabled');

    // F1: 100k trigger / 80k target — Google's ADK prescription for this model.
    // A low trigger pays the trim's own latency cost over and over inside one
    // dump. Both are int64 on the wire, so both travel as strings.
    expect(connects[0].compression).toEqual({
      slidingWindow: { targetTokens: '80000' },
      triggerTokens: '100000',
    });

    // The whole setup payload is re-prefilled on EVERY turn, so the system
    // instruction is kept bounded. This is the regression guard on the slimming
    // (and on the project / previous-task caps that bound its two lists).
    // (F1 grew it from ~2500 to 2945 with the act-immediately block; the 3200
    // ceiling is deliberately NOT loosened to pay for it.)
    expect(connects[0].systemInstructionChars).toBeGreaterThan(500);
    expect(connects[0].systemInstructionChars).toBeLessThan(3200);
  });

  /**
   * F1 — the instant-feel prompt register.
   *
   * Ramble's design law, and the one prompt line that decides whether Brain Dump
   * feels instant: the model must call tools WHILE the user is still speaking,
   * because correction-by-voice absorbs an eager mistake but nothing absorbs a
   * late one. The register this replaced ordered the opposite ("wait for a
   * pause"), stacking the model's own hesitation on top of the VAD gap.
   *
   * BISECT PROOF (house law): src/hooks/useBrainDumpLive.ts
   * BISECT_RESTORE_WAIT_RULE = true -> both halves of this test FAIL (the
   * ACT IMMEDIATELY assertion first). Restore to false -> green.
   *
   * WHAT THIS CANNOT PROVE: that the model OBEYS it. This asserts which text is
   * on the wire, not the behaviour it buys — only real speech into a real
   * session settles that.
   */
  test('the system instruction ships the act-immediately timing register', async ({ page }) => {
    await boot(page);

    const { connects } = await harness(page);
    const prompt = connects[0].systemInstruction;
    console.log('[systemInstruction chars]', prompt.length);

    // The new register is present, and it names the tools it applies to.
    expect(prompt).toContain('ACT IMMEDIATELY');
    expect(prompt).toContain('the MOMENT you hear a plausible task');
    expect(prompt).toContain('One task heard = one tool call, straight away');

    // ...and the wait-for-a-pause register is GONE, not merely outvoted by it.
    expect(prompt).not.toContain('Do NOT call tools mid-sentence');
    expect(prompt).not.toContain('Wait until a task is complete before calling any tool');

    // The correction rules are the safety net that makes eager firing safe, so
    // they must still be in there alongside it.
    expect(prompt).toContain('CORRECTION RULES');
    expect(prompt).toContain('SILENT MODE');
    expect(prompt).toContain('ROUTING RULES');
  });

  test('the tool response is sent in the SAME TICK as the tool call', async ({ page }) => {
    await boot(page);

    // No await between delivering the call and reading the mock. If ANYTHING on
    // the ack path yielded — an await, a microtask, a timer, a React flush —
    // `after` would still be 0. The next model makes tools SYNC-ONLY, so any
    // delay here is dead air on the user's line.
    const sameTick = await page.evaluate((message) => {
      const mock = (window as any).__brainDumpLiveMock;
      const before = mock.toolResponses.length;
      mock.emit(message);
      const after = mock.toolResponses.length;
      return { before, after, echo: mock.toolResponses[mock.toolResponses.length - 1] ?? null };
    }, addBuyMilk('call-tick'));

    expect(sameTick.before).toBe(0);
    expect(sameTick.after).toBe(1);
    expect(sameTick.echo.functionResponses.id).toBe('call-tick');
    // ...and it is the REAL echo, not an empty ack sent early to look fast:
    // applyToolCall genuinely ran first, which is why the outcome is in there.
    expect(sameTick.echo.functionResponses.response.task_id).toBeTruthy();
    expect(sameTick.echo.functionResponses.response.current_tasks).toHaveLength(1);

    // The paint follows the ack, not the other way round.
    await expect(page.getByTestId('transport-task')).toHaveCount(1);
  });

  test('a quiet session auto-stops and keeps the capture staged', async ({ page }) => {
    await boot(page, { idleStopMs: 500 });

    await emit(page, addBuyMilk('call-1'));
    await expect(page.getByTestId('transport-task')).toHaveCount(1);
    await expect(page.getByTestId('transport-idle-stopped')).toHaveText('no');

    // Nobody talks, so the server sends nothing at all — the signal the hook
    // watches. With BISECT_DISABLE_IDLE_STOP = true this never flips and the
    // test fails here.
    await expect(page.getByTestId('transport-idle-stopped')).toHaveText('yes', { timeout: 5_000 });
    await expect(page.getByTestId('transport-state')).toHaveText('idle');

    // STAGED, not discarded: an auto-stop is the finish path, never Discard.
    await expect(page.getByTestId('transport-task')).toHaveCount(1);
    await expect(page.getByTestId('transport-task')).toHaveText('Buy milk');

    // ...and it is a DELIBERATE stop, so nothing reconnects behind it.
    await page.waitForTimeout(1_200);
    const { connects, clientCloses } = await harness(page);
    expect(connects).toHaveLength(1);
    expect(clientCloses).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('transport-state')).toHaveText('idle');
    await expect(page.getByTestId('transport-reconnecting')).toHaveText('no');
  });

  test('server activity resets the idle countdown', async ({ page }) => {
    await boot(page, { idleStopMs: 1_000 });

    // 4 x 400ms of activity = 1.6s of wall clock, well past a single window.
    for (let i = 0; i < 4; i += 1) {
      await page.waitForTimeout(400);
      await emit(page, { sessionResumptionUpdate: { newHandle: `handle-${i}`, resumable: true } });
    }

    await expect(page.getByTestId('transport-idle-stopped')).toHaveText('no');
    await expect(page.getByTestId('transport-state')).toHaveText('listening');
  });
});

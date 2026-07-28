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

  /* ── REVERT GUARD (2026-07-28): the P1/F1 tuning wave failed Igor's feel
     gate twice, so the connect payload is back to the v40 wire behaviour and
     THIS SPEC PINS IT THERE. No VAD config, no compression config, no
     experimental prompt register may ship again without device-measured
     numbers from the PCM-injection rig — if you are editing these assertions
     to re-add one, bring the measurements. Configs under autopsy live in git:
     1a059a6 (P1), 89c35bf (F1). ────────────────────────────────────────── */

  test('the connect config is v40-clean: no VAD overrides, no compression', async ({ page }) => {
    await boot(page);

    const { connects } = await harness(page);
    expect(connects).toHaveLength(1);

    // Server defaults, exactly as v40 shipped them. Every value the tuning
    // wave sent here made the felt latency worse on the real device.
    expect(connects[0].vad).toBeNull();
    expect(connects[0].compression).toBeNull();

    // The whole setup payload is re-prefilled on EVERY turn, so the system
    // instruction stays bounded (the P1 project/previous-task caps remain).
    expect(connects[0].systemInstructionChars).toBeGreaterThan(500);
    expect(connects[0].systemInstructionChars).toBeLessThan(3200);
  });

  /**
   * REVERT GUARD — the prompt register is the v40 wait-rule again.
   *
   * F1's act-immediately register (Ramble's design law) is under autopsy, not
   * abandoned: on Igor's device the F1 build read as "worse — not picking
   * things up". It returns only together with rig measurements. This spec
   * fails loudly if either register drifts.
   */
  test('the system instruction ships the v40 wait-for-completion register', async ({ page }) => {
    await boot(page);

    const { connects } = await harness(page);
    const prompt = connects[0].systemInstruction;
    console.log('[systemInstruction chars]', prompt.length);

    // The v40 register is present...
    expect(prompt).toContain('Wait until a task is complete before calling any tool');
    expect(prompt).toContain('Do NOT call tools mid-sentence');

    // ...and the F1 register is fully gone, not merely outvoted.
    expect(prompt).not.toContain('ACT IMMEDIATELY');
    expect(prompt).not.toContain('the MOMENT you hear a plausible task');

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

  // ---------------------------------------------------------------------------
  // TITLE DEDUP (device-confirmed regression, 2026-07-28): the guard used to
  // match on substring containment, so "Call mum about the car" was silently
  // merged into "Call mum" — and the echo claimed success, so the model never
  // retried. Igor proved it on his phone: 4 spoken tasks, 2 cards. The guard is
  // now EXACT-match only. These specs pin all three behaviours: distinct-but-
  // overlapping titles land, same-batch overlaps land, true re-creations merge.
  // ---------------------------------------------------------------------------

  test('overlapping titles are distinct tasks, not duplicates', async ({ page }) => {
    await boot(page);

    await emit(page, {
      toolCall: {
        functionCalls: [
          { id: 'call-1', name: 'add_task_to_today', args: { title: 'Call mum', priority: 'medium' } },
        ],
      },
    });
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    // The Igor scenario, across two turns: a superset title must be a NEW card.
    await emit(page, {
      toolCall: {
        functionCalls: [
          { id: 'call-2', name: 'add_task_to_today', args: { title: 'Call mum about the car', priority: 'medium' } },
        ],
      },
    });
    await expect(page.getByTestId('transport-task')).toHaveCount(2);

    const { toolResponses } = await harness(page);
    const second = toolResponses.find((r) => r.functionResponses.id === 'call-2');
    // The model is told the truth: a fresh task, not a swallowed "duplicate".
    expect(second?.functionResponses.response.note).toBeUndefined();
    expect(second?.functionResponses.response.current_tasks).toHaveLength(2);
  });

  test('overlapping titles in the SAME batch both land (Fix C same-tick path)', async ({ page }) => {
    await boot(page);

    // One wire message, two functionCalls: since Fix C the second call sees the
    // row the first just made, which is exactly where substring dedup used to
    // eat tasks spoken in one breath.
    await emit(page, {
      toolCall: {
        functionCalls: [
          { id: 'call-1', name: 'add_task_to_today', args: { title: 'Email Sarah', priority: 'medium' } },
          { id: 'call-2', name: 'add_task_to_today', args: { title: 'Email Sarah the invoice', priority: 'medium' } },
        ],
      },
    });
    await expect(page.getByTestId('transport-task')).toHaveCount(2);
  });

  test('an exact re-created title still merges instead of duplicating', async ({ page }) => {
    await boot(page);

    await emit(page, addBuyMilk('call-1'));
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    // Different fc.id (so transport dedup does not apply), same title modulo
    // case/punctuation — the reconnect-replay shape this guard exists for.
    await emit(page, {
      toolCall: {
        functionCalls: [
          { id: 'call-9', name: 'add_task_to_today', args: { title: 'buy milk!', priority: 'high' } },
        ],
      },
    });
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    const { toolResponses } = await harness(page);
    const merged = toolResponses.find((r) => r.functionResponses.id === 'call-9');
    expect(merged?.functionResponses.response.note).toBe('duplicate_prevented_updated_existing');
  });

  // ---------------------------------------------------------------------------
  // ?m31=1 — the model A/B switch (Deploy B, 2026-07-28). One build, two
  // models: default stays gemini-2.5-flash-native-audio-preview-12-2025 with
  // NON_BLOCKING/SILENT tools; the param flips to gemini-3.1-flash-live-preview
  // whose tools are SYNC-ONLY, so behavior and scheduling must BOTH vanish.
  // ---------------------------------------------------------------------------

  test('?m31=1 connects the 3.1 model with sync-only tools', async ({ page }) => {
    await page.route('**/*.supabase.co/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.addInitScript(() => {
      (window as any).__mockLiveSession = true;
    });
    await page.goto('/dev/braindump-repro?mocklive=1&m31=1');
    await expect(page.getByTestId('transport-ready')).toHaveText('ready');
    await page.getByTestId('transport-start').click();
    await expect(page.getByTestId('transport-state')).toHaveText('listening');

    await emit(page, addBuyMilk('call-1'));
    await expect(page.getByTestId('transport-task')).toHaveCount(1);

    const { connects, toolResponses } = await harness(page);
    expect(connects[0].model).toBe('gemini-3.1-flash-live-preview');
    // Sync-only: no NON_BLOCKING on any declaration, no SILENT on any echo.
    expect((connects[0] as any).toolBehaviors).toEqual([]);
    expect(toolResponses[0].functionResponses.scheduling).toBeUndefined();
  });

  test('without the params the default model, NON_BLOCKING tools and barge-in are untouched', async ({ page }) => {
    await boot(page);
    const { connects } = await harness(page);
    expect(connects[0].model).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    expect((connects[0] as any).toolBehaviors).toEqual(['NON_BLOCKING']);
    expect((connects[0] as any).activityHandling).toBeNull();
  });

  // ?ni=1 — NO_INTERRUPTION barge-in switch (device-diagnosed: default
  // interruption cancels the generation carrying the previous task's tool
  // call whenever the user starts the next task -> batch-at-end arrival).
  test('?ni=1 ships NO_INTERRUPTION and nothing else; composes with ?m31=1', async ({ page }) => {
    await page.route('**/*.supabase.co/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.addInitScript(() => {
      (window as any).__mockLiveSession = true;
    });
    await page.goto('/dev/braindump-repro?mocklive=1&ni=1&m31=1');
    await expect(page.getByTestId('transport-ready')).toHaveText('ready');
    await page.getByTestId('transport-start').click();
    await expect(page.getByTestId('transport-state')).toHaveText('listening');

    const { connects } = await harness(page);
    expect((connects[0] as any).activityHandling).toBe('NO_INTERRUPTION');
    // The mechanism switch must NOT smuggle VAD thresholds or compression back in.
    expect(connects[0].vad).toBeNull();
    expect(connects[0].compression).toBeNull();
    // Composition: the 3.1 arm still applies alongside.
    expect(connects[0].model).toBe('gemini-3.1-flash-live-preview');
    expect((connects[0] as any).toolBehaviors).toEqual([]);
  });

  test('a title that normalises to empty never dedups against anything', async ({ page }) => {
    await boot(page);

    // Non-Latin scripts (e.g. Arabic) normalise to '' under the [a-z0-9] filter.
    // Pre-fix, '' substring-matched EVERY task, so the first such title ate all
    // the rest. Two distinct Arabic titles must produce two cards.
    await emit(page, {
      toolCall: {
        functionCalls: [
          { id: 'call-1', name: 'add_task_to_today', args: { title: 'اتصل بأمي', priority: 'medium' } },
          { id: 'call-2', name: 'add_task_to_today', args: { title: 'جدد جواز السفر', priority: 'medium' } },
        ],
      },
    });
    await expect(page.getByTestId('transport-task')).toHaveCount(2);
  });
});

#!/usr/bin/env node
// O10 LIVE PROBE — cancel-then-reshare against the DEPLOYED focusos-share-item
// edge function.
//
// Bug (code-read verified, supabase/functions/focusos-share-item/index.ts):
// the idempotency lookup matched an existing focusos_shared_items row by
// sender_user_id + recipient_email + item_type + item_id WITHOUT excluding
// status='cancelled', so cancelling a share and then re-sharing the same item
// to the same person reused the cancelled row (it stayed cancelled forever)
// while the function still returned {success:true} — the client-side share
// silently shared nothing. The fix adds `.neq('status','cancelled')`
// (+ order+limit to stay single-row-safe once cancelled rows accumulate) to
// that lookup, so a cancel-then-reshare always falls through to a fresh
// INSERT with a new pending row.
//
// This script is the LIVE counterpart to the hermetic browser assertion in
// tests/shared-items-live.spec.ts ("Test H") — it exercises the actual
// deployed function and real Postgres rows, not an intercept. Run it ONLY
// AFTER `supabase functions deploy focusos-share-item` has shipped the fix.
//
// Usage:
//   node scripts/probe_o10_reshare.mjs
//
// Safety:
//   - Demo account credentials are read at runtime from
//     tests/project-tree.spec.ts (DEMO_EMAIL / DEMO_PASSWORD) — never
//     hardcoded here.
//   - The Supabase URL + publishable (anon) key are read at runtime from
//     src/integrations/supabase/client.ts — never hardcoded here.
//   - The share recipient is a FIXED fake address on the reserved-for-testing
//     `example.invalid` TLD (RFC 2606 — guaranteed never to resolve), so this
//     can never deliver a real email to a real person even though the
//     function's own auto-routing logic (see the finding below) does not
//     honour `sendEmail:false` for a recipient with no Focus OS account.
//   - Cleanup (asserted, runs even when assertions fail): the temp task is
//     DELETED with a 0-row read-back; the two focusos_shared_items rows are
//     flipped to status='cancelled' via UPDATE instead of deleted, because
//     RLS on focusos_shared_items has SELECT/INSERT/UPDATE policies but NO
//     DELETE policy (skeptic-proven live: DELETE returns 204 and removes
//     nothing). Cancelled rows are permanent history the app filters from
//     every share surface, matching what the app's own cancel button leaves
//     behind; the read-back asserts no non-cancelled probe row remains.
//   - Never touches port 8080 (Igor's live dev server) — this only speaks to
//     the deployed Supabase REST + edge function endpoints.
//
// KNOWN FINDING (unrelated to the fix itself, reported for the record): the
// function's auto-routing —
//   const shouldSendEmail = recipientUserId === null ? true : (sendEmail !== false);
// — sends the email UNCONDITIONALLY whenever the recipient has no Focus OS
// account, ignoring an explicit `sendEmail:false`. This script still passes
// `sendEmail:false` (belt and braces, matches the task spec) but relies on
// the `.invalid` TLD, not that flag, to stay safe. Do not change the
// recipient domain without re-checking this.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const FAKE_RECIPIENT = 'o10-probe@example.invalid';

let passCount = 0;
let failCount = 0;

function pass(label) {
  passCount += 1;
  console.log(`PASS: ${label}`);
}

function fail(label, detail) {
  failCount += 1;
  console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}

function assertTrue(condition, label, detail) {
  if (condition) pass(label);
  else fail(label, detail);
}

// ---- Read secrets/config from the repo's own source files (never hardcode) ----

function readDemoCreds() {
  const src = readFileSync(path.join(REPO_ROOT, 'tests/project-tree.spec.ts'), 'utf8');
  const email = src.match(/const DEMO_EMAIL = '([^']+)'/)?.[1];
  const password = src.match(/const DEMO_PASSWORD = '([^']+)'/)?.[1];
  if (!email || !password) {
    throw new Error('Could not read DEMO_EMAIL/DEMO_PASSWORD out of tests/project-tree.spec.ts — has that file changed shape?');
  }
  return { email, password };
}

function readSupabaseConfig() {
  const src = readFileSync(path.join(REPO_ROOT, 'src/integrations/supabase/client.ts'), 'utf8');
  const url = src.match(/const SUPABASE_URL = "([^"]+)"/)?.[1];
  const anonKey = src.match(/const SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)?.[1];
  if (!url || !anonKey) {
    throw new Error('Could not read SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY out of src/integrations/supabase/client.ts — has that file changed shape?');
  }
  return { url, anonKey };
}

// ---- Small REST helpers ----------------------------------------------------

async function restSignIn(supabaseUrl, anonKey, email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`REST sign-in failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { token: body.access_token, userId: body.user.id, email: body.user.email };
}

function restHeaders(anonKey, token, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function restInsert(supabaseUrl, anonKey, token, table, row) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: restHeaders(anonKey, token, { Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`INSERT into ${table} failed (${res.status}): ${JSON.stringify(body)}`);
  return body[0];
}

async function restSelect(supabaseUrl, anonKey, token, query) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${query}`, {
    headers: restHeaders(anonKey, token),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`SELECT ${query} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function restDelete(supabaseUrl, anonKey, token, table, idColumn, id) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${idColumn}=eq.${id}`, {
    method: 'DELETE',
    headers: restHeaders(anonKey, token),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE ${table} id=${id} failed (${res.status}): ${body}`);
  }
}

async function restUpdate(supabaseUrl, anonKey, token, table, idColumn, id, patch) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${idColumn}=eq.${id}`, {
    method: 'PATCH',
    headers: { ...restHeaders(anonKey, token), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`UPDATE ${table} id=${id} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

async function invokeShareFunction(supabaseUrl, anonKey, token, payload) {
  const res = await fetch(`${supabaseUrl}/functions/v1/focusos-share-item`, {
    method: 'POST',
    headers: restHeaders(anonKey, token),
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch { /* leave null */ }
  return { status: res.status, ok: res.ok, body };
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const { email: DEMO_EMAIL, password: DEMO_PASSWORD } = readDemoCreds();
  const { url: SUPABASE_URL, anonKey: ANON_KEY } = readSupabaseConfig();

  console.log(`O10 live probe starting against ${SUPABASE_URL} as ${DEMO_EMAIL}`);

  const session = await restSignIn(SUPABASE_URL, ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD);
  pass('signed in via password grant');

  // Track everything we create so cleanup can run even if a later assertion fails.
  let taskId = null;
  const sharedItemIds = [];

  try {
    // --- Create a zz-prefixed temp task to attach the share to. ---
    const taskTitle = `zz-o10-probe-${Date.now()}`;
    const task = await restInsert(SUPABASE_URL, ANON_KEY, session.token, 'focusos_tasks', {
      title: taskTitle,
      user_id: session.userId,
    });
    taskId = task?.id ?? null;
    assertTrue(!!taskId, 'created a temp probe task', JSON.stringify(task));

    // --- Insert a CANCELLED focusos_shared_items row directly (simulates a
    // previously-cancelled share to the same recipient for the same item). ---
    const cancelledRow = await restInsert(SUPABASE_URL, ANON_KEY, session.token, 'focusos_shared_items', {
      item_id: taskId,
      item_type: 'task',
      item_title: taskTitle,
      recipient_email: FAKE_RECIPIENT,
      sender_email: session.email,
      sender_user_id: session.userId,
      status: 'cancelled',
    });
    const cancelledRowId = cancelledRow?.id ?? null;
    if (cancelledRowId) sharedItemIds.push(cancelledRowId);
    assertTrue(
      !!cancelledRowId && cancelledRow.status === 'cancelled',
      'seeded a pre-existing CANCELLED shared_items row for this item+recipient',
      JSON.stringify(cancelledRow),
    );

    // --- Invoke the deployed function for the SAME item + SAME recipient. ---
    const fnResult = await invokeShareFunction(SUPABASE_URL, ANON_KEY, session.token, {
      itemType: 'task',
      itemId: taskId,
      recipientEmail: FAKE_RECIPIENT,
      sendEmail: false, // belt-and-braces; see the KNOWN FINDING note above the header — the .invalid TLD is what actually keeps this safe.
    });
    assertTrue(
      fnResult.ok && fnResult.body?.success === true,
      'focusos-share-item function returned success for the reshare',
      `status=${fnResult.status} body=${JSON.stringify(fnResult.body)}`,
    );

    // --- Read back: the cancelled row must be untouched, and a NEW pending row must exist. ---
    const rows = await restSelect(
      SUPABASE_URL, ANON_KEY, session.token,
      `focusos_shared_items?select=id,status,created_at,recipient_email,item_id,item_type&sender_user_id=eq.${session.userId}&recipient_email=eq.${FAKE_RECIPIENT}&item_type=eq.task&item_id=eq.${taskId}&order=created_at.asc`,
    );

    assertTrue(rows.length === 2, 'exactly two shared_items rows exist for this item+recipient after the reshare (the old cancelled one + one fresh)', `found ${rows.length}: ${JSON.stringify(rows)}`);

    const stillCancelled = rows.find((r) => r.id === cancelledRowId);
    assertTrue(
      !!stillCancelled && stillCancelled.status === 'cancelled',
      'the original cancelled row is untouched (still status=cancelled, same id)',
      JSON.stringify(stillCancelled),
    );

    const freshRow = rows.find((r) => r.id !== cancelledRowId);
    if (freshRow?.id) sharedItemIds.push(freshRow.id);
    assertTrue(
      !!freshRow && freshRow.status === 'pending',
      'a NEW row was created with status=pending (the reshare was NOT swallowed by the cancelled row)',
      JSON.stringify(freshRow),
    );
  } finally {
    // --- Cleanup. focusos_shared_items has NO DELETE RLS policy (a DELETE
    // returns 204 and silently removes nothing), so the probe's rows are
    // flipped to status='cancelled' via UPDATE (the sender-side UPDATE the
    // app's own cancel button uses) and left as filtered-everywhere history.
    // The temp task IS deletable and is removed with an asserted read-back. ---
    for (const id of [...new Set(sharedItemIds)]) {
      try {
        await restUpdate(SUPABASE_URL, ANON_KEY, session.token, 'focusos_shared_items', 'id', id, { status: 'cancelled' });
      } catch (e) {
        fail(`cancelled shared_items row ${id}`, e.message);
      }
    }
    if (taskId) {
      try {
        await restDelete(SUPABASE_URL, ANON_KEY, session.token, 'focusos_tasks', 'id', taskId);
      } catch (e) {
        fail(`deleted temp task ${taskId}`, e.message);
      }
    }

    // Asserted read-back: every probe shared_items row is cancelled (none
    // left pending/accepted where a share surface could show it), and the
    // temp task is gone.
    if (sharedItemIds.length) {
      const idList = [...new Set(sharedItemIds)].join(',');
      const leftover = await restSelect(
        SUPABASE_URL, ANON_KEY, session.token,
        `focusos_shared_items?select=id,status&id=in.(${idList})&status=neq.cancelled`,
      );
      assertTrue(leftover.length === 0, 'cleanup read-back: every probe shared_items row is status=cancelled', `found ${leftover.length} non-cancelled: ${JSON.stringify(leftover)}`);
    }
    if (taskId) {
      const remainingTask = await restSelect(
        SUPABASE_URL, ANON_KEY, session.token,
        `focusos_tasks?select=id&id=eq.${taskId}`,
      );
      assertTrue(remainingTask.length === 0, 'cleanup read-back: 0 temp tasks remain', `found ${remainingTask.length}: ${JSON.stringify(remainingTask)}`);
    }
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('PROBE CRASHED:', err);
  process.exit(1);
});

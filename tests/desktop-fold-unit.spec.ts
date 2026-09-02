import { test, expect } from '@playwright/test';
import { selectFoldedKeys, visibleFoldSet } from '../src/hooks/useProjectBarFold';

/**
 * BINDING guard for the desktop project bar's fold selection (G1 fix round,
 * 2026-09-02).
 *
 * WHY THIS FILE EXISTS. tests/desktop-pin.spec.ts asserts the wide invariant
 * through the real DOM: every action a project's shape offers is reachable in
 * the row OR in the More menu, never neither. A skeptic reverted the fold fix
 * and that spec still passed 16/16, so it does NOT bind on the defect the fix
 * addresses, and it cannot: the fold set is computed in a LAYOUT effect, which
 * commits before the browser paints, so a wrong fold set produced by a stale or
 * mis-indexed count is corrected in the same frame and never reaches a pixel a
 * browser test can sample. A guard that cannot fail on the broken code is not a
 * guard. The behaviour therefore lives in pure functions and is asserted here,
 * where the broken shape is expressible and demonstrably fails.
 *
 * DISCRIMINATION IS ASSERTED, NOT ASSUMED. `legacySelectFoldedKeys` below is the
 * pre-fix algorithm, byte-for-byte in behaviour: count across the MEASURED
 * candidates, then slice the caller's FULL candidate list. The first test proves
 * the fixture makes it fail the contract; the rest hold the shipped function to
 * that contract. Delete the fix and these go red.
 *
 * These are pure-function tests: no `page` fixture, so no browser is launched.
 * The filename carries the `desktop-` prefix so the config's desktop-mouse
 * project owns it and it runs exactly once.
 */

/** The pre-fix implementation, kept ONLY so the fixtures can be proven discriminating. */
function legacySelectFoldedKeys(input: {
  keysInFoldOrder: string[];
  widths: Map<string, number>;
  available: number;
  reservedName: number;
  moreWidth: number;
  gap: number;
}): string[] {
  const { keysInFoldOrder, widths, available, reservedName, moreWidth, gap } = input;
  const keys = keysInFoldOrder.filter((k) => widths.has(k));
  let count = 0;
  for (; count <= keys.length; count++) {
    const visible = keys.slice(count);
    const visibleWidth = visible.reduce((sum, k) => sum + (widths.get(k) ?? 0), 0);
    const innerGaps = Math.max(0, visible.length - 1) * gap;
    const rowGapToName = visible.length > 0 || count > 0 ? gap : 0;
    const moreExtra = count > 0 ? moreWidth + gap : 0;
    const total = reservedName + rowGapToName + visibleWidth + innerGaps + moreExtra;
    if (total <= available) break;
  }
  // The defect: counted over `keys`, applied to `keysInFoldOrder`.
  return keysInFoldOrder.slice(0, count);
}

/**
 * The drift fixture. The caller offers eight actions in fold order. The measurer
 * clone has only reported widths for six of them, which is what one commit of a
 * project switch looks like: the candidate list already carries the new
 * project's actions while the hidden clone still holds the previous render's
 * children, so `keysInFoldOrder` is wider than the measured set.
 */
const OFFERED = ['pin', 'invite', 'movetasks', 'meetings', 'share', 'moveto', 'archive', 'delete'];
const MEASURED_ONLY = ['movetasks', 'meetings', 'share', 'moveto', 'archive', 'delete'];
const driftWidths = () => new Map<string, number>(MEASURED_ONLY.map((k) => [k, 96]));

const DRIFT = {
  keysInFoldOrder: OFFERED,
  widths: driftWidths(),
  available: 700,
  reservedName: 240,
  moreWidth: 40,
  gap: 8,
};

test.describe('project bar fold selection (pure)', () => {
  test('the drift fixture is discriminating: the pre-fix algorithm fails the contract on it', () => {
    const legacy = legacySelectFoldedKeys(DRIFT);
    const fixed = selectFoldedKeys(DRIFT);

    // Legacy hides candidates the measurer never reported, and it hides ones
    // whose width was never part of the fit sum, so the row it leaves behind is
    // still over-wide.
    const legacyUnmeasured = legacy.filter((k) => !DRIFT.widths.has(k));
    expect(legacyUnmeasured.length).toBeGreaterThan(0);
    expect(legacy).not.toEqual(fixed);
  });

  test('contract 1: every folded key was measured', () => {
    const folded = selectFoldedKeys(DRIFT);
    for (const key of folded) expect(DRIFT.widths.has(key)).toBe(true);
  });

  test('contract 2: the fold set is a prefix of the measured candidates in fold order', () => {
    const folded = selectFoldedKeys(DRIFT);
    expect(folded).toEqual(MEASURED_ONLY.slice(0, folded.length));
  });

  test('contract 3: the fold set is a subset of the offered candidates', () => {
    const folded = selectFoldedKeys(DRIFT);
    for (const key of folded) expect(OFFERED).toContain(key);
  });

  test('contract 4: folding is minimal, and what is left in the row actually fits', () => {
    const folded = selectFoldedKeys(DRIFT);
    const fits = (foldCount: number) => {
      const visible = MEASURED_ONLY.slice(foldCount);
      const visibleWidth = visible.reduce((sum, k) => sum + (DRIFT.widths.get(k) ?? 0), 0);
      const innerGaps = Math.max(0, visible.length - 1) * DRIFT.gap;
      const rowGapToName = visible.length > 0 || foldCount > 0 ? DRIFT.gap : 0;
      const moreExtra = foldCount > 0 ? DRIFT.moreWidth + DRIFT.gap : 0;
      return DRIFT.reservedName + rowGapToName + visibleWidth + innerGaps + moreExtra <= DRIFT.available;
    };
    expect(fits(folded.length)).toBe(true);
    if (folded.length > 0) expect(fits(folded.length - 1)).toBe(false);
  });

  test('a wide row folds nothing', () => {
    expect(selectFoldedKeys({ ...DRIFT, available: 4000 })).toEqual([]);
  });

  test('a row with no space folds every measured candidate and no more', () => {
    const folded = selectFoldedKeys({ ...DRIFT, available: 1 });
    expect(folded).toEqual(MEASURED_ONLY);
    expect(folded.length).toBeLessThanOrEqual(MEASURED_ONLY.length);
  });

  test('nothing is folded before the measurer has reported anything', () => {
    expect(selectFoldedKeys({ ...DRIFT, widths: new Map(), available: 1 })).toEqual([]);
  });

  test('visibleFoldSet drops keys the current render no longer offers', () => {
    // Held from a previous project that had Pin and Invite; the current project
    // offers neither. Applying them by position would hide two of ITS actions.
    const held = ['pin', 'invite', 'share'];
    const nowOffered = ['movetasks', 'meetings', 'share', 'archive', 'delete'];
    const applied = visibleFoldSet(held, nowOffered);
    expect([...applied]).toEqual(['share']);
    for (const key of applied) expect(nowOffered).toContain(key);
  });

  test('visibleFoldSet cannot gate an empty More menu', () => {
    // Every held key is stale, so the set is empty and `hasFolded` stays false:
    // no action can sit behind a trigger whose menu would render nothing.
    const applied = visibleFoldSet(['pin', 'invite'], ['movetasks', 'meetings', 'archive']);
    expect(applied.size).toBe(0);
  });
});

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Progressive overflow fold for the desktop project bar (O9, 2026-08-26).
 *
 * U1 (2026-08-23) folded the whole 7-button action row into a "More" menu at
 * ONE hard container-width breakpoint (1179px), picked by hand from a single
 * bisect. Igor's verdict: at full width the bar shows every action, and one
 * small shrink makes them ALL vanish at once — he wants each action to stay
 * visible until it genuinely no longer fits, folding into the menu one at a
 * time, least-used first.
 *
 * A fixed CSS breakpoint per action was considered and rejected: the row's
 * required width is NOT constant — it depends on the project name's length,
 * whether the project has members (ProjectMembersBar), sub-project/archived
 * state (which items even exist), and badges. A breakpoint hand-tuned against
 * one project would fold too early for a short name and clip for a long one.
 * This hook measures real rendered pixel widths instead of guessing them, so
 * the fold set is exactly tight for whatever project is showing.
 *
 * How: a hidden clone of the fold-order items (position:absolute,
 * visibility:hidden, rendered by the caller with the SAME classes/props as
 * the real buttons so widths match pixel-for-pixel) supplies each item's
 * natural width — real DOM elements can't be measured once they stop being
 * rendered, so the clone stays mounted permanently regardless of fold state.
 * The flexible name element's own width is read live (it's never unmounted)
 * to derive the fixed non-name width of its group plus its CSS floor.
 *
 * Render-phase laws: the fold count is derived in a LAYOUT effect, which
 * commits synchronously before the browser paints (unlike a plain effect, it
 * never lets a wrong frame reach the screen) — this is the measure-then-set
 * pattern the render-phase laws' "never correct after paint" rule targets
 * AWAY from (that rule is about useEffect corrections after a stale frame was
 * already shown), not the pre-paint case. A ResizeObserver-driven recompute
 * on live window resize can still lag the physical drag by a frame — that is
 * an unavoidable property of any JS-measured layout (pure CSS has none),
 * flagged as an open risk, not a render-phase-law violation.
 *
 * CALLBACK refs, not plain object refs: `renderProjectBar()`'s output sits
 * behind loading gates in Index.tsx (auth/preferences) that are unrelated to
 * `active` (which only tracks whether a project is selected) — a device
 * bisect during this build (repeated across four StrictMode-doubled runs,
 * console-traced) caught `active` turning true on a render where those OTHER
 * gates still had the bar unmounted, i.e. `active` went stable (no further
 * effect re-run) with the refs permanently null, wedging the row at
 * "everything visible" (the exact U1 bug this hook exists to fix). A plain
 * `useRef` + `ref={x}` never notifies this hook when its target later mounts,
 * because mutating `.current` triggers no re-render and the effect's own
 * dependencies hadn't changed. Callback refs DO fire on every attach/detach
 * regardless of dependency arrays; `attachTick` folds that into the layout
 * effect's dependencies so it always gets a chance to retry once the real DOM
 * exists, however many renders that takes.
 */

export interface UseProjectBarFoldResult {
  /** Ref for the row whose available width is being divided (bears padding). */
  rowRef: (el: HTMLDivElement | null) => void;
  /** Ref for the flexible name group (the flex-1 min-w-0 wrapper). */
  nameGroupRef: (el: HTMLDivElement | null) => void;
  /** Ref for the name element itself (span or input) — must carry the CSS floor. */
  nameRef: (el: HTMLElement | null) => void;
  /** Ref for the hidden measurer clone; render one `[data-fold-key]` child per candidate, in any order, plus one `[data-fold-more]` child for the trigger. */
  measureRef: (el: HTMLDivElement | null) => void;
  /** Keys currently folded into the overflow menu (subset of the input keys). */
  foldedKeys: Set<string>;
  /** True once at least one item is folded — drives the More trigger's visibility. */
  hasFolded: boolean;
}

export function useProjectBarFold(
  /** Candidate keys THIS render actually offers, in fold order — index 0 folds first, the last entry folds last. */
  keysInFoldOrder: string[],
  options: { active: boolean; gap?: number; nameFloor?: number; contentKey?: string | number } = { active: true },
): UseProjectBarFoldResult {
  const { active, gap = 8, nameFloor = 64, contentKey } = options;
  const rowEl = useRef<HTMLDivElement | null>(null);
  const nameGroupEl = useRef<HTMLDivElement | null>(null);
  const nameEl = useRef<HTMLElement | null>(null);
  const measureEl = useRef<HTMLDivElement | null>(null);
  const [attachTick, setAttachTick] = useState(0);
  // The fold set is held BY KEY, never by a count (G1, 2026-09-02). A count is
  // only meaningful against the exact array it was computed over: the loop below
  // counts across `keys` (the candidates the measurer actually reported a width
  // for) while the caller's `keysInFoldOrder` may hold more, so slicing one with
  // the other's count folds the wrong actions — silently, and in the middle of
  // the row rather than off its front. It also made a STALE count dangerous: a
  // count carried over from the previously selected project re-indexes into a
  // different candidate list. Keys re-apply harmlessly (a key that is no longer
  // offered simply matches nothing), so the invariant "an action is either in
  // the row or in the More menu, never neither" holds even mid-switch.
  const [foldedKeyList, setFoldedKeyList] = useState<string[]>([]);

  // See the file-level note: callback refs so a late-mounting target (behind
  // an unrelated loading gate) still gets the layout effect to retry.
  const bump = useCallback(() => setAttachTick((t) => t + 1), []);
  const rowRef = useCallback((el: HTMLDivElement | null) => { rowEl.current = el; bump(); }, [bump]);
  const nameGroupRef = useCallback((el: HTMLDivElement | null) => { nameGroupEl.current = el; bump(); }, [bump]);
  const nameRef = useCallback((el: HTMLElement | null) => { nameEl.current = el; bump(); }, [bump]);
  const measureRef = useCallback((el: HTMLDivElement | null) => { measureEl.current = el; bump(); }, [bump]);

  // Re-derive whenever the CANDIDATE SET changes (switching project can add/
  // remove items like "New sub-project"), not just on resize.
  const keysSignature = keysInFoldOrder.join('|');

  useLayoutEffect(() => {
    if (!active) {
      setFoldedKeyList((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const row = rowEl.current;
    const nameGroup = nameGroupEl.current;
    const nameNode = nameEl.current;
    const measure = measureEl.current;
    // Not mounted yet (behind an unrelated loading gate) — `attachTick` will
    // bump and re-run this effect the moment any of the four attach for real.
    if (!row || !nameGroup || !nameNode || !measure) return;

    const recompute = () => {
      const rowStyle = getComputedStyle(row);
      const horizontalPadding = parseFloat(rowStyle.paddingLeft || '0') + parseFloat(rowStyle.paddingRight || '0');
      const available = row.clientWidth - horizontalPadding;
      if (available <= 0) return;

      // Fixed (non-name) width already inside the name group — emoji, sub-
      // project breadcrumb, archived/shared badges, ProjectMembersBar. These
      // are never folded, so whatever they cost is reserved off the top.
      //
      // Deliberately NOT `nameGroup.scrollWidth - nameNode.scrollWidth`: the
      // name group is `flex-1` (grows to fill leftover space), so when it
      // isn't currently overflowing its OWN box, `scrollWidth` reports the
      // group's inflated rendered width, not its children's true minimum
      // need — a self-referential trap (device-bisected during this build:
      // a fresh load at a wide viewport measured a ~900px "fixed" cost from a
      // ~90px cost, folded everything, which left even MORE free space for
      // the group to inflate into, so it never self-corrected). Every
      // non-name child in this row carries `shrink-0` (emoji, breadcrumb,
      // badges, ProjectMembersBar), so ITS OWN rendered width is reliable
      // regardless of how much space the group currently has — sum those
      // directly instead of inferring from the group's box.
      const nameGroupChildren = Array.from(nameGroup.children);
      const nameGroupGap = parseFloat(getComputedStyle(nameGroup).columnGap || '0') || 0;
      const fixedChildrenWidth = nameGroupChildren
        .filter((child) => child !== nameNode)
        .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
      const nameGroupFixed = fixedChildrenWidth + Math.max(0, nameGroupChildren.length - 1) * nameGroupGap;
      const reservedName = nameGroupFixed + nameFloor;

      const widths = new Map<string, number>();
      measure.querySelectorAll<HTMLElement>('[data-fold-key]').forEach((el) => {
        const key = el.getAttribute('data-fold-key');
        if (key) widths.set(key, el.getBoundingClientRect().width);
      });
      const moreTrigger = measure.querySelector<HTMLElement>('[data-fold-more]');
      const moreWidth = moreTrigger ? moreTrigger.getBoundingClientRect().width : 0;

      // Row layout: [nameGroup] gap [moveTasks+actions...] gap [more?] — one
      // `gap` between the name group and the action cluster, one `gap`
      // between each visible action, one more `gap` before the trigger.
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
      // Slice the SAME array the count was counted over, and only re-set state
      // when the resulting key list really changed.
      const nextFolded = keys.slice(0, count);
      setFoldedKeyList((prev) =>
        prev.length === nextFolded.length && prev.every((k, i) => k === nextFolded[i]) ? prev : nextFolded,
      );
    };

    recompute();

    const ro = new ResizeObserver(() => recompute());
    ro.observe(row);
    ro.observe(nameGroup);
    ro.observe(measure);

    return () => ro.disconnect();
    // `contentKey` (the caller passes the selected project's id): the fixed
    // siblings summed above — ProjectMembersBar, badges, the sub-project
    // breadcrumb — can change size when switching to a DIFFERENT project
    // that happens to offer the exact same candidate key set (so
    // `keysSignature` alone wouldn't change), and none of row/nameGroup/
    // measure's OWN border-boxes necessarily resize as a direct consequence
    // (nameGroup's box is set by the outer row's allocation, not by its
    // children's content). Forcing a re-run on project identity is simpler
    // and more robust than observing every conditionally-present sibling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, keysSignature, gap, nameFloor, attachTick, contentKey]);

  // Derived DURING RENDER, and intersected with the candidates THIS render
  // offers: a key held over from the previous project can never fold an action
  // the current one does not have, and `hasFolded` can never be true while the
  // menu it gates would come out empty (which would hide an action behind a
  // trigger that shows nothing).
  const offered = new Set(keysInFoldOrder);
  const foldedKeys = new Set(foldedKeyList.filter((k) => offered.has(k)));
  return { rowRef, nameGroupRef, nameRef, measureRef, foldedKeys, hasFolded: foldedKeys.size > 0 };
}

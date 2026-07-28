import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Stick-to-bottom for a live-appending scroll box (Home's brain-dump stream).
 *
 * iOS Safari has no `overflow-anchor`, so a box that appends newest-LAST simply
 * grows past its own viewport and every new row lands below the fold. This hook
 * follows the growth in JS:
 *
 *  - PINNED while the user is at (or within 24px of) the bottom. Every content
 *    growth then scrolls to the bottom inside a LAYOUT effect / ResizeObserver
 *    callback — both run after layout and BEFORE paint, so the corrective scroll
 *    lands in the same frame as the growth. No post-paint timeout, no visible
 *    jump (render-phase laws, memory `focusos-render-phase-laws`).
 *  - UNPINNED as soon as the user scrolls up: their reading position is never
 *    yanked. Scrolling back to the bottom re-pins, as does `jumpToLatest()`.
 *
 * `pinned` is STATE, not a ref, because it gates render output (the jump pill).
 * A ref latch would survive a discarded react-router transition render while the
 * queued setState died with it. `pinnedRef` mirrors it for the side-effect paths
 * only (event handlers + observer callbacks, never during render); the mirror is
 * written in the same call as the setState, so the two can never diverge.
 *
 * Programmatic scroll writes set `programmaticRef` synchronously, before the
 * `scrollTop` assignment, so the scroll event they queue is not mistaken for the
 * user scrolling — but the DOM, not the flag, has the final say (see onScroll).
 *
 * The refs are CALLBACK refs on purpose. Home renders a placeholder first
 * (authLoading), so the scroll box arrives on a later commit than the hook: an
 * object ref left the mount effect running once against `null`, which attached
 * no scroll listener at all and no amount of scrolling could unpin. A callback
 * ref puts the node in state, so the effect re-runs the moment it exists.
 */

/** How close to the bottom still counts as "following the stream". */
const PIN_THRESHOLD_PX = 24;

/**
 * BISECT SWITCH (house law: a guard spec must be shown to fail without the fix).
 * Flip to true and tests/braindump-stream.spec.ts fails its auto-follow
 * assertion; flip back and it passes. Never true in a commit.
 */
const BISECT_DISABLE_FOLLOW: boolean = false;

export interface StickToBottom<S extends HTMLElement, C extends HTMLElement> {
  /** Attach to the scrolling box (the element with `overflow-y: auto`). */
  scrollRef: (node: S | null) => void;
  /** Attach to the growing content inside it (what the ResizeObserver watches). */
  contentRef: (node: C | null) => void;
  /** True while the view is following the newest content. */
  pinned: boolean;
  /** True while the content is taller than the box (i.e. scrolling is possible). */
  overflowing: boolean;
  /** Re-pin and scroll to the newest content. */
  jumpToLatest: () => void;
}

export function useStickToBottom<
  S extends HTMLElement = HTMLDivElement,
  C extends HTMLElement = HTMLDivElement,
>(
  /** Bump on every content change (e.g. the item count) — drives the layout effect. */
  revision: number,
  /** While false the box is dormant; the true-edge re-pins for a fresh session. */
  active = true,
): StickToBottom<S, C> {
  // Node identity in state (drives the attach effect) + a mirror ref for the
  // synchronous side-effect paths.
  const [scrollEl, setScrollEl] = useState<S | null>(null);
  const [contentEl, setContentEl] = useState<C | null>(null);
  const scrollElRef = useRef<S | null>(null);

  const scrollRef = useCallback((node: S | null) => {
    scrollElRef.current = node;
    setScrollEl(node);
  }, []);
  const contentRef = useCallback((node: C | null) => setContentEl(node), []);

  const [pinned, setPinnedState] = useState(true);
  const [overflowing, setOverflowing] = useState(false);

  // Side-effect mirror of `pinned` (observer + listener closures). Never read
  // during render — the state above is the single source of truth for output.
  const pinnedRef = useRef(true);
  const programmaticRef = useRef(false);

  const setPinned = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setPinnedState(next); // React bails out when the value is unchanged
  }, []);

  const measure = useCallback(() => {
    const el = scrollElRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight - el.clientHeight > 1);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (BISECT_DISABLE_FOLLOW) return;
    const el = scrollElRef.current;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    // Already there: the write would not fire a scroll event, so the flag would
    // be left armed and would swallow the user's next scroll.
    if (target <= 0 || Math.abs(el.scrollTop - target) < 1) return;
    programmaticRef.current = true;
    el.scrollTop = target;
    // Disarm at the end of the frame. The scroll steps run BEFORE animation-frame
    // callbacks, so our own event has already been seen; anything later is the
    // user's. Without this, an arm whose event never arrives (a coalesced frame,
    // a write the compositor folds away) stays armed and eats the next real
    // scroll — measured: the wheel scrolled to 0 and the view still re-followed.
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, []);

  const jumpToLatest = useCallback(() => {
    setPinned(true);
    scrollToBottom();
    measure();
  }, [measure, scrollToBottom, setPinned]);

  // Listener + observer live for the lifetime of the (permanently mounted) box.
  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) return;

    const onScroll = () => {
      // The DOM is the source of truth, not the flag: every write of ours lands
      // AT the bottom, so a flagged event that is nowhere near the bottom can
      // only be the user's and must still unpin. (The flag alone used to win
      // that argument and silently re-pin a user who had scrolled up.)
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance <= PIN_THRESHOLD_PX;
      if (programmaticRef.current) {
        programmaticRef.current = false;
        if (atBottom) {
          setPinned(true);
          measure();
          return;
        }
      }
      setPinned(atBottom);
      measure();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // Growth that React does not drive (row wrapping, fonts, the card's own
    // max-height transition). RO callbacks run before paint, like a layout effect.
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (pinnedRef.current) scrollToBottom();
        measure();
      });
      if (contentEl) ro.observe(contentEl);
      ro.observe(el);
    }

    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [scrollEl, contentEl, measure, scrollToBottom, setPinned]);

  // React-driven growth: follow it in the same commit, before paint.
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
    measure();
  }, [revision, scrollEl, measure, scrollToBottom]);

  // A fresh session starts pinned, whatever the previous one ended on.
  useLayoutEffect(() => {
    if (!active) return;
    setPinned(true);
    scrollToBottom();
    measure();
  }, [active, scrollEl, measure, scrollToBottom, setPinned]);

  return { scrollRef, contentRef, pinned, overflowing, jumpToLatest };
}

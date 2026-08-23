import { useEffect, useState } from 'react';

/**
 * Tracks the bounding rect of an element matching `selector`.
 * - Polls for up to `pollTimeout`ms until the element appears.
 * - Scrolls the element into view (centered) before measuring.
 * - Re-measures on resize, scroll, DOM mutation, and ResizeObserver changes.
 *
 * Returns null while the target is missing.
 */
export function useTourSpotlight(
  selector: string | null,
  active: boolean,
  pollTimeout = 1500,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active || !selector) {
      setRect(null);
      return;
    }

    let cancelled = false;
    let pollHandle: number | null = null;
    let resizeObs: ResizeObserver | null = null;
    let mutationObs: MutationObserver | null = null;
    let currentTarget: Element | null = null;

    const measure = () => {
      if (cancelled || !currentTarget) return;
      const r = currentTarget.getBoundingClientRect();
      setRect(r);
    };

    const attachToTarget = (el: Element) => {
      currentTarget = el;
      // Scroll into view (centered) so the spotlight always lands on visible content
      // Scroll into view INSTANTLY (not smooth) so the rect is correct immediately —
      // any "smooth" scroll would leave the spotlight measuring the pre-scroll position
      // and force the loading overlay to dismiss before the user sees the target.
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      } catch {
        /* older browsers */
      }
      // Measure on the next frame so layout has settled after the instant scroll
      requestAnimationFrame(() => measure());
      measure();

      // ResizeObserver on the target
      if ('ResizeObserver' in window) {
        resizeObs = new ResizeObserver(() => measure());
        resizeObs.observe(el);
      }
    };

    // A tour target can exist twice in the DOM with only one instance visible
    // per breakpoint (e.g. the desktop Delete button vs the mobile ⋯ menu that
    // holds Delete). Spotlight the first VISIBLE match, not the first match.
    const findVisible = (): Element | null => {
      const matches = document.querySelectorAll(selector);
      for (const el of matches) {
        if (el.getClientRects().length > 0) return el;
      }
      return matches[0] ?? null;
    };

    const start = Date.now();
    const tryFind = () => {
      if (cancelled) return;
      const el = findVisible();
      if (el) {
        attachToTarget(el);
        return;
      }
      if (Date.now() - start < pollTimeout) {
        pollHandle = window.setTimeout(tryFind, 50);
      } else {
        setRect(null);
      }
    };
    tryFind();

    // Re-measure on scroll. On RESIZE also re-resolve the target: a width
    // change can flip WHICH instance of a twice-present target is the visible
    // one (the desktop project bar swaps its full Delete button for the More
    // trigger by container query, U1 2026-08-23) with zero DOM mutations, so
    // the MutationObserver below never fires and the spotlight would stay
    // attached to a display:none element (0x0 rect) until something else
    // mutated. Same re-attach rule as the observer.
    const handleScroll = () => measure();
    const handleViewportChange = () => {
      const el = findVisible();
      if (el && el !== currentTarget) {
        resizeObs?.disconnect();
        attachToTarget(el);
      } else {
        measure();
      }
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleScroll, true);

    // Watch DOM for the target reappearing/moving (dialogs mounting, etc.)
    mutationObs = new MutationObserver(() => {
      const el = findVisible();
      if (el && el !== currentTarget) {
        resizeObs?.disconnect();
        attachToTarget(el);
      } else if (currentTarget) {
        measure();
      }
    });
    // Watch for both new nodes AND attribute changes — tour data attributes
    // (e.g. data-projects-tour-step="demo-project") are added to existing rows
    // when a project becomes selected; without `attributes: true` the observer
    // never fires and the spotlight rect stays null.
    mutationObs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-projects-tour-step', 'data-task-tour-step', 'data-tour-step'],
    });

    return () => {
      cancelled = true;
      if (pollHandle) clearTimeout(pollHandle);
      resizeObs?.disconnect();
      mutationObs?.disconnect();
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [selector, active, pollTimeout]);

  return rect;
}

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipPosition {
  left: number;
  top: number;
  placement: TooltipPlacement;
}

/**
 * Compute a tooltip position around a target rect, choosing the best of
 * 4 sides given available viewport space and clamping to viewport edges.
 */
export function computeTooltipPosition(
  rect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferred: TooltipPlacement = 'bottom',
  margin = 16,
): TooltipPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fits = {
    top: rect.top - tooltipHeight - margin >= margin,
    bottom: rect.bottom + tooltipHeight + margin <= vh - margin,
    left: rect.left - tooltipWidth - margin >= margin,
    right: rect.right + tooltipWidth + margin <= vw - margin,
  };

  // Order of preference, starting with the requested side
  const order: TooltipPlacement[] = [preferred];
  (['bottom', 'top', 'left', 'right'] as TooltipPlacement[]).forEach((p) => {
    if (!order.includes(p)) order.push(p);
  });

  const placement = order.find((p) => fits[p]) ?? preferred;

  let left: number;
  let top: number;

  if (placement === 'top' || placement === 'bottom') {
    left = rect.left + rect.width / 2 - tooltipWidth / 2;
    top = placement === 'top' ? rect.top - tooltipHeight - margin : rect.bottom + margin;
  } else {
    top = rect.top + rect.height / 2 - tooltipHeight / 2;
    left = placement === 'left' ? rect.left - tooltipWidth - margin : rect.right + margin;
  }

  // Clamp to viewport
  left = Math.max(margin, Math.min(left, vw - tooltipWidth - margin));
  top = Math.max(margin, Math.min(top, vh - tooltipHeight - margin));

  return { left, top, placement };
}

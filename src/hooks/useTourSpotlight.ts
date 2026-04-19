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

    const start = Date.now();
    const tryFind = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
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

    // Re-measure on viewport changes
    const handleViewportChange = () => measure();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    // Watch DOM for the target reappearing/moving (dialogs mounting, etc.)
    mutationObs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el && el !== currentTarget) {
        resizeObs?.disconnect();
        attachToTarget(el);
      } else if (currentTarget) {
        measure();
      }
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      if (pollHandle) clearTimeout(pollHandle);
      resizeObs?.disconnect();
      mutationObs?.disconnect();
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
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

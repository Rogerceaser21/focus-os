// Motion gate (C+D wave, task 6).
//
// Coordinates the deferred data merges (completed-task hydration and image
// hydration in Index.tsx) with in-flight surface transitions so a setAllTasks
// re-render never lands mid-glide and stutters the drawer or edit sheet.
//
// A surface calls beginSurfaceTransition(key) when its data-state changes and
// endSurfaceTransition(key) once the transition has finished (transitionend /
// animationend, or a duration-matched fallback). A deferred merge wraps its work
// in runWhenSettled(fn): the work runs on an idle slot (requestIdleCallback,
// falling back to setTimeout) only once no surface transition is in flight.
//
// This is best-effort scheduling, never correctness-critical: the fetch results
// and single-flight caches are untouched — only the moment the re-render commits
// is nudged out of the animation window.

const active = new Set<string>();
const waiters = new Set<() => void>();
// One end-timer per key so a rapid re-toggle refreshes the buffer rather than
// stacking several deferred clears.
const endTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Small tail after a transition reports done, so the compositor lands its final
// frame before a merge re-render is allowed in.
const SETTLE_BUFFER_MS = 80;

const ric: (cb: () => void) => void =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => (window as unknown as { requestIdleCallback: (c: () => void, o?: { timeout: number }) => void }).requestIdleCallback(cb, { timeout: 500 })
    : (cb) => { window.setTimeout(cb, 0); };

function flush(): void {
  if (active.size > 0) return;
  const pending = Array.from(waiters);
  waiters.clear();
  for (const w of pending) w();
}

/** Mark a surface transition as started. Cancels any pending end-buffer for the
 *  same key (a re-open before the close buffer elapsed keeps the gate closed). */
export function beginSurfaceTransition(key: string): void {
  const t = endTimers.get(key);
  if (t !== undefined) {
    clearTimeout(t);
    endTimers.delete(key);
  }
  active.add(key);
}

/** Mark a surface transition as finished, after a small settle buffer. When the
 *  last active transition clears, any queued merges are released. */
export function endSurfaceTransition(key: string): void {
  const existing = endTimers.get(key);
  if (existing !== undefined) clearTimeout(existing);
  const t = setTimeout(() => {
    endTimers.delete(key);
    active.delete(key);
    if (active.size === 0) flush();
  }, SETTLE_BUFFER_MS);
  endTimers.set(key, t);
}

/** True while any surface transition (plus its settle buffer) is in flight. */
export function isSurfaceTransitionInFlight(): boolean {
  return active.size > 0;
}

/** Run fn as soon as no surface transition is in flight, on an idle slot so the
 *  merge's re-render never competes with an active glide. If nothing is in
 *  flight, it is scheduled straight onto the next idle slot. */
export function runWhenSettled(fn: () => void): void {
  const schedule = () => ric(fn);
  if (active.size === 0) {
    schedule();
    return;
  }
  waiters.add(schedule);
}

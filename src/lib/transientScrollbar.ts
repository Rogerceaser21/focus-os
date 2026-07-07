/**
 * iOS-style transient scrollbar: while a .lg-content panel scrolls it gets
 * .lg-scrolling (thumb painted, see index.css); removed ~0.9s after the last
 * scroll event. Mounted once from main.tsx. Scroll events don't bubble, so we
 * listen in the capture phase on document.
 */
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function installTransientScrollbar() {
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('lg-content')) return;
      el.classList.add('lg-scrolling');
      const prev = timers.get(el);
      if (prev) clearTimeout(prev);
      timers.set(el, setTimeout(() => el.classList.remove('lg-scrolling'), 900));
    },
    true
  );
}

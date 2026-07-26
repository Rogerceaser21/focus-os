import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// Resolve the mobile state synchronously so the very FIRST render is already
// correct. The previous useState(undefined) start returned desktop for one
// render on every mount, which briefly mounted the 280px desktop sidebar over
// the app on phones before swapping to the mobile drawer (the visible "opens
// twice" + frame freeze). No SSR in this Vite SPA, but guard `window`
// defensively so a non-browser render falls back to desktop rather than throw.
function getIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(getIsMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

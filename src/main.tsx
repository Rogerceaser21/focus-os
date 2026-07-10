import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import { WallpaperController } from "./lib/wallpaper";
import { installTransientScrollbar } from "./lib/transientScrollbar";
import "./index.css";
import "./components/ParticleEffect.css";

installTransientScrollbar();

// Home-Screen (standalone) launches: detect via any reliable signal and mark
// <html> so the stylesheet's html.standalone rules apply.
const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
const mmStandalone = window.matchMedia('(display-mode: standalone)').matches;
const mmFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
const notBrowser = !window.matchMedia('(display-mode: browser)').matches;
const isStandalone = navStandalone || mmStandalone || mmFullscreen || notBrowser;
if (isStandalone) {
  document.documentElement.classList.add('standalone');
}

// TEMP DIAGNOSTIC SWITCHES (?gd=<mode>) for the Safari-only white flash on
// the Projects sheet — each mode disables ONE suspect so on-device testing
// can bisect the cause. Remove once the culprit is confirmed.
//   ?gd=noblur  -> sheet renders with NO backdrop-filter (opaque-ish glass)
//   ?gd=nolock  -> Radix Sheet runs non-modal (no scroll-lock / body mutation)
//   ?gd=noanim  -> sheet + overlay appear/disappear instantly (no animation)
const gd = new URLSearchParams(window.location.search).get('gd');
if (gd && ['noblur', 'nolock', 'noanim'].includes(gd)) {
  document.documentElement.classList.add(`dbg-${gd}`);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme="liquid-glass" defaultTheme="liquid-glass" enableSystem={false} themes={['liquid-glass']}>
      <WallpaperController />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
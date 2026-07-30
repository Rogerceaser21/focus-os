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
// <html> so the stylesheet's html.standalone rules apply. The iOS shell app
// cannot match any display-mode query (WKWebView has no manifest), so it
// injects window.__FOCUSOS_SHELL__ at documentStart instead.
const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
const mmStandalone = window.matchMedia('(display-mode: standalone)').matches;
const mmFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
const shellFlag = (window as unknown as { __FOCUSOS_SHELL__?: boolean }).__FOCUSOS_SHELL__ === true;
const isStandalone = navStandalone || mmStandalone || mmFullscreen || shellFlag;
if (isStandalone) {
  document.documentElement.classList.add('standalone');
}
// Shell-only marker: the iOS shell's webview is edge-to-edge, so Safari-only
// geometry (the +40px wallpaper stretch) must be switched off there — that
// stretch is real scrollable overflow in a WKWebView (draggable whole app).
if (shellFlag) {
  document.documentElement.classList.add('shell');
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme="liquid-glass" defaultTheme="liquid-glass" enableSystem={false} themes={['liquid-glass']}>
      <WallpaperController />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
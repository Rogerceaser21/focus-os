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

// TEMP diagnostic probe (remove once standalone detection is confirmed).
// Shows a red banner reporting each signal so a single screenshot tells us
// exactly what the running home-screen app sees.
{
  const probe = document.createElement('div');
  probe.textContent = `PROBE3 SA:${navStandalone} MM:${mmStandalone} FS:${mmFullscreen} NB:${notBrowser} CLS:${document.documentElement.classList.contains('standalone')}`;
  probe.style.cssText =
    'position:fixed;left:50%;top:calc(env(safe-area-inset-top, 0px) + 2px);' +
    'transform:translateX(-50%);z-index:2147483647;background:#e11d48;color:#fff;' +
    'font:700 10px/1.3 ui-monospace,SFMono-Regular,monospace;padding:3px 7px;' +
    'border-radius:6px;pointer-events:none;white-space:nowrap;max-width:96vw;overflow:hidden;';
  document.body.appendChild(probe);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme="liquid-glass" defaultTheme="liquid-glass" enableSystem={false} themes={['liquid-glass']}>
      <WallpaperController />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
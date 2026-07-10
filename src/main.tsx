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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme="liquid-glass" defaultTheme="liquid-glass" enableSystem={false} themes={['liquid-glass']}>
      <WallpaperController />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
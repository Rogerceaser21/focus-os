import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import { WallpaperController } from "./lib/wallpaper";
import { installTransientScrollbar } from "./lib/transientScrollbar";
import "./index.css";
import "./components/ParticleEffect.css";

installTransientScrollbar();

// Home-Screen (standalone) launches: iOS legacy web apps report
// navigator.standalone rather than reliably matching the display-mode media
// query — normalise both signals to a class the stylesheet targets.
if (
  (navigator as unknown as { standalone?: boolean }).standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches
) {
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
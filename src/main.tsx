import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import { WallpaperController } from "./lib/wallpaper";
import "./index.css";
import "./components/ParticleEffect.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme="liquid-glass" defaultTheme="liquid-glass" enableSystem={false} themes={['liquid-glass']}>
      <WallpaperController />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
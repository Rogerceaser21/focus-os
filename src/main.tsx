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

// TEMP DIAGNOSTIC PROBE — REMOVE AFTER ONE SCREENSHOT. Four paint mechanisms
// as side-by-side columns crossing the layout-viewport bottom into the
// home-indicator strip. Whichever colour shows IN the strip = a mechanism
// that can paint there. Root background = yellow backdrop (proven channel):
// all-yellow strip means nothing else paints below the line.
if (isStandalone) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      const mk = (css: Partial<CSSStyleDeclaration>) => {
        const d = document.createElement('div');
        Object.assign(d.style, {
          pointerEvents: 'none',
          zIndex: '2147483000',
          opacity: '0.85',
        } as Partial<CSSStyleDeclaration>, css);
        document.body.appendChild(d);
        return d;
      };
      // backdrop: root colour (proven to paint the strip)
      document.documentElement.style.backgroundColor = '#ffee00';
      // A: absolute, overshoot 60px past 100svh — RED
      mk({ position: 'absolute', top: '0', left: '0', width: '25vw',
        height: 'calc(100svh + 60px)', background: '#ff2020' });
      // B: absolute, 100lvh tall — GREEN
      const b = mk({ position: 'absolute', top: '0', left: '25vw', width: '25vw',
        height: '100lvh', background: '#00c830' });
      // C: absolute 100svh, transform pushes 60px below — ORANGE
      mk({ position: 'absolute', top: '0', left: '50vw', width: '25vw',
        height: '100svh', background: '#ff9500', transform: 'translateY(60px)' });
      // D: fixed with overshoot — MAGENTA (control: proven clipped)
      mk({ position: 'fixed', top: '0', left: '75vw', width: '25vw',
        height: 'calc(100svh + 60px)', background: '#ff00d0' });
      // safe-area-inset-bottom measurer
      const sab = mk({ position: 'absolute', top: '0', left: '0', width: '1px',
        height: 'env(safe-area-inset-bottom, 0px)', background: 'transparent' });
      const banner = mk({ position: 'fixed', top: '70px', left: '8px', right: '8px',
        background: '#000', color: '#fff', font: '700 15px/1.5 monospace',
        padding: '10px', whiteSpace: 'pre-wrap', opacity: '1' });
      banner.textContent =
        `PROBE  A abs+60=RED  B lvh=GREEN  C transform=ORANGE  D fixed=MAGENTA  root=YELLOW\n` +
        `inH=${window.innerHeight} clH=${document.documentElement.clientHeight} ` +
        `scr=${screen.height} vv=${Math.round(window.visualViewport?.height ?? -1)} ` +
        `lvh=${b.offsetHeight} sab=${sab.offsetHeight} dpr=${window.devicePixelRatio}`;
    }, 600);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" forcedTheme="liquid-glass" defaultTheme="liquid-glass" enableSystem={false} themes={['liquid-glass']}>
      <WallpaperController />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
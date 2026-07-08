/**
 * Liquid Glass wallpaper system.
 * Liquid Glass is the app's only theme; the wallpaper choice drives its
 * material state. Each wallpaper maps to a data-wallpaper attribute on
 * <html>, which src/index.css uses to pick the frost / smoke / solid token
 * set and the accent. Images live in the public Supabase Storage bucket
 * `wallpapers`. The Plain wallpaper takes a user-picked colour
 * (--plain-color); data-plain-tone flips the tokens dark when the picked
 * colour is dark so text stays readable.
 * Choices persist in localStorage (per device) for now; syncing them through
 * focusos_user_preferences is a later, deliberate migration.
 */
import { useEffect, useState } from 'react';

export type WallpaperId = 'lilies' | 'wave' | 'starry' | 'plain';

const BUCKET = 'https://mshlbsgsyzzfxyxramjj.supabase.co/storage/v1/object/public/wallpapers';

export const WALLPAPERS: Record<WallpaperId, { name: string; src: string | null }> = {
  lilies: { name: 'Monet', src: `${BUCKET}/water-lilies.jpg` },
  wave: { name: 'Hokusai', src: `${BUCKET}/great-wave.jpg` },
  starry: { name: 'Van Gogh', src: `${BUCKET}/starry-night.jpg` },
  plain: { name: 'Plain', src: null },
};

/* Edge tone per wallpaper — fed to <meta name="theme-color"> and the <html>
   background so iOS Safari tints its top/bottom chrome to blend with the
   wallpaper (browser chrome can't show the image itself, only a tint), and
   rubber-band overscroll shows a matching colour instead of white. */
const EDGE_TONES: Record<Exclude<WallpaperId, 'plain'>, string> = {
  lilies: '#8fa89b',
  wave: '#e3dcc6',
  starry: '#1e2a4a',
};

/* Bottom-edge tone per wallpaper — in standalone mode this colours the thin
   home-indicator sliver the cover-sized image doesn't reach, so it reads as
   a continuation of the artwork's bottom instead of a bare stripe. */
const BOTTOM_TONES: Record<Exclude<WallpaperId, 'plain'>, string> = {
  lilies: '#6f8f80',
  wave: '#41607a',
  starry: '#141d33',
};

const LS_KEY = 'focusos-wallpaper';
const LS_PLAIN_COLOR_KEY = 'focusos-plain-color';
const CHANGE_EVENT = 'focusos-wallpaper-change';
const PLAIN_COLOR_EVENT = 'focusos-plain-color-change';

export const DEFAULT_PLAIN_COLOR = '#eef1f5';

export function getWallpaper(): WallpaperId {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && v in WALLPAPERS) return v as WallpaperId;
  } catch {
    /* storage unavailable */
  }
  return 'wave';
}

export function setWallpaper(id: WallpaperId) {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id }));
}

export function getPlainColor(): string {
  try {
    const v = localStorage.getItem(LS_PLAIN_COLOR_KEY);
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_PLAIN_COLOR;
}

export function setPlainColor(hex: string) {
  try {
    localStorage.setItem(LS_PLAIN_COLOR_KEY, hex);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(PLAIN_COLOR_EVENT, { detail: hex }));
}

/** WCAG relative luminance; < 0.45 counts as a dark background. */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum =
    0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
  return lum < 0.45;
}

export function useWallpaper(): [WallpaperId, (id: WallpaperId) => void] {
  const [id, setId] = useState<WallpaperId>(getWallpaper);
  useEffect(() => {
    const onChange = (e: Event) => setId((e as CustomEvent).detail as WallpaperId);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return [id, setWallpaper];
}

export function usePlainColor(): [string, (hex: string) => void] {
  const [color, setColor] = useState<string>(getPlainColor);
  useEffect(() => {
    const onChange = (e: Event) => setColor((e as CustomEvent).detail as string);
    window.addEventListener(PLAIN_COLOR_EVENT, onChange);
    return () => window.removeEventListener(PLAIN_COLOR_EVENT, onChange);
  }, []);
  return [color, setPlainColor];
}

/** Mounted once in main.tsx. Keeps <html> wallpaper attributes and vars in sync. */
export function WallpaperController() {
  const [wp] = useWallpaper();
  const [plainColor] = usePlainColor();

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.wallpaper = wp;
    const src = WALLPAPERS[wp].src;
    el.style.setProperty('--wallpaper-url', src ? `url('${src}')` : 'none');
    if (wp === 'plain') {
      el.style.setProperty('--plain-color', plainColor);
      el.dataset.plainTone = isDarkColor(plainColor) ? 'dark' : 'light';
    } else {
      el.style.removeProperty('--plain-color');
      delete el.dataset.plainTone;
    }
    // Blend the browser chrome (Safari status bar / toolbar) into the wallpaper.
    const tone = wp === 'plain' ? plainColor : EDGE_TONES[wp];
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = tone;
    // Standalone: the root background-color only ever shows in the bottom
    // home-indicator sliver, so use the artwork's bottom-edge tone there.
    // Safari: it shows on overscroll top/bottom, keep the (top) edge tone.
    const standalone = el.classList.contains('standalone');
    el.style.backgroundColor =
      standalone && wp !== 'plain' ? BOTTOM_TONES[wp] : tone;
  }, [wp, plainColor]);

  return null;
}

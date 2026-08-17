/**
 * Liquid Glass wallpaper system.
 * Liquid Glass is the app's only theme; the wallpaper choice drives its
 * material state. Each wallpaper maps to a data-wallpaper attribute on
 * <html>, which src/index.css uses to pick the frost / smoke / solid token
 * set and the accent. Images live in the public Supabase Storage bucket
 * `wallpapers`. The Plain wallpaper takes a user-picked colour
 * (--plain-color); data-plain-tone flips the tokens dark when the picked
 * colour is dark so text stays readable. The Custom wallpaper ("My Photo")
 * takes a photo from the user's own library: the paintable copy is a data-URI
 * in localStorage (so it paints in the same tick as a built-in, with no
 * network), and an uploaded copy in the task-image bucket is the refresh /
 * fresh-device fallback.
 * Choices persist in localStorage (per device) for now; syncing them through
 * focusos_user_preferences is a later, deliberate migration.
 */
import { useEffect, useState } from 'react';

export type WallpaperId = 'lilies' | 'wave' | 'starry' | 'plain' | 'custom';

const BUCKET = 'https://mshlbsgsyzzfxyxramjj.supabase.co/storage/v1/object/public/wallpapers';

export const WALLPAPERS: Record<WallpaperId, { name: string; src: string | null }> = {
  lilies: { name: 'Monet', src: `${BUCKET}/water-lilies.jpg` },
  wave: { name: 'Hokusai', src: `${BUCKET}/great-wave.jpg` },
  starry: { name: 'Van Gogh', src: `${BUCKET}/starry-night.jpg` },
  plain: { name: 'Plain', src: null },
  /* src is resolved per device from the localStorage cache, not from a fixed
     URL — see customWallpaperSrc(). */
  custom: { name: 'My Photo', src: null },
};

/* Edge tone per wallpaper — fed to <meta name="theme-color"> and the <html>
   background so iOS Safari tints its top/bottom chrome to blend with the
   wallpaper (browser chrome can't show the image itself, only a tint), and
   rubber-band overscroll shows a matching colour instead of white. */
const EDGE_TONES: Record<Exclude<WallpaperId, 'plain'>, string> = {
  lilies: '#8fa89b',
  wave: '#e3dcc6',
  starry: '#1e2a4a',
  /* An arbitrary photo has no known edge colour, and Custom wears the darkest
     built-in's scrim, so a neutral dark tone blends with the veiled artwork. */
  custom: '#1d2126',
};

/* Bottom-edge tone per wallpaper — in standalone mode this colours the thin
   home-indicator sliver the cover-sized image doesn't reach, so it reads as
   a continuation of the artwork's bottom instead of a bare stripe. */
const BOTTOM_TONES: Record<Exclude<WallpaperId, 'plain'>, string> = {
  lilies: '#6f8f80',
  wave: '#41607a',
  starry: '#141d33',
  custom: '#14181c',
};

const LS_KEY = 'focusos-wallpaper';
const LS_PLAIN_COLOR_KEY = 'focusos-plain-color';
const LS_CUSTOM_DATA_KEY = 'focusos-custom-wallpaper';
const LS_CUSTOM_URL_KEY = 'focusos-custom-wallpaper-url';
const CHANGE_EVENT = 'focusos-wallpaper-change';
const PLAIN_COLOR_EVENT = 'focusos-plain-color-change';
const CUSTOM_EVENT = 'focusos-custom-wallpaper-change';

export const DEFAULT_PLAIN_COLOR = '#eef1f5';

/* Encoder settings for "My Photo". The upload copy is the archival one; the
   cache copy has to fit localStorage (a few MB per origin in Safari), so it is
   deliberately smaller, and FALLBACK_* is the retry when even that is refused. */
export const CUSTOM_UPLOAD_MAX_DIM = 2000;
export const CUSTOM_UPLOAD_QUALITY = 0.85;
export const CUSTOM_CACHE_MAX_DIM = 1280;
export const CUSTOM_CACHE_QUALITY = 0.8;
export const CUSTOM_CACHE_FALLBACK_MAX_DIM = 900;
export const CUSTOM_CACHE_FALLBACK_QUALITY = 0.7;

/** The user's own photo: instant-paint copy + the uploaded copy's public URL. */
export type CustomWallpaper = { dataUri: string | null; url: string | null };

/** Synchronous read — same shape and cost as getWallpaper(), so the custom
 *  photo is known during the SAME render that resolves the wallpaper id. */
export function getCustomWallpaper(): CustomWallpaper {
  let dataUri: string | null = null;
  let url: string | null = null;
  try {
    const d = localStorage.getItem(LS_CUSTOM_DATA_KEY);
    if (d && d.startsWith('data:image/')) dataUri = d;
    const u = localStorage.getItem(LS_CUSTOM_URL_KEY);
    if (u && /^https?:\/\//.test(u)) url = u;
  } catch {
    /* storage unavailable */
  }
  return { dataUri, url };
}

/** The paint source for a custom photo: the local data-URI cache FIRST (no
 *  network, so it lands in the first wallpaper write exactly like a built-in
 *  URL), the uploaded copy only as the fresh-device fallback. */
export function customWallpaperSrc(c: CustomWallpaper): string | null {
  return c.dataUri ?? c.url;
}

export function hasCustomWallpaper(c: CustomWallpaper = getCustomWallpaper()): boolean {
  return customWallpaperSrc(c) !== null;
}

/** Store the instant-paint copy. Returns false when the device refuses the
 *  write (quota) — the caller then re-encodes smaller rather than selecting a
 *  wallpaper it cannot paint on the next cold start. */
export function cacheCustomWallpaper(dataUri: string): boolean {
  try {
    localStorage.setItem(LS_CUSTOM_DATA_KEY, dataUri);
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
  return true;
}

/** Record the uploaded copy's public URL (refresh / fresh-device fallback). */
export function setCustomWallpaperUrl(url: string) {
  try {
    localStorage.setItem(LS_CUSTOM_URL_KEY, url);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
}

/** Drop this device's photo. The uploaded copy is left in storage on purpose:
 *  this is the per-device cache, not an account-wide delete. */
export function clearCustomWallpaper() {
  try {
    localStorage.removeItem(LS_CUSTOM_DATA_KEY);
    localStorage.removeItem(LS_CUSTOM_URL_KEY);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
}

export function getWallpaper(): WallpaperId {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && v in WALLPAPERS) {
      // 'custom' with nothing to paint (cache cleared, upload never happened)
      // would leave a bare dark void. Resolve that during this same read, not
      // by correcting state after paint.
      if (v === 'custom' && !hasCustomWallpaper()) return 'wave';
      return v as WallpaperId;
    }
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

export function useCustomWallpaper(): CustomWallpaper {
  const [custom, setCustom] = useState<CustomWallpaper>(getCustomWallpaper);
  useEffect(() => {
    const onChange = () => setCustom(getCustomWallpaper());
    window.addEventListener(CUSTOM_EVENT, onChange);
    return () => window.removeEventListener(CUSTOM_EVENT, onChange);
  }, []);
  return custom;
}

/** Mounted once in main.tsx. Keeps <html> wallpaper attributes and vars in sync. */
export function WallpaperController() {
  const [wp] = useWallpaper();
  const [plainColor] = usePlainColor();
  const custom = useCustomWallpaper();

  // Derived DURING render, never corrected after paint: both the id and the
  // custom photo come out of localStorage synchronously (state initialisers),
  // so a custom photo is already in hand for the FIRST --wallpaper-url write —
  // the same code path and the same tick as a built-in URL, with no swap.
  const src = wp === 'custom' ? customWallpaperSrc(custom) : WALLPAPERS[wp].src;

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.wallpaper = wp;
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
  }, [wp, plainColor, src]);

  return null;
}

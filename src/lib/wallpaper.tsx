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
 * fresh-device fallback. The photo is measured once when it is picked (see
 * encodeImageWithStats) and the numbers ride beside it in localStorage, so the
 * SAME synchronous read that picks data-wallpaper also picks data-custom-tone
 * (light photo -> light glass + dark text, dark photo -> the smoke treatment)
 * and the accent sampled from the photo (--custom-accent).
 * Choices persist in localStorage (per device) for now; syncing them through
 * focusos_user_preferences is a later, deliberate migration.
 */
import { useEffect, useState } from 'react';
import type { PhotoStats } from '@/lib/taskImageStorage';

export type WallpaperId = 'lilies' | 'wave' | 'starry' | 'plain' | 'custom';

/** Custom-photo treatment: 'light' is minimal veil + light glass + dark text,
 *  'dark' is the smoke treatment every custom photo used to wear. */
export type CustomTone = 'light' | 'dark';

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

/* A bright photo wears the light treatment, so its chrome tint has to be light
   too — the dark tones above would read as a black band above the picture. */
const CUSTOM_LIGHT_EDGE_TONE = '#e9ecef';
const CUSTOM_LIGHT_BOTTOM_TONE = '#dfe3e8';

const LS_KEY = 'focusos-wallpaper';
const LS_PLAIN_COLOR_KEY = 'focusos-plain-color';
const LS_CUSTOM_DATA_KEY = 'focusos-custom-wallpaper';
const LS_CUSTOM_URL_KEY = 'focusos-custom-wallpaper-url';
const LS_CUSTOM_META_KEY = 'focusos-custom-wallpaper-meta';
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

/* Photo measurements live in their OWN key: the paint cache stays a bare
   data-URI, so the cold-start read that paints the wallpaper is untouched. */
const CUSTOM_META_VERSION = 1;

/** What the picked photo looks like, as stored beside it. */
export type CustomPhotoMeta = PhotoStats;

/** The user's own photo: instant-paint copy, the uploaded copy's public URL,
 *  and how the photo measured (null for a photo cached before W4 — it keeps
 *  today's dark treatment until the user picks a photo again). */
export type CustomWallpaper = {
  dataUri: string | null;
  url: string | null;
  meta: CustomPhotoMeta | null;
};

/** Synchronous read — same shape and cost as getWallpaper(), so the custom
 *  photo is known during the SAME render that resolves the wallpaper id. */
export function getCustomWallpaper(): CustomWallpaper {
  let dataUri: string | null = null;
  let url: string | null = null;
  let meta: CustomPhotoMeta | null = null;
  try {
    const d = localStorage.getItem(LS_CUSTOM_DATA_KEY);
    if (d && d.startsWith('data:image/')) dataUri = d;
    const u = localStorage.getItem(LS_CUSTOM_URL_KEY);
    if (u && /^https?:\/\//.test(u)) url = u;
    meta = parseCustomMeta(localStorage.getItem(LS_CUSTOM_META_KEY));
  } catch {
    /* storage unavailable */
  }
  return { dataUri, url, meta };
}

/** Anything malformed or from a future shape reads as "no measurement", which
 *  is the same as an old photo: the dark treatment, never a broken one. */
function parseCustomMeta(raw: string | null): CustomPhotoMeta | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as { v?: number; brightness?: unknown; dominant?: unknown };
    if (m?.v !== CUSTOM_META_VERSION) return null;
    if (typeof m.brightness !== 'number' || !(m.brightness >= 0 && m.brightness <= 1)) return null;
    const dominant =
      typeof m.dominant === 'string' && /^#[0-9a-f]{6}$/i.test(m.dominant) ? m.dominant : null;
    return { brightness: m.brightness, dominant };
  } catch {
    return null;
  }
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

/** Store the instant-paint copy plus what the photo measured. Returns false
 *  when the device refuses the write (quota) — the caller then re-encodes
 *  smaller rather than selecting a wallpaper it cannot paint on the next cold
 *  start. The meta is written after the photo and cleared when it is missing,
 *  so the two can never describe different pictures. */
export function cacheCustomWallpaper(dataUri: string, meta?: CustomPhotoMeta | null): boolean {
  try {
    localStorage.setItem(LS_CUSTOM_DATA_KEY, dataUri);
  } catch {
    return false;
  }
  try {
    if (meta) {
      localStorage.setItem(
        LS_CUSTOM_META_KEY,
        JSON.stringify({ v: CUSTOM_META_VERSION, ...meta })
      );
    } else {
      localStorage.removeItem(LS_CUSTOM_META_KEY);
    }
  } catch {
    /* the photo is cached; an unmeasured photo just takes the dark treatment */
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
    localStorage.removeItem(LS_CUSTOM_META_KEY);
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

/* --- Custom-photo treatment ------------------------------------------------
   Two numbers off the photo decide everything: mean brightness picks the tone,
   the dominant colour becomes the accent. Both guarded, because an arbitrary
   photo is allowed to be anything. */

/** Mean brightness at or above this reads as a genuinely bright photo — the
 *  only case that earns dark text. An average outdoor shot sits near 0.5. */
export const CUSTOM_LIGHT_BRIGHTNESS = 0.62;
/** Guard rails on the sampled colour: too grey or too dark and its hue is
 *  noise, so the app's own teal is the better accent. */
const CUSTOM_ACCENT_MIN_SATURATION = 0.2;
const CUSTOM_ACCENT_MIN_LIGHTNESS = 0.12;
/* The photo gives hue; saturation is bounded and lightness is fixed per tone,
   so the accent always clears its own background instead of trusting a photo
   to have picked a legible colour. */
const CUSTOM_ACCENT_SATURATION_FLOOR = 0.45;
const CUSTOM_ACCENT_SATURATION_CEIL = 0.85;
const CUSTOM_ACCENT_LIGHTNESS: Record<CustomTone, number> = { light: 0.34, dark: 0.72 };
const CUSTOM_ACCENT_FOREGROUND: Record<CustomTone, string> = {
  light: '0 0% 100%',
  dark: '220 40% 10%',
};

/** #rrggbb -> HSL, hue in degrees, saturation and lightness 0-1. */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** The treatment a measured photo earns. No measurement (a photo cached before
 *  this shipped, or the uploaded copy on a fresh device) = today's behaviour. */
export function customTone(meta: CustomPhotoMeta | null): CustomTone {
  return meta && meta.brightness >= CUSTOM_LIGHT_BRIGHTNESS ? 'light' : 'dark';
}

/** The photo's accent as an HSL triplet ('45 85% 34%', the shape the theme
 *  tokens take), or null when the photo has no colour worth borrowing and the
 *  teal fallback in the CSS should stand. */
export function customAccent(meta: CustomPhotoMeta | null, tone: CustomTone): string | null {
  if (!meta?.dominant) return null;
  const { h, s, l } = hexToHsl(meta.dominant);
  if (s < CUSTOM_ACCENT_MIN_SATURATION || l < CUSTOM_ACCENT_MIN_LIGHTNESS) return null;
  const sat = Math.min(CUSTOM_ACCENT_SATURATION_CEIL, Math.max(CUSTOM_ACCENT_SATURATION_FLOOR, s));
  return `${Math.round(h)} ${Math.round(sat * 100)}% ${Math.round(CUSTOM_ACCENT_LIGHTNESS[tone] * 100)}%`;
}

/** Text/icon colour that sits ON the sampled accent. */
export function customAccentForeground(tone: CustomTone): string {
  return CUSTOM_ACCENT_FOREGROUND[tone];
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
  // the same code path and the same tick as a built-in URL, with no swap. The
  // photo's tone and accent come off the same read, so they land in that first
  // write too: no dark-then-light flip.
  const src = wp === 'custom' ? customWallpaperSrc(custom) : WALLPAPERS[wp].src;
  const photoTone = wp === 'custom' ? customTone(custom.meta) : null;
  const photoAccent = photoTone ? customAccent(custom.meta, photoTone) : null;

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
    if (photoTone) {
      el.dataset.customTone = photoTone;
    } else {
      delete el.dataset.customTone;
    }
    if (photoAccent && photoTone) {
      el.style.setProperty('--custom-accent', photoAccent);
      el.style.setProperty('--custom-accent-fg', customAccentForeground(photoTone));
    } else {
      el.style.removeProperty('--custom-accent');
      el.style.removeProperty('--custom-accent-fg');
    }
    // Blend the browser chrome (Safari status bar / toolbar) into the wallpaper.
    const tone =
      wp === 'plain'
        ? plainColor
        : photoTone === 'light'
          ? CUSTOM_LIGHT_EDGE_TONE
          : EDGE_TONES[wp];
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
      standalone && wp !== 'plain'
        ? photoTone === 'light'
          ? CUSTOM_LIGHT_BOTTOM_TONE
          : BOTTOM_TONES[wp]
        : tone;
  }, [wp, plainColor, src, photoTone, photoAccent]);

  return null;
}

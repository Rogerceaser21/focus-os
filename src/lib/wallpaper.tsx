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
 * Choices persist in localStorage so they paint before any network, and the
 * SAME choice rides the account through focusos_user_preferences.wallpaper_prefs
 * (see "Account sync" at the bottom of this file): the device cache is the
 * paint source, the account column is the source of truth between devices.
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
  stampWallpaperChange();
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
  stampWallpaperChange();
}

/** Drop this device's photo. The uploaded FILE is left in the bucket on purpose
 *  (nothing else can put it back), but the account's pointer to it travels with
 *  the choice, so the next sync carries "no photo" like any other change. */
export function clearCustomWallpaper() {
  try {
    localStorage.removeItem(LS_CUSTOM_DATA_KEY);
    localStorage.removeItem(LS_CUSTOM_URL_KEY);
    localStorage.removeItem(LS_CUSTOM_META_KEY);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
  stampWallpaperChange();
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

/** The stored choice, verbatim. getWallpaper() coerces an unpaintable 'custom'
 *  to the default so nothing paints a void; the ACCOUNT copy must carry what the
 *  user actually picked, or a device whose photo cache was evicted would push
 *  'wave' over the account's custom choice. */
function rawWallpaperChoice(): WallpaperId | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && v in WALLPAPERS) return v as WallpaperId;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function setWallpaper(id: WallpaperId) {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: id }));
  stampWallpaperChange();
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
  stampWallpaperChange();
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

/* --- Account sync -----------------------------------------------------------
   The wallpaper is a per-ACCOUNT choice that is CACHED per device, not a device
   setting. Nothing below runs before paint: localStorage stays the only
   first-paint source (the no-flash law at the top of this file is untouched),
   and focusos_user_preferences.wallpaper_prefs carries the choice between
   devices.

   Write path: every setter above stamps the choice with the moment it was made
   (LS_SYNC_KEY, keyed by account) AFTER its own synchronous localStorage write,
   then schedules a fire-and-forget push of the whole choice to the account. The
   push is debounced because one picker interaction is several setter calls
   (cache the photo, select it, record the uploaded URL) and the account only
   wants the settled result.

   Read path: ONE reconciliation per account per session, run post-paint from
   useUserPreferences once the preferences row has resolved (the same shape as
   ensureDefaultPreferences). The later updatedAt wins; a swap it decides on is
   applied through the SAME setters, so the wallpaper layer changes exactly once
   by the existing path and no new animation runs across it.

   The trade-off, stated plainly: on a brand-new device the first load paints the
   default until the preferences row arrives, then swaps once. Every later load
   on that device is already cached and paints the right wallpaper immediately.
   -------------------------------------------------------------------------- */

/** Shape version of the jsonb payload. Anything else reads as "no value". */
export const WALLPAPER_PREFS_VERSION = 1;

const LS_SYNC_KEY = 'focusos-wallpaper-sync';

/** The account copy of the choice: everything a fresh device needs to paint it
 *  without re-measuring the photo, plus when it was chosen. */
export type WallpaperPrefs = {
  v: number;
  id: WallpaperId;
  plainColor: string;
  customUrl: string | null;
  customBrightness: number | null;
  customDominant: string | null;
  updatedAt: string;
};

/** What this device last wrote, and for WHICH account. The account id is what
 *  stops a second user on the same device from inheriting the first user's
 *  choice: a stamp belonging to someone else is not a comparable timestamp. */
type SyncStamp = { updatedAt: string; userId: string | null };

export type WallpaperSyncPush = (prefs: WallpaperPrefs) => void;

/** What the reconciliation decided (returned for tests and diagnostics). */
export type WallpaperSyncOutcome =
  | 'applied-remote'
  | 'pushed-local'
  | 'in-sync'
  | 'reset-foreign';

const PUSH_DEBOUNCE_MS = 250;

let syncUserId: string | null = null;
let syncPush: WallpaperSyncPush | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/* True only while the reconciliation is writing the account's choice into the
   setters, so the echo never travels back up as a fresh local change. */
let applyingRemote = false;

const nowIso = () => new Date().toISOString();

/** ISO string -> comparable number; anything unparseable sorts oldest. */
const at = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

function readSyncStamp(): SyncStamp | null {
  try {
    const raw = localStorage.getItem(LS_SYNC_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { updatedAt?: unknown; userId?: unknown };
    if (typeof s?.updatedAt !== 'string' || at(s.updatedAt) === -Infinity) return null;
    return {
      updatedAt: s.updatedAt,
      userId: typeof s.userId === 'string' && s.userId ? s.userId : null,
    };
  } catch {
    return null;
  }
}

function writeSyncStamp(updatedAt: string, userId: string | null) {
  try {
    localStorage.setItem(LS_SYNC_KEY, JSON.stringify({ updatedAt, userId }));
  } catch {
    /* storage unavailable: the choice still paints, it just never syncs */
  }
}

/** This device's choice as the account would store it, at a given moment. */
export function localWallpaperPrefs(updatedAt: string): WallpaperPrefs {
  const custom = getCustomWallpaper();
  return {
    v: WALLPAPER_PREFS_VERSION,
    id: rawWallpaperChoice() ?? getWallpaper(),
    plainColor: getPlainColor(),
    customUrl: custom.url,
    customBrightness: custom.meta ? custom.meta.brightness : null,
    customDominant: custom.meta ? custom.meta.dominant : null,
    updatedAt,
  };
}

/** Guarded read of the jsonb column. An arbitrary row is allowed to be
 *  anything, and a value this build does not understand must never paint. */
export function parseWallpaperPrefs(raw: unknown): WallpaperPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== WALLPAPER_PREFS_VERSION) return null;
  if (typeof p.id !== 'string' || !(p.id in WALLPAPERS)) return null;
  if (typeof p.updatedAt !== 'string' || at(p.updatedAt) === -Infinity) return null;
  const plainColor =
    typeof p.plainColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.plainColor)
      ? p.plainColor
      : DEFAULT_PLAIN_COLOR;
  const customUrl =
    typeof p.customUrl === 'string' && /^https?:\/\//.test(p.customUrl) ? p.customUrl : null;
  const customBrightness =
    typeof p.customBrightness === 'number' && p.customBrightness >= 0 && p.customBrightness <= 1
      ? p.customBrightness
      : null;
  const customDominant =
    typeof p.customDominant === 'string' && /^#[0-9a-f]{6}$/i.test(p.customDominant)
      ? p.customDominant
      : null;
  return {
    v: WALLPAPER_PREFS_VERSION,
    id: p.id as WallpaperId,
    plainColor,
    customUrl,
    customBrightness,
    customDominant,
    updatedAt: p.updatedAt,
  };
}

/** Called by every setter above, AFTER its own localStorage write and its
 *  change event: the visible path is never waiting on the account. */
function stampWallpaperChange() {
  if (applyingRemote) return;
  writeSyncStamp(nowIso(), syncUserId);
  if (!syncPush) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const push = syncPush;
    if (!push) return;
    push(localWallpaperPrefs(readSyncStamp()?.updatedAt ?? nowIso()));
  }, PUSH_DEBOUNCE_MS);
}

/** Point the write path at an account. Idempotent: every useUserPreferences
 *  instance calls it with the same pair, and the last one wins. */
export function connectWallpaperSync(userId: string, push: WallpaperSyncPush) {
  syncUserId = userId;
  syncPush = push;
}

/* The account's photo, as a data URI this device can paint with no network on
   every later cold start. Best effort: the uploaded URL alone already paints,
   the cache copy only removes the fetch. The taskImageStorage import is dynamic
   on purpose, because this file is loaded by main.tsx before first paint and
   must not pull the storage/supabase graph into that path. */
async function fetchRemotePhoto(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    const { blobToDataUri } = await import('@/lib/taskImageStorage');
    return await blobToDataUri(blob);
  } catch {
    return null;
  }
}

/** Put the account's choice on this device. Every write goes through the
 *  existing setters, so the wallpaper layer changes by the one path the app
 *  already has (no second mechanism, no animation across the swap). */
async function applyWallpaperPrefs(prefs: WallpaperPrefs, userId: string) {
  let id = prefs.id;
  let photo: string | null = null;
  if (id === 'custom') {
    const local = getCustomWallpaper();
    const cached = !!local.dataUri && local.url === prefs.customUrl;
    if (!cached && prefs.customUrl) photo = await fetchRemotePhoto(prefs.customUrl);
    // Nothing to paint on this device and nothing to fetch: the built-in
    // default, never the bare void (same rule as getWallpaper()).
    if (!prefs.customUrl && !customWallpaperSrc(local)) id = 'wave';
  }

  // One synchronous block: the photo lands in the cache BEFORE the choice
  // selects it, exactly like the picker, so there is a single visible swap.
  applyingRemote = true;
  try {
    if (id === 'custom' && prefs.customUrl) {
      if (photo) {
        cacheCustomWallpaper(
          photo,
          prefs.customBrightness === null
            ? null
            : { brightness: prefs.customBrightness, dominant: prefs.customDominant },
        );
      }
      setCustomWallpaperUrl(prefs.customUrl);
    }
    if (prefs.plainColor !== getPlainColor()) setPlainColor(prefs.plainColor);
    // Unconditional: the stored choice and the PAINTED one can differ (a stored
    // 'custom' with no photo paints the default), so only the setter can be
    // trusted to bring the controller to this id. An identical value is a React
    // bail-out, not a repaint.
    setWallpaper(id);
  } finally {
    applyingRemote = false;
  }
  writeSyncStamp(prefs.updatedAt, userId);
}

/**
 * Reconcile this device's cached choice with the account's, exactly once per
 * account per session. Latest updatedAt wins; equal stamps are already in sync;
 * a device carrying ANOTHER account's choice never lets that choice win.
 */
export async function reconcileWallpaperPrefs(
  userId: string,
  remoteRaw: unknown,
  push: WallpaperSyncPush,
): Promise<WallpaperSyncOutcome> {
  const remote = parseWallpaperPrefs(remoteRaw);
  const stamp = readSyncStamp();
  // A stamp written for a different account is not this account's history, so
  // it carries no comparable timestamp (rule 3: no inheriting).
  const foreign = !!stamp && !!stamp.userId && stamp.userId !== userId;
  const localAt = foreign ? null : (stamp?.updatedAt ?? null);

  if (remote) {
    if (localAt === null || at(remote.updatedAt) > at(localAt)) {
      await applyWallpaperPrefs(remote, userId);
      return 'applied-remote';
    }
    if (localAt !== null && at(remote.updatedAt) === at(localAt)) {
      // Same moment on both sides: nothing to send, but claim the device for
      // this account so a later sign-in by someone else reads it as foreign.
      writeSyncStamp(localAt, userId);
      return 'in-sync';
    }
  } else if (foreign) {
    // Someone else's choice is cached here and this account has never chosen:
    // start it on the app default rather than hand over the other user's photo.
    const fresh: WallpaperPrefs = {
      v: WALLPAPER_PREFS_VERSION,
      id: 'wave',
      plainColor: DEFAULT_PLAIN_COLOR,
      customUrl: null,
      customBrightness: null,
      customDominant: null,
      updatedAt: nowIso(),
    };
    await applyWallpaperPrefs(fresh, userId);
    push(fresh);
    return 'reset-foreign';
  }

  const mineAt = localAt ?? nowIso();
  const mine = localWallpaperPrefs(mineAt);
  writeSyncStamp(mineAt, userId);
  push(mine);
  return 'pushed-local';
}

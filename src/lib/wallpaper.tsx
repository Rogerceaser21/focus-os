/**
 * Liquid Glass wallpaper system.
 * The wallpaper choice drives the theme's material state: each wallpaper maps
 * to a data-wallpaper attribute on <html>, which src/index.css uses to pick
 * the frost / smoke / solid token set and the accent. Images live in the
 * public Supabase Storage bucket `wallpapers`.
 * Choice persists in localStorage (per device) for now; syncing it through
 * focusos_user_preferences is a later, deliberate migration.
 */
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

export type WallpaperId = 'lilies' | 'wave' | 'starry' | 'plain';

const BUCKET = 'https://mshlbsgsyzzfxyxramjj.supabase.co/storage/v1/object/public/wallpapers';

export const WALLPAPERS: Record<WallpaperId, { name: string; src: string | null }> = {
  lilies: { name: 'Monet', src: `${BUCKET}/water-lilies.jpg` },
  wave: { name: 'Hokusai', src: `${BUCKET}/great-wave.jpg` },
  starry: { name: 'Van Gogh', src: `${BUCKET}/starry-night.jpg` },
  plain: { name: 'Plain', src: null },
};

const LS_KEY = 'focusos-wallpaper';
const CHANGE_EVENT = 'focusos-wallpaper-change';

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

export function useWallpaper(): [WallpaperId, (id: WallpaperId) => void] {
  const [id, setId] = useState<WallpaperId>(getWallpaper);
  useEffect(() => {
    const onChange = (e: Event) => setId((e as CustomEvent).detail as WallpaperId);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return [id, setWallpaper];
}

/** Mounted once in main.tsx. Keeps <html data-wallpaper> and --wallpaper-url in sync. */
export function WallpaperController() {
  const { theme } = useTheme();
  const [wp] = useWallpaper();

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'liquid-glass') {
      el.dataset.wallpaper = wp;
      const src = WALLPAPERS[wp].src;
      el.style.setProperty('--wallpaper-url', src ? `url('${src}')` : 'none');
    } else {
      delete el.dataset.wallpaper;
      el.style.removeProperty('--wallpaper-url');
    }
  }, [theme, wp]);

  return null;
}

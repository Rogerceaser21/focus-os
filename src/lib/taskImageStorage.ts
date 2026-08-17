import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'focusos-task-images';

const MAX_DIMENSION = 2000;
const COMPRESSION_SKIP_BYTES = 300 * 1024;
const WEBP_QUALITY = 0.85;

/* Wallpaper photos ride in the SAME bucket as task images, inside a
   `wallpapers` folder under the owner's own folder. The bucket's INSERT policy
   is `(storage.foldername(name))[1] = auth.uid()::text` (migration
   20260315100505), so the user id MUST stay the FIRST path segment — verified
   live against production storage: `{uid}/wallpapers/x.jpg` uploads 200 and
   reads 200 unauthenticated (the bucket is public), while a top-level
   `wallpapers/{uid}-x.jpg` is refused with "new row violates row-level
   security policy". No migration, no new bucket, no policy change. */
const WALLPAPER_FOLDER = 'wallpapers';

export type EncodeImageOptions = {
  /** Longest edge of the output, in pixels. Smaller inputs are never upscaled. */
  maxDimension: number;
  /** Output mime type, e.g. 'image/webp' or 'image/jpeg'. */
  mime: string;
  /** Encoder quality, 0-1. */
  quality: number;
};

/** What a photo LOOKS like, read off the downscale canvas: mean perceptual
 *  brightness (0-1) and the dominant colour as #rrggbb (null when the photo
 *  carries no usable hue at all — a greyscale or near-black picture).
 *  The wallpaper module owns what these MEAN (see src/lib/wallpaper.tsx). */
export type PhotoStats = { brightness: number; dominant: string | null };

export type EncodedImage = { blob: Blob; stats: PhotoStats | null };

/* Pixels sampled for the measurement. A stride keeps even a 2000px photo to a
   few thousand reads; a tone flip and one accent hue do not get better with
   more samples. */
const STATS_MAX_SAMPLES = 8000;
/* A pixel only joins the dominant-colour vote when it actually carries colour:
   flat grey, near-black and near-white pixels have no hue worth taking. */
const STATS_MIN_CHROMA = 20;
const STATS_MIN_MAX_CHANNEL = 40;
const STATS_MAX_MIN_CHANNEL = 245;
/* 4 bits per channel — coarse enough that a photo's shades of one colour land
   in the same bucket, fine enough that two real colours stay apart. */
const STATS_BUCKET_SHIFT = 4;

/**
 * Measure the canvas the downscale just drew: mean brightness over the whole
 * frame, plus the modal colour bucket averaged back to one hex. Never throws —
 * an unreadable canvas simply means the photo goes untreated.
 */
const measureCanvas = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): PhotoStats | null => {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }

  const pixels = width * height;
  const stride = Math.max(1, Math.floor(pixels / STATS_MAX_SAMPLES));
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let lumSum = 0;
  let samples = 0;

  for (let p = 0; p < pixels; p += stride) {
    const i = p * 4;
    if (data[i + 3] < 128) continue; // transparent pixels paint as nothing
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    samples++;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < STATS_MIN_CHROMA) continue;
    if (max < STATS_MIN_MAX_CHANNEL || min > STATS_MAX_MIN_CHANNEL) continue;
    const key =
      ((r >> STATS_BUCKET_SHIFT) << 8) |
      ((g >> STATS_BUCKET_SHIFT) << 4) |
      (b >> STATS_BUCKET_SHIFT);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.n++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }

  if (!samples) return null;

  // Insertion order breaks ties, so the same photo always yields the same hex.
  let top: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!top || bucket.n > top.n) top = bucket;
  }
  const chan = (sum: number, n: number) =>
    Math.round(sum / n)
      .toString(16)
      .padStart(2, '0');

  return {
    brightness: Math.round((lumSum / samples) * 1000) / 1000,
    dominant: top ? `#${chan(top.r, top.n)}${chan(top.g, top.n)}${chan(top.b, top.n)}` : null,
  };
};

/**
 * Decode an image, downscale its longest side to opts.maxDimension and
 * re-encode it as opts.mime at opts.quality. The single canvas path in the app
 * (task images and wallpaper photos both use it). Throws if the browser cannot
 * decode or cannot produce the requested type — callers decide the fallback.
 * `measure` reads the photo's brightness / dominant colour off the SAME canvas
 * the downscale already drew (the wallpaper picker wants them; task images do
 * not, and a full-frame getImageData is not free).
 */
const encodeCore = async (
  file: File | Blob,
  opts: EncodeImageOptions,
  measure: boolean
): Promise<EncodedImage> => {
  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;
  let width = 0;
  let height = 0;
  let source: CanvasImageSource;

  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } else {
      objectUrl = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Image decode failed'));
        i.src = objectUrl!;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    }

    if (!width || !height) throw new Error('Invalid image dimensions');

    const longest = Math.max(width, height);
    const scale = Math.min(1, opts.maxDimension / longest);
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(source, 0, 0, targetW, targetH);

    const stats = measure ? measureCanvas(ctx, targetW, targetH) : null;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), opts.mime, opts.quality);
    });

    if (!blob || blob.size === 0) throw new Error('Canvas toBlob returned empty');
    if (blob.type !== opts.mime) throw new Error(`${opts.mime} not supported by browser`);

    return { blob, stats };
  } finally {
    if (bitmap) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

/** Downscale + re-encode. */
export const encodeImage = async (
  file: File | Blob,
  opts: EncodeImageOptions
): Promise<Blob> => (await encodeCore(file, opts, false)).blob;

/** Downscale + re-encode, and hand back what the photo looks like (wallpaper). */
export const encodeImageWithStats = (
  file: File | Blob,
  opts: EncodeImageOptions
): Promise<EncodedImage> => encodeCore(file, opts, true);

/**
 * Compress an image: downscale longest side to MAX_DIMENSION and re-encode as WebP.
 * Throws if compression isn't supported or fails — callers should fall back to original.
 */
export const compressImage = (file: File | Blob): Promise<Blob> =>
  encodeImage(file, {
    maxDimension: MAX_DIMENSION,
    mime: 'image/webp',
    quality: WEBP_QUALITY,
  });

/**
 * Check if an image string is a legacy base64 data URL
 */
export const isBase64Image = (src: string): boolean => {
  return src.startsWith('data:');
};

/**
 * Get the display URL for an image (handles both base64 legacy and storage paths)
 */
export const getImageDisplayUrl = (imageSrc: string): string => {
  if (isBase64Image(imageSrc)) {
    return imageSrc;
  }
  // It's a storage path — construct public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(imageSrc);
  return data.publicUrl;
};

/**
 * Upload a File/Blob to Supabase Storage and return the storage path
 */
export const uploadTaskImage = async (
  file: File | Blob,
  userId: string
): Promise<string> => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const originalExt =
    file instanceof File && file.name ? file.name.split('.').pop() || 'jpg' : 'jpg';
  const mime = (file as File).type || '';

  let uploadBlob: Blob = file;
  let ext = originalExt;

  const isGif = mime === 'image/gif';
  const isSmall = file.size < COMPRESSION_SKIP_BYTES;

  if (!isGif && !isSmall) {
    try {
      uploadBlob = await compressImage(file);
      ext = 'webp';
    } catch (err) {
      console.warn('Image compression failed, uploading original:', err);
      uploadBlob = file;
      ext = originalExt;
    }
  }

  const path = `${userId}/${timestamp}-${random}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, uploadBlob, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    throw new Error(`Image upload failed: ${error.message}`);
  }

  return path;
};

/**
 * Upload a wallpaper photo and return its PUBLIC url (the bucket is public, so
 * no signing and no auth are needed to paint it). Path shape:
 * `{userId}/wallpapers/{timestamp}.jpg` — see WALLPAPER_FOLDER above for why
 * the user id has to lead.
 */
export const uploadWallpaperImage = async (
  file: Blob,
  userId: string
): Promise<string> => {
  const path = `${userId}/${WALLPAPER_FOLDER}/${Date.now()}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw new Error(`Wallpaper upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

/**
 * Read a Blob back as a data URL (the instant-paint wallpaper cache is stored
 * as a data URI, so it needs no network and no object-URL lifetime).
 */
export const blobToDataUri = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image data'));
    reader.readAsDataURL(blob);
  });

/**
 * Convert a base64 data URL to a Blob
 */
export const base64ToBlob = (base64: string): Blob => {
  const [header, data] = base64.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
};

/**
 * Delete an image from storage (only works for own images)
 */
export const deleteTaskImage = async (storagePath: string): Promise<void> => {
  if (isBase64Image(storagePath)) return; // Can't delete base64
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) {
    console.warn('Failed to delete image from storage:', error.message);
  }
};

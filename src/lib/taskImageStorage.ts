import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'focusos-task-images';

const MAX_DIMENSION = 2000;
const COMPRESSION_SKIP_BYTES = 300 * 1024;
const WEBP_QUALITY = 0.85;

/**
 * Compress an image: downscale longest side to MAX_DIMENSION and re-encode as WebP.
 * Throws if compression isn't supported or fails — callers should fall back to original.
 */
export const compressImage = async (file: File | Blob): Promise<Blob> => {
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
    const scale = Math.min(1, MAX_DIMENSION / longest);
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(source, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', WEBP_QUALITY);
    });

    if (!blob || blob.size === 0) throw new Error('Canvas toBlob returned empty');
    if (blob.type !== 'image/webp') throw new Error('WebP not supported by browser');

    return blob;
  } finally {
    if (bitmap) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

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

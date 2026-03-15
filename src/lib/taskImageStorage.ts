import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'focusos-task-images';

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
  const ext = file instanceof File && file.name ? file.name.split('.').pop() || 'jpg' : 'jpg';
  const path = `${userId}/${timestamp}-${random}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
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

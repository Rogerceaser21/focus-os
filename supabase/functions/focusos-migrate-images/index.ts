import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all tasks that have base64 images
    const { data: tasks, error: fetchError } = await supabase
      .from("focusos_tasks")
      .select("id, user_id, images")
      .not("images", "is", null);

    if (fetchError) throw fetchError;

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const task of tasks || []) {
      const images = task.images as string[];
      if (!images || images.length === 0) {
        skippedCount++;
        continue;
      }

      // Check if any images are still base64
      const hasBase64 = images.some((img: string) => typeof img === 'string' && img.startsWith('data:'));
      if (!hasBase64) {
        skippedCount++;
        continue;
      }

      const newImages: string[] = [];

      for (const img of images) {
        if (typeof img !== 'string' || !img.startsWith('data:')) {
          // Already a storage path
          newImages.push(img);
          continue;
        }

        try {
          // Convert base64 to blob
          const [header, data] = img.split(',');
          const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
          const ext = mime.split('/')[1] || 'jpg';
          const bytes = atob(data);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) {
            arr[i] = bytes.charCodeAt(i);
          }
          const blob = new Blob([arr], { type: mime });

          const timestamp = Date.now();
          const random = Math.random().toString(36).substring(2, 8);
          const path = `${task.user_id}/${timestamp}-${random}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('focusos-task-images')
            .upload(path, blob, {
              contentType: mime,
              cacheControl: '3600',
              upsert: false,
            });

          if (uploadError) {
            console.error(`Upload error for task ${task.id}:`, uploadError.message);
            newImages.push(img); // Keep base64 on failure
            errorCount++;
          } else {
            newImages.push(path);
          }
        } catch (e) {
          console.error(`Error processing image for task ${task.id}:`, e);
          newImages.push(img); // Keep base64 on failure
          errorCount++;
        }
      }

      // Update task with new image paths
      const { error: updateError } = await supabase
        .from("focusos_tasks")
        .update({ images: newImages })
        .eq("id", task.id);

      if (updateError) {
        console.error(`Update error for task ${task.id}:`, updateError.message);
        errorCount++;
      } else {
        migratedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        migrated: migratedCount,
        skipped: skippedCount,
        errors: errorCount,
        totalTasks: tasks?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Migration error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

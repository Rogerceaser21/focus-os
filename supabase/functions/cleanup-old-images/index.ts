import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find tasks that have been completed for more than 7 days and still have images
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log(`Looking for completed tasks older than: ${sevenDaysAgo.toISOString()}`);

    // Get tasks that need cleanup
    const { data: tasksToClean, error: fetchError } = await supabase
      .from('focusos_tasks')
      .select('id, title, images, completed_at')
      .eq('status', 'completed')
      .lt('completed_at', sevenDaysAgo.toISOString())
      .neq('images', '[]');

    if (fetchError) {
      console.error('Error fetching tasks:', fetchError);
      throw fetchError;
    }

    // Filter to only tasks that actually have images
    const tasksWithImages = tasksToClean?.filter(task => 
      task.images && Array.isArray(task.images) && task.images.length > 0
    ) || [];

    console.log(`Found ${tasksWithImages.length} tasks with images to clean up`);

    if (tasksWithImages.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No tasks to clean up',
        cleaned: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log what we're cleaning
    for (const task of tasksWithImages) {
      console.log(`Cleaning images from task: "${task.title}" (${task.id}), ${task.images.length} images, completed at: ${task.completed_at}`);
    }

    // Update tasks to clear their images
    const taskIds = tasksWithImages.map(t => t.id);
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ images: [] })
      .in('id', taskIds);

    if (updateError) {
      console.error('Error updating tasks:', updateError);
      throw updateError;
    }

    const totalImagesRemoved = tasksWithImages.reduce((sum, t) => sum + (t.images?.length || 0), 0);
    console.log(`Successfully cleaned ${totalImagesRemoved} images from ${tasksWithImages.length} tasks`);

    return new Response(JSON.stringify({ 
      message: `Cleaned images from ${tasksWithImages.length} tasks`,
      cleaned: tasksWithImages.length,
      imagesRemoved: totalImagesRemoved
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in cleanup-old-images function:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

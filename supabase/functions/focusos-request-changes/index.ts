import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { taskId, message } = await req.json();

    if (!taskId || !message) {
      return new Response(JSON.stringify({ error: "taskId and message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear completed_by_email on sender's task
    await supabaseAdmin
      .from("focusos_tasks")
      .update({
        completed_by_email: null,
        change_request_message: null,
      })
      .eq("id", taskId);

    // Case 1: This task is the sender's original — find recipient's cloned task
    const { data: asOriginal } = await supabaseAdmin
      .from("focusos_shared_items")
      .select("recipient_task_id")
      .eq("item_id", taskId)
      .eq("item_type", "task")
      .eq("status", "accepted")
      .not("recipient_task_id", "is", null);

    if (asOriginal && asOriginal.length > 0) {
      for (const si of asOriginal) {
        await supabaseAdmin
          .from("focusos_tasks")
          .update({
            status: "todo",
            completed_by_email: null,
            completed_at: null,
            change_request_message: message,
          })
          .eq("id", si.recipient_task_id);
      }
    }

    // Case 2: This task is the recipient's clone — find sender's original task
    const { data: asClone } = await supabaseAdmin
      .from("focusos_shared_items")
      .select("item_id")
      .eq("recipient_task_id", taskId)
      .eq("item_type", "task")
      .eq("status", "accepted");

    if (asClone && asClone.length > 0) {
      for (const si of asClone) {
        await supabaseAdmin
          .from("focusos_tasks")
          .update({
            status: "todo",
            completed_by_email: null,
            completed_at: null,
            change_request_message: message,
          })
          .eq("id", si.item_id);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in focusos-request-changes:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

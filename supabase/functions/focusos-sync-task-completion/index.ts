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

    const { taskId, completedByEmail } = await req.json();

    if (!taskId) {
      return new Response(JSON.stringify({ error: "taskId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = completedByEmail || user.email || "unknown";

    // Case 1: This task is the sender's original — update recipient's cloned task
    // Only set completed_by_email, do NOT change status — let the other user "Move to Done" manually
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
            completed_by_email: email,
          })
          .eq("id", si.recipient_task_id);
      }
    }

    // Case 2: This task is the recipient's clone — update sender's original task
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
            completed_by_email: email,
          })
          .eq("id", si.item_id);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in focusos-sync-task-completion:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

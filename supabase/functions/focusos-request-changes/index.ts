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

    const { taskId, message, recipientEmail } = await req.json();

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
    let query = supabaseAdmin
      .from("focusos_shared_items")
      .select("*")
      .eq("item_id", taskId)
      .eq("item_type", "task")
      .in("status", ["accepted", "completed"])
      .not("recipient_task_id", "is", null);
    
    // If recipientEmail is provided, target only that specific recipient
    if (recipientEmail) {
      query = query.eq("recipient_email", recipientEmail);
    }

    const { data: asOriginal } = await query;

    if (asOriginal && asOriginal.length > 0) {
      for (const si of asOriginal) {
        // Update recipient's task with change request
        await supabaseAdmin
          .from("focusos_tasks")
          .update({
            status: "todo",
            completed_by_email: null,
            completed_at: null,
            change_request_message: message,
          })
          .eq("id", si.recipient_task_id);

        // Revert shared_item status back to accepted
        await supabaseAdmin
          .from("focusos_shared_items")
          .update({ status: "accepted" })
          .eq("id", si.id);

        // Get sender info
        const { data: senderUser } = await supabaseAdmin
          .from("focusos_users")
          .select("email")
          .eq("user_id", user.id)
          .single();

        const { data: senderProfile } = await supabaseAdmin
          .from("focusos_profiles")
          .select("first_name, last_name")
          .eq("user_id", user.id)
          .single();

        const senderEmail = senderUser?.email || user.email || "";
        const senderName = senderProfile
          ? `${senderProfile.first_name || ""} ${senderProfile.last_name || ""}`.trim()
          : "";

        // Get the recipient's task title for the notification
        const { data: recipientTask } = await supabaseAdmin
          .from("focusos_tasks")
          .select("title, project_id")
          .eq("id", si.recipient_task_id)
          .single();

        // Get project name if available
        let projectName: string | null = si.project_name || null;
        if (!projectName && recipientTask?.project_id) {
          const { data: proj } = await supabaseAdmin
            .from("focusos_projects")
            .select("name")
            .eq("id", recipientTask.project_id)
            .single();
          if (proj) projectName = proj.name;
        }

        // Create a new shared_items record as a sidebar notification for the recipient
        await supabaseAdmin
          .from("focusos_shared_items")
          .insert({
            item_id: taskId,
            item_title: recipientTask?.title || "Task",
            item_type: "change_request",
            sender_user_id: user.id,
            sender_email: senderEmail,
            sender_name: message, // Store the change request message in sender_name
            recipient_email: si.recipient_email,
            recipient_user_id: si.recipient_user_id,
            recipient_task_id: si.recipient_task_id,
            project_name: projectName,
            status: "pending",
          });
      }
    }

    // Case 2: This task is the recipient's clone — find sender's original task
    const { data: asClone } = await supabaseAdmin
      .from("focusos_shared_items")
      .select("*")
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
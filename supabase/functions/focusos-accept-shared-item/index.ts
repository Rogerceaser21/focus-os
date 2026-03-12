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

    const recipientId = user.id;
    const { sharedItemId } = await req.json();

    if (!sharedItemId) {
      return new Response(JSON.stringify({ error: "sharedItemId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the shared item
    const { data: sharedItem, error: fetchError } = await supabaseAdmin
      .from("focusos_shared_items")
      .select("*")
      .eq("id", sharedItemId)
      .single();

    if (fetchError || !sharedItem) {
      return new Response(JSON.stringify({ error: "Shared item not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the current user is the recipient
    const recipientEmail = user.email?.toLowerCase();
    if (sharedItem.recipient_user_id !== recipientId && sharedItem.recipient_email !== recipientEmail) {
      return new Response(JSON.stringify({ error: "Not authorized to accept this item" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderId = sharedItem.sender_user_id;
    const itemType = sharedItem.item_type;
    const itemId = sharedItem.item_id;
    let recipientTaskId: string | null = null;

    if (itemType === "task") {
      // Fetch original task
      const { data: task } = await supabaseAdmin
        .from("focusos_tasks")
        .select("*")
        .eq("id", itemId)
        .single();

      if (task) {
        // Resolve or create a project for the recipient based on the shared item's project_name
        let recipientProjectId: string | null = null;
        const projectName = sharedItem.project_name;

        if (projectName) {
          // Check if recipient already has a project with this name
          const { data: existingProject } = await supabaseAdmin
            .from("focusos_projects")
            .select("id")
            .eq("user_id", recipientId)
            .eq("name", projectName)
            .single();

          if (existingProject) {
            recipientProjectId = existingProject.id;
          } else {
            // Look up original project color
            let projectColor = "#3b82f6";
            if (task.project_id) {
              const { data: origProject } = await supabaseAdmin
                .from("focusos_projects")
                .select("color")
                .eq("id", task.project_id)
                .single();
              if (origProject) projectColor = origProject.color;
            }
            // Create a new project for the recipient
            const { data: newProject } = await supabaseAdmin
              .from("focusos_projects")
              .insert({
                user_id: recipientId,
                name: projectName,
                color: projectColor,
                is_shared: true,
              })
              .select("id")
              .single();
            if (newProject) recipientProjectId = newProject.id;
          }
        }

        // Clone task for recipient
        const { data: newTask } = await supabaseAdmin
          .from("focusos_tasks")
          .insert({
            user_id: recipientId,
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: "todo",
            due_date: task.due_date,
            start_date: task.start_date,
            end_date: task.end_date,
            project_id: recipientProjectId,
            images: task.images,
            timer_total_seconds: 0,
            timer_is_running: false,
            timer_start_time: null,
            assigned_to_email: sharedItem.sender_email,
          })
          .select("id")
          .single();

        if (newTask) {
          recipientTaskId = newTask.id;
        }
      }
    } else if (itemType === "project") {
      const { data: project } = await supabaseAdmin
        .from("focusos_projects")
        .select("*")
        .eq("id", itemId)
        .single();

      if (project) {
        const { data: newProject } = await supabaseAdmin
          .from("focusos_projects")
          .insert({
            user_id: recipientId,
            name: project.name,
            color: project.color,
          })
          .select("id")
          .single();

        if (newProject) {
          const { data: tasks } = await supabaseAdmin
            .from("focusos_tasks")
            .select("*")
            .eq("project_id", itemId)
            .eq("user_id", senderId);

          if (tasks && tasks.length > 0) {
            const clonedTasks = tasks.map((t: any) => ({
              user_id: recipientId,
              project_id: newProject.id,
              title: t.title,
              description: t.description,
              priority: t.priority,
              status: "todo",
              due_date: t.due_date,
              start_date: t.start_date,
              end_date: t.end_date,
              images: t.images,
              timer_total_seconds: 0,
              timer_is_running: false,
              timer_start_time: null,
              assigned_to_email: sharedItem.sender_email,
            }));
            await supabaseAdmin.from("focusos_tasks").insert(clonedTasks);
          }
        }
      }
    } else if (itemType === "meeting") {
      const { data: meeting } = await supabaseAdmin
        .from("focusos_meetings")
        .select("*")
        .eq("id", itemId)
        .single();

      if (meeting) {
        await supabaseAdmin
          .from("focusos_meetings")
          .insert({
            user_id: recipientId,
            title: meeting.title,
            summary: meeting.summary,
            action_items: meeting.action_items,
            participants: meeting.participants,
            duration_seconds: meeting.duration_seconds,
            processing_status: "done",
          });
      }
    }

    // Update status to accepted, set recipient_user_id and recipient_task_id
    // Do NOT set sender_acknowledged — sender needs to dismiss the notification
    const { error: updateError } = await supabaseAdmin
      .from("focusos_shared_items")
      .update({
        status: "accepted",
        recipient_user_id: recipientId,
        recipient_task_id: recipientTaskId,
        sender_acknowledged: false,
      })
      .eq("id", sharedItemId);

    if (updateError) {
      console.error("Update error:", updateError);
      throw new Error("Failed to accept shared item");
    }

    // NO email notification for accept — sender gets live in-app notification instead

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in focusos-accept-shared-item:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

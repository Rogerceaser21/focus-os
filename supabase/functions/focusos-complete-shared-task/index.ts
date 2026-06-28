import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  let token = url.searchParams.get("token");
  if (!token) { try { const b = await req.json(); token = b.token; } catch (_) {} }

  if (!token) {
    return json({ ok: false, title: "Invalid link", message: "This link appears to be broken or incomplete." });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find task by share_token
    const { data: task, error: fetchError } = await supabase
      .from("focusos_tasks")
      .select("id, title, status, assigned_to_email, user_id")
      .eq("share_token", token)
      .single();

    if (fetchError || !task) {
      return json({ ok: false, title: "Task not found", message: "This link may have expired or the task was deleted." });
    }

    if (task.status === "completed") {
      return json({ ok: true, title: "Already completed", message: "This task has already been marked as completed." });
    }

    const completedByEmail = task.assigned_to_email || "external user";

    // Mark THIS task (sender's original) as completed with completed_by_email
    const { error: updateError } = await supabase
      .from("focusos_tasks")
      .update({
        completed_by_email: completedByEmail,
        status: "completed",
      })
      .eq("id", task.id);

    if (updateError) {
      throw updateError;
    }

    // Now sync: find the shared_items row that links this task, and update the recipient's cloned task too
    // Only set completed_by_email, do NOT change status — let the other user "Move to Done" manually
    const { data: sharedItems } = await supabase
      .from("focusos_shared_items")
      .select("id, recipient_task_id, item_id, completion_acknowledged, completed_at")
      .eq("item_id", task.id)
      .eq("item_type", "task")
      .eq("status", "accepted");

    if (sharedItems && sharedItems.length > 0) {
      for (const si of sharedItems) {
        if (si.recipient_task_id) {
          await supabase
            .from("focusos_tasks")
            .update({
              completed_by_email: completedByEmail,
            })
            .eq("id", si.recipient_task_id);
        }
        // Notify the original sender: stamp completion fields on the shared_items row.
        // Idempotent: don't overwrite once already completed/acknowledged.
        if (!si.completion_acknowledged && !si.completed_at) {
          await supabase
            .from("focusos_shared_items")
            .update({
              completed_by: completedByEmail,
              completed_at: new Date().toISOString(),
              completion_acknowledged: false,
            })
            .eq("id", si.id);
        }
      }
    }

    // Also check if THIS task is a recipient's task — sync back to sender's original
    const { data: reverseSharedItems } = await supabase
      .from("focusos_shared_items")
      .select("id, item_id, completion_acknowledged, completed_at")
      .eq("recipient_task_id", task.id)
      .eq("item_type", "task")
      .eq("status", "accepted");

    if (reverseSharedItems && reverseSharedItems.length > 0) {
      for (const si of reverseSharedItems) {
        await supabase
          .from("focusos_tasks")
          .update({
            completed_by_email: completedByEmail,
          })
          .eq("id", si.item_id);
        // Notify the original sender via the same shared_items row.
        if (!si.completion_acknowledged && !si.completed_at) {
          await supabase
            .from("focusos_shared_items")
            .update({
              completed_by: completedByEmail,
              completed_at: new Date().toISOString(),
              completion_acknowledged: false,
            })
            .eq("id", si.id);
        }
      }
    }

    return json({ ok: true, title: "Task completed", message: `"${task.title}" has been marked as completed.` });
  } catch (error: any) {
    console.error("Error completing task:", error);
    return json({ ok: false, title: "Something went wrong", message: "We couldn't complete this task right now. Please try again later." });
  }
});


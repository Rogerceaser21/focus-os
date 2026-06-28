import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(buildPage("Invalid Link", "This link appears to be broken or incomplete."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
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
      return new Response(buildPage("Task Not Found", "This link may have expired or the task was deleted."), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (task.status === "completed") {
      return new Response(buildPage("Already Completed", "This task has already been marked as completed.", true), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
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

    return new Response(buildPage("Task completed", `"${task.title}" has been marked as completed.`, true), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("Error completing task:", error);
    return new Response(buildPage("Something went wrong", "We couldn't complete this task right now. Please try again later.", false), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPage(title: string, message: string, isSuccess: boolean = false): string {
  const t = escapeHtml(title);
  const m = escapeHtml(message);
  const icon = isSuccess
    ? `<div class="icon ok"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`
    : `<div class="icon err">!</div>`;
  const autoClose = isSuccess
    ? `<script>setTimeout(function(){try{window.close();}catch(e){}}, 1200);</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${t} · Focus OS</title>
<style>
  body { margin:0; padding:40px 20px; background:#ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color:#2c2418; min-height:100vh; }
  .wrap { max-width: 440px; margin: 60px auto; text-align:center; }
  .brand { margin-bottom:24px; font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#B8572E; font-weight:600; }
  .card { background:#ffffff; border:1px solid #ece3d2; border-radius:16px; padding:36px 28px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); }
  .icon { width:64px; height:64px; border-radius:50%; margin:0 auto 20px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:32px; color:#fff; }
  .icon.ok { background:#5a8a4a; }
  .icon.err { background:#B8572E; }
  h1 { margin:0 0 10px; font-size:22px; color:#2c2418; font-weight:600; letter-spacing:-0.01em; }
  p { margin:0 0 24px; font-size:15px; line-height:1.55; color:#5b4f3f; }
  button { background:#B8572E; color:#fff; border:0; border-radius:8px; padding:10px 22px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; }
  button:hover { background:#a04a25; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">Focus OS</div>
    <div class="card">
      ${icon}
      <h1>${t}</h1>
      <p>${m}</p>
      <button onclick="try{window.close();}catch(e){}">Close</button>
    </div>
  </div>
  ${autoClose}
</body>
</html>`;
}

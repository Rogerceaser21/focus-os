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
      return new Response(buildPage("Already Completed", "This task has already been marked as completed.", false, true), {
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

    return new Response(buildPage("Task Completed!", `"${task.title}" has been marked as completed by ${completedByEmail}.`, true, true), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error: any) {
    console.error("Error completing task:", error);
    return new Response(buildPage("Something Went Wrong", "We couldn't complete this task right now. Please try again later."), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPage(title: string, message: string, isSuccess: boolean = false, redirect: boolean = false): string {
  const icon = isSuccess
    ? `<div style="width:80px;height:80px;margin:0 auto 24px;border-radius:50%;background:linear-gradient(135deg,#4FD1C5,#3B82F6);display:flex;align-items:center;justify-content:center;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
       </div>`
    : title.includes('Already')
      ? `<div style="width:80px;height:80px;margin:0 auto 24px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#6366F1);display:flex;align-items:center;justify-content:center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M9 12l2 2 4-4"/></svg>
         </div>`
      : `<div style="width:80px;height:80px;margin:0 auto 24px;border-radius:50%;background:linear-gradient(135deg,#EF4444,#F97316);display:flex;align-items:center;justify-content:center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
         </div>`;

  const headingText = title.replace(/^[^\w]*/, '').trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headingText} — Focus OS</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0b0f;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .bg-glow {
      position: fixed;
      width: 600px; height: 600px;
      border-radius: 50%;
      filter: blur(120px);
      opacity: 0.15;
      pointer-events: none;
    }
    .glow-1 { top: -200px; left: -100px; background: #4FD1C5; }
    .glow-2 { bottom: -200px; right: -100px; background: #3B82F6; }
    .card {
      position: relative;
      z-index: 1;
      max-width: 420px;
      width: 90%;
      padding: 48px 36px;
      text-align: center;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      backdrop-filter: blur(20px);
      animation: fadeUp 0.5s ease-out;
    }
    @keyframes fadeUp {
      from { opacity:0; transform:translateY(20px); }
      to { opacity:1; transform:translateY(0); }
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #f0f2f5;
      margin-bottom: 12px;
      letter-spacing: -0.02em;
    }
    .message {
      font-size: 15px;
      color: #9ca3af;
      line-height: 1.7;
      margin-bottom: 32px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: rgba(255,255,255,0.25);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .brand-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4FD1C5, #3B82F6);
    }
  </style>
  ${redirect ? `<script>setTimeout(function(){ window.location.href = "https://focusos2.lovable.app"; }, 3000);</script>` : ""}
</head>
<body>
  <div class="bg-glow glow-1"></div>
  <div class="bg-glow glow-2"></div>
  <div class="card">
    ${icon}
    <h1>${headingText}</h1>
    <p class="message">${message}</p>
    <div class="brand"><span class="brand-dot"></span>Focus OS</div>
  </div>
</body>
</html>`;
}

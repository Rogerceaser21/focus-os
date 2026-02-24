import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(buildPage("❌ Invalid Link", "This link is missing a token."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find task by share_token
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("id, title, status")
      .eq("share_token", token)
      .single();

    if (fetchError || !task) {
      return new Response(buildPage("❌ Task Not Found", "This link may have expired or the task was deleted."), {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (task.status === "completed") {
      return new Response(buildPage("✅ Already Complete", `"${escapeHtml(task.title)}" was already marked as complete.`), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    // Mark complete
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: "completed" })
      .eq("id", task.id);

    if (updateError) {
      throw updateError;
    }

    return new Response(
      buildPage("✅ Task Completed!", `"${escapeHtml(task.title)}" has been marked as complete. Nice work!`),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (error: any) {
    console.error("Error completing task:", error);
    return new Response(buildPage("❌ Error", "Something went wrong. Please try again later."), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0e1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="text-align:center;padding:40px;max-width:400px;">
    <h1 style="font-size:32px;margin-bottom:16px;color:#f0f0f0;">${title}</h1>
    <p style="font-size:16px;color:#9ca3af;line-height:1.6;">${message}</p>
    <p style="margin-top:32px;font-size:12px;color:#6b7280;">Focus OS</p>
  </div>
</body>
</html>`;
}

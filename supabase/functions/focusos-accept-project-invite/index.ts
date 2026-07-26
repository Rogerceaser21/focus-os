import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;
    const userEmail = (claimsData.claims.email as string)?.toLowerCase();

    const { memberId, action } = await req.json();

    if (!memberId || !["accept", "decline"].includes(action)) {
      return new Response(JSON.stringify({ error: "memberId and action (accept/decline) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Get the membership record
    const { data: member, error: memberError } = await adminClient
      .from("focusos_project_members")
      .select("*")
      .eq("id", memberId)
      .single();

    if (memberError || !member) {
      return new Response(JSON.stringify({ error: "Invitation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify this invitation belongs to the caller (by email or user_id)
    if (member.invited_email !== userEmail && member.user_id !== userId) {
      return new Response(JSON.stringify({ error: "This invitation is not for you" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (member.status !== "pending") {
      return new Response(JSON.stringify({ error: `Invitation already ${member.status}` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newStatus = action === "accept" ? "accepted" : "declined";

    // Update the membership — set the real user_id (in case it was a placeholder)
    const { error: updateError } = await adminClient
      .from("focusos_project_members")
      .update({
        status: newStatus,
        user_id: userId,
      })
      .eq("id", memberId);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update invitation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Notify the sender via email
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      // Get project name
      const { data: project } = await adminClient
        .from("focusos_projects")
        .select("name")
        .eq("id", member.project_id)
        .single();

      // Get sender email
      const { data: senderUser } = await adminClient
        .from("focusos_users")
        .select("email")
        .eq("user_id", member.invited_by)
        .single();

      // Get recipient name
      const { data: recipientProfile } = await adminClient
        .from("focusos_profiles")
        .select("first_name, last_name")
        .eq("user_id", userId)
        .single();

      const recipientName = recipientProfile
        ? `${recipientProfile.first_name || ""} ${recipientProfile.last_name || ""}`.trim() || userEmail
        : userEmail;

      const projectName = project?.name || "a project";
      const actionText = action === "accept" ? "accepted" : "declined";
      const actionColor = action === "accept" ? "#34c759" : "#e5484d";

      if (senderUser?.email) {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
            to: [senderUser.email],
            subject: `${recipientName} ${actionText} your invitation to "${projectName}"`,
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #0f7490;">Project Invitation ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}</h2>
                <p><strong>${recipientName}</strong> (${userEmail}) has <span style="color: ${actionColor}; font-weight: bold;">${actionText}</span> your invitation to collaborate on <strong>"${projectName}"</strong>.</p>
                ${action === "accept" ? '<p>They now have access to the project.</p>' : '<p>They will not be added to the project.</p>'}
                <a href="https://focusos2.lovable.app" style="display: inline-block; background: #0f7490; color: white; padding: 12px 24px; border-radius: 999px; text-decoration: none; margin-top: 16px;">Open Focus OS</a>
              </div>
            `,
          }),
        });

        if (!emailRes.ok) {
          console.error("Sender notification email failed:", await emailRes.text());
        }
      }
    }

    return new Response(JSON.stringify({ success: true, status: newStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

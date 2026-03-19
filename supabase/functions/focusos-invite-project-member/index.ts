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

    // Verify the caller
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
    const senderUserId = claimsData.claims.sub;
    const senderEmail = claimsData.claims.email as string;

    const { projectId, recipientEmail, role = "collaborator" } = await req.json();

    if (!projectId || !recipientEmail) {
      return new Response(JSON.stringify({ error: "projectId and recipientEmail are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["collaborator", "viewer"].includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller owns the project
    const { data: project, error: projectError } = await adminClient
      .from("focusos_projects")
      .select("id, name, user_id")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (project.user_id !== senderUserId) {
      return new Response(JSON.stringify({ error: "Only the project owner can invite members" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up recipient user_id from focusos_users
    const { data: recipientUser } = await adminClient
      .from("focusos_users")
      .select("user_id")
      .eq("email", recipientEmail.toLowerCase())
      .single();

    const recipientUserId = recipientUser?.user_id || null;

    // Check if already a member
    if (recipientUserId) {
      const { data: existing } = await adminClient
        .from("focusos_project_members")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("user_id", recipientUserId)
        .single();

      if (existing) {
        return new Response(
          JSON.stringify({ error: `This user has already been invited (status: ${existing.status})` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Insert membership record
    const memberData: Record<string, unknown> = {
      project_id: projectId,
      invited_by: senderUserId,
      invited_email: recipientEmail.toLowerCase(),
      role,
      status: "pending",
    };
    if (recipientUserId) {
      memberData.user_id = recipientUserId;
    } else {
      // Use a placeholder; will be updated on accept
      memberData.user_id = "00000000-0000-0000-0000-000000000000";
    }

    const { data: member, error: insertError } = await adminClient
      .from("focusos_project_members")
      .insert(memberData)
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create invitation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark project as shared
    await adminClient
      .from("focusos_projects")
      .update({ is_shared: true })
      .eq("id", projectId);

    // Get sender name
    const { data: senderProfile } = await adminClient
      .from("focusos_profiles")
      .select("first_name, last_name")
      .eq("user_id", senderUserId)
      .single();

    const senderName = senderProfile
      ? `${senderProfile.first_name || ""} ${senderProfile.last_name || ""}`.trim() || senderEmail
      : senderEmail;

    // Send invitation email via Resend
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
          to: [recipientEmail],
          subject: `${senderName} invited you to collaborate on "${project.name}"`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #7c3aed;">You've been invited to a project!</h2>
              <p><strong>${senderName}</strong> has invited you to collaborate on the project <strong>"${project.name}"</strong> as a <strong>${role}</strong>.</p>
              <p>Log in to Focus OS to accept or decline this invitation.</p>
              <a href="https://focusos2.lovable.app" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">Open Focus OS</a>
            </div>
          `,
        }),
      });

      if (!emailRes.ok) {
        console.error("Email send failed:", await emailRes.text());
      }
    }

    return new Response(JSON.stringify({ success: true, member }), {
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

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
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
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
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

    const { sharedItemId } = await req.json();

    if (!sharedItemId) {
      return new Response(JSON.stringify({ error: "sharedItemId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch shared item
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

    // Verify recipient
    const recipientEmail = user.email?.toLowerCase();
    if (sharedItem.recipient_user_id !== user.id && sharedItem.recipient_email !== recipientEmail) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status
    const { error: updateError } = await supabaseAdmin
      .from("focusos_shared_items")
      .update({ status: "declined", recipient_user_id: user.id })
      .eq("id", sharedItemId);

    if (updateError) {
      throw new Error("Failed to decline shared item");
    }

    // Resolve decliner's display name from profile
    let declinerName = user.email || "Someone";
    const { data: declinerProfile } = await supabaseAdmin
      .from("focusos_profiles")
      .select("first_name, last_name")
      .eq("user_id", user.id)
      .single();
    if (declinerProfile) {
      const name = [declinerProfile.first_name, declinerProfile.last_name].filter(Boolean).join(" ");
      if (name) declinerName = name;
    }

    // Notify sender
    if (RESEND_API_KEY) {
      try {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
          to: [sharedItem.sender_email],
          subject: `Your shared ${sharedItem.item_type} was declined`,
          html: `<p>${declinerName} has declined the ${sharedItem.item_type} "<strong>${sharedItem.item_title}</strong>" that you shared.</p>`,
        });
      } catch (emailErr) {
        console.error("Failed to send decline notification:", emailErr);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in focusos-decline-shared-item:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifyState(state: string, secret: string): Promise<string | null> {
  const [userId, sigB64] = state.split(".");
  if (!userId || !sigB64) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["verify"],
  );
  const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(userId));
  return ok ? userId : null;
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function closingPage(success: boolean, message: string, appUrl?: string) {
  const safe = message.replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0e1117;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;}
.card{max-width:420px;background:#1a1f2e;border:1px solid #2d3548;border-radius:12px;padding:32px;}
h1{margin:0 0 12px;font-size:20px;color:${success ? "#10b981" : "#ef4444"};}
p{margin:0 0 16px;font-size:14px;color:#9ca3af;line-height:1.5;}
a{color:#60a5fa;text-decoration:none;}</style></head>
<body><div class="card"><h1>${success ? "✓ Google Calendar Connected" : "Connection Failed"}</h1>
<p>${safe}</p>${appUrl ? `<p><a href="${appUrl}">Return to Focus OS</a></p>` : ""}
<p style="font-size:12px;">You can close this window.</p></div>
<script>setTimeout(()=>{try{window.close();}catch(e){}},2500);</script></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) return htmlResponse(closingPage(false, `Google returned: ${errParam}`), 400);
  if (!code || !state) return htmlResponse(closingPage(false, "Missing code or state."), 400);

  try {
    const serviceSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userId = await verifyState(state, serviceSecret);
    if (!userId) return htmlResponse(closingPage(false, "Invalid state token."), 400);

    const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
    const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")!;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("token exchange failed", tokenJson);
      return htmlResponse(closingPage(false, tokenJson.error_description || "Token exchange failed."), 400);
    }

    const accessToken: string = tokenJson.access_token;
    const refreshToken: string | undefined = tokenJson.refresh_token;
    const expiresIn: number = tokenJson.expires_in ?? 3600;
    const scope: string = tokenJson.scope ?? "";
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceSecret,
    );

    // If no refresh_token (user already granted before), keep the existing one
    let finalRefreshToken = refreshToken;
    if (!finalRefreshToken) {
      const { data: existing } = await admin
        .from("focusos_google_tokens")
        .select("refresh_token")
        .eq("user_id", userId)
        .maybeSingle();
      finalRefreshToken = existing?.refresh_token;
    }
    if (!finalRefreshToken) {
      return htmlResponse(closingPage(false, "No refresh token returned. Please revoke access in your Google account and try again."), 400);
    }

    // Create or find dedicated "Focus OS" calendar
    let focusosCalendarId: string | null = null;
    try {
      const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const listJson = await listRes.json();
      const found = (listJson.items ?? []).find((c: any) => c.summary === "Focus OS");
      if (found) {
        focusosCalendarId = found.id;
      } else {
        const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: "Focus OS",
            description: "Tasks & meetings synced from Focus OS",
            timeZone: "UTC",
          }),
        });
        const createJson = await createRes.json();
        if (createRes.ok) focusosCalendarId = createJson.id;
        else console.error("calendar create failed", createJson);
      }
    } catch (e) {
      console.error("calendar setup error", e);
    }

    const { error: upsertErr } = await admin
      .from("focusos_google_tokens")
      .upsert({
        user_id: userId,
        access_token: accessToken,
        refresh_token: finalRefreshToken,
        expires_at: expiresAt,
        scope,
        focusos_calendar_id: focusosCalendarId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (upsertErr) {
      console.error("token upsert error", upsertErr);
      return htmlResponse(closingPage(false, "Failed to save tokens."), 500);
    }

    return htmlResponse(closingPage(true, "Your Google Calendar is now connected to Focus OS."));
  } catch (e) {
    console.error("oauth-callback error", e);
    return htmlResponse(closingPage(false, String(e)), 500);
  }
});
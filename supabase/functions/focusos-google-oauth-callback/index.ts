import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Where to send the user when the OAuth flow finishes.
// Override with APP_BASE_URL secret if you need a different host (e.g. preview vs prod).
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://focusos.tech";

// Unsigned marker appended by focusos-google-oauth-start for mobile callers,
// and the deep link that finishes the flow inside the iOS shell.
const MOBILE_STATE_SUFFIX = ".m";
const MOBILE_DONE_URL = "focusos://calendar-done";

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

function redirectResponse(success: boolean, message?: string) {
  const params = new URLSearchParams({ status: success ? "success" : "error" });
  if (message) params.set("message", message);
  const url = `${APP_BASE_URL}/google-connected?${params.toString()}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) return redirectResponse(false, `Google returned: ${errParam}`);
  if (!code || !state) return redirectResponse(false, "Missing code or state.");

  // Strip the unsigned mobile marker before verifying, so the signature is
  // always checked against exactly `${userId}.${sigB64}`. States issued
  // before the marker existed verify unchanged.
  const isMobile = state.endsWith(MOBILE_STATE_SUFFIX);
  const signedState = isMobile ? state.slice(0, -MOBILE_STATE_SUFFIX.length) : state;

  try {
    const serviceSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userId = await verifyState(signedState, serviceSecret);
    if (!userId) return redirectResponse(false, "Invalid state token.");

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
      return redirectResponse(false, tokenJson.error_description || "Token exchange failed.");
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
      return redirectResponse(false, "No refresh token returned. Revoke access in your Google account and try again.");
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
      return redirectResponse(false, "Failed to save tokens.");
    }

    if (isMobile) {
      // The iOS shell runs this flow in an ASWebAuthenticationSession opened
      // with callbackURLScheme "focusos". That sheet only closes when the web
      // flow redirects to a focusos:// URL, so the mobile success path MUST be
      // this 302 and nothing else.
      return new Response(null, { status: 302, headers: { Location: MOBILE_DONE_URL } });
    }

    return redirectResponse(true);
  } catch (e) {
    console.error("oauth-callback error", e);
    return redirectResponse(false, String(e));
  }
});

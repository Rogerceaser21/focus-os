// Brain Dump live-session config.
//
// SHARED WITH THE PRODUCTION APP. The response contract the deployed client
// depends on is `{ apiKey, model }`; everything added here is additive and
// opt-in, so deploying this file changes nothing until the matching env var is
// set. src/hooks/useBrainDumpLive.ts already reads `ephemeralToken` when it is
// present and falls back to `apiKey` when it is not.
//
// Env vars:
//   GEMINI_API_KEY               (required) the long-lived key.
//   BRAIN_DUMP_MODEL             (optional) overrides the model id. Unset = default below.
//   BRAIN_DUMP_EPHEMERAL_TOKENS  (optional) "1" turns on ephemeral-token minting.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

/**
 * Mint a single-use ephemeral auth token for the Live API.
 *
 * NOT YET EXERCISED AGAINST THE SERVICE — this path is dark until
 * BRAIN_DUMP_EPHEMERAL_TOKENS=1 is set on the deployed function, which is Igor's
 * call. Written as a raw fetch rather than @google/genai so the function keeps
 * no SDK dependency; the shape mirrors what the SDK's authTokens.create() posts
 * (@google/genai 1.41.0: POST {baseUrl}/v1alpha/auth_tokens, response
 * { name: "auth_tokens/..." }, and the client must then connect with
 * apiKey = token.name + httpOptions.apiVersion = "v1alpha").
 *
 * Deliberately NOT locking liveConnectConstraints: the client rebuilds its
 * systemInstruction on every connect (it carries the live task list, and a
 * reconnect must carry the updated one), so a token that pinned the connect
 * config would break "Keep Talking" and every resumption.
 *
 * `uses: 2` leaves one spare for an immediate reconnect; the client refetches
 * config on each connect anyway, so this is belt and braces.
 */
async function mintEphemeralToken(apiKey: string): Promise<string | null> {
  const now = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 2,
          // Session may run for the full audio-only cap (15 min) plus slack.
          expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
          // The window in which a NEW session may be opened with this token.
          newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
        }),
      },
    );
    if (!res.ok) {
      console.error("Ephemeral token mint failed:", res.status, await res.text());
      return null;
    }
    const body = await res.json();
    return typeof body?.name === "string" ? body.name : null;
  } catch (e) {
    console.error("Ephemeral token mint threw:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const model = Deno.env.get("BRAIN_DUMP_MODEL") || DEFAULT_MODEL;

    // Opt-in only. If minting fails for any reason the long-lived key still goes
    // out, so Brain Dump never breaks on a token-service hiccup.
    const ephemeralToken = Deno.env.get("BRAIN_DUMP_EPHEMERAL_TOKENS") === "1"
      ? await mintEphemeralToken(geminiApiKey)
      : null;

    // `apiKey` stays in the response while any older bundle is still in the wild
    // (the live focusos.tech client only knows that field). It is the one thing
    // to delete once every client reads `ephemeralToken` — until then the
    // long-lived key is still on the wire and the token buys reliability, not
    // secrecy.
    return new Response(
      JSON.stringify({
        apiKey: geminiApiKey,
        wsUrl: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
        model,
        ...(ephemeralToken && { ephemeralToken }),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

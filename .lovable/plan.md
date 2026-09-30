# Rotate the GCS service-account key for Focus OS meeting recording

## What I verified before writing this plan (read-only)

- `fetch_secrets` on this Lovable project returns exactly 7 names: GEMINI_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, LOVABLE_API_KEY, RESEND_API_KEY, WORKOS_API_KEY.
- **No secret containing "GCS" exists in Lovable's store — neither `GCS_SERVICE_ACCOUNT_JSON` nor `GCS_BUCKET_NAME`.**
- Project memory (`integrations/required-secrets`) confirms why: `GCS_SERVICE_ACCOUNT_JSON`, `GCS_BUCKET_NAME` (and `GCS_PROJECT_ID`) are configured as **edge function secrets in the shared Supabase dashboard** of the connected project `mshlbsgsyzzfxyxramjj`, deliberately named that way so other apps on the same project keep working. Lovable has no tool to list or edit an external Supabase project's edge-function secrets — its secret form only manages Lovable-side secrets.
- Every meeting edge function (`focusos-transcribe-meeting`, `focusos-process-meeting`, `focusos-get-meeting-audio`, `focusos-get-shared-meeting-audio`, `focusos-delete-meeting`) reads the value at run time via `Deno.env.get("GCS_SERVICE_ACCOUNT_JSON")` under exactly that name, and `GCS_BUCKET_NAME` for the bucket.

## The stop condition in the task, and what it means here

The task says: if `GCS_SERVICE_ACCOUNT_JSON` is not found under that exact name, stop and report. I checked everywhere Lovable can reach and it is not found **in Lovable's secret form** — that store is simply the wrong place; the real secret lives in the Supabase dashboard where I cannot look. So the one action below belongs to Igor in the Supabase dashboard, not in Lovable. I am not creating any secret under any name.

## The action (Igor, in the Supabase dashboard — about 2 minutes)

1. Open: https://supabase.com/dashboard/project/mshlbsgsyzzfxyxramjj/settings/functions
   (Edge Functions → Secrets; if your dashboard shows secrets under Project Settings → Edge Functions, same place.)
2. Find the existing secret named `GCS_SERVICE_ACCOUNT_JSON` and **edit its value only** — the name must stay exactly `GCS_SERVICE_ACCOUNT_JSON`.
3. Paste the **full contents of the new JSON key file** (the whole file, from `{` to `}`, including `private_key` with its `\n` escapes) as the value. Save.
4. Touch nothing else: leave `GCS_BUCKET_NAME`, `GCS_PROJECT_ID`, `GEMINI_API_KEY`, `RESEND_API_KEY` and every other secret exactly as they are.
5. No redeploy is needed — edge functions read secrets at run time, so the next invocation picks up the new key.

Two cautions:
- This Supabase project is shared with other apps that rely on the same service-account credential under the same name. Updating the value affects every app that reads it — which is expected here, since the old key is being retired.
- Keep the old key active in Google Cloud until the verification below passes; only then disable/delete the old key in Google Cloud IAM.

## What I will do after Igor saves it (read-only verification, no changes)

1. Call `focusos-get-meeting-audio` for one existing meeting with the preview session — a successful audio stream proves the new key authenticates to GCS and can read the bucket.
2. Check recent `focusos-transcribe-meeting` logs for any GCS error after the change.
3. Report the result. No file in the repository changes; no deploy, no SQL, no publish.

## Explicitly out of scope

- No code edits, migrations, SQL, policy changes, edge function deploys, or publish.
- No Lovable secret is created, renamed, or updated.
- `GCS_BUCKET_NAME` and all other secrets untouched.

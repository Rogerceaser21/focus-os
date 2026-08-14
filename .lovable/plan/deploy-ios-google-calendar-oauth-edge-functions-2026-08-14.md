# Deploy iOS Google Calendar OAuth edge functions

## Goal
Deploy the reviewed mobile-OAuth updates to the two Google Calendar OAuth edge functions exactly as provided from repo commit f20cbd7. No other files, tables, policies, or secrets change.

## Changes
1. Replace `supabase/functions/focusos-google-oauth-start/index.ts` with the version that accepts an optional `{"mobile": true}` body and appends an unsigned `.m` marker to the OAuth state.
2. Replace `supabase/functions/focusos-google-oauth-callback/index.ts` with the version that strips the `.m` marker before HMAC verification and redirects mobile successes to `focusos://calendar-done`.
3. Deploy both functions.

## Verification
- Web callers (no marker) get the same state string and the same `/google-connected` redirect, byte-identical to the previous behavior.
- An authenticated POST to `focusos-google-oauth-start` with body `{"mobile": true}` returns a consent URL whose `state` ends with `.m`.
- A callback with the `.m` marker, after successful token storage, returns a 302 to `focusos://calendar-done`.
- No other edge functions, database objects, secrets, or frontend files are modified.
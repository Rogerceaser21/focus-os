# Security fix: Admin Reset flow (edge function + secret lockdown + client)

## Verified current state
- `public.app_configuration` already has RLS enabled, but carries a policy `Allow anonymous read access to app_configuration` (SELECT, role `anon`, `USING true`) — so the anon key can read `settings_password` today. A second policy exists for the internal `dreamlit_app` role.
- `public.get_app_configuration()` is SECURITY DEFINER, returns `settings_password` in its JSON, and its ACL grants EXECUTE to `PUBLIC`, `anon`, `authenticated`, `service_role`, `dreamlit_app`.
- `focusos-admin-reset-password` currently performs no admin-password check; `verify_jwt = false` in config.toml, so it is callable by anyone with the anon key.

## Change 1 — Edge function gate
Replace `supabase/functions/focusos-admin-reset-password/index.ts` with the supplied implementation: it requires `adminPassword` on every call, compares it to `app_configuration.settings_password` (read via service role, constant-time compare), returns 403 on mismatch, supports a `verifyOnly` probe, and only then performs the existing self-heal + listUsers + password update path.

## Change 2 — SQL migration (no data changes)
- `DROP POLICY "Allow anonymous read access to app_configuration" ON public.app_configuration;` (RLS is already on; the `dreamlit_app` policy is left untouched.)
- Revoke table-level SELECT from `anon` and `authenticated`, keep `service_role`.
- `REVOKE EXECUTE ON FUNCTION public.get_app_configuration() FROM anon, authenticated, PUBLIC;` — function and table are kept; `service_role` retains execute.
- The `settings_password` value is not read, written, or altered.

## Change 3 — `src/pages/Auth.tsx`
- `handleAdminVerify`: drop the direct `app_configuration` select; invoke the edge function with `{ adminPassword, verifyOnly: true }` and set `adminVerified` on `res.data?.verified`, otherwise toast the returned error.
- `handleAdminReset`: add `adminPassword` to the invoke body alongside `userEmail` + `newPassword`.
- Dialog markup, state resets and copy stay as-is.

## Out of scope
No other edge function, table, RPC, policy or UI is touched. No new dependencies.

## Verification after ship
- Anon-key REST SELECT on `app_configuration` → denied/empty.
- Anon-key POST `rpc/get_app_configuration` → permission denied.
- Edge function without / with wrong `adminPassword` → 400/403, no reset.
- Correct password: `verifyOnly` → `verified: true`; full call still resets the target user.

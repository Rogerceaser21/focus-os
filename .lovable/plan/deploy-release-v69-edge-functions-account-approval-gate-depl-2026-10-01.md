# Deploy release v69 edge functions (account-approval gate) — deploy only

## Pre-check (done, read-only)
- Workspace is at commit `7ca7ae21` (matches `main` / `v69-good-baseline`).
- All 35 function folders have `index.ts`. `_shared/approval.ts`, `approvalResend.ts` and `passwordThrottle.ts` are present.
- `supabase/config.toml` sets `verify_jwt = false` for `focusos-decide-approval`.

## Steps
1. Deploy the 35 functions exactly as they are, without editing any file, in batches of about 6–8:
   - New: focusos-request-approval, focusos-decide-approval
   - Changed: the 33 listed in the request
2. Report each function as deployed or failed. For a failure, give the error verbatim. Do not retry with code changes.
3. Acceptance probes (read-only, anon key only):
   - POST `focusos-extract-tasks` should return 401 `{"error":"Not signed in"}`
   - GET `focusos-decide-approval?token=x` should return 400 `{"error":"This link is no longer valid."}`

## Not done
No file edits, no migrations or SQL, no secret changes, no other functions, no step 2 (the lock) and no account changes.

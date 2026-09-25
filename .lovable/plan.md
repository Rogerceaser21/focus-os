# Add focusos.tech (and three more) to Supabase Auth Redirect URLs

## Finding: this change cannot be made from Lovable

- The Supabase project `mshlbsgsyzzfxyxramjj` is an **external, user-owned project** connected to Lovable. Auth URL configuration (Site URL + Redirect URLs) for external projects is **not editable through any Lovable tool** — Lovable only auto-manages these settings for its own built-in Cloud backend. Official docs: "Apps that use your own Supabase project get no automatic updates, so add the addresses in that project's auth settings."
- There is also no SQL path: redirect URLs live in the auth service configuration, not in a database table, so a migration cannot change them.
- Therefore no code, migration, or edge-function change will be made, and no workaround will be attempted. The change must be done by you in the Supabase dashboard. Exact steps are below.

## Root cause (verified live, read-only, 2026-09-25)

`GET /auth/v1/verify?token=invalid&type=magiclink&redirect_to=...` probes:

| redirect_to | Result |
|---|---|
| `https://focusos.tech/home` | 303 → `https://focusos.thefeedbackapp.net/#error=...` (falls back to Site URL — **not allow-listed**) |
| `https://focusos2.lovable.app/home` | 303 → `https://focusos2.lovable.app/home#error=...` (allow-listed) |

This confirms `focusos.tech` is missing from Authentication → URL Configuration → Redirect URLs, exactly as diagnosed. Sign-in links that carry `redirect_to=https://focusos.tech/home` get bounced to the shared Site URL, where the session doesn't exist — hence landing signed out on iPad Safari.

## Exact dashboard steps (for you, Igor)

1. Open https://supabase.com/dashboard/project/mshlbsgsyzzfxyxramjj/auth/url-configuration
2. Under **Redirect URLs**, click **Add URL** and add these four, one at a time:
   - `https://focusos.tech/**`
   - `https://www.focusos.tech/**`
   - `http://localhost:8080/**`
   - `https://rogerceaser21.github.io/focus-os/**`
3. Do **not** touch **Site URL** — it stays `https://focusos.thefeedbackapp.net/` (other apps share this project and rely on it).
4. Do **not** remove or edit any existing Redirect URL entry — this is add-only.
5. Settings apply immediately; no redeploy needed.

## Verification (I run this after you've saved — read-only)

- `GET https://mshlbsgsyzzfxyxramjj.supabase.co/auth/v1/verify?token=invalid&type=magiclink&redirect_to=https%3A%2F%2Ffocusos.tech%2Fhome` must return **303** with `Location` starting `https://focusos.tech/home` (with the expected `#error=access_denied` fragment — the token is intentionally invalid; what matters is the host is preserved instead of falling back to the Site URL).
- Same check for `https://www.focusos.tech/home`, `http://localhost:8080/home`, and `https://rogerceaser21.github.io/focus-os/home`.
- Re-probe `https://focusos2.lovable.app/home` to confirm existing entries still work (no regression).
- Site URL regression check: `https://focusos.thefeedbackapp.net/` must remain the fallback for a non-listed address (e.g. `https://example.com/home` should still 303 to the Site URL).

## Scope

- No code changes, no migrations, no edge-function deploys, no publish, no data changes.
- The only human action is the four dashboard entries above.

// Web half of the iOS shell's native Google OAuth bridge.
//
// Google refuses a plain WKWebView (disallowed_useragent), so the shell runs
// the authorize URL in an ASWebAuthenticationSession instead: the page posts
// the URL to window.webkit.messageHandlers.oauth, and the shell answers by
// calling window.__FOCUSOS_OAUTH_CALLBACK__(<callback url> | null) — null for
// cancel, failure, or a URL the shell's host allowlist rejected
// (ios-shell/FocusOSShell/ShellWebView.swift).
//
// FLOW: src/integrations/supabase/client.ts sets no flowType, so supabase-js
// runs its default — @supabase/supabase-js 2.110.0,
// dist/index.mjs:38 `DEFAULT_AUTH_OPTIONS = { ... flowType: "implicit" }`
// (same default in @supabase/auth-js GoTrueClient.js:21). Implicit means the
// tokens ride back in the callback URL's #fragment and the session is
// installed with setSession; there is no ?code= to exchange.
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Fired when an OAuth attempt ends WITHOUT navigating (cancel, provider
// error, unreadable callback) so the Auth page can drop its loading state.
// Window CustomEvent, matching the tours and the wallpaper store.
export const SHELL_OAUTH_SETTLED_EVENT = 'focusos:shell-oauth-settled';

// Fired when the native sheet came back from the Google CALENDAR leg
// (focusos://calendar-done): the edge function already stored the tokens
// server-side, so there is nothing to install here — the widget just re-reads
// its connection row. Same window-CustomEvent shape as the settled event.
export const SHELL_CALENDAR_CONNECTED_EVENT = 'focusos:calendar-connected';

// The calendar leg's terminal redirect. Prefix, not equality: the shell may
// hand back a trailing slash or query on the same URL.
const CALENDAR_CALLBACK_PREFIX = 'focusos://calendar-done';

type OAuthMessageHandler = { postMessage: (url: string) => void };

const settled = () => {
  window.dispatchEvent(new CustomEvent(SHELL_OAUTH_SETTLED_EVENT));
};

/** Hand the Supabase authorize URL to the native bridge. */
export const postShellOauthUrl = (url: string) => {
  const handler = (
    window as unknown as {
      webkit?: { messageHandlers?: { oauth?: OAuthMessageHandler } };
    }
  ).webkit?.messageHandlers?.oauth;
  if (!handler) {
    // Flag present but no bridge: not a build we can sign in with.
    toast.error('Google sign-in is not available in this app version');
    settled();
    return;
  }
  handler.postMessage(url);
};

// Read BOTH halves of the callback URL: the tokens arrive in the fragment,
// but a provider refusal can come back as either ?error= or #error=. Parsed by
// hand rather than via `new URL`, because the callback carries the custom
// focusos:// scheme.
const paramsFrom = (raw: string) => {
  const hashIndex = raw.indexOf('#');
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';

  const merged = new URLSearchParams();
  for (const part of [query, fragment]) {
    new URLSearchParams(part).forEach((value, key) => merged.set(key, value));
  }
  return merged;
};

const handleCallback = async (raw: string | null | undefined) => {
  if (!raw) {
    toast('Google sign-in was cancelled');
    settled();
    return;
  }

  // Routed by URL content, because ONE native bridge serves both legs: the
  // sign-in leg returns focusos://auth-callback with tokens in the fragment,
  // the calendar leg returns focusos://calendar-done with nothing to read.
  // The calendar leg must not touch the session or navigate — the user is
  // already signed in and sitting in the Settings dialog.
  if (raw.toLowerCase().startsWith(CALENDAR_CALLBACK_PREFIX)) {
    window.dispatchEvent(new CustomEvent(SHELL_CALENDAR_CONNECTED_EVENT));
    return;
  }

  const params = paramsFrom(raw);

  const providerError = params.get('error_description') ?? params.get('error');
  if (providerError) {
    toast.error(providerError);
    settled();
    return;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    toast.error('Google sign-in returned an unreadable response');
    settled();
    return;
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    toast.error(error.message);
    settled();
    return;
  }

  // Full navigation, not a router push: this runs outside React's tree, and a
  // fresh document reads the session straight out of storage.
  window.location.assign(`${import.meta.env.BASE_URL}home`);
};

// Registered at module load (main.tsx imports this for the side effect) so the
// handler exists before the user can reach the button. Registered
// unconditionally: only a shell build carrying the native bridge ever calls it.
if (typeof window !== 'undefined') {
  (
    window as unknown as {
      __FOCUSOS_OAUTH_CALLBACK__?: (url: string | null) => void;
    }
  ).__FOCUSOS_OAUTH_CALLBACK__ = (url) => {
    void handleCallback(url);
  };
}

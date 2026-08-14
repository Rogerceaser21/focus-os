// The iOS shell injects window.__FOCUSOS_SHELL__ at documentStart (before any
// module code runs — ShellWebView.swift bootScript), so a module-load read is
// stable for the whole session. Safari/A2HS/desktop resolve to false.
export const IS_SHELL =
  typeof window !== 'undefined' &&
  (window as unknown as { __FOCUSOS_SHELL__?: boolean }).__FOCUSOS_SHELL__ === true;

// Separate CAPABILITY flag, injected by the same documentStart bootScript but
// only by a shell build that carries the native OAuth bridge
// (ASWebAuthenticationSession + the "oauth" message handler). Google answers
// disallowed_useragent to a plain WKWebView, so Google sign-in may only be
// offered when this is true — shell build 1 is still in the field and must
// keep hiding it.
export const SHELL_OAUTH =
  IS_SHELL &&
  (window as unknown as { __FOCUSOS_SHELL_OAUTH__?: boolean }).__FOCUSOS_SHELL_OAUTH__ === true;

// Second CAPABILITY flag from the same documentStart bootScript, injected only
// by a shell build whose native bridge also accepts the Google Calendar
// authorize URL (shell build 3+: the host allowlist covers the Supabase edge
// function, and the sheet closes on the focusos://calendar-done redirect).
// Builds 1 and 2 are still in the field and must keep showing the
// connect-on-the-web hint instead of the widget.
export const SHELL_CAL =
  IS_SHELL &&
  (window as unknown as { __FOCUSOS_SHELL_CAL__?: boolean }).__FOCUSOS_SHELL_CAL__ === true;

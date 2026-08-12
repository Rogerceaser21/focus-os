// The iOS shell injects window.__FOCUSOS_SHELL__ at documentStart (before any
// module code runs — ShellWebView.swift bootScript), so a module-load read is
// stable for the whole session. Safari/A2HS/desktop resolve to false.
export const IS_SHELL =
  typeof window !== 'undefined' &&
  (window as unknown as { __FOCUSOS_SHELL__?: boolean }).__FOCUSOS_SHELL__ === true;

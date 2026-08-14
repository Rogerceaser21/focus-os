import SwiftUI
import WebKit
import UIKit
import AuthenticationServices

/// Observable state shared between SwiftUI and the WKWebView coordinator.
final class ShellModel: ObservableObject {
    @Published var loadError: String?
    weak var webView: WKWebView?

    func retry() {
        loadError = nil
        if let url = ShellConfig.startURL {
            webView?.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        }
    }
}

enum ShellConfig {
    /// Start URL from Info.plist (FOSStartURL) — deployed channel by default,
    /// preview channel for a Dev flavour.
    static var startURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "FOSStartURL") as? String else { return nil }
        return URL(string: raw)
    }

    /// Hosts treated as "inside the app". Everything else opens in the system browser.
    /// accounts.google.com is deliberately NOT here: Google blocks OAuth in embedded
    /// webviews (disallowed_useragent), so the OAuth leg must leave the shell.
    static let appHosts: Set<String> = [
        "rogerceaser21.github.io",
    ]

    /// The only host the native OAuth bridge will open. The page posts the URL,
    /// so anything wider would make the shell an open redirector for injected
    /// script.
    static let oauthHost = "mshlbsgsyzzfxyxramjj.supabase.co"

    /// Callback scheme is claimed by ASWebAuthenticationSession itself, never by
    /// a CFBundleURLTypes entry — registering it would hand the callback to the
    /// app delegate instead and break the session's own capture.
    static let oauthCallbackScheme = "focusos"
}

/// WKUserContentController retains its message handlers until they are removed
/// by name, so registering the Coordinator directly outlives the view and leaks
/// it. This proxy holds the target weakly and breaks the cycle.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// WKWebView never surfaces env(safe-area-inset-*) to this page (verified on
/// device: the greeting rendered under the clock), so the shell measures the
/// real insets natively and writes them as CSS vars the stylesheet prefers
/// over env() (var(--shell-top-inset, env(...)) fallback chain).
final class ShellWKWebView: WKWebView {
    var onSafeAreaChange: ((UIEdgeInsets) -> Void)?

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        onSafeAreaChange?(safeAreaInsets)
    }
}

struct ShellWebView: UIViewRepresentable {
    @ObservedObject var model: ShellModel

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Voice surface needs both: inline playback + no gesture gate on audio.
        // Safari can never grant the second one — this is the shell's first real win.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Persistent store: Supabase session in localStorage survives relaunches.
        config.websiteDataStore = .default()

        // documentStart flag: the web app can key CSS/logic off the shell.
        // Also force the standalone class for v1 layout evaluation — the
        // (display-mode: standalone) media query NEVER matches inside WKWebView
        // (WebKit resolves it from the app manifest, which a webview cannot have),
        // and navigator.standalone is Safari-only. Step 2 moves this into main.tsx.
        // __FOCUSOS_SHELL_OAUTH__ is a CAPABILITY flag, separate from the shell
        // flag: only a build carrying the native bridge below may show Google
        // sign-in, because in a plain webview Google answers disallowed_useragent.
        let bootScript = """
        window.__FOCUSOS_SHELL__ = true;
        window.__FOCUSOS_SHELL_OAUTH__ = true;
        document.documentElement.classList.add('standalone', 'shell');
        """
        config.userContentController.addUserScript(WKUserScript(
            source: bootScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        // Native OAuth bridge: the page posts the Supabase authorize URL here and
        // the shell runs it in ASWebAuthenticationSession (a real Safari context,
        // which Google accepts). Weak proxy — see WeakScriptMessageHandler.
        config.userContentController.add(
            WeakScriptMessageHandler(target: context.coordinator),
            name: "oauth"
        )

        let webView = ShellWKWebView(frame: .zero, configuration: config)
        #if DEBUG
        // Safari Web Inspector + Appium web-context access (JS census rig).
        webView.isInspectable = true
        #endif
        webView.onSafeAreaChange = { [weak coordinator = context.coordinator, weak webView] insets in
            guard let webView else { return }
            coordinator?.injectSafeAreaVars(insets, into: webView)
        }
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.89, green: 0.86, blue: 0.78, alpha: 1) // Hokusai default tone
        webView.scrollView.backgroundColor = webView.backgroundColor

        // Edge-to-edge: the web layer owns env(safe-area-inset-*); never let the
        // native scroll view re-inset it, and kill rubber-banding (the wallpaper
        // edge-tone trick was designed for Safari, not a bouncing native scroller).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false

        // Pull-to-refresh escape hatch: Pages caches HTML ~10 min and a chromeless
        // shell has no reload button. bounces must be enabled during the gesture,
        // so gate it: refresh control re-enables bounce only while dragging from top.
        // Simpler v1: leave bounces off and expose refresh via 3-finger triple-tap
        // handled in JS later; for now a UIRefreshControl with alwaysBounceVertical
        // scoped by the control itself.
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        webView.scrollView.alwaysBounceVertical = true // required for UIRefreshControl to trigger

        model.webView = webView

        if let url = ShellConfig.startURL {
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate,
                             WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
        private let model: ShellModel
        private var lastInsets: UIEdgeInsets = .zero
        /// ASWebAuthenticationSession deallocates itself mid-flight without an
        /// owner, cancelling the sheet; this holds it for the session's lifetime.
        private var authSession: ASWebAuthenticationSession?
        init(model: ShellModel) { self.model = model }

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            model.webView?.reloadFromOrigin() // bypass every cache layer
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
        }

        // Write the native safe-area insets as CSS vars on <html>. Inline style
        // survives SPA route changes but dies with the document, so didCommit
        // re-applies it on every full load (cold start, reloadFromOrigin,
        // process-kill reload).
        func injectSafeAreaVars(_ insets: UIEdgeInsets, into webView: WKWebView) {
            lastInsets = insets
            let js = """
            document.documentElement.style.setProperty('--shell-top-inset', '\(Int(insets.top.rounded()))px');
            document.documentElement.style.setProperty('--shell-bottom-inset', '\(Int(insets.bottom.rounded()))px');
            """
            webView.evaluateJavaScript(js)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            injectSafeAreaVars(lastInsets, into: webView)
        }

        // MARK: - Native OAuth bridge

        // Single entry point for window.webkit.messageHandlers.oauth.postMessage(url).
        // Body must be a string; a non-string body or a URL outside the project's
        // own Supabase host is answered with null rather than opened, so page
        // script can never drive the session at an arbitrary origin.
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "oauth" else { return }
            guard let raw = message.body as? String,
                  let url = URL(string: raw),
                  url.scheme == "https",
                  url.host == ShellConfig.oauthHost else {
                deliverOAuthCallback(nil)
                return
            }
            startAuthSession(url)
        }

        private func startAuthSession(_ url: URL) {
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: ShellConfig.oauthCallbackScheme
            ) { [weak self] callbackURL, _ in
                self?.authSession = nil
                self?.deliverOAuthCallback(callbackURL?.absoluteString)
            }
            session.presentationContextProvider = self
            // Non-ephemeral: the ephemeral jar hides the user's existing Google
            // session, forcing a full sign-in on every connect.
            session.prefersEphemeralWebBrowserSession = false
            authSession = session
            session.start()
        }

        // The web app resolves its pending promise here. null = cancelled, failed,
        // or rejected by the host check above.
        private func deliverOAuthCallback(_ callback: String?) {
            let argument = callback.flatMap(Coordinator.jsonString) ?? "null"
            DispatchQueue.main.async { [weak self] in
                self?.model.webView?.evaluateJavaScript(
                    "window.__FOCUSOS_OAUTH_CALLBACK__ && window.__FOCUSOS_OAUTH_CALLBACK__(\(argument));"
                )
            }
        }

        // JSON encoding, not string interpolation: the callback URL carries
        // provider-controlled query and fragment values that would otherwise
        // escape the JS string literal.
        private static func jsonString(_ value: String) -> String? {
            guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
                  let encoded = String(data: data, encoding: .utf8) else { return nil }
            return encoded
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first?.keyWindow ?? ASPresentationAnchor()
        }

        // Mic: answer WebKit's per-origin capture prompt from the app's own
        // one-time iOS permission. Without this the user is re-prompted on
        // every launch. (~the 8 lines Capacitor would have given us)
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            if ShellConfig.appHosts.contains(origin.host), type == .microphone {
                decisionHandler(.grant)
            } else {
                decisionHandler(.deny)
            }
        }

        // window.open / target=_blank: WKWebView returns nil silently unless this
        // exists. Send it to the system browser and open nothing in-shell.
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

        // Keep app-origin navigation in-shell; everything else (Google OAuth,
        // user links, /respond email pages) leaves for the system browser.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow); return
            }
            let host = url.host ?? ""
            let isAppHost = ShellConfig.appHosts.contains(host)
            let isHTTP = url.scheme == "https" || url.scheme == "http"

            if navigationAction.targetFrame?.isMainFrame != false, isHTTP, !isAppHost {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        // JS dialogs: WKWebView silently returns false/null without these —
        // the Google Calendar "Disconnect" confirm() would just do nothing.
        func webView(_ webView: WKWebView,
                     runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping () -> Void) {
            presentAlert(title: "Focus OS", message: message, actions: [
                ("OK", { completionHandler() }),
            ])
        }

        func webView(_ webView: WKWebView,
                     runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (Bool) -> Void) {
            presentAlert(title: "Focus OS", message: message, actions: [
                ("Cancel", { completionHandler(false) }),
                ("OK", { completionHandler(true) }),
            ])
        }

        func webView(_ webView: WKWebView,
                     runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?,
                     initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            // The app never uses prompt(); answer nil rather than hang the page.
            completionHandler(nil)
        }

        // iOS kills the WebContent process after background pressure; without
        // this the user comes back to a blank white view.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        // Network failure on cold launch = white screen in a remote-URL shell.
        // Surface the native offline view instead.
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            DispatchQueue.main.async { [weak self] in
                self?.model.loadError = nsError.localizedDescription
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { [weak self] in
                self?.model.loadError = nil
            }
        }

        private func presentAlert(title: String, message: String, actions: [(String, () -> Void)]) {
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let root = scene.keyWindow?.rootViewController else {
                actions.last?.1(); return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            for (label, handler) in actions {
                alert.addAction(UIAlertAction(title: label, style: label == "Cancel" ? .cancel : .default) { _ in handler() })
            }
            var presenter = root
            while let presented = presenter.presentedViewController { presenter = presented }
            presenter.present(alert, animated: true)
        }
    }
}

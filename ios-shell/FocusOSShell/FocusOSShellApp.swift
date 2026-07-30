import SwiftUI

@main
struct FocusOSShellApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var model = ShellModel()

    var body: some View {
        ShellWebView(model: model)
            .ignoresSafeArea() // edge-to-edge: the web app owns the safe areas via env()
            .statusBarHidden(false)
            .overlay(alignment: .center) {
                if let error = model.loadError {
                    OfflineView(message: error) { model.retry() }
                }
            }
    }
}

/// Shown instead of WKWebView's white error page when the remote origin
/// is unreachable (remote-URL shells have no offline story by design).
struct OfflineView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(.secondary)
            Text("Focus OS needs a connection")
                .font(.headline)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}

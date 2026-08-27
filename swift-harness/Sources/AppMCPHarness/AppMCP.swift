import AppKit

/// Dev-only harness that lets the `macos-ui-mcp` MCP server inspect and drive
/// this app's UI over localhost HTTP. Compile it into **DEBUG builds only** — it
/// opens a local port and exposes your view hierarchy.
///
/// Integration (AppDelegate):
/// ```swift
/// func applicationDidFinishLaunching(_ note: Notification) {
///     #if DEBUG
///     AppMCP.start()
///     AppMCP.registerAction("resetOnboarding") { AppState.shared.reset() }
///     #endif
/// }
/// ```
public enum AppMCP {
    private static let lock = NSLock()
    private static var server: HTTPServer?
    static var actions: [String: () -> Void] = [:]

    /// Start the harness.
    /// - Parameter port: localhost port. Must match `MACOS_UI_MCP_HARNESS_URL`
    ///   (default `http://127.0.0.1:8787`) in the MCP server config.
    public static func start(port: UInt16 = 8787) {
        lock.lock(); defer { lock.unlock() }
        guard server == nil else { return }
        let httpServer = HTTPServer(port: port) { Router.handle($0) }
        do {
            try httpServer.start()
            server = httpServer
            NSLog("[macos-ui-mcp] harness listening on http://127.0.0.1:\(port)")
        } catch {
            NSLog("[macos-ui-mcp] failed to start harness: \(error)")
        }
    }

    public static func stop() {
        lock.lock(); defer { lock.unlock() }
        server?.stop()
        server = nil
    }

    /// Register a named hook invokable from Claude via the `invoke_action` tool.
    /// The handler runs on the main thread.
    public static func registerAction(_ name: String, _ handler: @escaping () -> Void) {
        lock.lock(); defer { lock.unlock() }
        actions[name] = handler
    }

    static func action(named name: String) -> (() -> Void)? {
        lock.lock(); defer { lock.unlock() }
        return actions[name]
    }
}

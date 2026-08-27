import AppKit
import AppMCPHarness

// A minimal AppKit app that links the DEBUG harness, so the macos-ui-mcp MCP
// server can be exercised end-to-end against a real running app.
//
//   swift run --package-path showcase Showcase
//   # then, from Claude Code with macos-ui-mcp registered:  get_ui_tree / screenshot / click "#save"
//
// Port comes from SHOWCASE_PORT (default 8790) so it can run next to a real app.

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let status = NSTextField(labelWithString: "Welcome")
    private let email = NSTextField(string: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let port = UInt16(ProcessInfo.processInfo.environment["SHOWCASE_PORT"] ?? "") ?? 8790

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 200))

        status.frame = NSRect(x: 20, y: 150, width: 320, height: 24)
        status.identifier = NSUserInterfaceItemIdentifier("status")

        email.frame = NSRect(x: 20, y: 100, width: 320, height: 24)
        email.placeholderString = "Email"
        email.identifier = NSUserInterfaceItemIdentifier("email")
        email.setAccessibilityLabel("Email")

        let save = NSButton(title: "Save", target: self, action: #selector(didTapSave))
        save.frame = NSRect(x: 20, y: 50, width: 100, height: 32)
        save.identifier = NSUserInterfaceItemIdentifier("save")

        content.addSubview(status)
        content.addSubview(email)
        content.addSubview(save)

        window = NSWindow(
            contentRect: content.frame,
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Showcase"
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        content.layoutSubtreeIfNeeded()

        AppMCP.start(port: port)
        AppMCP.registerAction("reset") { [weak self] in
            self?.email.stringValue = ""
            self?.status.stringValue = "Welcome"
        }

        NSLog("[showcase] ready on http://127.0.0.1:\(port)")
    }

    @objc private func didTapSave() {
        status.stringValue = "Saved: \(email.stringValue)"
    }
}

// Terminate cleanly on SIGTERM so the e2e test can stop us.
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()
signal(SIGTERM, SIG_IGN)

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // no Dock icon, does not steal focus
app.run()

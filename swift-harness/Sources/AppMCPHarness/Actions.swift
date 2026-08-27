import AppKit

/// UI mutations. Every method assumes it is running on the main thread
/// (`Router` hops there once for the whole request).
enum Actions {
    static func tap(_ view: NSView) {
        if let button = view as? NSButton {
            button.performClick(nil)
            return
        }
        if let control = view as? NSControl, let action = control.action {
            NSApp.sendAction(action, to: control.target, from: control)
        }
    }

    @discardableResult
    static func setText(_ view: NSView, _ text: String) -> Bool {
        if let field = view as? NSTextField {
            field.stringValue = text
            if let action = field.action { NSApp.sendAction(action, to: field.target, from: field) }
            return true
        }
        if let textView = view as? NSTextView {
            textView.string = text
            return true
        }
        return false
    }
}

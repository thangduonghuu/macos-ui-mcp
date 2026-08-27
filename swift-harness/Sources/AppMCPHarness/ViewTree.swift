import AppKit

struct WindowInfo {
    let window: NSWindow

    var id: String { "win-\(window.windowNumber)" }

    var dictionary: [String: Any] {
        let frame = window.frame
        return [
            "id": id,
            "title": window.title,
            "key": window.isKeyWindow,
            "frame": rect(frame),
        ]
    }

    static func all() -> [WindowInfo] {
        NSApp.windows.filter { $0.isVisible }.map(WindowInfo.init)
    }

    static func resolve(id: String?) -> WindowInfo? {
        let windows = all()
        guard let id, !id.isEmpty else {
            return windows.first(where: { $0.window.isKeyWindow }) ?? windows.first
        }
        return windows.first(where: { $0.id == id })
    }
}

enum ViewTree {
    /// Serialize an AppKit view subtree into the macos-ui-mcp node shape.
    static func node(for view: NSView) -> [String: Any] {
        var dict: [String: Any] = [
            "id": identifier(for: view),
            "role": role(for: view),
        ]
        if let label = label(for: view) { dict["label"] = label }
        if let value = value(for: view) { dict["value"] = value }
        if let control = view as? NSControl { dict["enabled"] = control.isEnabled }
        if let window = view.window { dict["focused"] = (window.firstResponder === view) }
        dict["frame"] = rect(view.convert(view.bounds, to: nil))

        // Don't descend into a control's private subviews (cells, field editors).
        let children = (view is NSControl) ? [] : view.subviews.map(node(for:))
        if !children.isEmpty { dict["children"] = children }
        return dict
    }

    static func find(_ id: String, in start: NSView?) -> NSView? {
        let roots: [NSView] = start.map { [$0] }
            ?? WindowInfo.all().compactMap { $0.window.contentView }
        for root in roots {
            if let hit = search(id, in: root) { return hit }
        }
        return nil
    }

    private static func search(_ id: String, in view: NSView) -> NSView? {
        if identifier(for: view) == id { return view }
        for subview in view.subviews {
            if let hit = search(id, in: subview) { return hit }
        }
        return nil
    }

    // MARK: attribute extraction

    private static func identifier(for view: NSView) -> String {
        if let raw = view.identifier?.rawValue, !raw.isEmpty { return raw }
        let axId = view.accessibilityIdentifier()
        if !axId.isEmpty { return axId }
        return "v-\(UInt(bitPattern: ObjectIdentifier(view).hashValue))"
    }

    private static func role(for view: NSView) -> String {
        switch view {
        case let field as NSTextField:
            return field.isEditable ? "textfield" : "text"
        case is NSButton:
            return "button"
        case is NSTextView:
            return "textfield"
        case is NSImageView:
            return "image"
        case is NSSlider:
            return "slider"
        case is NSSwitch:
            return "switch"
        case is NSStackView:
            return "group"
        default:
            let ax = (view.accessibilityRole()?.rawValue ?? "")
                .replacingOccurrences(of: "AX", with: "")
                .lowercased()
            return (ax.isEmpty || ax == "unknown") ? "group" : ax
        }
    }

    private static func label(for view: NSView) -> String? {
        if let button = view as? NSButton { return button.title }
        if let field = view as? NSTextField, !field.isEditable { return field.stringValue }
        if let axLabel = view.accessibilityLabel(), !axLabel.isEmpty { return axLabel }
        return nil
    }

    private static func value(for view: NSView) -> Any? {
        if let field = view as? NSTextField, field.isEditable { return field.stringValue }
        if let textView = view as? NSTextView { return textView.string }
        if let toggle = view as? NSSwitch { return toggle.state == .on }
        if let slider = view as? NSSlider { return slider.doubleValue }
        return nil
    }
}

func rect(_ r: NSRect) -> [String: Double] {
    [
        "x": Double(r.origin.x),
        "y": Double(r.origin.y),
        "width": Double(r.size.width),
        "height": Double(r.size.height),
    ]
}

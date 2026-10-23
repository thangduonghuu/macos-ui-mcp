#if os(macOS)
import AppKit

struct WindowInfo {
    let window: NSWindow

    var id: String { "win-\(window.windowNumber)" }

    var rootView: NSView { window.contentView ?? NSView() }

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
            ?? WindowInfo.all().map(\.rootView)
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
#else
import UIKit

struct WindowInfo {
    let window: UIWindow

    var id: String { "win-\(UInt(bitPattern: ObjectIdentifier(window).hashValue))" }

    /// UIWindow is itself a UIView; using it as the root also covers presented controllers.
    var rootView: UIView { window }

    var dictionary: [String: Any] {
        [
            "id": id,
            "title": window.windowScene?.title ?? "",
            "key": window.isKeyWindow,
            "frame": rect(window.frame),
        ]
    }

    static func all() -> [WindowInfo] {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .filter { !$0.isHidden }
            .map(WindowInfo.init)
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
    /// Serialize a UIKit view subtree into the macos-ui-mcp node shape. Hidden,
    /// transparent and clipped-away / off-screen views are left out.
    static func node(for view: UIView) -> [String: Any] {
        let clip = view.window?.bounds ?? view.convert(view.bounds, to: nil)
        return node(for: view, clip: clip)
    }

    private static func node(for view: UIView, clip: CGRect) -> [String: Any] {
        let frame = view.convert(view.bounds, to: nil)
        var dict: [String: Any] = [
            "id": identifier(for: view),
            "role": role(for: view),
        ]
        let label = label(for: view)
        let value = value(for: view)
        if let label { dict["label"] = label }
        if let value { dict["value"] = value }
        if let control = view as? UIControl { dict["enabled"] = control.isEnabled }
        dict["focused"] = view.isFirstResponder
        dict["frame"] = rect(frame)
        // Only worth a hit-test for nodes a selector is likely to target.
        if label != nil || value != nil || view.accessibilityIdentifier?.isEmpty == false,
           !isHittable(view, frame: frame) {
            dict["hittable"] = false
        }

        // Don't descend into a control's private subviews (title labels, backgrounds).
        let childClip = view.clipsToBounds ? clip.intersection(frame) : clip
        let children = (view is UIControl)
            ? []
            : view.subviews.filter { isVisible($0, in: childClip) }.map { node(for: $0, clip: childClip) }
        if !children.isEmpty { dict["children"] = children }
        return dict
    }

    private static func isVisible(_ view: UIView, in clip: CGRect) -> Bool {
        guard !view.isHidden, view.alpha > 0.01 else { return false }
        if view.convert(view.bounds, to: nil).intersects(clip) { return true }
        // An off-screen view can still hold on-screen children unless it clips them.
        return !view.clipsToBounds && !view.subviews.isEmpty
    }

    /// Whether a touch at the view's center would reach it (or a view inside it), i.e. it
    /// is not covered by a sibling, modal or overlay.
    private static func isHittable(_ view: UIView, frame: CGRect) -> Bool {
        guard let window = view.window else { return false }
        let center = CGPoint(x: frame.midX, y: frame.midY)
        guard let hit = window.hitTest(center, with: nil) else { return false }
        return overlaps(hit, view)
    }

    /// True if `hit` is `view`, inside it, or one of its ancestors (a non-interactive view
    /// such as a label hit-tests to its container).
    static func overlaps(_ hit: UIView, _ view: UIView) -> Bool {
        hit.isDescendant(of: view) || view.isDescendant(of: hit)
    }

    /// Text views: UILabel, non-editable UITextView, and React Native's
    /// RCTParagraphComponentView (the native view behind <Text>).
    static func isTextLike(_ view: UIView) -> Bool {
        if view is UILabel { return true }
        if let textView = view as? UITextView { return !textView.isEditable }
        return NSStringFromClass(type(of: view)).hasPrefix("RCTParagraph")
    }

    static func find(_ id: String, in start: UIView?) -> UIView? {
        let roots: [UIView] = start.map { [$0] } ?? WindowInfo.all().map(\.rootView)
        for root in roots {
            if let hit = search(id, in: root) { return hit }
        }
        return nil
    }

    /// Prefers a visible match: React Native keeps screens that are navigated away from
    /// in the hierarchy, so the same testID can exist on a hidden screen.
    private static func search(_ id: String, in root: UIView) -> UIView? {
        var hiddenMatch: UIView?
        var queue: [(UIView, Bool)] = [(root, true)]
        while !queue.isEmpty {
            let (view, visible) = queue.removeFirst()
            if identifier(for: view) == id {
                if visible { return view }
                hiddenMatch = hiddenMatch ?? view
            }
            for subview in view.subviews {
                queue.append((subview, visible && !subview.isHidden && subview.alpha > 0.01))
            }
        }
        return hiddenMatch
    }

    // MARK: attribute extraction

    private static func identifier(for view: UIView) -> String {
        if let axId = view.accessibilityIdentifier, !axId.isEmpty { return axId }
        return "v-\(UInt(bitPattern: ObjectIdentifier(view).hashValue))"
    }

    private static func role(for view: UIView) -> String {
        switch view {
        case is UITextField:
            return "textfield"
        case let textView as UITextView:
            return textView.isEditable ? "textfield" : "text"
        case is UIButton:
            return "button"
        case is UIImageView:
            return "image"
        case is UISlider:
            return "slider"
        case is UISwitch:
            return "switch"
        case is UIScrollView:
            return "scroll"
        case is UIStackView:
            return "group"
        default:
            if isTextLike(view) { return "text" }
            let traits = view.accessibilityTraits
            if traits.contains(.button) { return "button" }
            if traits.contains(.staticText) { return "text" }
            if traits.contains(.image) { return "image" }
            return "group"
        }
    }

    private static func label(for view: UIView) -> String? {
        if let button = view as? UIButton, let title = button.currentTitle ?? button.configuration?.title {
            return title
        }
        if let text = (view as? UILabel)?.text { return text }
        if let textView = view as? UITextView, !textView.isEditable { return textView.text }
        if let axLabel = view.accessibilityLabel, !axLabel.isEmpty { return axLabel }
        // React Native <Text>: the rendered string, when it isn't exposed as a label.
        if isTextLike(view), view.responds(to: NSSelectorFromString("attributedText")),
           let text = (view.value(forKey: "attributedText") as? NSAttributedString)?.string, !text.isEmpty {
            return text
        }
        return nil
    }

    private static func value(for view: UIView) -> Any? {
        if let field = view as? UITextField { return field.text ?? "" }
        if let textView = view as? UITextView, textView.isEditable { return textView.text ?? "" }
        if let toggle = view as? UISwitch { return toggle.isOn }
        if let slider = view as? UISlider { return Double(slider.value) }
        return nil
    }
}

func rect(_ r: CGRect) -> [String: Double] {
    [
        "x": Double(r.origin.x),
        "y": Double(r.origin.y),
        "width": Double(r.size.width),
        "height": Double(r.size.height),
    ]
}
#endif

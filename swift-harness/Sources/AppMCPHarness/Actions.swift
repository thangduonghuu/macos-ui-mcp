#if os(macOS)
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
#else
import UIKit

/// UI mutations. Every method assumes it is running on the main thread.
enum Actions {
    /// Fires a control's actions directly (no touch). Used for UIControls; everything else
    /// gets a synthesized touch (see `Gestures`).
    static func tap(_ control: UIControl) {
        if let toggle = control as? UISwitch {
            toggle.setOn(!toggle.isOn, animated: false)
            toggle.sendActions(for: [.valueChanged, .primaryActionTriggered])
            return
        }
        // A real tap fires both; target-action buttons listen to the first, UIAction ones the second.
        control.sendActions(for: [.touchUpInside, .primaryActionTriggered])
    }

    /// Where a tap on `view` should land. Text is not itself pressable, so climb to the
    /// nearest pressable ancestor: a UIControl, a `.button`, or an accessibility element
    /// (React Native's Pressable / Touchable* are accessible by default).
    static func tapTarget(for view: UIView) -> UIView {
        guard ViewTree.isTextLike(view) else { return view }
        var ancestor = view.superview
        while let current = ancestor, !(current is UIWindow) {
            if current is UIControl || current.accessibilityTraits.contains(.button)
                || current.isAccessibilityElement {
                return current
            }
            ancestor = current.superview
        }
        return view
    }

    /// Types like a keyboard: focus, select everything, ask the delegate
    /// (`shouldChangeCharactersIn` / `shouldChangeTextIn`, which `insertText` skips), then
    /// `insertText` so `.editingChanged` / `textViewDidChange` fire. React Native's
    /// TextInput listens to both to report `onChangeText`.
    @discardableResult
    static func setText(_ view: UIView, _ text: String) -> Bool {
        guard let input = view as? (UIView & UITextInput) else { return false }
        if !input.isFirstResponder { _ = input.becomeFirstResponder() }
        guard input.isFirstResponder else {
            // Can't focus (e.g. not in a window): fall back to assigning the value.
            if let field = input as? UITextField {
                field.text = text
                field.sendActions(for: .editingChanged)
            } else if let textView = input as? UITextView {
                textView.text = text
                textView.delegate?.textViewDidChange?(textView)
            }
            return true
        }
        input.selectedTextRange = input.textRange(from: input.beginningOfDocument, to: input.endOfDocument)
        let all = NSRange(location: 0, length: input.offset(from: input.beginningOfDocument, to: input.endOfDocument))
        if let field = input as? UITextField,
           field.delegate?.textField?(field, shouldChangeCharactersIn: all, replacementString: text) == false {
            return true // rejected, as a keyboard edit would be
        }
        if let textView = input as? UITextView,
           textView.delegate?.textView?(textView, shouldChangeTextIn: all, replacementText: text) == false {
            return true
        }
        if text.isEmpty {
            input.deleteBackward()
        } else {
            input.insertText(text)
        }
        return true
    }

    /// Fallback when touches can't be synthesized: move the content offset directly.
    static func scroll(_ scrollView: UIScrollView, by distance: CGFloat, vertical: Bool, sign: CGFloat) {
        let inset = scrollView.adjustedContentInset
        var offset = scrollView.contentOffset
        if vertical {
            let maxY = max(-inset.top, scrollView.contentSize.height - scrollView.bounds.height + inset.bottom)
            offset.y = min(max(offset.y + sign * distance, -inset.top), maxY)
        } else {
            let maxX = max(-inset.left, scrollView.contentSize.width - scrollView.bounds.width + inset.right)
            offset.x = min(max(offset.x + sign * distance, -inset.left), maxX)
        }
        scrollView.setContentOffset(offset, animated: false)
    }
}
#endif

#if os(macOS)
import AppKit

enum Snapshot {
    /// Render a view to PNG entirely in-process. Uses the app's own drawing —
    /// **no Screen Recording permission** and nothing outside this app is captured.
    /// Assumes it is called on the main thread (Router guarantees that).
    static func png(of view: NSView) -> Data? {
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0,
              let rep = view.bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        rep.size = bounds.size
        view.cacheDisplay(in: bounds, to: rep)
        return rep.representation(using: .png, properties: [:])
    }
}
#else
import UIKit

enum Snapshot {
    /// Render a view to PNG entirely in-process using the app's own drawing.
    /// Assumes it is called on the main thread (Router guarantees that).
    static func png(of view: UIView) -> Data? {
        let bounds = view.bounds
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let image = UIGraphicsImageRenderer(bounds: bounds).image { _ in
            view.drawHierarchy(in: bounds, afterScreenUpdates: false)
        }
        return image.pngData()
    }
}
#endif

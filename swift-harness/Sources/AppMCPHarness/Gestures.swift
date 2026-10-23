#if os(iOS)
import UIKit

/// Touch-driven requests (iOS). Unlike `Router`, these run on the HTTP server queue and
/// hop to the main thread once per touch phase, sleeping a few frames in between, so
/// UIKit and React Native process began / moved / ended as separate run-loop turns —
/// the way a real finger arrives.
enum Gestures {
    private static let frame: useconds_t = 16_000

    /// Handles `/tap`, `/tapAt` and `/scroll`; nil for every other route.
    static func handle(_ request: HTTPRequest) -> HTTPResponse? {
        guard request.method == "POST" else { return nil }
        let body = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] ?? [:]
        let result: (ok: Bool, detail: String?)
        switch request.path {
        case "/tap": result = tap(body)
        case "/tapAt": result = tapAt(body)
        case "/scroll": result = scroll(body)
        default: return nil
        }
        var out: [String: Any] = ["ok": result.ok]
        if let detail = result.detail { out["detail"] = detail }
        return .json(out)
    }

    /// Lets the run loop drain what the last step queued (gesture callbacks, RN events).
    static func settle() {
        usleep(frame * 3)
        DispatchQueue.main.sync {}
    }

    // MARK: routes

    private enum Plan {
        case done(ok: Bool, detail: String?)
        case touch(UIWindow, CGPoint)
    }

    private static func tap(_ body: [String: Any]) -> (ok: Bool, detail: String?) {
        let plan: Plan = DispatchQueue.main.sync {
            guard let id = body["node"] as? String, let view = ViewTree.find(id, in: nil) else {
                return .done(ok: false, detail: "no such node")
            }
            let target = Actions.tapTarget(for: view)
            if let control = target as? UIControl, !(control is UITextField) {
                Actions.tap(control)
                return .done(ok: true, detail: nil)
            }
            guard let window = target.window else { return .done(ok: false, detail: "node is not in a window") }
            let point = target.convert(CGPoint(x: target.bounds.midX, y: target.bounds.midY), to: window)
            if let hit = window.hitTest(point, with: nil), !ViewTree.overlaps(hit, target) {
                return .done(ok: false, detail: "node is covered by \(type(of: hit))")
            }
            return .touch(window, point)
        }
        switch plan {
        case let .done(ok, detail): return (ok, detail)
        case let .touch(window, point): return touchTap(window, point)
        }
    }

    private static func tapAt(_ body: [String: Any]) -> (ok: Bool, detail: String?) {
        guard let x = body["x"] as? Double, let y = body["y"] as? Double else { return (false, "missing x/y") }
        let window = DispatchQueue.main.sync { WindowInfo.resolve(id: body["window"] as? String)?.window }
        guard let window else { return (false, "no matching window") }
        return touchTap(window, CGPoint(x: x, y: y))
    }

    private static func scroll(_ body: [String: Any]) -> (ok: Bool, detail: String?) {
        let direction = body["direction"] as? String ?? "down"
        guard ["up", "down", "left", "right"].contains(direction) else { return (false, "bad direction") }
        let vertical = direction == "up" || direction == "down"
        // "down" reveals content below, so the finger travels up (negative delta).
        let sign: CGFloat = (direction == "down" || direction == "right") ? -1 : 1

        enum ScrollPlan { case missing, done, drag(UIWindow, CGRect, CGFloat) }
        let plan: ScrollPlan = DispatchQueue.main.sync {
            guard let scrollView = targetScrollView(body), let window = scrollView.window else { return .missing }
            let distance = (body["amount"] as? Double).map { CGFloat($0) }
            guard touchSynthesisAvailable else {
                let extent = vertical ? scrollView.bounds.height : scrollView.bounds.width
                Actions.scroll(scrollView, by: distance ?? extent * 0.7, vertical: vertical, sign: -sign)
                return .done
            }
            let area = scrollView.convert(scrollView.bounds, to: window).intersection(window.bounds)
            guard !area.isNull else { return .missing }
            return .drag(window, area, distance ?? (vertical ? area.height : area.width) * 0.7)
        }
        let window: UIWindow, area: CGRect, distance: CGFloat
        switch plan {
        case .missing:
            return (false, "no visible scroll view found")
        case .done:
            settle()
            return (true, "scrolled via setContentOffset (touch synthesis unavailable)")
        case let .drag(w, a, d):
            (window, area, distance) = (w, a, d)
        }

        // Drag in equal segments that stay inside the scroll view (10% inset at each end).
        // The pan only starts moving content after ~10pt of travel, so each drag adds that.
        let slop: CGFloat = 10
        let span = (vertical ? area.height : area.width) * 0.8
        let count = max(1, Int(ceil(distance / (span - slop))))
        let length = distance / CGFloat(count) + slop
        let mid = CGPoint(x: area.midX, y: area.midY)
        let start = vertical
            ? CGPoint(x: mid.x, y: mid.y - sign * span / 2)
            : CGPoint(x: mid.x - sign * span / 2, y: mid.y)
        let end = vertical
            ? CGPoint(x: start.x, y: start.y + sign * length)
            : CGPoint(x: start.x + sign * length, y: start.y)
        for _ in 0..<count where distance >= 1 {
            touchDrag(window, from: start, to: end)
        }
        return (true, nil)
    }

    /// The scroll view for a node: itself, a scroll view inside it (RN's ScrollView wraps
    /// a UIScrollView), or its nearest scrolling ancestor. With no node: the largest
    /// visible scroll view in the window.
    private static func targetScrollView(_ body: [String: Any]) -> UIScrollView? {
        if let id = body["node"] as? String {
            guard let view = ViewTree.find(id, in: nil) else { return nil }
            if let own = view as? UIScrollView ?? firstScrollView(in: view) { return own }
            var ancestor = view.superview
            while let current = ancestor {
                if let scrollView = current as? UIScrollView { return scrollView }
                ancestor = current.superview
            }
            return nil
        }
        guard let window = WindowInfo.resolve(id: body["window"] as? String)?.window else { return nil }
        var all: [UIScrollView] = []
        collectScrollViews(in: window, into: &all)
        return all.max { area($0) < area($1) }
    }

    private static func firstScrollView(in view: UIView) -> UIScrollView? {
        var queue = view.subviews
        while !queue.isEmpty {
            let next = queue.removeFirst()
            if let scrollView = next as? UIScrollView, !next.isHidden { return scrollView }
            queue.append(contentsOf: next.subviews)
        }
        return nil
    }

    private static func collectScrollViews(in view: UIView, into out: inout [UIScrollView]) {
        guard !view.isHidden, view.alpha > 0.01 else { return }
        if let scrollView = view as? UIScrollView, scrollView.isScrollEnabled,
           !(scrollView is UITextView) { out.append(scrollView) }
        view.subviews.forEach { collectScrollViews(in: $0, into: &out) }
    }

    private static func area(_ view: UIView) -> CGFloat {
        guard let window = view.window else { return 0 }
        let visible = view.convert(view.bounds, to: window).intersection(window.bounds)
        return visible.isNull ? 0 : visible.width * visible.height
    }

    // MARK: touch sequences

    private static func touchTap(_ window: UIWindow, _ point: CGPoint) -> (ok: Bool, detail: String?) {
        #if DEBUG
        let touch = DispatchQueue.main.sync { SyntheticTouch(at: point, in: window) }
        guard let touch else { return (false, "touch synthesis is unavailable on this iOS version") }
        usleep(frame * 3)
        DispatchQueue.main.sync { touch.end() }
        settle()
        return (true, nil)
        #else
        return (false, "touch synthesis is DEBUG-only")
        #endif
    }

    private static func touchDrag(_ window: UIWindow, from start: CGPoint, to end: CGPoint) {
        #if DEBUG
        guard let touch = DispatchQueue.main.sync(execute: { SyntheticTouch(at: start, in: window) }) else { return }
        let steps = 12
        for step in 1...steps {
            usleep(frame)
            let t = CGFloat(step) / CGFloat(steps)
            let point = CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
            DispatchQueue.main.sync { touch.move(to: point) }
        }
        // Hold still before lifting, reporting the resting position every frame like a real
        // finger, so the release carries no velocity (no momentum).
        for _ in 0..<8 {
            usleep(frame)
            DispatchQueue.main.sync { touch.move(to: end) }
        }
        usleep(frame)
        DispatchQueue.main.sync { touch.end() }
        settle()
        #endif
    }
}

/// False in non-DEBUG builds (touch synthesis is compiled out) or when a private symbol
/// it needs is missing on this iOS version.
#if DEBUG
private var touchSynthesisAvailable: Bool { TouchSynth.isAvailable }
#else
private let touchSynthesisAvailable = false
#endif
#endif

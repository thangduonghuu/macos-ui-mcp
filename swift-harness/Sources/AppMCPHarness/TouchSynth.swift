#if os(iOS) && DEBUG
import Darwin
import UIKit

/// Synthesizes real touches and feeds them through `UIApplication.sendEvent`, so gesture
/// recognizers and responders (including React Native's RCTSurfaceTouchHandler) see them
/// exactly like a finger. Same technique as KIF / EarlGrey: private UITouch / UIEvent
/// setters plus an IOHIDEvent attached to both. DEBUG-only; every private symbol is looked
/// up at runtime, and `isAvailable` is false if any is missing on this iOS version.
final class SyntheticTouch {
    private let touch: UITouch
    private let window: UIWindow

    /// Begins a touch at `point` (window coordinates). Must run on the main thread.
    init?(at point: CGPoint, in window: UIWindow) {
        guard TouchSynth.isAvailable else { return nil }
        self.window = window
        touch = UITouch()
        let target = window.hitTest(point, with: nil) ?? window
        TouchSynth.send(touch, "setWindow:", object: window)
        TouchSynth.send(touch, "setTapCount:", int: 1)
        TouchSynth.send(touch, "_setLocationInWindow:resetPrevious:", point: point, flag: true)
        TouchSynth.send(touch, "setView:", object: target)
        TouchSynth.send(touch, "setPhase:", int: UITouch.Phase.began.rawValue)
        TouchSynth.send(touch, "_setIsFirstTouchForView:", flag: true)
        TouchSynth.send(touch, "setIsTap:", flag: true)
        TouchSynth.send(touch, "setGestureView:", object: target)
        dispatch()
    }

    func move(to point: CGPoint) {
        TouchSynth.send(touch, "setIsTap:", flag: false)
        TouchSynth.send(touch, "_setLocationInWindow:resetPrevious:", point: point, flag: false)
        TouchSynth.send(touch, "setPhase:", int: UITouch.Phase.moved.rawValue)
        dispatch()
    }

    func end() {
        TouchSynth.send(touch, "setPhase:", int: UITouch.Phase.ended.rawValue)
        dispatch()
    }

    private func dispatch() {
        TouchSynth.send(touch, "setTimestamp:", double: ProcessInfo.processInfo.systemUptime)
        let hidEvent = TouchSynth.hidEvent(for: touch, in: window)
        TouchSynth.send(touch, "_setHidEvent:", pointer: hidEvent)
        guard let event = UIApplication.shared.perform(NSSelectorFromString("_touchesEvent"))?
            .takeUnretainedValue() as? UIEvent else { return }
        TouchSynth.send(event, "_clearTouches")
        TouchSynth.send(event, "_setHIDEvent:", pointer: hidEvent)
        TouchSynth.send(event, "_addTouch:forDelayedDelivery:", object: touch, flag: false)
        UIApplication.shared.sendEvent(event)
        if let hidEvent { Unmanaged<AnyObject>.fromOpaque(UnsafeRawPointer(hidEvent)).release() }
    }
}

enum TouchSynth {
    // IOKit digitizer constants (IOHIDEventTypes.h / IOHIDEventField.h).
    private static let transducerHand: UInt32 = 3
    private static let eventRange: UInt32 = 1 << 0
    private static let eventTouch: UInt32 = 1 << 1
    private static let eventPosition: UInt32 = 1 << 2
    private static let fieldIsDisplayIntegrated: UInt32 = (11 << 16) | 25

    private typealias CreateHand = @convention(c) (
        CFAllocator?, UInt64, UInt32, UInt32, UInt32, UInt32, UInt32,
        Double, Double, Double, Double, Double, UInt8, UInt8, UInt32
    ) -> OpaquePointer?
    private typealias CreateFinger = @convention(c) (
        CFAllocator?, UInt64, UInt32, UInt32, UInt32,
        Double, Double, Double, Double, Double, Double, Double, Double, Double, Double,
        UInt8, UInt8, UInt32
    ) -> OpaquePointer?
    private typealias SetInteger = @convention(c) (OpaquePointer, UInt32, Int) -> Void
    private typealias Append = @convention(c) (OpaquePointer, OpaquePointer, UInt32) -> Void

    private static let iokit = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_NOW)
    private static func symbol<T>(_ name: String, as _: T.Type) -> T? {
        dlsym(iokit, name).map { unsafeBitCast($0, to: T.self) }
    }

    private static let createHand = symbol("IOHIDEventCreateDigitizerEvent", as: CreateHand.self)
    private static let createFinger = symbol("IOHIDEventCreateDigitizerFingerEventWithQuality", as: CreateFinger.self)
    private static let setInteger = symbol("IOHIDEventSetIntegerValue", as: SetInteger.self)
    private static let append = symbol("IOHIDEventAppendEvent", as: Append.self)

    static let isAvailable: Bool = {
        let missing = missingSymbols()
        if !missing.isEmpty {
            NSLog("[macos-ui-mcp] touch synthesis unavailable, missing: \(missing.joined(separator: ", "))")
        }
        return missing.isEmpty
    }()

    private static func missingSymbols() -> [String] {
        var missing: [String] = []
        if createHand == nil { missing.append("IOHIDEventCreateDigitizerEvent") }
        if createFinger == nil { missing.append("IOHIDEventCreateDigitizerFingerEventWithQuality") }
        if setInteger == nil { missing.append("IOHIDEventSetIntegerValue") }
        if append == nil { missing.append("IOHIDEventAppendEvent") }
        if !UIApplication.shared.responds(to: NSSelectorFromString("_touchesEvent")) {
            missing.append("-[UIApplication _touchesEvent]")
        }
        let touchSelectors = [
            "setWindow:", "setView:", "setTapCount:", "_setLocationInWindow:resetPrevious:",
            "setPhase:", "setTimestamp:", "_setHidEvent:",
        ]
        missing += touchSelectors.filter { !UITouch.instancesRespond(to: NSSelectorFromString($0)) }
            .map { "-[UITouch \($0)]" }
        let eventSelectors = ["_clearTouches", "_setHIDEvent:", "_addTouch:forDelayedDelivery:"]
        // These live on the private UITouchesEvent subclass that `_touchesEvent` returns.
        let eventClass: AnyClass = NSClassFromString("UITouchesEvent") ?? UIEvent.self
        missing += eventSelectors.filter { !eventClass.instancesRespond(to: NSSelectorFromString($0)) }
            .map { "-[UITouchesEvent \($0)]" }
        return missing
    }

    /// A hand event carrying one finger event, mirroring what the HID system delivers.
    /// Returned +1 retained; the caller releases it.
    fileprivate static func hidEvent(for touch: UITouch, in window: UIWindow) -> OpaquePointer? {
        guard let createHand, let createFinger, let setInteger, let append else { return nil }
        let now = mach_absolute_time()
        guard let hand = createHand(
            kCFAllocatorDefault, now, transducerHand, 0, 0, eventTouch, 0, 0, 0, 0, 0, 0, 0, 1, 0
        ) else { return nil }
        setInteger(hand, fieldIsDisplayIntegrated, 1)

        let location = touch.location(in: window)
        let mask = touch.phase == .moved ? eventPosition : (eventRange | eventTouch)
        let touching: UInt8 = touch.phase == .ended ? 0 : 1
        if let finger = createFinger(
            kCFAllocatorDefault, now, 1, 2, mask,
            Double(location.x), Double(location.y), 0, 0, 0, 5, 5, 1, 1, 1,
            touching, touching, 0
        ) {
            setInteger(finger, fieldIsDisplayIntegrated, 1)
            append(hand, finger, 0)
            Unmanaged<AnyObject>.fromOpaque(UnsafeRawPointer(finger)).release()
        }
        return hand
    }

    // MARK: typed objc_msgSend for private selectors (no-op if the selector is missing)

    private static func imp<T>(_ target: NSObject, _ name: String, as _: T.Type) -> (Selector, T)? {
        let sel = NSSelectorFromString(name)
        guard target.responds(to: sel) else { return nil }
        return (sel, unsafeBitCast(target.method(for: sel), to: T.self))
    }

    fileprivate static func send(_ target: NSObject, _ name: String) {
        typealias F = @convention(c) (AnyObject, Selector) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, object: AnyObject) {
        typealias F = @convention(c) (AnyObject, Selector, AnyObject) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, object) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, object: AnyObject, flag: Bool) {
        typealias F = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, object, flag) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, int: Int) {
        typealias F = @convention(c) (AnyObject, Selector, Int) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, int) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, flag: Bool) {
        typealias F = @convention(c) (AnyObject, Selector, Bool) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, flag) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, double: Double) {
        typealias F = @convention(c) (AnyObject, Selector, Double) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, double) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, point: CGPoint, flag: Bool) {
        typealias F = @convention(c) (AnyObject, Selector, CGPoint, Bool) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, point, flag) }
    }

    fileprivate static func send(_ target: NSObject, _ name: String, pointer: OpaquePointer?) {
        typealias F = @convention(c) (AnyObject, Selector, OpaquePointer?) -> Void
        if let (sel, f) = imp(target, name, as: F.self) { f(target, sel, pointer) }
    }
}
#endif

import AppMCPHarness
import UIKit

// A UIKit app that mimics how React Native's views look to UIKit, so the iOS harness can
// be tested without a JS toolchain:
//  - one gesture recognizer on the root view decides what was pressed (RCTSurfaceTouchHandler);
//  - "buttons" are plain UIViews, not UIControls, with the text in a child label (Pressable + Text);
//  - the text field's "JS state" only updates through the keyboard path: the delegate's
//    shouldChangeCharactersIn followed by .editingChanged.

/// Stand-in for RN's Pressable: an accessible plain view whose label comes from its child text.
final class Pressable: UIView {
    let text = UILabel()
    var onPress: () -> Void = {}

    init(title: String, id: String) {
        super.init(frame: .zero)
        backgroundColor = .systemBlue
        layer.cornerRadius = 8
        isAccessibilityElement = true
        accessibilityIdentifier = id
        text.text = title
        text.textColor = .white
        text.textAlignment = .center
        text.isUserInteractionEnabled = true // RN text views take part in hit-testing
        addSubview(text)
    }

    required init?(coder: NSCoder) { fatalError() }

    override var accessibilityLabel: String? {
        get { text.text }
        set {}
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        text.frame = bounds
    }
}

/// Stand-in for RCTSurfaceTouchHandler: sees raw touches for the whole surface and fires
/// `onPress` when a touch begins and ends inside the same Pressable.
final class SurfaceTouchHandler: UIGestureRecognizer {
    private var pressed: Pressable?

    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false
        delaysTouchesEnded = false
    }

    // Like RN's handler: never block the scroll view's pan.
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }

    private func pressable(for touch: UITouch) -> Pressable? {
        var view = touch.view
        while let current = view {
            if let pressable = current as? Pressable { return pressable }
            view = current.superview
        }
        return nil
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        pressed = touches.first.flatMap(pressable(for:))
        state = .began
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .changed
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        if let pressed, let touch = touches.first,
           pressed.bounds.contains(touch.location(in: pressed)) {
            pressed.onPress()
        }
        pressed = nil
        state = .ended
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        pressed = nil
        state = .cancelled
    }
}

final class ShowcaseViewController: UIViewController, UITextFieldDelegate {
    private let status = UILabel()
    private let field = UITextField()
    private let nextButton = Pressable(title: "Tiếp", id: "next")
    private let reset = UIButton(type: .system)
    private let list = UIScrollView()
    private var rows: [UILabel] = []
    private let screen2 = UIView()
    private let screen2Title = UILabel()

    /// What "JS" believes the field contains. Only the keyboard path updates it.
    private var typed = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.addGestureRecognizer(SurfaceTouchHandler(target: nil, action: nil))

        status.accessibilityIdentifier = "status"
        status.text = "Welcome"

        field.accessibilityIdentifier = "email"
        field.placeholder = "Email"
        field.borderStyle = .roundedRect
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.delegate = self
        field.addTarget(self, action: #selector(textChanged), for: .editingChanged)

        reset.accessibilityIdentifier = "reset"
        reset.setTitle("Reset", for: .normal)
        reset.addTarget(self, action: #selector(resetAll), for: .touchUpInside)

        nextButton.onPress = { [weak self] in self?.screen2.isHidden = false }

        for i in 1...30 {
            let row = UILabel()
            row.text = "Row \(i)"
            row.accessibilityIdentifier = "row-\(i)"
            list.addSubview(row)
            rows.append(row)
        }

        // Screen 2 covers screen 1 instead of replacing it, the way a navigation stack
        // leaves the previous screen in the hierarchy.
        screen2.backgroundColor = .systemBackground
        screen2.isHidden = true
        screen2Title.text = "Màn 2"
        screen2Title.accessibilityIdentifier = "screen2-title"
        screen2.addSubview(screen2Title)

        [status, field, nextButton, reset, list, screen2].forEach(view.addSubview)
        AppMCP.registerAction("reset") { [weak self] in self?.resetAll() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let area = view.bounds.inset(by: view.safeAreaInsets).insetBy(dx: 20, dy: 12)
        var y = area.minY
        func place(_ v: UIView, height: CGFloat) {
            v.frame = CGRect(x: area.minX, y: y, width: area.width, height: height)
            y += height + 12
        }
        place(status, height: 28)
        place(field, height: 40)
        place(nextButton, height: 44)
        place(reset, height: 36)
        list.frame = CGRect(x: area.minX, y: y, width: area.width, height: min(240, area.maxY - y))
        for (i, row) in rows.enumerated() {
            row.frame = CGRect(x: 0, y: CGFloat(i) * 40, width: area.width, height: 40)
        }
        list.contentSize = CGSize(width: area.width, height: CGFloat(rows.count) * 40)
        screen2.frame = view.bounds
        screen2Title.frame = CGRect(x: area.minX, y: area.minY, width: area.width, height: 40)
    }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange,
                   replacementString string: String) -> Bool {
        typed = (typed as NSString).replacingCharacters(in: range, with: string)
        return true
    }

    /// RN reports the change on `.editingChanged`, after the delegate saw the edit.
    @objc private func textChanged() {
        status.text = "Typed: \(typed)"
    }

    @objc private func resetAll() {
        typed = ""
        field.text = ""
        status.text = "Welcome"
        screen2.isHidden = true
        list.contentOffset = .zero
        field.resignFirstResponder()
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let port = ProcessInfo.processInfo.environment["SHOWCASE_PORT"].flatMap(UInt16.init) ?? 8790
        AppMCP.start(port: port)
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = ShowcaseViewController()
        window?.makeKeyAndVisible()
        return true
    }
}

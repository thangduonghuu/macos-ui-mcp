# AppMCPHarness

Drop-in, **DEBUG-only** harness that exposes this app's UI to the `macos-ui-mcp` MCP
server over `http://127.0.0.1:8787`. Works for macOS (AppKit) and iOS / iOS Simulator
(UIKit) apps. No Screen Recording permission — the app renders
itself.

## Add it to your app

### Swift Package Manager

In Xcode: *File ▸ Add Package Dependencies ▸ Add Local…* and pick this `swift-harness`
folder. Then, on your **app** target, gate the link so it never ships in Release:

- *Build Phases ▸ Link Binary With Libraries* → add `AppMCPHarness`, set status to
  *Optional*, or
- keep the framework out of the Release configuration via a per-configuration setting.

The safer pattern is to keep all calls behind `#if DEBUG` (below) and add the package
only to a Debug-only scheme.

### Manual

Copy `Sources/AppMCPHarness/*.swift` into a `Debug`-only compilation condition group.

## Start it

```swift
import AppMCPHarness

func applicationDidFinishLaunching(_ notification: Notification) {
    #if DEBUG
    AppMCP.start()                       // default port 8787
    AppMCP.registerAction("signOut") { SessionStore.shared.clear() }
    AppMCP.registerAction("seedData") { Fixtures.load() }
    #endif
}
```

SwiftUI app lifecycle:

```swift
@main
struct MyApp: App {
    init() {
        #if DEBUG
        AppMCP.start()
        #endif
    }
    var body: some Scene { WindowGroup { ContentView() } }
}
```

## Make elements addressable

The harness ids each node from, in order: `view.identifier`, then
`accessibilityIdentifier()`, then a synthesized `v-<hash>` (unstable across launches).
Give the views you'll target a stable id:

```swift
// SwiftUI
Button("Save") { save() }
    .accessibilityIdentifier("save")

TextField("Email", text: $email)
    .accessibilityIdentifier("email")
```

```swift
// AppKit
saveButton.identifier = NSUserInterfaceItemIdentifier("save")

// UIKit
saveButton.accessibilityIdentifier = "save"
```

Then Claude can use `#save`, `#email` as selectors.

## HTTP contract

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /windows` | — | `{ windows: [{ id, title, key, frame }] }` |
| `GET /tree` | `?window=<id>` (optional) | `{ window, tree }` — recursive `{ id, role, label?, value?, enabled?, focused?, frame, children? }` |
| `GET /snapshot` | `?window=<id>&node=<id>` (both optional) | `image/png` |
| `POST /tap` | `{ "node": "<id>" }` | `{ ok, detail? }` |
| `POST /setText` | `{ "node": "<id>", "text": "…" }` | `{ ok, detail? }` |
| `POST /action` | `{ "name": "<registered name>" }` | `{ ok, detail? }` |
| `POST /tapAt` (iOS) | `{ "x", "y", "window"? }` — window coordinates | `{ ok, detail? }` |
| `POST /scroll` (iOS) | `{ "node"?, "window"?, "direction": "up\|down\|left\|right", "amount"? }` | `{ ok, detail? }` |

## Notes & limits

- **AppKit / UIKit introspection only.** For a pure-SwiftUI view, the tree reflects the
  backing views the framework synthesizes — usable, but coarser than the SwiftUI view graph.
  A SwiftUI-native adapter (via `_ViewDebug` / a custom `EnvironmentKey` registry) is a
  planned improvement.
- **iOS specifics.**
  - `click` on a `UIControl` fires its actions directly (and toggles a `UISwitch`).
    Any other view (React Native `Pressable`, custom gesture views) gets a real touch
    synthesized through `UIApplication.sendEvent`, the KIF / EarlGrey technique, using
    private UIKit / IOKit symbols. It's compiled only under `DEBUG`, looked up at runtime,
    and logs which symbol is missing if an iOS version drops one. Tapping a Text taps its
    nearest pressable parent, and a covered target is refused.
  - `type` focuses the field, asks the delegate (`shouldChangeCharactersIn`) and then
    calls `insertText`, so React Native's `onChangeText` fires.
  - `POST /tapAt` and `POST /scroll` are iOS-only. Scrolling drags in segments and
    holds still before lifting, so there's no momentum.
  - The tree leaves out hidden, transparent and clipped-away / off-screen views, and
    marks covered nodes `hittable: false`.
  - Snapshots use `drawHierarchy`, so system UI (status bar, keyboard) isn't included.
  - The listener binds `127.0.0.1` explicitly, because `acceptLocalOnly` resets
    connections in the Simulator.
- **CocoaPods:** `AppMCPHarness.podspec` (used by `expo-plugin/`). Link it with
  `:configurations => ['Debug']`.
- Single request per TCP connection; no keep-alive, no chunked bodies. Fine for a local
  dev tool.
- Binds `127.0.0.1` only. Still: **do not ship it** — keep every call
  behind `#if DEBUG`.
- `swift build` here just compiles the library in isolation; real use is linking it into
  a `.app`.

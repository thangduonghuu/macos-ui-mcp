# AppMCPHarness

Drop-in, **DEBUG-only** harness that exposes this app's UI to the `macos-ui-mcp` MCP
server over `http://127.0.0.1:8787`. No Screen Recording permission — the app renders
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

## Notes & limits

- **AppKit introspection only.** For a pure-SwiftUI view, the tree reflects the AppKit
  backing views AppKit synthesizes — usable, but coarser than the SwiftUI view graph.
  A SwiftUI-native adapter (via `_ViewDebug` / a custom `EnvironmentKey` registry) is a
  planned improvement.
- Single request per TCP connection; no keep-alive, no chunked bodies. Fine for a local
  dev tool.
- Binds `127.0.0.1` only (`acceptLocalOnly`). Still: **do not ship it** — keep every call
  behind `#if DEBUG`.
- `swift build` here just compiles the library in isolation; real use is linking it into
  a `.app`.

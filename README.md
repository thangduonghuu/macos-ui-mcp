# macos-ui-mcp

A Playwright-style tool that lets **Claude inspect and drive a native macOS app's UI
while you build it — without Screen Recording permission.** The same harness runs in
iOS Simulator apps, including React Native / Expo apps.

Instead of capturing the screen, the app renders itself. A tiny debug-only harness
inside your app exposes its view tree and an in-process PNG renderer over localhost
HTTP; an MCP server turns that into tools Claude can call.

See [IDEA.md](./IDEA.md) for the design rationale, the architecture comparison, and the
project goals.

## Architecture

```mermaid
flowchart LR
    Claude["Claude Code"] -- "MCP (stdio)" --> Server["macos-ui-mcp server\n(src/)"]
    Server -- "HTTP :8787" --> Harness["AppMCP harness\n(DEBUG builds only)"]

    subgraph App["Your app process"]
        Harness
    end
```

The server and the harness talk one shared HTTP contract
([`src/contract.ts`](./src/contract.ts)), so either harness implementation works with
the same MCP tools:

```mermaid
flowchart TB
    Contract["HTTP contract\nGET /windows · /tree · /snapshot\nPOST /tap · /setText · /action"]
    Contract --> Swift["swift-harness/\nAppKit / UIKit / SwiftUI — NSView / UIView tree"]
    Contract --> Tauri["tauri-harness/\nTauri v2 — webview DOM"]
```

## Tools

| Tool | Does |
|---|---|
| `launch_app` | Launch the target app (`.app` bundle via `open`, or a plain executable) and wait for its harness to come up. With `simulator`, installs and launches an iOS build on the Simulator via `xcrun simctl`. |
| `list_windows` | List the app's on-screen windows (id, title, key, frame). |
| `get_ui_tree` | Dump the semantic view tree: roles, labels, values, enabled/focused state, frames, stable ids. |
| `screenshot` | Render a window — or a single node via `selector` — to PNG, in-process. No Screen Recording permission. |
| `click` | Tap a view matched by selector. On iOS, non-`UIControl` views (React Native `Pressable`, etc.) get a real synthesized touch; tapping a Text taps its nearest pressable parent. |
| `type` | Set the text value of a field matched by selector. On iOS it types like the keyboard (delegate + `editingChanged`), so React Native `onChangeText` fires. |
| `tap_at` | Tap at a window coordinate with a real synthesized touch (iOS). |
| `scroll` | Scroll a scroll view with a synthesized drag, no momentum (iOS). |
| `invoke_action` | Trigger a named action hook the app registered via `AppMCP.registerAction(name, …)`. |
| `wait_for` | Poll the UI tree until a selector appears, or time out. |

A typical session — Claude launches the app itself, then drives it:

```mermaid
sequenceDiagram
    participant C as Claude
    participant M as MCP server
    participant H as Harness (in app)

    C->>M: launch_app(path)
    M->>H: spawn app, poll GET /windows
    H-->>M: 200 { windows: [...] }
    C->>M: get_ui_tree()
    M->>H: GET /tree
    H-->>M: view tree JSON
    C->>M: click(selector)
    M->>H: POST /tap
    H-->>M: { ok: true }
    C->>M: screenshot()
    M->>H: GET /snapshot
    H-->>M: PNG bytes
```

## Layout

| Path | What |
|---|---|
| `src/` | the MCP server (TypeScript) |
| `src/contract.ts` | the harness HTTP wire format (types + zod schemas) |
| `test/` | vitest suite + an in-memory mock harness; `e2e*.test.ts` drive the real apps (macOS, iOS, RN) |
| `swift-harness/` | drop-in harness for native AppKit / SwiftUI apps |
| `tauri-harness/` | drop-in harness (Tauri v2 plugin) for webview apps |
| `showcase/` | a minimal AppKit app that links the harness — used by the e2e test |
| `showcase-ios/` | a UIKit app shaped like React Native — used by the iOS e2e test |
| `expo-plugin/` | Expo config plugin that embeds the harness in Debug iOS builds |
| `examples/expo-rn/` | a minimal Expo / React Native app using the plugin |

## Use it

### 1. Add the harness to your app (DEBUG builds only)

**AppKit / SwiftUI** — see [`swift-harness/README.md`](./swift-harness/README.md). One line
in your `AppDelegate`:

```swift
#if DEBUG
AppMCP.start()   // opens http://127.0.0.1:8787
#endif
```

**Tauri v2** — see [`tauri-harness/README.md`](./tauri-harness/README.md). Register the
plugin behind `#[cfg(debug_assertions)]` and add `"macos-ui-mcp:default"` to your
capabilities:

```rust
#[cfg(debug_assertions)]
{
    builder = builder.plugin(tauri_plugin_macos_ui_mcp::init());
}
```

**Expo / React Native** — see [`expo-plugin/README.md`](./expo-plugin/README.md). Add the
plugin to `app.config.js`; `expo prebuild` links the harness (Debug only) and starts it.

### 2. Build the MCP server

```sh
npm install
npm run build
```

### 3. Register it with Claude Code

```jsonc
// .mcp.json
{
  "mcpServers": {
    "macos-ui-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/macos-ui-mcp/dist/index.js"],
      "env": { "MACOS_UI_MCP_HARNESS_URL": "http://127.0.0.1:8787" }
    }
  }
}
```

### iOS Simulator

The same `swift-harness` builds for iOS (UIKit). Add it to your iOS app, build for a
simulator (`Debug-iphonesimulator`), boot a simulator, then:

```
launch_app(path: ".../Debug-iphonesimulator/MyApp.app", simulator: "booted")
```

This runs `simctl install` + `simctl launch --terminate-running-process` (bundle id read
from `Info.plist`; `env` is forwarded as `SIMCTL_CHILD_*`). Simulator apps share the
Mac's loopback, so the harness is still reached at `http://127.0.0.1:8787`.

Now ask Claude to call `launch_app` (path to your `.app` bundle or executable) to start
your debug build and wait for the harness to come up, then `get_ui_tree`, `click`,
`type`, or `screenshot` — no Screen Recording prompt.

## Selector grammar

Used by `click`, `type`, `screenshot`, `wait_for`:

| Form | Matches |
|---|---|
| `#save` | node whose id is `save` (set via `.accessibilityIdentifier("save")` in the app) |
| `Button "Save"` | role `button` **and** label `Save` |
| `"Save"` | any node with label `Save` |
| `Button` | any node with role `button` |

`"Label"` also matches visible text (React Native `<Text>`), and on iOS only on-screen
nodes are listed: hidden, transparent and scrolled-away views are left out.

When several nodes match, a match nested inside another match counts as one element (an RN
Pressable and the Text inside it), and nodes marked `hittable: false` (covered, e.g. by
the next screen) are dropped. If more than one match is still left, `click` / `type`
refuse and report the candidate ids.

## Develop

```sh
npm test           # unit tests, no real app needed (mock harness); e2e is skipped
npm run typecheck
npm run dev         # run the server against a live harness

npm run test:e2e    # builds showcase/, launches it, runs the real tools against the
                    # real Swift harness. Needs a logged-in macOS GUI session.
npm run test:e2e:ios  # builds showcase-ios/, installs it on the booted simulator, drives it
npm run test:e2e:rn   # drives examples/expo-rn (real RN app; build it first, see its README)
```

`npm run test:e2e` is the proof of the goals: it asserts `get_ui_tree` sees the
controls, `screenshot` returns a real in-process PNG, and `click` / `type` change the
live UI — with no Screen Recording permission.

## Status

- **AppKit / SwiftUI** (`swift-harness/`) — all 7 harness-specific tools. 56 unit tests
  + a 5-case end-to-end test driving the `showcase/` app through the real harness.
  Verified: tree, in-process PNG snapshot, tap, set-text, action hooks — Screen
  Recording off.
- **Tauri v2** (`tauri-harness/`) — plugin compiles (`cargo check` / `clippy` clean);
  full DOM tree, DOM-event interaction, dependency-free snapshot. Not yet exercised by
  an automated end-to-end test in this repo (no Tauri showcase app).
- **iOS / iOS Simulator** (`swift-harness/`, UIKit) — tree with visibility filtering and
  `hittable`, in-process snapshot, real synthesized touches (`click`, `tap_at`,
  `scroll`), keyboard-path typing. Verified on the iOS 26.2 simulator by `test:e2e:ios`
  (RN-shaped UIKit app) and `test:e2e:rn` (real Expo 57 / RN 0.86 app).
- **Expo / React Native** (`expo-plugin/`) — Debug-only pod + `AppMCP.start` on every
  `expo prebuild`; verified on a real prebuild (Release links nothing).
- **`launch_app`** — framework-agnostic (spawns/`open`s whatever path you give it, then
  polls the harness); with `simulator`, `simctl install` + `launch`. Used by both iOS
  e2e suites.
- Not yet — SwiftUI-native tree (AppKit introspection only for now), Windows adapter,
  third-party-app inspection via the Accessibility API.

## License

[MIT](./LICENSE) © 2026 Thang Duong

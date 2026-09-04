# macos-ui-mcp — a Playwright-style tool for native desktop apps

## Problem

When vibe-coding a macOS app with Claude Code, the only way for Claude to "see" the UI
today is **whole-screen Screen Recording** permission — which captures *everything* on the
machine. That's uncomfortable for privacy and it's noisy.

Goal: a **Playwright-like** tool for native desktop apps (macOS first, Windows later) so
Claude can inspect the UI and app state *while building it* — without recording the screen.

---

## Core insight

Playwright is powerful **not because it screenshots**, but because it reads the **DOM**: a
semantic tree of elements (role, label, value) you can query and act on. Pixels are the
fallback.

Every desktop OS already ships the equivalent semantic tree: the **Accessibility API**
(what screen readers use). For any app it gives you:

- The window / control hierarchy
- Per element: role (button, textfield, checkbox…), label, value, enabled/focused state,
  on-screen frame
- Invokable actions: press, set value, focus, scroll

So the tool to build is: **an MCP server that talks to a semantic UI tree**, with
**per-window screenshots** as a secondary channel. Claude calls tools like `get_ui_tree`
and `click` — it never records the screen.

---

## The macOS permission problem

Three ways to "see" a UI on macOS; only one triggers the scary prompt:

| Path | macOS permission | Sees |
|---|---|---|
| Screen Recording (ScreenCaptureKit) | **Screen Recording** — captures *everything* | any window, live |
| Accessibility API (AXUIElement) | **Accessibility** ("control your computer") — no screen stream | semantic tree + synthetic input, any app |
| **Render in-process** (the app draws itself to PNG) | **none** | only that app's own windows |

The real annoyance is path 1. Paths 2 and 3 avoid it.

Windows is easier here: `PrintWindow(hwnd, …, PW_RENDERFULLCONTENT)` captures a single
specific window with **no special permission**.

---

## Three architectures (pick by what you're building)

### A. Generic — MCP server → OS accessibility

Works with **any** app, including third-party. One small native helper per platform behind
a shared interface:

- **macOS**: tiny Swift helper using `AXUIElement` (ApplicationServices). Dumps the tree to
  JSON, calls `AXPress` / sets `AXValue`. One-time Accessibility permission.
- **Windows**: small C# helper using **UI Automation** (or
  [FlaUI](https://github.com/FlaUI/FlaUI)). `IUIAutomationElement` tree +
  `InvokePattern` / `ValuePattern`. `PrintWindow` for pixels.
- **MCP server** (TypeScript — best MCP SDK support) talks to the helpers over stdio/JSON.

Selector language modeled on Playwright:
`button "Save"`, `textfield[label="Email"]`, `row >> button "Delete"`.

### B. In-app dev harness — best for vibe-coding *your own* app  ← chosen

Link a **debug-only** library into the app. When an env flag is set it opens a localhost
HTTP server exposing:

- `GET /tree` → view hierarchy as JSON (you have the real view models, so this is *richer*
  than AX — real state, test IDs, nav stack)
- `GET /snapshot` → render the window / a subview to PNG **in-process**
  (`ImageRenderer` on SwiftUI, `bitmapImageRepForCachingDisplayInRect:` on AppKit) —
  **zero OS permissions**
- `POST /tap`, `POST /setText`, `POST /action`

Claude's MCP server just proxies to this endpoint. Deterministic, no permission prompts,
captures nothing but the app. Cost: one-time integration per framework.

### C. Framework-native — if the app isn't pure native

- **Electron** → Playwright drives it already (`_electron`), full DOM
- **Flutter** → `flutter_driver` + VM service protocol → widget tree
- **Tauri** → on macOS the webview is WKWebView, which Playwright/CDP can't attach to.
  Use the Architecture B route instead: `tauri-harness/` is a DEBUG-only Tauri v2 plugin
  that injects a webview agent and serves the same HTTP contract as `swift-harness/`.
- **Qt / GTK** → AT-SPI, or Squish

---

## Recommendation

### The branch that matters

**Electron / Flutter / React Native → build nothing.** Use the framework's own tooling
(above). **Tauri** → use `tauri-harness/` (a webview-DOM harness on the same contract),
since Playwright/CDP can't attach to macOS WKWebView.

**Native SwiftUI/AppKit** (this project) → build **Architecture B: an in-app dev harness**
exposed through a TypeScript MCP server.

### Why B, not the generic accessibility route (A)

| | B (in-app harness) | A (OS accessibility) |
|---|---|---|
| Permission prompts | **none** — app renders itself | Accessibility permission required |
| Data quality | your real view models + state | whatever AX exposes (often sparse) |
| Determinism | high (you control it) | flaky timing / hit-testing |
| Works on 3rd-party apps | no | yes |
| Integration cost | one-time, per app | zero |

The real complaint is the Screen Recording permission. B eliminates it entirely — the app
draws its own window to PNG in-process. No OS capture API involved.

The only trade-off: you can't inspect apps you don't control. If that's needed later, add
an AX adapter **behind the same MCP interface** — the tool surface doesn't change.

### Concrete build

**In the app (dev builds only, behind `#if DEBUG` or an env flag):**

A small Swift package that starts a localhost HTTP server and exposes:

| Endpoint | Does |
|---|---|
| `GET /windows` | list on-screen windows |
| `GET /tree?window=<id>` | view hierarchy → JSON (`.accessibilityIdentifier()` = stable ids) |
| `GET /snapshot?window=<id>&node=<id>` | render window or subview to PNG, in-process |
| `POST /tap {node}` | synthesize a tap on that view |
| `POST /setText {node,text}` | set a field's value |
| `POST /action {name}` | trigger a named nav/action hook you registered |

**The MCP server (TypeScript):**

A thin wrapper turning those endpoints into MCP tools: `list_windows`, `get_ui_tree`,
`screenshot`, `click`, `type`, `wait_for`. Register it in Claude Code's MCP config. Done —
Claude reviews the UI by calling tools, never by recording the screen.

**Windows later:** mirror the harness in WinUI/WPF with `RenderTargetBitmap` + UIA ids.
Same MCP server, second adapter.

### Smallest first step (~1 day)

Ship only `GET /tree` and `GET /snapshot` — read-only, no interaction. That alone lets
Claude see the current screen and its structure while you work. Add `tap` / `setText`
once it proves useful.

---

## Goals

**Primary:** let Claude inspect and drive a native macOS app's UI during development
**without Screen Recording permission**.

| # | Goal | Verify |
|---|---|---|
| G1 | Semantic view tree on demand — roles, labels, values, stable ids | `get_ui_tree` returns the sample app's tree in < 200 ms |
| G2 | In-process PNG snapshot of a window or subview, zero OS capture permission | `screenshot` returns a valid PNG with Screen Recording **off** |
| G3 | Basic interaction: tap, set text, named action hooks | `click '#save'` fires the button; `type '#email' '…'` updates the field |
| G4 | Exposed to Claude as MCP tools; drop-in integration | one line in `AppDelegate` + one entry in MCP config |
| G5 | Deterministic and test-covered; harness is **DEBUG-only**, never in release | `npm test` green; release build excludes the package |

**Non-goals (for now):** third-party app inspection (future AX adapter), Windows (phase 2),
visual-regression / pixel diffing, drag & multi-touch gestures.

**Definition of done for v0.1:**

1. `npm test` green.
2. From Claude Code against the sample app: `get_ui_tree` returns its tree, `screenshot`
   returns a PNG, `click '#save'` triggers the button — all with Screen Recording
   permission **not granted**.

---

## Don't reinvent — evaluate these first

- **Appium** + `appium-mac2-driver` + `appium-windows-driver` — "Selenium for desktop
  apps", WebDriver protocol, cross-platform. Heavy, but may cover ~80%.
- **[macapptree](https://github.com/MacPaw/macapptree)** — open-source macOS AX-tree →
  JSON dumper. Good reference / starting point.
- **FlaUI** (Windows), **atomacos** (macOS) — bindings to build on.
- **Accessibility Inspector** (Xcode) / **Accessibility Insights** (Windows) — use by hand
  first to see what tree your app exposes. Sparse tree → confirms Architecture B.

---

## Repo layout

```
macos-ui-mcp/
  IDEA.md
  package.json  tsconfig.json  vitest.config.ts
  src/
    contract.ts        shared types + zod schemas for the harness wire format
    harnessClient.ts    HTTP client to the Swift harness
    selector.ts         "#id" / Role "Label" / Role  ->  node lookup
    tools.ts            pure tool implementations (testable without the MCP SDK)
    server.ts           MCP server wiring tools -> harnessClient
    index.ts            stdio entrypoint
  test/
    mockHarness.ts      Node HTTP server implementing the harness contract
    e2e.test.ts         drives showcase/ through the real Swift harness
    *.test.ts
  swift-harness/        in-app harness for AppKit / SwiftUI apps
    Package.swift
    Sources/AppMCPHarness/*.swift
    README.md
  tauri-harness/        in-app harness for Tauri v2 apps (Rust plugin + injected agent.js)
    Cargo.toml  build.rs  permissions/
    src/*.rs
    guest-js/agent.js
    README.md
  showcase/             minimal AppKit app that links the harness (used by e2e.test.ts)
```

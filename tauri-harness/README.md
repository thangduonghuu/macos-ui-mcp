# tauri-plugin-macos-ui-mcp

DEBUG-only Tauri v2 plugin that exposes your app's **webview DOM** to the
`macos-ui-mcp` MCP server over `http://127.0.0.1:8787` — the **same HTTP contract**
as the Swift/AppKit harness, so the MCP server and its tools are unchanged.

No Screen Recording permission: the tree comes from the DOM and snapshots are
rasterized inside the webview.

```
Claude Code ──MCP(stdio)──> macos-ui-mcp server ──HTTP──> this plugin ──eval──> agent.js in your webview
```

## How it works

`agent.js` is injected at document start and defines `window.__MACOS_UI_MCP__`.
On each HTTP request the plugin `eval`s `window.__MACOS_UI_MCP__.dispatch(id, op, params)`
in the target webview; the agent does the work and calls the plugin's `deliver`
command back with the result. The HTTP handler blocks on that round-trip (5s timeout).

## Add it to your Tauri app

### 1. Cargo dependency

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-macos-ui-mcp = { path = "../../macos-ui-mcp/tauri-harness" }
# or: git = "https://github.com/<you>/macos-ui-mcp", package = "tauri-plugin-macos-ui-mcp"
```

### 2. Register the plugin — DEBUG builds only

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_macos_ui_mcp::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3. Grant the capability

The agent needs to call the plugin's `deliver` command, so add its permission set:

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "windows": ["*"],
  "permissions": [
    "core:default",
    "macos-ui-mcp:default"
  ]
}
```

If you keep a separate debug capability file, put `"macos-ui-mcp:default"` there instead.

### 4. Run

```sh
npm run tauri dev
# console: [macos-ui-mcp] harness listening on http://127.0.0.1:8787
```

Port: set `MACOS_UI_MCP_PORT`. In a release build the harness stays off unless
`MACOS_UI_MCP_FORCE=1`.

## Make elements addressable

Node ids are, in order: `data-testid` → `id` → a synthesized `dom-N` (unstable
across reloads). Give the things you'll target a stable handle:

```html
<button data-testid="save" @click="save">Save</button>
<input data-testid="email" v-model="email" />
```

Then Claude can use `#save`, `#email` as selectors (same grammar as the Swift harness:
`#id` · `Role "Label"` · `"Label"` · `Role`).

## Register actions

Expose app-level hooks for the `invoke_action` tool:

```js
window.__MACOS_UI_MCP_ACTIONS__ ||= {};
window.__MACOS_UI_MCP_ACTIONS__.resetStore = () => useStore.getState().reset();
window.__MACOS_UI_MCP_ACTIONS__.seedData   = () => loadFixtures();
```

## Point macos-ui-mcp at it

Nothing special — it's the same server. In your MCP config:

```jsonc
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

## HTTP contract

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /windows` | — | `{ windows: [{ id: <label>, title, key, frame }] }` |
| `GET /tree` | `?window=<label>` (optional) | `{ window, tree }` — recursive `{ id, role, label?, value?, enabled?, focused?, frame, children? }` |
| `GET /snapshot` | `?window=<label>&node=<id>` (both optional) | `image/png` |
| `POST /tap` | `{ "node": "<id>" }` | `{ ok, detail? }` |
| `POST /setText` | `{ "node": "<id>", "text": "…" }` | `{ ok, detail? }` — native setter + `input`/`change` events (React/Vue friendly) |
| `POST /action` | `{ "name": "<registered name>" }` | `{ ok, detail? }` |

DOM → node mapping: `role` from `role=""` attr or tag (`button`, `a[href]`→`link`,
`input`→`textfield`/`checkbox`/`radio`/`button`, `textarea`→`textfield`,
`select`→`combobox`, headings/`p`/`span`/`li`→`text`); `label` from `aria-label` /
`aria-labelledby` / associated `<label>` / trimmed leaf text; `value` from
`.value` / `.checked` / contenteditable text; `enabled` from `!el.disabled`.
`script`/`style`/`head` and `aria-hidden="true"` subtrees are skipped.

## Snapshot fidelity

The built-in snapshot serializes the node to an SVG `<foreignObject>` with inlined
computed styles and rasterizes it to PNG — **no dependencies, approximate output**
(web fonts, some backgrounds, cross-origin images may drop or taint the canvas).

For pixel-accurate captures, provide your own rasterizer:

```js
import { toPng } from "html-to-image"; // or modern-screenshot
window.__MACOS_UI_MCP_SNAPSHOT__ = (el) => toPng(el);
```

## Limits

- One request served at a time (sequential). Fine for a dev tool; parallelize later.
- `eval` round-trip needs `macos-ui-mcp:default` in your capabilities — a timeout with
  "is the capability enabled?" almost always means step 3 was missed.
- `agent.js` uses `window.__TAURI_INTERNALS__.invoke` (falls back to
  `window.__TAURI__.core.invoke`). Both are core Tauri v2; no `withGlobalTauri` needed.
- Multi-webview apps: ops target the focused webview unless `?window=<label>` is given.
- **Never ship it** — keep the `.plugin(...)` call under `#[cfg(debug_assertions)]`.

## Develop

```sh
cd tauri-harness
cargo check
cargo clippy
```

The crate builds in isolation; real use is linking it into a Tauri app.

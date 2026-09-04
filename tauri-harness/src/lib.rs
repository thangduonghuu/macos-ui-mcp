//! DEBUG-only Tauri v2 plugin: exposes this app's webview UI to the
//! `macos-ui-mcp` MCP server over localhost HTTP, using the **same wire
//! contract** as the Swift (AppKit) harness. No Screen Recording permission.
//!
//! ```ignore
//! // src-tauri/src/lib.rs
//! pub fn run() {
//!     let mut builder = tauri::Builder::default();
//!     #[cfg(debug_assertions)]
//!     {
//!         builder = builder.plugin(tauri_plugin_macos_ui_mcp::init());
//!     }
//!     builder.run(tauri::generate_context!()).unwrap();
//! }
//! ```
//!
//! Then add `"macos-ui-mcp:default"` to `src-tauri/capabilities/default.json`.

mod protocol;
mod server;

use protocol::{HarnessState, Reply};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Injected into every webview at document start. Defines `window.__MACOS_UI_MCP__`.
const AGENT_JS: &str = include_str!("../guest-js/agent.js");

/// Called by the injected agent (`plugin:macos-ui-mcp|deliver`) to hand a
/// round-trip result back to the blocked HTTP handler.
#[tauri::command]
fn deliver(
    state: tauri::State<'_, HarnessState>,
    id: u64,
    ok: bool,
    data: Option<serde_json::Value>,
    detail: Option<String>,
) {
    state.complete(id, Reply { ok, data, detail });
}

/// Build the plugin. Gate the `.plugin(...)` call behind `#[cfg(debug_assertions)]`
/// in your app; this also refuses to start in release unless
/// `MACOS_UI_MCP_FORCE=1`. Port: `MACOS_UI_MCP_PORT` (default `8787`).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("macos-ui-mcp")
        .invoke_handler(tauri::generate_handler![deliver])
        .js_init_script(AGENT_JS.to_string())
        .setup(|app, _api| {
            app.manage(HarnessState::default());
            if should_start() {
                server::spawn(app.clone());
            } else {
                eprintln!(
                    "[macos-ui-mcp] harness disabled (release build; set MACOS_UI_MCP_FORCE=1 to override)"
                );
            }
            Ok(())
        })
        .build()
}

fn should_start() -> bool {
    cfg!(debug_assertions) || std::env::var("MACOS_UI_MCP_FORCE").as_deref() == Ok("1")
}

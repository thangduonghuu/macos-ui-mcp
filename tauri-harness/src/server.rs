//! Localhost HTTP server implementing the macos-ui-mcp harness contract:
//!
//!   GET  /windows
//!   GET  /tree?window=<label>
//!   GET  /snapshot?window=<label>&node=<id>
//!   POST /tap      { "node": "<id>" }
//!   POST /setText  { "node": "<id>", "text": "..." }
//!   POST /action   { "name": "<registered name>" }
//!
//! Everything that needs the DOM is answered by `eval`-ing the injected agent
//! and waiting (via `HarnessState`) for it to call the `deliver` command back.

use crate::protocol::HarnessState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tiny_http::{Header, Method, Request, Response, Server};

const ROUNDTRIP_TIMEOUT: Duration = Duration::from_secs(5);

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let port: u16 = std::env::var("MACOS_UI_MCP_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8787);

    std::thread::Builder::new()
        .name("macos-ui-mcp".into())
        .spawn(move || match Server::http(("127.0.0.1", port)) {
            Ok(server) => {
                eprintln!("[macos-ui-mcp] harness listening on http://127.0.0.1:{port}");
                for request in server.incoming_requests() {
                    handle(&app, request);
                }
            }
            Err(e) => eprintln!("[macos-ui-mcp] failed to bind 127.0.0.1:{port}: {e}"),
        })
        .expect("spawn macos-ui-mcp harness thread");
}

type Body = (Vec<u8>, &'static str, u16);

fn handle<R: Runtime>(app: &AppHandle<R>, mut request: Request) {
    let method = request.method().clone();
    let raw = request.url().to_string();
    let (path, query) = match raw.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (raw, String::new()),
    };

    let mut raw_body = String::new();
    let _ = request.as_reader().read_to_string(&mut raw_body);

    let (bytes, content_type, status) = match route(app, &method, &path, &query, &raw_body) {
        Ok(triple) => triple,
        Err(err) => (
            json_bytes(&serde_json::json!({ "error": err })),
            "application/json",
            500,
        ),
    };

    let header = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap();
    let _ = request.respond(
        Response::from_data(bytes).with_status_code(status).with_header(header),
    );
}

fn route<R: Runtime>(
    app: &AppHandle<R>,
    method: &Method,
    path: &str,
    query: &str,
    raw_body: &str,
) -> Result<Body, String> {
    let param = |key: &str| -> Option<String> {
        query.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == key).then(|| percent_decode(v))
        })
    };
    let json_body: serde_json::Value =
        serde_json::from_str(raw_body).unwrap_or(serde_json::Value::Null);

    match (method, path) {
        (Method::Get, "/windows") => {
            Ok((json_bytes(&list_windows(app)), "application/json", 200))
        }
        (Method::Get, "/tree") => {
            let target = param("window");
            let tree = roundtrip(app, target.clone(), "tree", serde_json::json!({}))?;
            let window = window_json_for(app, target).ok_or("no matching window")?;
            Ok((
                json_bytes(&serde_json::json!({ "window": window, "tree": tree })),
                "application/json",
                200,
            ))
        }
        (Method::Get, "/snapshot") => {
            let params = serde_json::json!({ "node": param("node") });
            let data = roundtrip(app, param("window"), "snapshot", params)?;
            let data_url = data
                .get("dataUrl")
                .and_then(|v| v.as_str())
                .ok_or("agent returned no image")?;
            let b64 = data_url.split(',').nth(1).ok_or("malformed data URL")?;
            let png = STANDARD.decode(b64).map_err(|e| e.to_string())?;
            Ok((png, "image/png", 200))
        }
        (Method::Post, "/tap") => act(app, json_body, "tap"),
        (Method::Post, "/setText") => act(app, json_body, "setText"),
        (Method::Post, "/action") => act(app, json_body, "action"),
        _ => Ok((
            json_bytes(&serde_json::json!({ "error": "not found" })),
            "application/json",
            404,
        )),
    }
}

fn act<R: Runtime>(app: &AppHandle<R>, body: serde_json::Value, op: &str) -> Result<Body, String> {
    let reply = match roundtrip(app, None, op, body) {
        Ok(_) => serde_json::json!({ "ok": true }),
        Err(detail) => serde_json::json!({ "ok": false, "detail": detail }),
    };
    Ok((json_bytes(&reply), "application/json", 200))
}

fn roundtrip<R: Runtime>(
    app: &AppHandle<R>,
    target: Option<String>,
    op: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let state = app.state::<HarnessState>();
    let id = state.next_id();
    let rx = state.register(id);

    let webview = pick_webview(app, target).ok_or("no webview window")?;
    let script = format!(
        "window.__MACOS_UI_MCP__ && window.__MACOS_UI_MCP__.dispatch({id}, {op}, {params})",
        id = id,
        op = serde_json::to_string(op).unwrap(),
        params = serde_json::to_string(&params).unwrap(),
    );
    webview.eval(&script).map_err(|e| e.to_string())?;

    match rx.recv_timeout(ROUNDTRIP_TIMEOUT) {
        Ok(reply) if reply.ok => Ok(reply.data.unwrap_or(serde_json::Value::Null)),
        Ok(reply) => Err(reply.detail.unwrap_or_else(|| "agent reported failure".into())),
        Err(_) => Err("agent did not respond — is \"macos-ui-mcp:default\" in your capabilities?".into()),
    }
}

fn pick_webview<R: Runtime>(
    app: &AppHandle<R>,
    target: Option<String>,
) -> Option<WebviewWindow<R>> {
    let windows = app.webview_windows();
    if let Some(label) = target.filter(|s| !s.is_empty()) {
        return windows.into_iter().find(|(l, _)| *l == label).map(|(_, w)| w);
    }
    let mut list: Vec<(String, WebviewWindow<R>)> = windows.into_iter().collect();
    if let Some(idx) = list.iter().position(|(_, w)| w.is_focused().unwrap_or(false)) {
        Some(list.swap_remove(idx).1)
    } else if !list.is_empty() {
        Some(list.swap_remove(0).1)
    } else {
        None
    }
}

fn list_windows<R: Runtime>(app: &AppHandle<R>) -> serde_json::Value {
    let windows: Vec<serde_json::Value> = app
        .webview_windows()
        .into_iter()
        .map(|(label, w)| window_json(&label, &w))
        .collect();
    serde_json::json!({ "windows": windows })
}

fn window_json_for<R: Runtime>(
    app: &AppHandle<R>,
    target: Option<String>,
) -> Option<serde_json::Value> {
    let w = pick_webview(app, target)?;
    Some(window_json(w.label(), &w))
}

fn window_json<R: Runtime>(label: &str, w: &WebviewWindow<R>) -> serde_json::Value {
    let pos = w.outer_position().ok();
    let size = w.outer_size().ok();
    serde_json::json!({
        "id": label,
        "title": w.title().unwrap_or_default(),
        "key": w.is_focused().unwrap_or(false),
        "frame": {
            "x": pos.map(|p| p.x).unwrap_or(0),
            "y": pos.map(|p| p.y).unwrap_or(0),
            "width": size.map(|s| s.width).unwrap_or(0),
            "height": size.map(|s| s.height).unwrap_or(0),
        }
    })
}

fn json_bytes(value: &serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec())
}

/// Minimal `application/x-www-form-urlencoded` decode for query values.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match u8::from_str_radix(&input[i + 1..i + 3], 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                }
                Err(_) => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

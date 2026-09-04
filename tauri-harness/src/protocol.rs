use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Mutex;

/// A single JS -> Rust reply for one `dispatch` round-trip.
pub struct Reply {
    pub ok: bool,
    pub data: Option<serde_json::Value>,
    pub detail: Option<String>,
}

/// Managed plugin state: correlates each `eval` round-trip with the HTTP
/// request thread that is blocked waiting for the webview to answer.
#[derive(Default)]
pub struct HarnessState {
    next: AtomicU64,
    pending: Mutex<HashMap<u64, SyncSender<Reply>>>,
}

impl HarnessState {
    pub fn next_id(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed)
    }

    /// Register interest in reply `id`; the returned receiver is waited on by
    /// the HTTP handler thread.
    pub fn register(&self, id: u64) -> Receiver<Reply> {
        let (tx, rx) = sync_channel(1);
        self.pending.lock().unwrap().insert(id, tx);
        rx
    }

    /// Called from the `deliver` command (Tauri thread) when JS reports back.
    pub fn complete(&self, id: u64, reply: Reply) {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(reply);
        }
    }
}

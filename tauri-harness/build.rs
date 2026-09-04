const COMMANDS: &[&str] = &["deliver"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}

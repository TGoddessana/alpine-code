//! The desktop shell: windows, tray, notifications, native dialogs and the server process.
//! Screens and the protocol live in the frontend (`../src`); this crate does not read protocol messages.

mod server;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let server = server::Server::start(app.handle())?;
            app.manage(server);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![server::server_send])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<server::Server>().stop();
            }
        });
}

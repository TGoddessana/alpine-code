//! Updates for a released app. A new version is found and downloaded quietly at launch and installed when the app
//! quits, after the server has stopped, so a running server never has its files replaced under it. The next launch
//! is the new version.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
struct Ready(Mutex<Option<(Update, Vec<u8>)>>);

pub fn download_in_background(app: &AppHandle) {
    app.manage(Ready::default());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match download(&app).await {
            Ok(Some(ready)) => {
                if let Ok(mut slot) = app.state::<Ready>().0.lock() {
                    *slot = Some(ready);
                }
            }
            Ok(None) => {}
            Err(e) => log::warn!(target: "update", "{e}"),
        }
    });
}

async fn download(app: &AppHandle) -> tauri_plugin_updater::Result<Option<(Update, Vec<u8>)>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    Ok(Some((update, bytes)))
}

/// Call once the server has stopped.
pub fn install_if_ready(app: &AppHandle) {
    let ready = app.try_state::<Ready>().and_then(|ready| ready.0.lock().ok()?.take());
    if let Some((update, bytes)) = ready
        && let Err(e) = update.install(bytes)
    {
        log::warn!(target: "update", "{e}");
    }
}

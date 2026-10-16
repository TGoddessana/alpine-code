//! Updates for a released app. A new version is found and downloaded quietly at launch and installed when the app
//! quits, after the server has stopped, so a running server never has its files replaced under it. The next launch
//! is the new version. Once one is downloaded the frontend is told (`update-ready`, with the version) and offers to
//! restart into it now; the menu can also check by hand.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::server::Server;

#[derive(Default)]
pub struct Updates {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// Held while checking and downloading, so a check by hand waits for the one at launch instead of downloading twice.
    fetching: tauri::async_runtime::Mutex<()>,
}

impl Updates {
    fn ready_version(&self) -> Option<String> {
        self.ready.lock().ok()?.as_ref().map(|(update, _)| update.version.clone())
    }
}

pub fn download_in_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = fetch(&app).await {
            log::warn!(target: "update", "{e}");
        }
    });
}

/// The version downloaded and waiting, if any; `None` when there is no newer one.
async fn fetch(app: &AppHandle) -> tauri_plugin_updater::Result<Option<String>> {
    let updates = app.state::<Updates>();
    let _turn = updates.fetching.lock().await;
    if let Some(version) = updates.ready_version() {
        return Ok(Some(version));
    }
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    if let Ok(mut slot) = updates.ready.lock() {
        *slot = Some((update, bytes));
    }
    let _ = app.emit("update-ready", &version);
    Ok(Some(version))
}

/// The version downloaded and waiting to be installed, for a window that opened after `update-ready` was sent.
#[tauri::command]
pub fn update_ready(app: AppHandle) -> Option<String> {
    app.state::<Updates>().ready_version()
}

/// Checks now (the menu's "Check for updates"): the version downloaded and waiting, or `None` when this is the newest.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<String>, String> {
    if cfg!(debug_assertions) {
        // Development runs a bare binary, not an installed app, so there is nothing to replace.
        return Err("development build".into());
    }
    fetch(&app).await.map_err(|e| e.to_string())
}

/// Installs the waiting version and starts it.
#[tauri::command]
pub fn update_restart(app: AppHandle) {
    app.state::<Server>().stop();
    install_if_ready(&app);
    app.restart();
}

/// Call once the server has stopped.
pub fn install_if_ready(app: &AppHandle) {
    let ready = app.try_state::<Updates>().and_then(|updates| updates.ready.lock().ok()?.take());
    if let Some((update, bytes)) = ready
        && let Err(e) = update.install(bytes)
    {
        log::warn!(target: "update", "{e}");
    }
}

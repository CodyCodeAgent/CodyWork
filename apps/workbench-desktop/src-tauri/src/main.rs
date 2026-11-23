#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod connections;
mod updates;

use connections::{check, client, http_url, server_url, ConnectionCheck, Connections, Server};
use reqwest::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    webview::NewWindowResponse,
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

const SETTINGS: &str = "settings";
const WORKBENCH: &str = "workbench";

struct Desktop {
    path: PathBuf,
    client: Client,
    connections: Mutex<Connections>,
    startup_error: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    connections: Connections,
    startup_error: Option<String>,
}

#[tauri::command]
fn desktop_settings(state: State<'_, Desktop>) -> SettingsView {
    SettingsView {
        connections: state.connections.lock().unwrap().clone(),
        startup_error: state.startup_error.lock().unwrap().take(),
    }
}

#[tauri::command]
async fn check_server(
    state: State<'_, Desktop>,
    address: String,
) -> Result<ConnectionCheck, String> {
    check(&state.client, &server_url(&address)?).await
}

#[tauri::command]
fn save_server(
    state: State<'_, Desktop>,
    previous: Option<String>,
    name: String,
    address: String,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err("连接名称需要 1 到 64 个字符。".into());
    }
    let address = server_url(&address)?.to_string();
    let mut saved = state.connections.lock().unwrap();
    let mut updated = saved.clone();
    updated.save(
        previous.as_deref(),
        Server {
            name: name.into(),
            address: address.clone(),
        },
    )?;
    updated.write(&state.path)?;
    *saved = updated;
    Ok(address)
}

#[tauri::command]
fn remove_server(state: State<'_, Desktop>, address: String) -> Result<(), String> {
    let mut saved = state.connections.lock().unwrap();
    saved.server(&address)?;
    let mut updated = saved.clone();
    updated.servers.retain(|server| server.address != address);
    if updated.default_address.as_ref() == Some(&address) {
        updated.default_address = None;
    }
    updated.write(&state.path)?;
    *saved = updated;
    Ok(())
}

#[tauri::command]
fn set_default_server(state: State<'_, Desktop>, address: String) -> Result<(), String> {
    let mut saved = state.connections.lock().unwrap();
    saved.server(&address)?;
    let mut updated = saved.clone();
    updated.default_address = Some(address);
    updated.write(&state.path)?;
    *saved = updated;
    Ok(())
}

#[tauri::command]
async fn connect_server(app: AppHandle, address: String) -> Result<(), String> {
    let state = app.state::<Desktop>();
    let server = state.connections.lock().unwrap().server(&address)?.clone();
    let url = server_url(&server.address)?;
    check(&state.client, &url).await?;
    // Create windows on the main thread. The async command can wait for it
    // while WebKit handles requests on its own run loop.
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let state = handle.state::<Desktop>();
        let result = (|| {
            let mut saved = state.connections.lock().unwrap();
            let server = saved.server(&address)?;
            show_workbench(&handle, server, url)?;
            if saved.default_address.is_none() {
                let mut updated = saved.clone();
                updated.default_address = Some(address);
                updated.write(&state.path)?;
                *saved = updated;
            }
            if let Some(settings) = handle.get_webview_window(SETTINGS) {
                let _ = settings.hide();
            }
            Ok(())
        })();
        let _ = sender.send(result);
    })
    .map_err(|_| "无法打开工作台。")?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "无法打开工作台。".to_string())?
    })
    .await
    .map_err(|_| "无法打开工作台。")?
}

fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS) {
        window.show()?;
        return window.set_focus();
    }
    WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("index.html".into()))
        .title("CodyWork · 服务器连接")
        .inner_size(670.0, 670.0)
        .min_inner_size(410.0, 440.0)
        .center()
        .on_navigation(|url| url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?
        .set_focus()
}

fn open_in_browser(url: &Url) {
    if let Ok(url) = http_url(url.as_str()) {
        let _ = std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .spawn();
    }
}

fn show_workbench(app: &AppHandle, server: &Server, url: Url) -> Result<(), String> {
    let origin = url.origin();
    // Cookies don't distinguish ports. Give even two services on the same
    // hostname separate persistent WebKit stores.
    let digest = Sha256::digest(origin.ascii_serialization());
    let mut store_id = [0; 16];
    store_id.copy_from_slice(&digest[..16]);
    // Use a fresh view when changing origins so its navigation guard stays
    // pinned to that server. Same-origin reconnect leaves open work intact.
    let mounted = app
        .webview_windows()
        .into_values()
        .find(|window| window.label().starts_with(WORKBENCH));
    if let Some(window) = &mounted {
        if window.url().is_ok_and(|current| current.origin() == origin) {
            window
                .set_title(&format!("CodyWork · {}", server.name))
                .map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            return window.set_focus().map_err(|error| error.to_string());
        }
    }
    let label = if mounted
        .as_ref()
        .is_some_and(|window| window.label() == "workbench-a")
    {
        "workbench-b"
    } else {
        "workbench-a"
    };
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .data_store_identifier(store_id)
        .title(format!("CodyWork · {}", server.name))
        .inner_size(1320.0, 850.0)
        .min_inner_size(460.0, 420.0)
        .center()
        .on_navigation(move |target| target.origin() == origin)
        .on_new_window(|target, _| {
            open_in_browser(&target);
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| error.to_string())?;
    if let Some(window) = mounted {
        let _ = window.destroy();
    }
    Ok(())
}

fn menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(app, SETTINGS, "服务器连接…", true, Some("CmdOrCtrl+,"))?;
    let check_updates = MenuItem::with_id(app, updates::WINDOW, "检查更新…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "刷新工作台", true, Some("CmdOrCtrl+R"))?;
    let app_menu = SubmenuBuilder::new(app, "CodyWork")
        .item(&settings)
        .item(&check_updates)
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "窗口")
        .item(&reload)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &edit, &window])
        .build()
}

fn restore(app: AppHandle, server: Server) {
    tauri::async_runtime::spawn(async move {
        let result = async {
            let url = server_url(&server.address)?;
            check(&app.state::<Desktop>().client, &url).await?;
            Ok::<_, String>(url)
        }
        .await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = result.and_then(|url| show_workbench(&handle, &server, url)) {
                *handle.state::<Desktop>().startup_error.lock().unwrap() =
                    Some(format!("无法恢复「{}」的连接。{error}", server.name));
                let _ = show_settings(&handle);
            }
            updates::check(handle, true);
        });
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SETTINGS => {
                let _ = show_settings(app);
            }
            updates::WINDOW => {
                if updates::show(app).is_ok() {
                    updates::check(app.clone(), false);
                }
            }
            "reload" => {
                if let Some(window) = app
                    .webview_windows()
                    .into_values()
                    .find(|window| window.label().starts_with(WORKBENCH))
                {
                    let _ = window.reload();
                }
            }
            _ => {}
        })
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("connections.json");
            let (connections, startup_error) = match Connections::read(&path) {
                Ok(connections) => (connections, None),
                Err(error) => (Connections::default(), Some(error)),
            };
            let default = connections
                .default_address
                .as_deref()
                .and_then(|address| connections.server(address).ok())
                .cloned();
            app.manage(Desktop {
                path,
                client: client()?,
                connections: Mutex::new(connections),
                startup_error: Mutex::new(startup_error),
            });
            app.manage(updates::DesktopUpdates::new(app.handle()));
            if let Some(server) = default {
                restore(app.handle().clone(), server);
            } else {
                show_settings(app.handle())?;
                updates::check(app.handle().clone(), true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_settings,
            check_server,
            save_server,
            connect_server,
            remove_server,
            set_default_server,
            updates::open_update_settings,
            updates::desktop_update_status,
            updates::desktop_check_updates,
            updates::desktop_install_update
        ])
        .build(tauri::generate_context!())
        .expect("failed to initialize CodyWork Desktop")
        .run(|app, event| {
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                if let Some(window) = app
                    .webview_windows()
                    .into_values()
                    .find(|window| window.label().starts_with(WORKBENCH))
                {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else {
                    let _ = show_settings(app);
                }
            }
        });
}

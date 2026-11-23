use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    webview::NewWindowResponse, AppHandle, Emitter, EventTarget, Manager, State, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const WINDOW: &str = "updates";
const STATUS_EVENT: &str = "desktop-update-changed";

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum Phase {
    Disabled,
    Idle,
    Checking,
    Current,
    Available {
        version: String,
        notes: String,
    },
    Downloading {
        version: String,
        received: u64,
        total: Option<u64>,
    },
    Installing {
        version: String,
    },
    Error {
        message: &'static str,
    },
}

impl Phase {
    fn can_check(&self) -> bool {
        matches!(
            self,
            Self::Idle | Self::Current | Self::Available { .. } | Self::Error { .. }
        )
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    #[serde(flatten)]
    phase: Phase,
}

struct UpdateState {
    status: UpdateStatus,
    available: Option<Update>,
}

pub struct DesktopUpdates(Mutex<UpdateState>);

impl DesktopUpdates {
    pub fn new(app: &AppHandle) -> Self {
        let signed_updates_configured = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|value| value.get("pubkey"))
            .and_then(|value| value.as_str())
            .is_some_and(|value| !value.trim().is_empty());
        Self(Mutex::new(UpdateState {
            status: UpdateStatus {
                current_version: app.package_info().version.to_string(),
                phase: if signed_updates_configured {
                    Phase::Idle
                } else {
                    Phase::Disabled
                },
            },
            available: None,
        }))
    }
}

#[tauri::command]
pub fn desktop_update_status(state: State<'_, DesktopUpdates>) -> UpdateStatus {
    state.0.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn open_update_settings(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = show(&handle) {
            eprintln!("CodyWork updater window: {error}");
        }
    })
    .map_err(|_| "无法打开更新窗口。".into())
}

#[tauri::command]
pub fn desktop_check_updates(app: AppHandle) {
    check(app, false);
}

pub fn check(app: AppHandle, show_if_available: bool) {
    let status = {
        let state = app.state::<DesktopUpdates>();
        let mut state = state.0.lock().unwrap();
        if !state.status.phase.can_check() {
            return;
        }
        state.status.phase = Phase::Checking;
        state.available = None;
        state.status.clone()
    };
    publish(&app, status);
    tauri::async_runtime::spawn(async move {
        let result = async {
            app.updater_builder()
                .timeout(Duration::from_secs(12))
                .build()?
                .check()
                .await
        }
        .await;
        match result {
            Ok(Some(update)) => {
                let phase = Phase::Available {
                    version: update.version.clone(),
                    notes: update
                        .body
                        .as_deref()
                        .unwrap_or("")
                        .chars()
                        .take(12_000)
                        .collect(),
                };
                change(&app, phase, Some(update));
                if show_if_available {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if matches!(
                            desktop_update_status(handle.state()).phase,
                            Phase::Available { .. }
                        ) && handle.get_webview_window(WINDOW).is_none()
                        {
                            let _ = show(&handle);
                        }
                    });
                }
            }
            Ok(None) => change(&app, Phase::Current, None),
            Err(error) => {
                eprintln!("CodyWork update check: {error}");
                change(
                    &app,
                    Phase::Error {
                        message: "无法检查更新。请确认 GitHub 可访问后重试。",
                    },
                    None,
                );
            }
        }
    });
}

#[tauri::command]
pub async fn desktop_install_update(app: AppHandle, version: String) -> Result<(), String> {
    let (mut update, status) = {
        let state = app.state::<DesktopUpdates>();
        let mut state = state.0.lock().unwrap();
        if !matches!(&state.status.phase, Phase::Available { version: offered, .. } if *offered == version)
        {
            return Err("可用版本已变化，请重新检查更新。".into());
        }
        let update = state.available.take().ok_or("找不到可安装的更新。")?;
        state.status.phase = Phase::Downloading {
            version: version.clone(),
            received: 0,
            total: None,
        };
        (update, state.status.clone())
    };
    publish(&app, status);
    update.timeout = Some(Duration::from_secs(180));
    let mut received = 0;
    let mut last_report = None::<Instant>;
    let bytes = update
        .download(
            |size, total| {
                received += size as u64;
                if last_report.is_none_or(|last| last.elapsed() >= Duration::from_millis(120)) {
                    last_report = Some(Instant::now());
                    change(
                        &app,
                        Phase::Downloading {
                            version: version.clone(),
                            received,
                            total,
                        },
                        None,
                    );
                }
            },
            || {},
        )
        .await;
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("CodyWork update download: {error}");
            change(
                &app,
                Phase::Error {
                    message: "更新下载或签名校验失败，请重新检查后重试。",
                },
                None,
            );
            return Ok(());
        }
    };

    change(&app, Phase::Installing { version }, None);
    match tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await {
        Ok(Ok(())) => app.request_restart(),
        result => {
            eprintln!("CodyWork update install: {result:?}");
            change(
                &app,
                Phase::Error {
                    message: "无法安装更新。请确认应用所在目录可写后重试。",
                },
                None,
            );
        }
    }
    Ok(())
}

fn change(app: &AppHandle, phase: Phase, available: Option<Update>) {
    let status = {
        let state = app.state::<DesktopUpdates>();
        let mut state = state.0.lock().unwrap();
        state.status.phase = phase;
        state.available = available;
        state.status.clone()
    };
    publish(app, status);
}

fn publish(app: &AppHandle, status: UpdateStatus) {
    let _ = app.emit_to(EventTarget::webview_window(WINDOW), STATUS_EVENT, status);
}

pub fn show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.show()?;
        return window.set_focus();
    }
    WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("updates.html".into()))
        .title("CodyWork · 关于与更新")
        .inner_size(540.0, 500.0)
        .min_inner_size(360.0, 340.0)
        .center()
        .on_navigation(|url| url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?
        .set_focus()
}

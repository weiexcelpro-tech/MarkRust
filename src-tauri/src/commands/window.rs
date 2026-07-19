//! 窗口管理命令（6 个），对应原 Electron 版本的 editor/preferences 窗口创建逻辑。
//!
//! 窗口加载统一的 `index.html`，通过 label 区分。设置窗口为单例（label 固定 "settings"）。

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

/// 新建编辑器窗口，返回窗口 label。
///
/// label 格式 `editor-{8 字符}`，前端拿到后用于后续窗口操作（set_title / close 等）。
#[tauri::command]
pub fn window_new_editor(app: tauri::AppHandle) -> AppResult<String> {
    let id = uuid::Uuid::new_v4();
    let label = format!("editor-{}", &id.to_string()[..8]);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("MarkText")
        .inner_size(1200.0, 800.0)
        .min_inner_size(600.0, 400.0)
        .build()
        .map_err(|e| AppError::Other(format!("create editor window: {e}")))?;

    Ok(label)
}

/// 打开设置窗口（单例）。已存在则聚焦，否则创建。
#[tauri::command]
pub fn window_open_settings(app: tauri::AppHandle) -> AppResult<()> {
    const SETTINGS_LABEL: &str = "settings";

    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.show()
            .and_then(|()| win.set_focus())
            .map_err(|e| AppError::Other(format!("focus settings window: {e}")))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title("Settings")
        .inner_size(800.0, 600.0)
        .min_inner_size(600.0, 400.0)
        .resizable(true)
        .visible(true)
        .build()
        .map_err(|e| AppError::Other(format!("create settings window: {e}")))?;
    Ok(())
}

/// 关闭指定 label 的窗口。
#[tauri::command]
pub fn window_close(label: String, app: tauri::AppHandle) -> AppResult<()> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::PathNotFound(format!("window not found: {label}")))?;
    win.close()
        .map_err(|e| AppError::Other(format!("close window {label}: {e}")))?;
    Ok(())
}

/// 查询窗口是否最大化。
#[tauri::command]
pub fn window_is_maximized(label: String, app: tauri::AppHandle) -> AppResult<bool> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::PathNotFound(format!("window not found: {label}")))?;
    Ok(win
        .is_maximized()
        .map_err(|e| AppError::Other(format!("query maximized: {e}")))?)
}

/// 切换窗口置顶状态。
#[tauri::command]
pub fn window_toggle_always_on_top(label: String, app: tauri::AppHandle) -> AppResult<()> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::PathNotFound(format!("window not found: {label}")))?;
    let current = win
        .is_always_on_top()
        .map_err(|e| AppError::Other(format!("query always-on-top: {e}")))?;
    win.set_always_on_top(!current)
        .map_err(|e| AppError::Other(format!("set always-on-top: {e}")))?;
    Ok(())
}

/// 设置窗口标题。
#[tauri::command]
pub fn window_set_title(label: String, title: String, app: tauri::AppHandle) -> AppResult<()> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::PathNotFound(format!("window not found: {label}")))?;
    win.set_title(&title)
        .map_err(|e| AppError::Other(format!("set title: {e}")))?;
    Ok(())
}

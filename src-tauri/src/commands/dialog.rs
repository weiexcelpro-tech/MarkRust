//! 文件对话框与消息框命令（5 个），基于 `tauri-plugin-dialog`。
//!
//! 对应原 Electron 版本的 `dialog.showOpenDialog` / `showSaveDialog` / `showMessageBox`。

use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};

use crate::error::AppResult;

/// 单个选中文件路径（字符串形式），便于前端直接使用。
type PathResult = Option<String>;

/// 多个选中文件路径。
type PathsResult = Vec<String>;

/// 文件选择器的扩展名过滤器（Markdown 优先 + 所有文件兜底）。
const MD_FILTER_NAME: &str = "Markdown";
const MD_EXTS: &[&str] = &["md", "markdown"];

/// 将 tauri-plugin-dialog 的 FilePath 转成字符串。
fn fp_to_string(fp: FilePath) -> Option<String> {
    match fp {
        FilePath::Url(url) => url.to_file_path().ok().map(|p| p.to_string_lossy().into_owned()),
        FilePath::Path(p) => Some(p.to_string_lossy().into_owned()),
    }
}

/// 打开单个文件选择器，返回选中路径或 None。
#[tauri::command]
pub fn dialog_open_file(app: tauri::AppHandle) -> AppResult<PathResult> {
    let picked = app
        .dialog()
        .file()
        .add_filter(MD_FILTER_NAME, MD_EXTS)
        .add_filter("All Files", &["*"])
        .blocking_pick_file();
    Ok(picked.and_then(fp_to_string))
}

/// 多选打开文件，返回路径列表（空表示取消）。
#[tauri::command]
pub fn dialog_open_files(app: tauri::AppHandle) -> AppResult<PathsResult> {
    let picked = app
        .dialog()
        .file()
        .add_filter(MD_FILTER_NAME, MD_EXTS)
        .add_filter("All Files", &["*"])
        .blocking_pick_files();
    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(fp_to_string)
        .collect())
}

/// 保存对话框，可指定默认文件名和扩展名过滤器，返回选中路径或 None。
///
/// `default_name` 为默认文件名（含扩展名），`exts` 为自定义过滤器的扩展名列表。
/// 当 `exts` 为 `Some` 时，使用自定义过滤器替代默认 Markdown 过滤器；
/// 为 `None` 时保持原有行为（Markdown + All Files）。
#[tauri::command]
pub fn dialog_save_file(
    app: tauri::AppHandle,
    default_name: Option<String>,
    exts: Option<Vec<String>>,
) -> AppResult<PathResult> {
    let mut builder = app.dialog().file();
    match exts.as_deref() {
        Some(list) if !list.is_empty() => {
            // 使用自定义扩展名过滤器（名称取第一个扩展名大写形式）+ All Files 兜底
            let name = list[0].to_uppercase();
            let exts_ref: Vec<&str> = list.iter().map(|s| s.as_str()).collect();
            builder = builder
                .add_filter(name.as_str(), &exts_ref)
                .add_filter("All Files", &["*"]);
        }
        _ => {
            builder = builder
                .add_filter(MD_FILTER_NAME, MD_EXTS)
                .add_filter("All Files", &["*"]);
        }
    }
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    Ok(builder.blocking_save_file().and_then(fp_to_string))
}

/// 选择目录，返回路径或 None。
#[tauri::command]
pub fn dialog_open_directory(app: tauri::AppHandle) -> AppResult<PathResult> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(fp_to_string))
}

/// 显示模态消息框。
/// `kind` 控制图标：`"info"` | `"warning"` | `"error"` | `"question"`，缺省为 info。
/// question 使用 Yes/No 按钮，其余使用 Ok 按钮（确认返回 true）。
#[tauri::command]
pub fn dialog_show_message(
    app: tauri::AppHandle,
    title: String,
    message: String,
    kind: Option<String>,
) -> AppResult<bool> {
    let dialog_kind = match kind.as_deref() {
        Some("warning") => MessageDialogKind::Warning,
        Some("error") => MessageDialogKind::Error,
        Some("question") => MessageDialogKind::Info,
        _ => MessageDialogKind::Info,
    };
    let buttons = match kind.as_deref() {
        Some("question") => MessageDialogButtons::YesNo,
        _ => MessageDialogButtons::Ok,
    };

    let confirmed = app
        .dialog()
        .message(message)
        .title(title)
        .kind(dialog_kind)
        .buttons(buttons)
        .blocking_show();
    Ok(confirmed)
}

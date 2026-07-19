//! 剪贴板命令（3 个），基于 `tauri-plugin-clipboard-manager`。
//!
//! 对应原 Electron 版本的 `mt::clipboard::read-text` / `write-text` / `guess-file-path`。
//! `guess-file-path` 在 Electron 中读取 Windows `FileNameW` 剪贴板格式，
//! Tauri 的 clipboard 插件只暴露纯文本接口，因此改为「读取文本 → 判断是否像
//! 已存在的文件路径」的启发式实现，覆盖粘贴板里恰好是一段文件路径字符串的场景。

use std::path::Path;

use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult};

/// 读取剪贴板纯文本。失败时返回空串（与 Electron 行为一致）。
#[tauri::command]
pub fn clipboard_read_text(app: tauri::AppHandle) -> AppResult<String> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| AppError::Other(format!("clipboard read_text: {e}")))?;
    Ok(text)
}

/// 写入剪贴板纯文本。
#[tauri::command]
pub fn clipboard_write_text(app: tauri::AppHandle, text: String) -> AppResult<()> {
    app.clipboard()
        .write_text(&text)
        .map_err(|e| AppError::Other(format!("clipboard write_text: {e}")))?;
    Ok(())
}

/// 猜测剪贴板内容是否是一个文件路径。
///
/// 启发式：读取剪贴板文本，trim 后若以 `/`、`\` 开头，或匹配 Windows 盘符前缀
/// （如 `C:\`），并且 `Path::exists()` 为真，则返回该路径；否则返回 None。
/// 这覆盖了用户从文件管理器复制路径、或终端粘贴路径等常见场景。
#[tauri::command]
pub fn clipboard_guess_file_path(app: tauri::AppHandle) -> AppResult<Option<String>> {
    let raw = match app.clipboard().read_text() {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if looks_like_path(trimmed) && Path::new(trimmed).exists() {
        Ok(Some(trimmed.to_string()))
    } else {
        Ok(None)
    }
}

/// 判断字符串是否「像」一个绝对路径：UNIX 风格 `/...`、Windows 风格 `\...`
/// 或盘符前缀 `X:\`。
fn looks_like_path(s: &str) -> bool {
    if s.starts_with('/') || s.starts_with('\\') {
        return true;
    }
    // Windows 盘符：单个字母 +冒号 +反斜杠/正斜杠
    let bytes = s.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

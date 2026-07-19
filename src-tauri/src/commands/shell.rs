//! Shell 命令（4 个），对应原 Electron 版本的 `mt::shell::*` 通道。
//!
//! - `open-external`：用系统默认浏览器打开 URL（tauri-plugin-shell）。
//! - `open-path`：用系统文件管理器打开目录（Windows: `explorer`）。
//! - `show-item`：在文件管理器中选中单个文件（Windows: `explorer /select,`）。
//! - `format-link-click`：处理编辑器中的链接点击（HTTP→浏览器，.md→新标签页，其他→系统应用）。

use std::process::Command;

use serde::Deserialize;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;

use crate::commands::fs::fs_read_markdown;
use crate::error::{AppError, AppResult};

/// 用系统默认浏览器打开 URL。
#[tauri::command]
pub fn shell_open_external(app: tauri::AppHandle, url: String) -> AppResult<()> {
    app.shell()
        .open(url, None)
        .map_err(|e| AppError::Other(format!("shell open external: {e}")))
}

/// 用系统文件管理器打开指定路径（目录会进入，文件会由系统决定打开方式）。
///
/// Windows 调用 `explorer <path>`；其他平台用 `xdg-open` / `open`。
#[tauri::command]
pub fn shell_open_path(_app: tauri::AppHandle, path: String) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Other(format!("explorer open path: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Other(format!("open path: {e}")))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Other(format!("xdg-open path: {e}")))?;
    }
    Ok(())
}

/// 在文件管理器中定位并选中指定文件（父目录打开，目标文件高亮）。
///
/// Windows 调用 `explorer /select,<path>`；其他平台退化为打开父目录。
#[tauri::command]
pub fn shell_show_item(_app: tauri::AppHandle, path: String) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        // explorer 的 /select 参数与路径之间用逗号连接，路径不加引号会被
        // 空格截断，因此用单独的 arg 传 "逗号+路径" 让 explorer 自行解析。
        let select_arg = format!("/select,{path}");
        Command::new("explorer")
            .arg(&select_arg)
            .spawn()
            .map_err(|e| AppError::Other(format!("explorer /select: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| AppError::Other(format!("open -R: {e}")))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux 无统一「定位文件」协议，退化为打开所在目录
        if let Some(parent) = std::path::Path::new(&path).parent() {
            Command::new("xdg-open")
                .arg(parent)
            .spawn()
            .map_err(|e| AppError::Other(format!("xdg-open parent: {e}")))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Link click handler (P2-22)
// ---------------------------------------------------------------------------

/// `format_link_click` 的请求参数
#[derive(Deserialize)]
pub struct LinkClickData {
    href: Option<String>,
    text: Option<String>,
}

#[derive(Deserialize)]
pub struct FormatLinkClickArgs {
    data: LinkClickData,
    dirname: String,
}

/// Markdown 扩展名列表，与原版 marktext-develop 及前端 tauri-bridge.ts 对齐
const MARKDOWN_EXTENSIONS: &[&str] = &[
    "markdown", "mdown", "mkdn", "md", "mkd", "mdwn", "mdtxt", "mdtext", "mdx", "mmd",
    "text", "txt",
];

/// HTTP/HTTPS URL 检测
fn is_http_url(s: &str) -> bool {
    let lower = s.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// 其他 URI scheme 检测（如 ftp:// 等）
fn is_other_uri_scheme(s: &str) -> bool {
    if let Some(colon_pos) = s.find(':') {
        let scheme = &s[..colon_pos];
        if scheme.chars().all(|c| c.is_ascii_alphanumeric()) {
            return s.get(colon_pos..).map(|r| r.starts_with("://")).unwrap_or(false);
        }
    }
    false
}

/// 处理编辑器中的链接点击：
/// - HTTP/HTTPS URL → 系统浏览器
/// - .md 文件 → 在编辑器中打开为新标签页
/// - 其他文件 → 系统默认应用
/// - 含空格的非尖括号URL → 发送错误通知
///
/// 对应原版 `file.ts` 中的 `mt::format-link-click` handler。
#[tauri::command]
pub fn format_link_click(app: tauri::AppHandle, args: FormatLinkClickArgs) -> AppResult<()> {
    let raw_url = match (&args.data.href, &args.data.text) {
        (Some(h), _) if !h.is_empty() => h.clone(),
        (_, Some(t)) if !t.is_empty() => t.clone(),
        _ => return Ok(()),
    };

    // Strip CommonMark angle brackets: <url> → url
    let mut was_bracketed = false;
    let url_candidate = if raw_url.starts_with('<') && raw_url.ends_with('>') {
        was_bracketed = true;
        raw_url[1..raw_url.len() - 1].to_string()
    } else {
        raw_url
    };

    // Links with spaces (not wrapped in <>) are invalid per CommonMark #488
    if !was_bracketed && url_candidate.contains(' ') {
        let _ = app.emit(
            "mt::show-notification",
            serde_json::json!({
                "title": "Invalid Link",
                "body": "Links cannot contain spaces. Wrap the URL in angle brackets (<>) to include spaces. See CommonMark #488."
            }),
        );
        return Ok(());
    }

    // HTTP/HTTPS → open in browser
    if is_http_url(&url_candidate) {
        return shell_open_external(app, url_candidate);
    }

    // Other URI schemes (ftp://, etc.) → block
    if is_other_uri_scheme(&url_candidate) {
        return Ok(());
    }

    // Treat as file path
    let mut pathname = if std::path::Path::new(&url_candidate).is_absolute() {
        url_candidate.clone()
    } else if !args.dirname.is_empty() {
        let mut p = std::path::PathBuf::from(&args.dirname);
        p.push(&url_candidate);
        p.to_string_lossy().to_string()
    } else {
        url_candidate.clone()
    };

    // Normalize and decode percent-encoded paths (CommonMark #503)
    pathname = pathname.replace('\\', "/");
    if pathname.contains('%') {
        pathname = percent_decode(&pathname);
    }
    pathname = std::path::PathBuf::from(&pathname)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(pathname);

    // Check if it's a markdown file
    let ext = std::path::Path::new(&pathname)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if MARKDOWN_EXTENSIONS.contains(&ext.as_str()) && std::path::Path::new(&pathname).is_file() {
        // Open as new tab in the editor
        let result = fs_read_markdown(pathname, None, None, None, None)?;
        let _ = app.emit("mt::open-new-tab", &result);
    } else {
        // Open with system default application
        return shell_open_path(app, pathname);
    }

    Ok(())
}

/// Simple percent-decode for file paths
fn percent_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                char::from(bytes[i + 1]).to_digit(16),
                char::from(bytes[i + 2]).to_digit(16),
            ) {
                result.push(char::from_u32(hi * 16 + lo).unwrap_or('?'));
                i += 3;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

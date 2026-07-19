//! 杂项工具命令（6 个），归并了路径检查、命令探测、启动信息、窗口查询、
//! 图片选择对话框等小型 handle 通道。
//!
//! 对应原 Electron 版本的：
//! - `mt::paths::is-image`
//! - `mt::paths::is-same-sync`
//! - `mt::cmd::exists`
//! - `mt::boot-info-async`
//! - `mt::win::is-fullscreen`
//! - `mt::ask-for-image-path`

use std::path::Path;

use serde_json::json;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::{AppError, AppResult};

/// 图片扩展名白名单（与 marktext-develop `IMAGE_EXTENSIONS` 对齐，额外纳入
/// ico / bmp / tiff 以覆盖常见用例）。
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "svg", "bmp", "webp", "ico", "tiff"];

/// Markdown 扩展名白名单（与 marktext-develop `MARKDOWN_EXTENSIONS` 对齐）。
const MARKDOWN_EXTS: &[&str] = &[
    "markdown",
    "mdown",
    "mkdn",
    "md",
    "mkd",
    "mdwn",
    "mdtxt",
    "mdtext",
    "mdx",
    "text",
    "txt",
];

/// 判断路径是否是图片文件：扩展名命中白名单，且目标真实存在且是文件。
#[tauri::command]
pub fn paths_is_image(path: String) -> AppResult<bool> {
    let p = Path::new(&path);
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false);
    Ok(ext_ok && p.is_file())
}

/// 判断两个路径是否指向同一文件：先 `canonicalize` 规范化再比较，
/// 命中大小写差异、相对/绝对路径混用、符号链接等场景。
/// 任一路径不存在时退化为字符串归一化比较。
#[tauri::command]
pub fn paths_is_same(path_a: String, path_b: String) -> AppResult<bool> {
    let a = Path::new(&path_a);
    let b = Path::new(&path_b);
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => Ok(ca == cb),
        _ => {
            // 路径不存在时退化为字符串比较（大小写不敏感，Windows 友好）
            let na = normalize_sep(&path_a);
            let nb = normalize_sep(&path_b);
            Ok(na.eq_ignore_ascii_case(&nb))
        }
    }
}

/// 把路径分隔符统一成正斜杠后比较，避免 `\` / `/` 混用造成的误判。
fn normalize_sep(s: &str) -> String {
    s.replace('\\', "/")
}

/// 检测系统命令是否可用（PATH 查找），用 `which` crate 实现。
/// 兼容 marktext-develop 对 picgo 在 macOS 的额外路径探测——这里统一委托
/// 给 `which`，它已经处理了 PATH 遍历。
#[tauri::command]
pub fn cmd_exists(command: String) -> AppResult<bool> {
    Ok(which::which(&command).is_ok())
}

/// 返回 Tauri app_data_dir 路径（renderer 端初始化时异步调用，
/// 替代硬编码的 userData 路径）。
#[tauri::command]
pub fn get_user_data_dir(app: tauri::AppHandle) -> AppResult<String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| AppError::Other(format!("resolve app_data_dir: {e}")))
}

/// 启动信息，结构对齐 marktext-develop `BootInfo` 接口。
///
/// 返回字段：platform / arch / versions / paths / isUpdatable / MARKDOWN_INCLUSIONS。
/// Electron 专属字段（node/chrome/electron 版本）替换为 Tauri 上下文等价信息。
#[tauri::command]
pub fn boot_info_async(app: tauri::AppHandle) -> AppResult<serde_json::Value> {
    let user_data = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let resource_dir = app
        .path()
        .resource_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let inclusions: Vec<String> = MARKDOWN_EXTS.iter().map(|e| format!("*.{e}")).collect();

    Ok(json!({
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "versions": {
            "rust": rust_version(),
            "tauri": tauri::VERSION,
        },
        "paths": {
            "resources": resource_dir,
            "userData": user_data,
            "cwd": cwd,
            "ripgrepBinary": rg_path(),
        },
        "isUpdatable": false,
        "MARKDOWN_INCLUSIONS": inclusions,
    }))
}

/// 返回 Cargo.toml 中声明的 `rust-version`（编译期由 Cargo 注入环境变量）。
fn rust_version() -> &'static str {
    option_env!("CARGO_PKG_RUST_VERSION").unwrap_or("unknown")
}

/// 探测 ripgrep 可执行文件路径：优先 PATH 上的 `rg`，找不到返回空串。
fn rg_path() -> String {
    which::which("rg")
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 查询指定窗口是否处于全屏状态。窗口不存在返回 false。
#[tauri::command]
pub fn win_is_fullscreen(label: String, app: tauri::AppHandle) -> AppResult<bool> {
    Ok(app
        .get_webview_window(&label)
        .and_then(|w| w.is_fullscreen().ok())
        .unwrap_or(false))
}

/// 打开图片选择对话框，返回选中文件路径或 None（用户取消）。
///
/// 对应 marktext-develop `mt::ask-for-image-path`，过滤器覆盖常见图片格式。
#[tauri::command]
pub fn ask_for_image_path(app: tauri::AppHandle) -> AppResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Images", IMAGE_EXTS)
        .add_filter("All Files", &["*"])
        .blocking_pick_file();
    Ok(picked.and_then(fp_to_string))
}

/// 将 tauri-plugin-dialog 的 FilePath 转成字符串（与 dialog.rs 的实现一致，
/// 这里保持独立以避免跨模块私有函数依赖）。
fn fp_to_string(fp: FilePath) -> Option<String> {
    match fp {
        FilePath::Url(url) => url.to_file_path().ok().map(|p| p.to_string_lossy().into_owned()),
        FilePath::Path(p) => Some(p.to_string_lossy().into_owned()),
    }
}

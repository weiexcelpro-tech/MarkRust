//! 键盘布局与快捷键命令（3 个），对应原 Electron 版本的 keyboard IPC 通道。
//!
//! 替代 `native-keymap` 依赖。原 Electron 通过 native-keymap 获取物理键位映射
//! 和布局信息，Tauri/WebView2 的 JS KeyboardEvent 已正确处理物理键位和布局
//!（`event.code` 直接对应物理键位），因此这里返回静态默认值（US 英语布局），
//! renderer 端改用 `event.code` 替代 native keymap。
//!
//! 新增 `get_keybindings` 命令：返回平台默认快捷键 + 用户自定义覆盖，
//! 对齐原版 `mt::request-keybindings` → `mt::keybindings-response` 调用链。
//!
//! - `mt::keybinding-get-keyboard-info`
//! - `mt::keybinding-debug-dump-keyboard-info`
//! - `mt::request-keybindings` (via `get_keybindings`)

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// 返回键盘布局信息（静态默认值）。
///
/// 对应 `mt::keybinding-get-keyboard-info`。原 Electron 返回 native-keymap 的
/// `getCurrentKeyboardLayout()` + `getKeyMap()` 结果；Tauri 简化为静态 US 布局，
/// 因为 WebView2 的 JS KeyboardEvent 已正确处理物理键位。
#[tauri::command]
pub fn keybinding_get_keyboard_info() -> AppResult<Value> {
    Ok(keyboard_info_value())
}

/// 将键盘信息 JSON dump 到系统临时目录并用默认程序打开。
///
/// 对应 `mt::keybinding-debug-dump-keyboard-info`。文件路径固定为
/// `{temp_dir()}/marktext_keyboard_info.json`，等价于 keyboard/index.ts:91。
#[tauri::command]
pub fn keybinding_dump_keyboard_info() -> AppResult<()> {
    let info = keyboard_info_value();
    let pretty = serde_json::to_string_pretty(&info)
        .map_err(|e| AppError::Other(format!("serialize keyboard info: {e}")))?;

    let dump_path: PathBuf = std::env::temp_dir().join("marktext_keyboard_info.json");
    std::fs::write(&dump_path, pretty)?;

    open_path_with_default_app(&dump_path)
}

/// 构造静态键盘布局信息（US 英语 QWERTY 布局）。
/// layout.id `00000409` 是 Windows 中 US English 的标准 KLID。
fn keyboard_info_value() -> Value {
    json!({
        "layout": {
            "id": "00000409",
            "name": "US",
            "isComposing": false,
        },
        "keymap": {},
    })
}

/// 用系统默认程序打开文件（Windows: `explorer`，macOS: `open`，Linux: `xdg-open`）。
/// 等价于 Electron 的 `shell.openPath(path)`。
fn open_path_with_default_app(path: &std::path::Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Other(format!("open file via explorer: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Other(format!("open file via open: {e}")))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Other(format!("open file via xdg-open: {e}")))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Keybindings: 平台默认 + 用户自定义覆盖
// ---------------------------------------------------------------------------

/// 返回快捷键映射（平台默认 + 用户覆盖），格式 `Record<string, string>`。
///
/// 对齐原版 `mt::request-keybindings` → 主进程返回 keybindings.keys 的逻辑。
/// Renderer 端通过 `mt::keybindings-response` 消费此数据，遍历 commandCenter
/// 的 subcommands 并设置 `entry.shortcut`。
#[tauri::command]
pub fn get_keybindings(app: tauri::AppHandle) -> AppResult<Value> {
    let mut keys = default_keybindings();

    // 从 {app_data_dir}/keybindings.json 加载用户自定义覆盖
    if let Ok(data_dir) = app.path().app_data_dir() {
        let user_path = data_dir.join("keybindings.json");
        if user_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&user_path) {
                if let Ok(user_map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                    for (k, v) in user_map {
                        // 用户绑定值可以是空字符串（表示"解绑"）
                        keys.insert(k, v);
                    }
                }
            }
        }
    }

    // HashMap → JSON object
    let map: serde_json::Map<String, Value> = keys
        .into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect();
    Ok(Value::Object(map))
}

/// 返回当前平台默认快捷键映射，对齐原版 keybindingsWindows/Darwin/Linux.ts。
fn default_keybindings() -> HashMap<String, String> {
    let mut m = HashMap::new();

    // File menu
    m.insert("file.new-window".into(), "Ctrl+N".into());
    m.insert("file.new-tab".into(), "Ctrl+T".into());
    m.insert("file.open-file".into(), "Ctrl+O".into());
    m.insert("file.open-folder".into(), "Ctrl+Shift+O".into());
    m.insert("file.save".into(), "Ctrl+S".into());
    m.insert("file.save-as".into(), "Ctrl+Shift+S".into());
    m.insert("file.move-file".into(), String::new());
    m.insert("file.rename-file".into(), String::new());
    m.insert("file.print".into(), "Ctrl+P".into());
    m.insert("file.preferences".into(), "Ctrl+,".into());
    m.insert("file.close-tab".into(), "Ctrl+W".into());
    m.insert("file.close-window".into(), "Ctrl+Shift+W".into());
    m.insert("file.quit".into(), "Ctrl+Q".into());
    m.insert("file.export-file.pdf".into(), "Ctrl+Alt+E".into());

    // Edit menu
    m.insert("edit.undo".into(), "Ctrl+Z".into());
    m.insert("edit.redo".into(), "Ctrl+Shift+Z".into());
    m.insert("edit.cut".into(), "Ctrl+X".into());
    m.insert("edit.copy".into(), "Ctrl+C".into());
    m.insert("edit.paste".into(), "Ctrl+V".into());
    m.insert("edit.copy-as-rich".into(), "Ctrl+Shift+C".into());
    m.insert("edit.copy-as-html".into(), String::new());
    m.insert("edit.paste-as-plaintext".into(), "Ctrl+Shift+V".into());
    m.insert("edit.select-all".into(), "Ctrl+A".into());
    m.insert("edit.duplicate".into(), "Ctrl+Alt+D".into());
    m.insert("edit.create-paragraph".into(), "Ctrl+Shift+N".into());
    m.insert("edit.delete-paragraph".into(), "Ctrl+Shift+D".into());
    m.insert("edit.find".into(), "Ctrl+F".into());
    m.insert("edit.find-next".into(), "F3".into());
    m.insert("edit.find-previous".into(), "Shift+F3".into());
    m.insert("edit.replace".into(), "Ctrl+R".into());
    m.insert("edit.find-in-folder".into(), "Ctrl+Shift+F".into());
    m.insert("edit.screenshot".into(), String::new());

    // Paragraph menu
    m.insert("paragraph.heading-1".into(), String::new());
    m.insert("paragraph.heading-2".into(), String::new());
    m.insert("paragraph.heading-3".into(), String::new());
    m.insert("paragraph.heading-4".into(), String::new());
    m.insert("paragraph.heading-5".into(), String::new());
    m.insert("paragraph.heading-6".into(), String::new());
    m.insert("paragraph.upgrade-heading".into(), "Ctrl+Plus".into());
    m.insert("paragraph.degrade-heading".into(), "Ctrl+-".into());
    m.insert("paragraph.table".into(), "Ctrl+Shift+T".into());
    m.insert("paragraph.code-fence".into(), "Ctrl+Shift+K".into());
    m.insert("paragraph.quote-block".into(), "Ctrl+Shift+Q".into());
    m.insert("paragraph.math-formula".into(), "Ctrl+Alt+N".into());
    m.insert("paragraph.html-block".into(), "Ctrl+Alt+H".into());
    m.insert("paragraph.order-list".into(), "Ctrl+G".into());
    m.insert("paragraph.bullet-list".into(), "Ctrl+H".into());
    m.insert("paragraph.task-list".into(), "Ctrl+Alt+X".into());
    m.insert("paragraph.loose-list-item".into(), "Ctrl+Alt+L".into());
    m.insert("paragraph.paragraph".into(), "Ctrl+Shift+0".into());
    m.insert("paragraph.horizontal-line".into(), "Ctrl+Shift+U".into());
    m.insert("paragraph.front-matter".into(), "Ctrl+Alt+Y".into());

    // Format menu
    m.insert("format.strong".into(), "Ctrl+B".into());
    m.insert("format.emphasis".into(), "Ctrl+I".into());
    m.insert("format.underline".into(), "Ctrl+U".into());
    m.insert("format.superscript".into(), String::new());
    m.insert("format.subscript".into(), String::new());
    m.insert("format.highlight".into(), "Ctrl+Shift+H".into());
    m.insert("format.inline-code".into(), "Ctrl+`".into());
    m.insert("format.inline-math".into(), "Ctrl+Shift+M".into());
    m.insert("format.strike".into(), "Ctrl+D".into());
    m.insert("format.hyperlink".into(), "Ctrl+L".into());
    m.insert("format.image".into(), "Ctrl+Shift+I".into());
    m.insert("format.clear-format".into(), "Ctrl+Shift+R".into());

    // Window menu
    m.insert("window.minimize".into(), "Ctrl+M".into());
    m.insert("window.toggle-always-on-top".into(), String::new());
    m.insert("window.zoomIn".into(), String::new());
    m.insert("window.zoomOut".into(), String::new());
    m.insert("window.toggle-full-screen".into(), "F11".into());

    // View menu
    m.insert("view.command-palette".into(), "Ctrl+Shift+P".into());
    m.insert("view.source-code-mode".into(), "Ctrl+E".into());
    m.insert("view.typewriter-mode".into(), "Ctrl+Shift+G".into());
    m.insert("view.focus-mode".into(), "Ctrl+Shift+J".into());
    m.insert("view.toggle-sidebar".into(), "Ctrl+J".into());
    m.insert("view.toggle-toc".into(), "Ctrl+K".into());
    m.insert("view.toggle-tabbar".into(), "Ctrl+Shift+B".into());
    m.insert("view.toggle-dev-tools".into(), "Ctrl+Alt+I".into());
    m.insert("view.dev-reload".into(), "Ctrl+F5".into());
    m.insert("view.reload-images".into(), "F5".into());

    // Tabs (not in application menu)
    m.insert("tabs.cycleForward".into(), "Ctrl+Tab".into());
    m.insert("tabs.cycleBackward".into(), "Ctrl+Shift+Tab".into());
    m.insert("tabs.switchToLeft".into(), "Ctrl+PageUp".into());
    m.insert("tabs.switchToRight".into(), "Ctrl+PageDown".into());
    m.insert("tabs.switchToFirst".into(), "Ctrl+1".into());
    m.insert("tabs.switchToSecond".into(), "Ctrl+2".into());
    m.insert("tabs.switchToThird".into(), "Ctrl+3".into());
    m.insert("tabs.switchToFourth".into(), "Ctrl+4".into());
    m.insert("tabs.switchToFifth".into(), "Ctrl+5".into());
    m.insert("tabs.switchToSixth".into(), "Ctrl+6".into());
    m.insert("tabs.switchToSeventh".into(), "Ctrl+7".into());
    m.insert("tabs.switchToEighth".into(), "Ctrl+8".into());
    m.insert("tabs.switchToNinth".into(), "Ctrl+9".into());
    m.insert("tabs.switchToTenth".into(), "Ctrl+0".into());
    m.insert("file.quick-open".into(), "Ctrl+P".into());

    // macOS-only entries (empty on Windows)
    m.insert("mt.hide".into(), String::new());
    m.insert("mt.hide-others".into(), String::new());

    m
}

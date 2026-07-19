use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{LogicalPosition, LogicalSize, Manager, WindowEvent};

#[derive(Serialize, Deserialize, Default)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

fn state_path(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?;
    fs::create_dir_all(&dir).map_err(|e| AppError::Io(e))?;
    Ok(dir.join("window-state.json"))
}

/// 返回主屏（或任一可用屏幕）的逻辑工作区：`(x, y, width, height)`。
/// Tauri 的 `available_monitor` 返回的是物理像素，需要除以 scale_factor 得到逻辑像素。
/// 若拿不到 monitor则返回 None。
fn primary_logical_workarea(app: &tauri::AppHandle) -> Option<(i32, i32, u32, u32)> {
    let window = app.get_webview_window("main")?;
    // available_monitors 返回所有可用屏幕；取第一个作为主屏用于 clamp
    let monitors = window.available_monitors().ok()?;
    let monitor = monitors.into_iter().next()?;
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    // 物理像素 → 逻辑像素
    let lx = (pos.x as f64 / scale).round() as i32;
    let ly = (pos.y as f64 / scale).round() as i32;
    let lw = (size.width as f64 / scale).round() as u32;
    let lh = (size.height as f64 / scale).round() as u32;
    Some((lx, ly, lw, lh))
}

/// 判断保存的窗口位置是否在任一屏幕的可见范围内。
/// 之前的 `[-5000, +10000]` 启发式过于宽松：副屏拔掉后 -2881 仍能通过，
/// 窗口实际跑到屏幕外。改为检查窗口矩形与某块屏幕工作区是否有交集。
fn is_position_visible(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    app: &tauri::AppHandle,
) -> bool {
    // Windows 最小化时 outer_position 返回 (-32768, -32768)
    if x <= -32000 || y <= -32000 {
        return false;
    }
    // 遍历所有屏幕，看窗口矩形是否与任一屏幕工作区相交
    if let Some(window) = app.get_webview_window("main") {
        let scale = window.scale_factor().unwrap_or(1.0);
        if let Ok(monitors) = window.available_monitors() {
            for m in monitors {
                let mx = (m.position().x as f64 / scale).round() as i32;
                let my = (m.position().y as f64 / scale).round() as i32;
                let mw = (m.size().width as f64 / scale).round() as i32;
                let mh = (m.size().height as f64 / scale).round() as i32;
                // 窗口左上角 + 至少 100x100 可见区域在屏幕内
                let win_right = x.saturating_add(width as i32);
                let win_bottom = y.saturating_add(height as i32);
                let visible_w = win_right.min(mx + mw) - x.max(mx);
                let visible_h = win_bottom.min(my + mh) - y.max(my);
                if visible_w >= 100 && visible_h >= 100 {
                    return true;
                }
            }
            return false;
        }
    }
    // 拿不到屏幕信息时退回宽松校验
    x >= -5000 && x <= 10000 && y >= -5000 && y <= 10000
}

/// 启动时恢复窗口大小/位置（替代 electron-window-state）。
/// 增强点：
/// 1) 尺寸 clamp 到当前可用屏幕工作区，避免多显示器残留的超屏尺寸
/// 2) 位置必须在某块屏幕的可见区域内，否则居中
pub fn restore(app: &tauri::AppHandle) {
    let Ok(path) = state_path(app) else {
        return;
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(state) = serde_json::from_str::<WindowState>(&content) else {
        return;
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // 取主屏逻辑工作区用于尺寸 clamp
    let workarea = primary_logical_workarea(app);

    // 恢复大小（clamp 到屏幕工作区，避免超过屏分辨率）
    let mut apply_width = state.width;
    let mut apply_height = state.height;
    if apply_width > 0 && apply_height > 0 {
        if let Some((_, _, mw, mh)) = workarea {
            // 留 20px 余量，避免刚好等于屏幕全屏被系统当成最大化
            if apply_width > mw.saturating_sub(20) {
                apply_width = mw.saturating_sub(20);
            }
            if apply_height > mh.saturating_sub(20) {
                apply_height = mh.saturating_sub(20);
            }
        }
        let _ = window.set_size(LogicalSize::new(apply_width, apply_height));
    }

    // 恢复位置：必须可见，否则居中
    if is_position_visible(state.x, state.y, apply_width, apply_height, app) {
        let _ = window.set_position(LogicalPosition::new(state.x, state.y));
    } else {
        let _ = window.center();
    }

    if state.maximized {
        let _ = window.maximize();
    }
}

/// 保存当前窗口状态到 `window-state.json`。
/// - 跳过最小化窗口（位置 -32000 以下）
/// - clamp 到屏幕工作区，避免保存超屏尺寸
/// - 物理像素 → 逻辑像素（restore 时用 LogicalSize/LogicalPosition 恢复）
fn save_window_state(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let is_maximized = win.is_maximized().unwrap_or(false);
    // scale_factor: 物理像素 / 逻辑像素 的比率，例如 1.25（Windows 125% 缩放）
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos = win.outer_position().unwrap_or_default();
    // Windows 最小化窗口 outer_position 返回 (-32768, -32768)，
    // 保存此值会导致下次启动窗口跑到屏幕外。遇到此情况跳过保存。
    let is_hidden = pos.x <= -32000 && pos.y <= -32000;
    if is_hidden {
        return;
    }
    // outer_size / outer_position 返回物理像素，转逻辑像素再保存
    // （restore 时用 LogicalSize / LogicalPosition 恢复）
    let outer = win.outer_size().unwrap_or_default();
    let mut width = (outer.width as f64 / scale).round() as u32;
    let mut height = (outer.height as f64 / scale).round() as u32;
    let x = (pos.x as f64 / scale).round() as i32;
    let y = (pos.y as f64 / scale).round() as i32;
    // 保存前同样 clamp 到屏幕工作区（逻辑像素），避免保存超屏尺寸
    if let Some((_, _, mw, mh)) = primary_logical_workarea(app) {
        if width > mw.saturating_sub(20) {
            width = mw.saturating_sub(20);
        }
        if height > mh.saturating_sub(20) {
            height = mh.saturating_sub(20);
        }
    }
    let state = WindowState {
        width,
        height,
        x,
        y,
        maximized: is_maximized,
    };
    if let Ok(path) = state_path(app) {
        if let Ok(json) = serde_json::to_string(&state) {
            let _ = fs::write(path, json);
        }
    }
}

/// 注册窗口事件监听以持久化窗口状态（在 setup 中调用）。
/// - 启动时立即保存一次初始状态（确保 window-state.json 存在）
/// - Resized/Moved: 实时保存新尺寸/位置
/// - CloseRequested/Destroyed: 退出前再保存一次
pub fn setup_save(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app_handle = app.clone();

    // 启动时立即保存一次初始状态，确保 window-state.json 存在
    save_window_state(&app_handle);

    window.on_window_event(move |event| {
        match event {
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                save_window_state(&app_handle);
            }
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                save_window_state(&app_handle);
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_state_serialize_roundtrip() {
        let state = WindowState {
            width: 1920,
            height: 1080,
            x: -100,
            y: 50,
            maximized: true,
        };
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: WindowState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.width, 1920);
        assert_eq!(deserialized.height, 1080);
        assert_eq!(deserialized.x, -100);
        assert_eq!(deserialized.y, 50);
        assert!(deserialized.maximized);
    }

    #[test]
    fn test_window_state_default() {
        let state = WindowState::default();
        assert_eq!(state.width, 0);
        assert_eq!(state.height, 0);
        assert_eq!(state.x, 0);
        assert_eq!(state.y, 0);
        assert!(!state.maximized);
    }

    #[test]
    fn test_window_state_json_format() {
        let state = WindowState {
            width: 800,
            height: 600,
            x: 0,
            y: 0,
            maximized: false,
        };
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"width\":800"));
        assert!(json.contains("\"maximized\":false"));
    }
}

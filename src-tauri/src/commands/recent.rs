//! 最近使用文档管理，对应原 Electron 版本 `menu/index.ts` 的
//! `addRecentlyUsedDocument` / `getRecentlyUsedDocuments` / `clearRecentlyUsedDocuments`。
//!
//! 数据存储在 `userData/recently-used-documents.json`，最多 12 条，MRU 顺序。
//! Windows Jump List (SHAddToRecentDocs) 暂不实现，后续可用 `windows` crate 补全。

use std::fs;
use std::path::PathBuf;

use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

const RECENTLY_USED_FILE: &str = "recently-used-documents.json";
const MAX_RECENTLY_USED: usize = 12;

/// 获取 recently-used-documents.json 路径
fn recents_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app_data_dir unavailable");
    dir.join(RECENTLY_USED_FILE)
}

/// 从 JSON 文件读取最近使用列表，过滤掉不存在的路径
fn read_recent_list(path: &std::path::Path) -> Vec<String> {
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(path) {
        Ok(content) => {
            let mut list: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
            // 过滤掉已不存在或为空的条目
            list.retain(|p| !p.is_empty() && (PathBuf::from(p).is_file() || PathBuf::from(p).is_dir()));
            if list.len() > MAX_RECENTLY_USED {
                list.truncate(MAX_RECENTLY_USED);
            }
            list
        }
        Err(_) => Vec::new(),
    }
}

/// 写入 JSON 文件，先确保目录存在
fn write_recent_list(path: &std::path::Path, list: &[String]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Other(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(list).map_err(|e| AppError::Other(e.to_string()))?;
    fs::write(path, json).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// 添加文件路径到最近使用列表（MRU 顺序，最多 12 条）。
///
/// 对应 Electron 的 `AppMenu.addRecentlyUsedDocument()`。
/// 调用后同时发出 `mt::recent-documents-changed` 事件以便前端/菜单重建。
#[tauri::command]
pub fn recent_add(app: tauri::AppHandle, file_path: String) -> AppResult<Vec<String>> {
    let path = recents_path(&app);
    let mut list = read_recent_list(&path);

    // 如果已存在则移到头部，否则插入头部
    if let Some(pos) = list.iter().position(|p| p == &file_path) {
        list.remove(pos);
    }
    list.insert(0, file_path);

    // 超出上限截断
    list.truncate(MAX_RECENTLY_USED);

    write_recent_list(&path, &list)?;

    // 通知前端列表已变化
    let _ = app.emit("mt::recent-documents-changed", &list);

    Ok(list)
}

/// 获取最近使用文档列表。
///
/// 对应 Electron 的 `AppMenu.getRecentlyUsedDocuments()`。
#[tauri::command]
pub fn recent_get(app: tauri::AppHandle) -> Vec<String> {
    let path = recents_path(&app);
    read_recent_list(&path)
}

/// 清空最近使用文档列表。
///
/// 对应 Electron 的 `AppMenu.clearRecentlyUsedDocuments()`。
#[tauri::command]
pub fn recent_clear(app: tauri::AppHandle) -> AppResult<Vec<String>> {
    let path = recents_path(&app);
    let empty: Vec<String> = Vec::new();
    write_recent_list(&path, &empty)?;

    // 通知前端列表已清空
    let _ = app.emit("mt::recent-documents-changed", &empty);

    Ok(empty)
}

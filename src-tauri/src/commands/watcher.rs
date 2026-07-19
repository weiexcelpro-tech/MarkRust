//! 文件监听命令，使用 `notify` + `notify-debouncer-mini`。
//!
//! 对应原 Electron 版本的 chokidar watcher（`mt::watch-file` / `mt::unwatch-file`）。
//!
//! 监听器在 500ms 防抖后同时推送两个事件：
//! - `mt::update-file`：文件内容变更（匹配前端 editor.ts 监听器）
//! - `mt::update-object-tree`：目录树结构变更（匹配前端 project.ts 监听器）
//!
//! payload 结构：`{ type: "add"|"change"|"unlink"|"addDir"|"unlinkDir", change: { pathname, isDirectory, isMarkdown? } }`
//!
//! **已知限制**：`notify-debouncer-mini` 不提供事件类型，`type` 字段通过检查路径
//! 是否存在来启发式判定（存在 → add/change / 不存在 → unlink）。`is_directory` 在
//! 删除时从已记录的状态中查询（路径已不存在无法实时判定）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, Debouncer};
use serde::Serialize;
use tauri::{Emitter, WebviewWindow};
use tokio::sync::{Mutex, OnceCell};

use crate::error::{AppError, AppResult};

type WatcherEntry = Debouncer<RecommendedWatcher>;

static WATCHERS: OnceCell<Mutex<HashMap<String, WatcherEntry>>> = OnceCell::const_new();

async fn watchers_map() -> &'static Mutex<HashMap<String, WatcherEntry>> {
    WATCHERS
        .get_or_init(|| async { Mutex::new(HashMap::new()) })
        .await
}

#[derive(Serialize, Clone)]
struct WatcherPayload {
    #[serde(rename = "type")]
    event_type: &'static str,
    change: ChangePayload,
}

#[derive(Serialize, Clone)]
struct ChangePayload {
    pathname: String,
    is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_markdown: Option<bool>,
}

/// 注册文件/目录监听器。同一路径重复调用会先停旧监听器再建新的。
#[tauri::command]
pub async fn watch_file(path: String, window: WebviewWindow) -> AppResult<()> {
    let (tx, rx) = mpsc::channel();
    let mut debouncer =
        new_debouncer(Duration::from_millis(500), tx).map_err(|e| AppError::Other(e.to_string()))?;

    let watch_path = PathBuf::from(&path);
    let is_dir = std::fs::metadata(&watch_path)
        .map(|m| m.is_dir())
        .unwrap_or(false);
    let mode = if is_dir {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };
    debouncer
        .watcher()
        .watch(&watch_path, mode)
        .map_err(|e| AppError::Other(format!("watch failed: {e}")))?;

    // mpsc::Receiver 是阻塞 API，在独立 OS 线程中轮询；
    // debouncer drop 时 sender 自动断开，recv 返回 Err 退出循环。
    let win = window;
    std::thread::spawn(move || {
        // 记录已见路径及其 is_directory，用于删除时判定事件类型。
        let mut seen: HashMap<PathBuf, bool> = HashMap::new();
        for result in rx {
            let events = match result {
                Ok(ev) => ev,
                Err(e) => {
                    log::error!("watcher error: {e}");
                    continue;
                }
            };
            for event in events {
                let path_str = event.path.to_string_lossy().into_owned();

                if !event.path.exists() {
                    // 路径已删除：从 seen 查询先前的 is_directory
                    let was_dir = seen.remove(&event.path).unwrap_or(false);
                    let event_type = if was_dir { "unlinkDir" } else { "unlink" };
                    let payload = WatcherPayload {
                        event_type,
                        change: ChangePayload {
                            pathname: path_str,
                            is_directory: was_dir,
                            is_markdown: None,
                        },
                    };
                    let _ = win.emit("mt::update-file", &payload);
                    let _ = win.emit("mt::update-object-tree", &payload);
                } else {
                    let is_dir = std::fs::metadata(&event.path)
                        .map(|m| m.is_dir())
                        .unwrap_or(false);
                    let is_new = !seen.contains_key(&event.path);

                    // 目录的 "change" 事件无对应 payload 类型，跳过；
                    // 目录子项变更会触发子路径自身的 add/unlink 事件。
                    if !is_new && is_dir {
                        continue;
                    }

                    seen.insert(event.path.clone(), is_dir);

                    let event_type = if is_dir {
                        "addDir"
                    } else if is_new {
                        "add"
                    } else {
                        "change"
                    };

                    let is_markdown = if is_dir {
                        None
                    } else {
                        Some(crate::commands::fs::is_markdown_name(&path_str))
                    };

                    let payload = WatcherPayload {
                        event_type,
                        change: ChangePayload {
                            pathname: path_str,
                            is_directory: is_dir,
                            is_markdown,
                        },
                    };
                    let _ = win.emit("mt::update-file", &payload);
                    let _ = win.emit("mt::update-object-tree", &payload);
                }
            }
        }
    });

    let map = watchers_map().await;
    let mut guard = map.lock().await;
    if let Some(old) = guard.remove(&path) {
        drop(old); // 显式停止旧监听器
    }
    guard.insert(path, debouncer);
    Ok(())
}

#[tauri::command]
pub async fn unwatch_file(path: String) -> AppResult<()> {
    let map = watchers_map().await;
    let mut guard = map.lock().await;
    guard.remove(&path); // drop 即停止监听
    Ok(())
}

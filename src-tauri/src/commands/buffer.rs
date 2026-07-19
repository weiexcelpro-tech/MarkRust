//! 编辑器会话缓冲存取（2 个命令），对应原 Electron 版的 `editorBufferStore`。
//!
//! 契约参考：`marktext-develop/packages/desktop/src/main/editorBufferStore/index.ts`。
//!
//! 原版用 `update-buffer-state` IPC channel + `{uuid}_editor_buffer_store.json` 文件
//! 实现会话持久化。Tauri 版简化为固定路径 `{app_data_dir}/buffer_state.json`，
//! 单窗口场景无需 UUID。

use std::path::PathBuf;

use serde_json::Value;
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// 返回缓冲状态文件的路径：`{app_data_dir}/buffer_state.json`。
fn buffer_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("resolve app_data_dir: {e}")))?;
    Ok(data_dir.join("buffer_state.json"))
}

/// 原子写入缓冲状态 JSON 文件。
///
/// 先写临时文件再 rename，避免崩溃时损坏（与原版 `writeBufferStoreFile` 一致）。
#[tauri::command]
pub fn buffer_save(app: tauri::AppHandle, state: Value) -> AppResult<()> {
    let path = buffer_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // 原子写入：先写 .tmp 再 rename
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string(&state).map_err(|e| AppError::Other(format!("serialize buffer: {e}")))?;
    std::fs::write(&tmp_path, &json)?;
    std::fs::rename(&tmp_path, &path)?;

    Ok(())
}

/// 读取缓冲状态 JSON 文件。文件不存在时返回 `null`。
#[tauri::command]
pub fn buffer_load(app: tauri::AppHandle) -> AppResult<Option<Value>> {
    let path = buffer_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| AppError::Other(format!("parse buffer: {e}")))?;
    Ok(Some(value))
}

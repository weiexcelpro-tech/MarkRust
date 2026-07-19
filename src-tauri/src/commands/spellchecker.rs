//! 拼写检查命令（5 个），对应原 Electron 版本的 `mt::spellchecker::*` 通道。
//!
//! 替代 Electron 内置 Hunspell spellchecker。WebView2 使用 Windows 系统级拼写
//! 检查，由 HTML `spellcheck` 属性控制（renderer 端处理）。Rust 端仅维护
//! 自定义词典（JSON 文件）和配置状态。
//!
//! 自定义词典存储：`{app_data_dir()}/spellchecker-dictionary.json`，
//! 格式 `{ "words": ["word1", "word2"] }`。
//!
//! 配置存储：`{app_data_dir()}/spellchecker-config.json`。
//!
//! 对应通道：
//! - `mt::spellchecker-set-enabled`
//! - `mt::spellchecker-switch-language`
//! - `mt::spellchecker-get-available-dictionaries`
//! - `mt::spellchecker-remove-word`
//! - `mt::spellchecker-get-custom-dictionary-words`

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// 自定义词典 JSON 结构：`{ "words": [...] }`。
#[derive(Serialize, Deserialize, Default)]
struct DictionaryFile {
    words: Vec<String>,
}

/// 拼写检查配置（启用状态 + 语言选择），序列化为 `spellchecker-config.json`。
#[derive(Serialize, Deserialize, Default)]
struct SpellConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

/// 设置拼写检查启用状态。WebView2 的实际启用由 renderer 端的 `spellcheck`
/// HTML 属性控制，这里仅记录用户偏好到配置文件。
///
/// 对应 `mt::spellchecker-set-enabled`，返回是否成功（固定 true）。
#[tauri::command]
pub fn spellchecker_set_enabled(app: tauri::AppHandle, enabled: bool) -> AppResult<bool> {
    let path = config_path(&app)?;
    let mut config = load_config(&path);
    config.enabled = Some(enabled);
    save_config(&path, &config)?;
    Ok(true)
}

/// 切换拼写检查语言。WebView2 使用系统语言，这里仅记录用户选择到配置文件。
///
/// 对应 `mt::spellchecker-switch-language`。
#[tauri::command]
pub fn spellchecker_switch_language(app: tauri::AppHandle, lang: String) -> AppResult<()> {
    let path = config_path(&app)?;
    let mut config = load_config(&path);
    config.language = Some(lang);
    save_config(&path, &config)?;
    Ok(())
}

/// 返回可用拼写检查语言列表。WebView2 使用系统语言，无法列举，返回硬编码列表。
///
/// 对应 `mt::spellchecker-get-available-dictionaries`（spellchecker/index.ts:45）。
#[tauri::command]
pub fn spellchecker_get_available_dictionaries(_app: tauri::AppHandle) -> AppResult<Vec<String>> {
    Ok(vec!["en-US".to_string()])
}

/// 从自定义词典中移除指定单词。
///
/// 对应 `mt::spellchecker-remove-word`，返回是否成功（固定 true）。
#[tauri::command]
pub fn spellchecker_remove_word(app: tauri::AppHandle, word: String) -> AppResult<bool> {
    let path = dictionary_path(&app)?;
    let mut words = load_dictionary(&path);
    words.retain(|w| w != &word);
    save_dictionary(&path, &words)?;
    Ok(true)
}

/// 返回自定义词典中的所有单词。
///
/// 对应 `mt::spellchecker-get-custom-dictionary-words`。
#[tauri::command]
pub fn spellchecker_get_custom_dictionary_words(
    app: tauri::AppHandle,
) -> AppResult<Vec<String>> {
    let path = dictionary_path(&app)?;
    Ok(load_dictionary(&path))
}

// ─── 辅助函数：路径解析 ──────────────────────────────────

/// 获取自定义词典文件路径：`{app_data_dir()}/spellchecker-dictionary.json`。
fn dictionary_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?;
    Ok(dir.join("spellchecker-dictionary.json"))
}

/// 获取拼写检查配置文件路径：`{app_data_dir()}/spellchecker-config.json`。
fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?;
    Ok(dir.join("spellchecker-config.json"))
}

/// 获取 `app_data_dir()`，确保目录存在（首次运行时自动创建）。
fn app_data_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// ─── 辅助函数：词典 + 配置 IO ────────────────────────────

/// 读取自定义词典。文件不存在或解析失败时返回空 Vec（不报错）。
fn load_dictionary(path: &Path) -> Vec<String> {
    let data = match std::fs::read_to_string(path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let dict: DictionaryFile = serde_json::from_str(&data).unwrap_or_default();
    dict.words
}

/// 写入自定义词典（pretty JSON）。
fn save_dictionary(path: &Path, words: &[String]) -> AppResult<()> {
    let dict = DictionaryFile {
        words: words.to_vec(),
    };
    write_json(path, &dict)
}

/// 读取拼写检查配置。文件不存在时返回默认值（空配置）。
fn load_config(path: &Path) -> SpellConfig {
    match std::fs::read_to_string(path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => SpellConfig::default(),
    }
}

/// 写入拼写检查配置（pretty JSON）。
fn save_config(path: &Path, config: &SpellConfig) -> AppResult<()> {
    write_json(path, config)
}

/// 将任意 Serialize 结构以 pretty JSON 写入文件。
fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let data = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Other(format!("serialize json: {e}")))?;
    std::fs::write(path, data)?;
    Ok(())
}

//! 国际化命令（3 个），对应原 Electron 版本的 `mt::i18n::*` 通道。
//!
//! 语言资源文件来自 marktext-develop 的 `static/locales/*.json`，已复制到
//! `src-tauri/resources/i18n/`，通过 `include_str!` 在编译期嵌入二进制。
//! 这样无需运行时文件 IO，也不依赖 `resourcesPath`，分发体积略增但部署更简单。
//!
//! 支持语言：en / zh-CN / zh-TW / es / fr / de / ja / ko / pt / tr（共 10 种）。

use serde_json::Value;

use crate::error::{AppError, AppResult};

/// 支持的语言代码列表（与 marktext-develop `SUPPORTED_LANGUAGES` 一致）。
const SUPPORTED: &[&str] = &[
    "en",
    "zh-CN",
    "zh-TW",
    "es",
    "fr",
    "de",
    "ja",
    "ko",
    "pt",
    "tr",
];

/// 判断语言是否受支持。
#[tauri::command]
pub fn i18n_is_supported(locale: String) -> AppResult<bool> {
    Ok(SUPPORTED.contains(&locale.as_str()))
}

/// 返回所有支持的语言代码。
#[tauri::command]
pub fn i18n_supported() -> AppResult<Vec<String>> {
    Ok(SUPPORTED.iter().map(|s| s.to_string()).collect())
}

/// 加载指定语言的翻译 JSON。未知语言回退到英文 `en`；
/// 解析失败返回错误（极不可能，因为文件编译期已嵌入）。
#[tauri::command]
pub fn i18n_load(locale: String) -> AppResult<Value> {
    let raw = match locale.as_str() {
        "zh-CN" => include_str!("../../resources/i18n/zh-CN.json"),
        "zh-TW" => include_str!("../../resources/i18n/zh-TW.json"),
        "es" => include_str!("../../resources/i18n/es.json"),
        "fr" => include_str!("../../resources/i18n/fr.json"),
        "de" => include_str!("../../resources/i18n/de.json"),
        "ja" => include_str!("../../resources/i18n/ja.json"),
        "ko" => include_str!("../../resources/i18n/ko.json"),
        "pt" => include_str!("../../resources/i18n/pt.json"),
        "tr" => include_str!("../../resources/i18n/tr.json"),
        // 未知语言或英文均回退到 en
        _ => include_str!("../../resources/i18n/en.json"),
    };
    serde_json::from_str(raw).map_err(|e| AppError::Other(format!("i18n parse {locale}: {e}")))
}

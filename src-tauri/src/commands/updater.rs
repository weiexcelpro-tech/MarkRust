//! 更新检查命令（1 个），用 GitHub Releases API 查询最新版本。
//!
//! 仅检查、不自动下载安装——对齐 marktext-develop 不强制代码签名的策略
//! （tauri-plugin-updater 要求签名校验，故弃用）。前端拿到 release 信息后
//! 自行引导用户打开 `release_url` 下载。
//!
//! 所有网络 / 解析错误都降级为 `{ has_update: false, error: "..." }` 返回，
//! 绝不 panic，保证 IPC 调用方始终拿到结构化响应。

use semver::Version;
use serde_json::{json, Value};

use crate::error::AppResult;

/// GitHub REST API v3 根路径。
const GH_API_BASE: &str = "https://api.github.com/repos";

/// 请求 User-Agent（GitHub API 强制要求，否则返回 403）。
const USER_AGENT: &str = "markrust";

/// 查询指定 GitHub 仓库的最新 release，用 semver 与当前版本比较。
///
/// - `owner` / `repo`：GitHub 仓库归属与名称（如 "marktext" / "marktext"）；
/// - `current_version`：当前版本号（可含 `v` 前缀，内部统一 strip）。
///
/// 返回 `{ has_update, latest_version, current_version, release_url, release_notes }`；
/// 网络 / 解析失败返回 `{ has_update: false, error: "..." }`，不返回 Err。
#[tauri::command]
pub async fn updater_check_latest(
    _app: tauri::AppHandle,
    owner: String,
    repo: String,
    current_version: String,
) -> AppResult<Value> {
    Ok(check_latest_inner(&owner, &repo, &current_version).await)
}

/// 实际查询逻辑独立出来，把所有错误降级为 `has_update: false` 的返回值，
/// 保证调用方始终拿到结构化 payload 而非 IPC 级 Err。
async fn check_latest_inner(owner: &str, repo: &str, current_version: &str) -> Value {
    let url = format!("{GH_API_BASE}/{owner}/{repo}/releases/latest");

    let client = match reqwest::Client::builder().user_agent(USER_AGENT).build() {
        Ok(c) => c,
        Err(e) => return error_payload(current_version, &format!("build http client: {e}")),
    };

    let resp = match client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return error_payload(current_version, &format!("network request: {e}")),
    };

    let body: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return error_payload(current_version, &format!("decode response: {e}")),
    };

    let tag = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let html_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = body
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // GitHub tag 约定带 v 前缀（如 v0.1.0），semver 比较前需统一 strip
    let latest = tag.trim_start_matches('v');
    let current = current_version.trim_start_matches('v');

    let has_update = match (Version::parse(latest), Version::parse(current)) {
        (Ok(l), Ok(c)) => l > c,
        // 任一版本非合法 semver 时降级为 false，避免误报
        _ => false,
    };

    json!({
        "has_update": has_update,
        "latest_version": latest,
        "current_version": current,
        "release_url": html_url,
        "release_notes": notes,
    })
}

/// 网络 / 解析失败时的统一返回体（has_update=false + error 字段）。
fn error_payload(current_version: &str, msg: &str) -> Value {
    json!({
        "has_update": false,
        "latest_version": "",
        "current_version": current_version,
        "release_url": "",
        "release_notes": "",
        "error": msg,
    })
}

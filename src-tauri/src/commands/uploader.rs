//! 图片上传命令（1 个），对应原 Electron 版本的 `mt::uploader::upload` 通道。
//!
//! 替代 marktext-develop `uploader.ts`（187 行），支持两种上传方式：
//! - `picgo`：调用 PicGo CLI（`picgo u <path>`），三级回退解析输出提取 URL
//!   （JSON 对象 → 关键词 + URL → `[PicGo SUCCESS]:` 标记）
//! - `cliScript`：调用用户自定义脚本，stdout trim 后即为 URL
//!
//! buffer 上传时会写入临时文件，上传完成后自动清理（try/finally 语义）。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

/// 图片扩展名白名单（与 misc.rs `IMAGE_EXTS` 一致）。
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "svg", "bmp", "webp", "ico", "tiff"];

/// 上传请求（字段名 camelCase 对齐 renderer 端 payload）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub pathname: String,
    pub image: Value,
    pub is_path: bool,
    pub preferences: UploadPreferences,
}

/// 上传偏好（currentUploader: `"picgo"` | `"cliScript"`）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadPreferences {
    pub current_uploader: String,
    pub cli_script: String,
}

/// Buffer 图片 payload：`{ data: [0, 1, 255, ...], name: "screenshot.png" }`。
#[derive(Deserialize)]
pub struct BufferImagePayload {
    pub data: Vec<u8>,
    pub name: String,
}

/// 上传图片到云端图床。
///
/// 对应 `mt::uploader::upload`（uploader.ts:176）。
/// - `isPath=true`：image 为相对路径，resolve 到 pathname 所在目录后上传
/// - `isPath=false`：image 为 `{ data, name }` buffer，写入临时文件后上传
#[tauri::command]
pub async fn uploader_upload(_app: tauri::AppHandle, req: UploadRequest) -> AppResult<String> {
    let UploadRequest {
        pathname,
        image,
        is_path,
        preferences,
    } = req;

    if is_path {
        // image 是相对/文件名字符串，解析到 pathname 所在目录
        let image_str = image
            .as_str()
            .ok_or_else(|| AppError::Other("image must be a string when isPath=true".into()))?;
        let dir = Path::new(&pathname)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        let image_path = dir.join(image_str);

        if !is_image_file(&image_path) {
            // 非图片文件直接返回原始字符串（不上传）
            return Ok(image_str.to_string());
        }
        upload_from_path(&image_path.to_string_lossy(), &preferences).await
    } else {
        // image 是 buffer payload
        let payload: BufferImagePayload = serde_json::from_value(image)
            .map_err(|e| AppError::Other(format!("parse image buffer payload: {e}")))?;
        upload_from_buffer(&payload, &preferences).await
    }
}

// ─── 上传分发 ────────────────────────────────────────────

/// 从本地文件路径上传（分发到 picgo 或 cliScript）。
async fn upload_from_path(path: &str, prefs: &UploadPreferences) -> AppResult<String> {
    match prefs.current_uploader.as_str() {
        "picgo" => upload_by_picgo(path).await,
        "cliScript" => upload_by_cli(&prefs.cli_script, path).await,
        other => Err(AppError::Other(format!("Unsupported uploader: {other}"))),
    }
}

/// 从内存 buffer 上传：写入临时文件 → 上传 → 删除临时文件（finally 清理）。
///
/// 等价于 uploader.ts:145 的 `uploadFromBuffer` + try/finally cleanup。
async fn upload_from_buffer(
    payload: &BufferImagePayload,
    prefs: &UploadPreferences,
) -> AppResult<String> {
    let suffix = Path::new(&payload.name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp_path = std::env::temp_dir().join(format!("mt_upload_{ts}{suffix}"));

    std::fs::write(&tmp_path, &payload.data)?;

    // Rust 没有 finally，用「先执行再清理」模式：无论上传成功或失败都删除临时文件
    let result = upload_from_path(&tmp_path.to_string_lossy(), prefs).await;
    let _ = std::fs::remove_file(&tmp_path);
    result
}

// ─── PicGo 上传 ──────────────────────────────────────────

/// 通过 PicGo CLI 上传图片，解析输出提取 URL。
async fn upload_by_picgo(local_path: &str) -> AppResult<String> {
    let cmd = resolve_picgo_binary()
        .ok_or_else(|| AppError::Other("PicGo command not found in PATH".into()))?;

    let output = tokio::process::Command::new(&cmd)
        .args(["u", local_path])
        .output()
        .await
        .map_err(|e| AppError::Other(format!("spawn picgo: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!(
            "PicGo failed (exit {:?}): {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    // 合并 stdout + stderr（picgo 可能将结果输出到 stderr）
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = if stderr.is_empty() {
        stdout.into_owned()
    } else {
        format!("{stdout}\n{stderr}")
    };

    match parse_picgo_output(&text) {
        Some(url) => Ok(url),
        None => {
            let preview: String = text.chars().take(400).collect();
            Err(AppError::Other(format!(
                "PicGo upload error: cannot parse output\n{preview}"
            )))
        }
    }
}

/// 在 PATH 中查找 picgo 可执行文件。
/// `which` 自动处理 Windows PATHEXT（.exe/.cmd/.bat）。
fn resolve_picgo_binary() -> Option<PathBuf> {
    which::which("picgo").ok()
}

// ─── CLI 脚本上传 ────────────────────────────────────────

/// 通过用户自定义 CLI 脚本上传，stdout trim 后即为 URL。
async fn upload_by_cli(cli_script: &str, local_path: &str) -> AppResult<String> {
    let output = tokio::process::Command::new(cli_script)
        .arg(local_path)
        .output()
        .await
        .map_err(|e| AppError::Other(format!("spawn cli script '{cli_script}': {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!(
            "CLI script failed (exit {:?}): {}",
            output.status.code(),
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

// ─── PicGo 输出解析（三级回退）──────────────────────────

/// 解析 PicGo CLI 输出提取上传后的 URL。
///
/// 三级回退（对齐 uploader.ts:50-88 `parsePicgoOutput`）：
/// 1. 逐行扫描 JSON 对象，检查 `success/imgUrl/url/result` 字段
/// 2. 关键词匹配 `success|succeeded|uploaded :?\s* URL`
/// 3. `[PicGo SUCCESS]:` 标记后的 URL
fn parse_picgo_output(text: &str) -> Option<String> {
    let cleaned = strip_ansi_sgr(text);

    // Phase 1: 逐行扫描
    for line in cleaned.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 1a. JSON 对象/数组行
        if (line.starts_with('{') && line.ends_with('}'))
            || (line.starts_with('[') && line.ends_with(']'))
        {
            if let Ok(obj) = serde_json::from_str::<Value>(line) {
                if obj.get("success").and_then(|v| v.as_bool()) == Some(true) {
                    // imgUrl 字段
                    if let Some(url) = obj.get("imgUrl").and_then(|v| v.as_str()) {
                        return Some(url.to_string());
                    }
                    // result 数组取最后一个元素
                    if let Some(arr) = obj.get("result").and_then(|v| v.as_array()) {
                        if let Some(last) = arr.last() {
                            if let Some(s) = last.as_str() {
                                return Some(s.to_string());
                            }
                            return Some(last.to_string());
                        }
                    }
                    // url 字段
                    if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
                        return Some(url.to_string());
                    }
                }
            }
        }

        // 1b. 关键词 + URL 匹配
        if let Some(url) = find_url_after_keyword(line) {
            return Some(url);
        }
    }

    // Phase 2: [PicGo SUCCESS]: 标记
    let marker = "[PicGo SUCCESS]:";
    if let Some(idx) = cleaned.rfind(marker) {
        let rest = cleaned[idx + marker.len()..].trim();
        if rest.starts_with("http://") || rest.starts_with("https://") {
            let url: String = rest.chars().take_while(|c| !c.is_whitespace()).collect();
            return Some(url);
        }
    }

    None
}

/// 在行中查找关键词（success/succeeded/uploaded）后的 URL。
///
/// 等价于 uploader.ts:76 的正则
/// `/(?:success|succeeded|uploaded)\s*:?\s*(https?:\/\/\S+)/i`。
///
/// 长关键词优先遍历，避免 `"success"` 命中 `"succeeded"` 的前缀导致漏匹配。
fn find_url_after_keyword(line: &str) -> Option<String> {
    let lower = line.to_lowercase();
    for keyword in ["succeeded", "uploaded", "success"] {
        let mut start = 0;
        while let Some(rel) = lower[start..].find(keyword) {
            let idx = start + rel;
            let after = &line[idx + keyword.len()..];
            // \s*:?\s* — 跳过空白，可选冒号，再跳过空白
            let rest = after.trim_start();
            let rest = rest.strip_prefix(':').unwrap_or(rest).trim_start();
            if rest.starts_with("http://") || rest.starts_with("https://") {
                let url: String = rest.chars().take_while(|c| !c.is_whitespace()).collect();
                return Some(url);
            }
            start = idx + keyword.len();
        }
    }
    None
}

/// 去除 ANSI SGR 颜色码（`\x1b[...m`），对齐 uploader.ts:48 的 `ANSI_SGR_RE`。
///
/// 精确匹配 `ESC [ [0-9;]* m`：扫描字符流，命中完整 SGR 序列则跳过，
/// 否则保留原始字符（包括非 SGR 的 ESC 序列）。
fn strip_ansi_sgr(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut result = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        // 尝试匹配 ESC [ [0-9;]* m
        if chars[i] == '\u{1b}' && i + 1 < chars.len() && chars[i + 1] == '[' {
            let mut j = i + 2;
            while j < chars.len() && (chars[j].is_ascii_digit() || chars[j] == ';') {
                j += 1;
            }
            if j < chars.len() && chars[j] == 'm' {
                i = j + 1; // 跳过整个 SGR 序列
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// 判断路径是否为图片文件（仅检查扩展名，不验证文件存在性）。
fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

// ─── 单元测试 ─────────────────────────────────────────────
//
// 不覆盖 upload_by_picgo / upload_by_cli / resolve_picgo_binary：
// 它们依赖外部进程（PicGo CLI）和 PATH，超出单元测试范围。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_sgr_removes_color_codes() {
        let input = "\u{1b}[31mred\u{1b}[0m";
        assert_eq!(strip_ansi_sgr(input), "red");
    }

    #[test]
    fn strip_ansi_sgr_handles_multiple_sgr_sequences() {
        let input = "\u{1b}[1;32mOK\u{1b}[0m \u{1b}[33mwarn\u{1b}[0m";
        assert_eq!(strip_ansi_sgr(input), "OK warn");
    }

    #[test]
    fn strip_ansi_sgr_leaves_plain_text_unchanged() {
        let input = "no escape sequences here";
        assert_eq!(strip_ansi_sgr(input), input);
    }

    #[test]
    fn strip_ansi_sgr_preserves_non_sgr_escape_sequences() {
        // 非 SGR 的 ESC 序列（如光标移动 ESC [ H）应保留，仅剥离 SGR (ESC [ ... m)
        let input = "x\u{1b}[Hy";
        assert_eq!(strip_ansi_sgr(input), "x\u{1b}[Hy");
    }

    #[test]
    fn strip_ansi_sgr_handles_empty_input() {
        assert_eq!(strip_ansi_sgr(""), "");
    }

    #[test]
    fn find_url_after_keyword_matches_success_prefix() {
        let line = "upload success: https://example.com/img.png";
        assert_eq!(
            find_url_after_keyword(line),
            Some("https://example.com/img.png".to_string())
        );
    }

    #[test]
    fn find_url_after_keyword_matches_without_colon() {
        let line = "succeeded https://cdn.example.org/a.jpg";
        assert_eq!(
            find_url_after_keyword(line),
            Some("https://cdn.example.org/a.jpg".to_string())
        );
    }

    #[test]
    fn find_url_after_keyword_case_insensitive() {
        // to_lowercase 后 "SUCCESS" 仍能匹配关键词 "success"
        let line = "upload SUCCESS: http://x.io/y.webp trailing";
        assert_eq!(
            find_url_after_keyword(line),
            Some("http://x.io/y.webp".to_string())
        );
    }

    #[test]
    fn find_url_after_keyword_returns_none_when_no_url() {
        assert_eq!(find_url_after_keyword("no url here"), None);
    }

    #[test]
    fn find_url_after_keyword_returns_none_when_no_keyword() {
        assert_eq!(
            find_url_after_keyword("https://example.com/no-keyword"),
            None
        );
    }

    #[test]
    fn parse_picgo_output_extracts_url_from_json_imgurl() {
        let text = r#"{"success":true,"imgUrl":"https://example.com/x.png"}"#;
        assert_eq!(
            parse_picgo_output(text),
            Some("https://example.com/x.png".to_string())
        );
    }

    #[test]
    fn parse_picgo_output_extracts_url_from_json_result_array() {
        let text = r#"{"success":true,"result":["https://example.com/a.png","https://example.com/b.png"]}"#;
        assert_eq!(
            parse_picgo_output(text),
            Some("https://example.com/b.png".to_string())
        );
    }

    #[test]
    fn parse_picgo_output_ignores_json_with_success_false() {
        let text = r#"{"success":false,"imgUrl":"https://example.com/x.png"}"#;
        assert!(parse_picgo_output(text).is_none());
    }

    #[test]
    fn parse_picgo_output_extracts_url_from_picgo_success_marker() {
        let text = "[PicGo SUCCESS]: https://example.com/marker.png";
        assert_eq!(
            parse_picgo_output(text),
            Some("https://example.com/marker.png".to_string())
        );
    }

    #[test]
    fn parse_picgo_output_extracts_url_from_keyword_line() {
        let text = "upload succeeded: https://example.com/kw.jpg";
        assert_eq!(
            parse_picgo_output(text),
            Some("https://example.com/kw.jpg".to_string())
        );
    }

    #[test]
    fn parse_picgo_output_strips_ansi_before_parsing() {
        let text = "\u{1b}[32m[PicGo SUCCESS]:\u{1b}[0m https://example.com/ansi.png";
        assert_eq!(
            parse_picgo_output(text),
            Some("https://example.com/ansi.png".to_string())
        );
    }

    #[test]
    fn parse_picgo_output_returns_none_for_unparseable_output() {
        assert!(parse_picgo_output("random noise without url").is_none());
        assert!(parse_picgo_output("").is_none());
    }

    #[test]
    fn parse_picgo_output_uses_last_picgo_success_marker() {
        // rfind 找最后一个 marker，确保多次上传场景下取最新 URL
        let text = "[PicGo SUCCESS]: https://old.com/1.png\n[PicGo SUCCESS]: https://new.com/2.png";
        assert_eq!(
            parse_picgo_output(text),
            Some("https://new.com/2.png".to_string())
        );
    }

    #[test]
    fn is_image_file_true_for_common_image_extensions() {
        assert!(is_image_file(Path::new("a.png")));
        assert!(is_image_file(Path::new("a.JPG")));
        assert!(is_image_file(Path::new("/path/to/photo.JPEG")));
        assert!(is_image_file(Path::new("x.webp")));
        assert!(is_image_file(Path::new("x.svg")));
    }

    #[test]
    fn is_image_file_false_for_non_image_extensions() {
        assert!(!is_image_file(Path::new("a.txt")));
        assert!(!is_image_file(Path::new("a.md")));
        assert!(!is_image_file(Path::new("a.pdf")));
    }

    #[test]
    fn is_image_file_false_for_no_extension() {
        assert!(!is_image_file(Path::new("noext")));
        assert!(!is_image_file(Path::new("/dir/")));
    }
}

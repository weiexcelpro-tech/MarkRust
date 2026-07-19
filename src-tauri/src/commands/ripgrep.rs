//! ripgrep 搜索命令，流式输出结果。
//!
//! 对应原 Electron 版本的 `mt::rg::start` / `mt::rg::cancel`。
//!
//! 与原版 Electron (ripgrep.ts) 完全对齐：
//! - 请求结构：{ searchId, mode, directories, pattern, options }
//! - 事件名：rg_match / rg_progress / rg_done / rg_error / rg_cancelled
//! - payload 信封：{ searchId, payload?, num?, error? }
//!
//! 支持两种模式：
//! - text: `rg --json --line-number` 搜索文本内容，结果按文件聚合
//! - files: `rg --files` 列出匹配文件路径

use std::collections::HashMap;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, WebviewWindow};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, OnceCell};
use tokio::task::JoinHandle;

use crate::error::{AppError, AppResult};

// ─── Request Types ───────────────────────────────────────────────────

/// 搜索选项，与原版 Electron SearchOptions 对齐。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgOptions {
    pub is_regexp: Option<bool>,
    pub is_case_sensitive: Option<bool>,
    pub is_whole_word: Option<bool>,
    pub follow_symlinks: Option<bool>,
    /// rg `--max-filesize` 参数，支持数字（字节数）或字符串（如 "10M"）。
    pub max_file_size: Option<serde_json::Value>,
    pub include_hidden: Option<bool>,
    pub no_ignore: Option<bool>,
    pub leading_context_line_count: Option<usize>,
    pub trailing_context_line_count: Option<usize>,
    pub inclusions: Option<Vec<String>>,
    pub exclusions: Option<Vec<String>>,
}

/// 搜索请求，与原版 Electron RipgrepRequest 对齐。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgRequest {
    pub search_id: String,
    pub mode: String,
    pub directories: Vec<String>,
    pub pattern: String,
    pub options: RgOptions,
}

// ─── Response Types ───────────────────────────────────────────────────

/// 事件推送信封，与前端 RipgrepPayloadEnvelope 对齐。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RgEnvelope {
    search_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// 单个匹配结果，与原版 RgMatch 对齐。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RgMatch {
    match_text: String,
    line_text: String,
    range: [[usize; 2]; 2],
    leading_context_lines: Vec<String>,
    trailing_context_lines: Vec<String>,
}

/// 按文件聚合的匹配集合（text 模式），与原版 match payload 对齐。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileMatches {
    file_path: String,
    matches: Vec<RgMatch>,
}

// ─── Task Management ─────────────────────────────────────────────────

/// 搜索任务句柄。`child` 用 Arc<Mutex<Option<_>>> 包装以支持从 cancel 端杀进程。
struct RgTask {
    child: std::sync::Arc<Mutex<Option<tokio::process::Child>>>,
    handle: JoinHandle<()>,
}

static RG_TASKS: OnceCell<Mutex<HashMap<String, RgTask>>> = OnceCell::const_new();

async fn rg_tasks_map() -> &'static Mutex<HashMap<String, RgTask>> {
    RG_TASKS
        .get_or_init(|| async { Mutex::new(HashMap::new()) })
        .await
}

// ─── Command: rg_start ────────────────────────────────────────────────

/// 启动 ripgrep 搜索。结果通过事件流式推送。
#[tauri::command]
pub async fn rg_start(req: RgRequest, window: WebviewWindow) -> AppResult<String> {
    let rg_path = which::which("rg")
        .map_err(|_| AppError::Ripgrep("ripgrep not found in PATH".into()))?;

    let search_id = req.search_id.clone();
    let mode = req.mode.clone();
    let args = build_args(&req);

    let mut child = Command::new(&rg_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Ripgrep(format!("failed to spawn rg: {e}")))?;

    let stdout = child.stdout.take().ok_or_else(|| {
        AppError::Ripgrep("rg stdout not captured".into())
    })?;

    // stderr: 首行错误通过 rg_error 事件推送，其余仅日志
    if let Some(stderr) = child.stderr.take() {
        let sid = search_id.clone();
        let win = window.clone();
        let mut stderr_reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            let mut first = true;
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                log::warn!("rg stderr: {line}");
                if first {
                    first = false;
                    let _ = win.emit("rg_error", RgEnvelope {
                        search_id: sid.clone(),
                        payload: None,
                        num: None,
                        error: Some(line),
                    });
                }
            }
        });
    }

    let child_arc = std::sync::Arc::new(Mutex::new(Some(child)));
    let child_for_cleanup = child_arc.clone();
    let win = window.clone();
    let sid = search_id.clone();

    let handle = tokio::spawn(async move {
        if mode == "files" {
            run_files_mode(stdout, &win, &sid).await;
        } else {
            run_text_mode(stdout, &win, &sid).await;
        }

        // 回收子进程，避免 Windows 句柄泄漏 / Unix 僵尸进程
        if let Some(mut child) = child_for_cleanup.lock().await.take() {
            let _ = child.wait().await;
        }

        let _ = win.emit("rg_done", RgEnvelope {
            search_id: sid,
            payload: None,
            num: None,
            error: None,
        });
    });

    let task = RgTask {
        child: child_arc,
        handle,
    };
    rg_tasks_map()
        .await
        .lock()
        .await
        .insert(search_id.clone(), task);

    Ok(search_id)
}

// ─── Command: rg_cancel ───────────────────────────────────────────────

/// 取消搜索。杀子进程 + abort 读取任务 + 推送 rg_cancelled 事件。
#[tauri::command]
pub async fn rg_cancel(search_id: String, window: WebviewWindow) -> AppResult<()> {
    let map = rg_tasks_map().await;
    let task = map.lock().await.remove(&search_id);
    if let Some(task) = task {
        if let Some(mut child) = task.child.lock().await.take() {
            let _ = child.start_kill();
        }
        task.handle.abort();
        let _ = window.emit("rg_cancelled", RgEnvelope {
            search_id,
            payload: None,
            num: None,
            error: None,
        });
    }
    Ok(())
}

// ─── Mode Runners ─────────────────────────────────────────────────────

/// text 模式：解析 rg `--json` 输出，按文件聚合匹配结果。
async fn run_text_mode(
    stdout: tokio::process::ChildStdout,
    win: &WebviewWindow,
    search_id: &str,
) {
    let mut reader = BufReader::new(stdout).lines();
    let mut current_file = String::new();
    let mut current_matches: Vec<RgMatch> = Vec::new();
    let mut pending_count = 0usize;

    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    let msg_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");

                    match msg_type {
                        "begin" => {
                            // 新文件的匹配开始
                            current_file = json
                                .pointer("/data/path/text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            current_matches.clear();
                        }
                        "match" => {
                            if let Some(m) = parse_rg_match(&json) {
                                current_matches.push(m);
                            }
                        }
                        "end" => {
                            // 文件匹配结束，推送聚合结果
                            if !current_file.is_empty() && !current_matches.is_empty() {
                                let payload = FileMatches {
                                    file_path: current_file.clone(),
                                    matches: std::mem::take(&mut current_matches),
                                };
                                let _ = win.emit("rg_match", RgEnvelope {
                                    search_id: search_id.to_string(),
                                    payload: Some(serde_json::to_value(&payload).unwrap_or_default()),
                                    num: None,
                                    error: None,
                                });
                            }
                            pending_count += 1;
                            let _ = win.emit("rg_progress", RgEnvelope {
                                search_id: search_id.to_string(),
                                payload: None,
                                num: Some(pending_count),
                                error: None,
                            });
                        }
                        _ => {}
                    }
                }
            }
            _ => break,
        }
    }
}

/// files 模式：读取 rg `--files` 输出，逐行推送文件路径。
async fn run_files_mode(
    stdout: tokio::process::ChildStdout,
    win: &WebviewWindow,
    search_id: &str,
) {
    let mut reader = BufReader::new(stdout).lines();
    let mut count = 0usize;

    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                let path = line.trim().to_string();
                if path.is_empty() { continue; }

                count += 1;
                let _ = win.emit("rg_match", RgEnvelope {
                    search_id: search_id.to_string(),
                    payload: Some(serde_json::Value::String(path)),
                    num: None,
                    error: None,
                });
                let _ = win.emit("rg_progress", RgEnvelope {
                    search_id: search_id.to_string(),
                    payload: None,
                    num: Some(count),
                    error: None,
                });

                // 原版行为：超过 100 个文件路径时自动取消
                if count >= 100 {
                    break;
                }
            }
            _ => break,
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/// 从 rg `--json` 的 match 消息中提取 RgMatch。
fn parse_rg_match(json: &serde_json::Value) -> Option<RgMatch> {
    let data = json.get("data")?;

    // 行文本（去掉末尾换行）
    let line_text = data
        .pointer("/lines/text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_end_matches('\n')
        .trim_end_matches('\r')
        .to_string();

    // 匹配文本
    let match_text = data
        .pointer("/submatches/0/match/text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 行号（rg --json 的 line_number 是 1-based，前端期望 0-based）
    let line_number = data
        .get("line_number")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as usize;
    let row = line_number.saturating_sub(1);

    // 列偏移（byte offset in line）
    let submatches = data.pointer("/submatches").and_then(|v| v.as_array());
    let (start_col, end_col) = if let Some(subs) = submatches {
        if let Some(first) = subs.first() {
            let s = first.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let e = first.get("end").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            (s, e)
        } else {
            (0, match_text.len())
        }
    } else {
        (0, match_text.len())
    };

    Some(RgMatch {
        match_text,
        line_text,
        range: [[row, start_col], [row, end_col]],
        leading_context_lines: Vec::new(),
        trailing_context_lines: Vec::new(),
    })
}

/// 构建 rg 命令行参数列表。
fn build_args(req: &RgRequest) -> Vec<String> {
    let mut args = Vec::new();

    if req.mode == "files" {
        args.push("--files".into());
    } else {
        args.push("--json".into());
        args.push("--line-number".into());
    }

    // 大小写敏感
    match req.options.is_case_sensitive {
        Some(true) => args.push("--case-sensitive".into()),
        _ => args.push("--ignore-case".into()),
    }

    // 全词匹配（仅 text 模式）
    if req.mode != "files" && req.options.is_whole_word == Some(true) {
        args.push("--word-regexp".into());
    }

    // 正则 vs 固定字符串（仅 text 模式）
    if req.mode != "files" && req.options.is_regexp != Some(true) {
        args.push("--fixed-strings".into());
    }

    // 跟随符号链接
    if req.options.follow_symlinks == Some(true) {
        args.push("--follow".into());
    }

    // 最大文件大小
    if let Some(v) = &req.options.max_file_size {
        args.push("--max-filesize".into());
        match v {
            serde_json::Value::Number(n) => args.push(n.to_string()),
            serde_json::Value::String(s) => args.push(s.clone()),
            _ => {}
        }
    }

    // 包含隐藏文件
    if req.options.include_hidden == Some(true) {
        args.push("--hidden".into());
    }

    // 忽略 .gitignore
    if req.options.no_ignore == Some(true) {
        args.push("--no-ignore".into());
    }

    // 上下文行数（仅 text 模式）
    if req.mode != "files" {
        if let Some(n) = req.options.leading_context_line_count {
            args.push("--before-context".into());
            args.push(n.to_string());
        }
        if let Some(n) = req.options.trailing_context_line_count {
            args.push("--after-context".into());
            args.push(n.to_string());
        }
    }

    // 包含 glob 模式
    if let Some(globs) = &req.options.inclusions {
        for g in globs {
            args.push("--iglob".into());
            args.push(g.clone());
        }
    }

    // 排除 glob 模式
    if let Some(globs) = &req.options.exclusions {
        for g in globs {
            args.push("--iglob".into());
            args.push(format!("!{g}"));
        }
    }

    // 搜索模式和路径
    if req.mode != "files" {
        args.push("--".into());
        args.push(req.pattern.clone());
    }

    for dir in &req.directories {
        args.push(dir.clone());
    }

    args
}

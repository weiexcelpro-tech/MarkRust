//! 导出命令模块：DOCX 导出 + 图片 base64 内嵌 + 图片自动缩放。
//!
//! v2.0 新增特性（对应 PRD F1/F2/F3）：
//! - F1: export_docx          — Markdown → DOCX（Rust 后端生成，docx-rs 0.4）
//! - F2: resize_if_needed     — 图片自动缩放（auto 模式下超宽图等比缩小至 PNG）
//! - F3: image_to_data_uri    — 单张图片读取 → base64 data URI
//!        images_to_data_uris — 批量转换（并行，含可选缩放）

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use base64::Engine;
use image::ImageFormat;
use pulldown_cmark::{Options, Parser, Event, Tag, TagEnd, HeadingLevel, CodeBlockKind};
use serde::{Deserialize, Serialize};


use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

/// 前端调用 export_docx 时的请求参数。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocxRequest {
    /// Markdown 源码
    pub markdown: String,
    /// 当前文件路径（解析相对图片路径的基准目录）
    pub pathname: String,
    /// 是否内嵌图片到 DOCX（默认 true）
    #[serde(default = "default_true")]
    pub image_embed: bool,
    /// 图片缩放模式："original" | "auto"
    #[serde(default = "default_image_resize")]
    pub image_resize: String,
    /// 自动缩放最大宽度（px），默认 1024
    #[serde(default = "default_image_max_width")]
    pub image_max_width: u32,
    /// 页面尺寸："A4" | "Letter"
    #[serde(default = "default_page_size")]
    pub page_size: String,
    /// 页边距："normal" | "narrow" | "wide"
    #[serde(default = "default_page_margin")]
    pub page_margin: String,
    /// 自定义字体族（None = 使用默认 Calibri/宋体）
    #[serde(default)]
    pub font_family: Option<String>,
    /// 自定义字号（pt），默认 11pt
    #[serde(default = "default_font_size")]
    pub font_size: f32,
    /// 自定义行高倍数，默认 1.5
    #[serde(default = "default_line_height")]
    pub line_height: f32,
}

fn default_font_size() -> f32 { 11.0 }
fn default_line_height() -> f32 { 1.5 }

fn default_true() -> bool { true }
fn default_image_resize() -> String { "auto".to_string() }
fn default_image_max_width() -> u32 { 1024 }
fn default_page_size() -> String { "A4".to_string() }
fn default_page_margin() -> String { "normal".to_string() }

/// export_docx 返回结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub size: u64,
    pub image_count: u32,
    pub warnings: Vec<String>,
}

/// 单张图片转换请求（用于 image_to_data_uri / images_to_data_uris）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSrcRequest {
    pub src: String,
    pub base_dir: String,
    /// 可选缩放参数
    pub resize: Option<ImageResizeOptions>,
}

/// 图片缩放选项。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageResizeOptions {
    /// "original" | "auto"
    pub mode: String,
    /// 最大宽度（px），默认 1024
    #[serde(default = "default_image_max_width")]
    pub max_width: u32,
}

/// 单张图片转换结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSrcResult {
    pub original_src: String,
    pub data_uri: Option<String>,
    pub original_width: Option<u32>,
    pub resized_width: Option<u32>,
    pub original_size: Option<u64>,
    pub final_size: Option<u64>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// F2: 图片自动缩放
// ---------------------------------------------------------------------------

/// 等比缩放（仅在宽度超过阈值时触发）。
/// 缩放后统一输出为 PNG（决策 D-4：避免 JPEG 二次压缩，简化逻辑）。
/// SVG 不做缩放（返回原始字节）。
pub fn resize_if_needed(bytes: &[u8], max_width: u32, mime: &str) -> AppResult<Vec<u8>> {
    // SVG 不做缩放
    if mime == "image/svg+xml" {
        return Ok(bytes.to_vec());
    }

    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::Other(format!("图片解码失败: {}", e)))?;
    let (w, h) = (img.width(), img.height());

    if w <= max_width {
        return Ok(bytes.to_vec()); // 不需要缩放
    }

    let ratio = max_width as f32 / w as f32;
    let new_h = (h as f32 * ratio) as u32;
    let resized = img.resize_exact(max_width, new_h, image::imageops::FilterType::Lanczos3);

    // 统一编码为 PNG
    let mut buf = Vec::new();
    resized.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| AppError::Other(format!("PNG 编码失败: {}", e)))?;
    Ok(buf)
}

// ---------------------------------------------------------------------------
// 图片 MIME 识别
// ---------------------------------------------------------------------------

/// 基于扩展名 + magic bytes 兜底检测图片 MIME。
pub fn detect_mime(bytes: &[u8], path: &Path) -> String {
    // 扩展名优先
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        match ext.to_lowercase().as_str() {
            "png" => return "image/png".to_string(),
            "jpg" | "jpeg" => return "image/jpeg".to_string(),
            "gif" => return "image/gif".to_string(),
            "svg" => return "image/svg+xml".to_string(),
            "webp" => return "image/webp".to_string(),
            "bmp" => return "image/bmp".to_string(),
            "ico" => return "image/x-icon".to_string(),
            "tiff" | "tif" => return "image/tiff".to_string(),
            _ => {}
        }
    }

    // Magic bytes 兜底
    if bytes.len() >= 8 {
        if bytes[0..4] == [0x89, 0x50, 0x4E, 0x47] { return "image/png".to_string(); }
        if bytes[0..2] == [0xFF, 0xD8] { return "image/jpeg".to_string(); }
        if bytes[0..4] == [0x47, 0x49, 0x46, 0x38] { return "image/gif".to_string(); }
        if bytes[0..4] == [0x52, 0x49, 0x46, 0x46] && bytes.len() >= 12 && bytes[8..12] == [0x57, 0x45, 0x42, 0x50] {
            return "image/webp".to_string();
        }
    }
    // SVG 检测（文本开头）
    if bytes.len() > 4 && (bytes.starts_with(b"<?xml") || bytes.starts_with(b"<svg")) {
        return "image/svg+xml".to_string();
    }

    "application/octet-stream".to_string()
}

// ---------------------------------------------------------------------------
// 图片路径解析
// ---------------------------------------------------------------------------

/// Minimal percent-decode for Tauri asset-protocol URLs.
/// Handles `%XX` sequences (hex digits) and leaves everything else as-is.
fn percent_decode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hi = chars.next();
            let lo = chars.next();
            if let (Some(h), Some(l)) = (hi, lo) {
                let hex = String::from_iter([h, l]);
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte as char);
                    continue;
                }
            }
            // Not valid hex after '%' — emit the raw characters
            result.push('%');
            if let Some(h) = hi { result.push(h); }
            if let Some(l) = lo { result.push(l); }
        } else {
            result.push(c);
        }
    }
    result
}

/// 解析图片 src 为绝对路径。
pub fn resolve_image_path(src: &str, base_dir: &str) -> Option<PathBuf> {
    // data: URI — 不解析为文件路径
    if src.starts_with("data:") {
        return None;
    }
    // 远程 URL — 不解析为文件路径
    if src.starts_with("http://") || src.starts_with("https://") {
        return None;
    }
    // asset://localhost/ URL — Tauri asset protocol (percent-decode the path)
    if let Some(rest) = src.strip_prefix("asset://localhost/") {
        let decoded = percent_decode(rest);
        let path = Path::new(&decoded);
        if path.is_absolute() {
            return Some(path.to_path_buf());
        }
        // Relative path under base_dir
        let base = Path::new(base_dir);
        return if base.is_dir() {
            Some(base.join(path))
        } else {
            base.parent().map(|p| p.join(path))
        };
    }
    // file:// URL — 去掉协议前缀
    let cleaned = src.trim_start_matches("file://")
        .trim_start_matches("//");
    let path = Path::new(cleaned);

    if path.is_absolute() {
        Some(path.to_path_buf())
    } else {
        // 相对路径：基于 base_dir 解析
        let base = Path::new(base_dir);
        if base.is_dir() {
            Some(base.join(path))
        } else {
            // base_dir 可能是文件路径，取其父目录
            base.parent().map(|p| p.join(path))
        }
    }
}

/// 读取本地图片文件为字节。
fn read_local_image(src: &str, base_dir: &str) -> AppResult<(Vec<u8>, PathBuf)> {
    let path = resolve_image_path(src, base_dir)
        .ok_or_else(|| AppError::Other(format!("不支持的图片路径格式: {}", src)))?;

    if !path.exists() {
        return Err(AppError::PathNotFound(path.to_string_lossy().to_string()));
    }

    let bytes = fs::read(&path)?;
    Ok((bytes, path))
}

/// 解码 data URI 中的图片字节。
fn decode_data_uri(src: &str) -> AppResult<(Vec<u8>, String)> {
    // data:image/png;base64,xxxxx
    if !src.starts_with("data:") {
        return Err(AppError::Other("不是 data URI".to_string()));
    }
    let rest = &src[5..]; // 去掉 "data:"
    let semi = rest.find(';').ok_or_else(|| AppError::Other("data URI 格式错误: 缺少 ';'".to_string()))?;
    let mime = &rest[..semi];
    let after_semi = &rest[semi + 1..];
    let comma = after_semi.find(',').ok_or_else(|| AppError::Other("data URI 格式错误: 缺少 ','".to_string()))?;
    let encoding = &after_semi[..comma];
    let data = &after_semi[comma + 1..];

    if encoding != "base64" {
        return Err(AppError::Other(format!("不支持的 data URI 编码: {}", encoding)));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| AppError::Other(format!("base64 解码失败: {}", e)))?;
    Ok((bytes, mime.to_string()))
}

// ---------------------------------------------------------------------------
// F3: image_to_data_uri 命令
// ---------------------------------------------------------------------------

/// 将本地图片文件读取为 base64 data URI（含可选缩放）。
#[tauri::command]
pub async fn image_to_data_uri(
    src: String,
    base_dir: String,
    resize: Option<ImageResizeOptions>,
) -> Result<ImageSrcResult, AppError> {
    // 1. 判断是 data URI 还是本地文件
    let (raw_bytes, _path, original_mime) = if src.starts_with("data:") {
        let (bytes, mime) = decode_data_uri(&src)?;
        (bytes, PathBuf::new(), mime)
    } else if src.starts_with("http://") || src.starts_with("https://") {
        // 远程 URL：使用 reqwest 下载
        let resp = reqwest::get(&src).await
            .map_err(|e| AppError::Other(format!("下载远程图片失败: {}", e)))?;
        if !resp.status().is_success() {
            return Ok(ImageSrcResult {
                original_src: src,
                data_uri: None,
                original_width: None,
                resized_width: None,
                original_size: None,
                final_size: None,
                error: Some(format!("HTTP {}", resp.status())),
            });
        }
        let bytes = resp.bytes().await
            .map_err(|e| AppError::Other(format!("读取远程图片失败: {}", e)))?;
        let mime = detect_mime(&bytes, Path::new(&src));
        (bytes.to_vec(), PathBuf::new(), mime)
    } else {
        match read_local_image(&src, &base_dir) {
            Ok((bytes, path)) => {
                let mime = detect_mime(&bytes, &path);
                (bytes, path, mime)
            }
            Err(e) => {
                return Ok(ImageSrcResult {
                    original_src: src,
                    data_uri: None,
                    original_width: None,
                    resized_width: None,
                    original_size: None,
                    final_size: None,
                    error: Some(e.to_string()),
                });
            }
        }
    };

    let original_size = raw_bytes.len() as u64;

    // 2. 获取原始尺寸
    let original_width = if original_mime == "image/svg+xml" {
        None
    } else {
        image::load_from_memory(&raw_bytes).ok().map(|img| img.width())
    };

    // 3. 可选缩放
    let (final_bytes, resized_width) = if let Some(opts) = &resize {
        if opts.mode == "auto" && original_mime != "image/svg+xml" {
            if let Some(w) = original_width {
                if w > opts.max_width {
                    match resize_if_needed(&raw_bytes, opts.max_width, &original_mime) {
                        Ok(resized) => {
                            let new_w = image::load_from_memory(&resized).ok().map(|img| img.width());
                            (resized, new_w)
                        }
                        Err(e) => {
                            log::warn!("图片缩放失败: {}", e);
                            (raw_bytes.clone(), original_width)
                        }
                    }
                } else {
                    (raw_bytes.clone(), original_width)
                }
            } else {
                (raw_bytes.clone(), original_width)
            }
        } else {
            (raw_bytes.clone(), original_width)
        }
    } else {
        (raw_bytes.clone(), original_width)
    };

    let final_size = final_bytes.len() as u64;

    // 4. base64 编码
    let encoded = base64::engine::general_purpose::STANDARD.encode(&final_bytes);
    let data_uri = format!("data:{};base64,{}", original_mime, encoded);

    Ok(ImageSrcResult {
        original_src: src,
        data_uri: Some(data_uri),
        original_width,
        resized_width,
        original_size: Some(original_size),
        final_size: Some(final_size),
        error: None,
    })
}

// ---------------------------------------------------------------------------
// F3: images_to_data_uris 命令（批量并行）
// ---------------------------------------------------------------------------

/// 批量转换图片为 base64 data URI（并行，含可选缩放）。
#[tauri::command]
pub async fn images_to_data_uris(
    sources: Vec<ImageSrcRequest>,
) -> Result<Vec<ImageSrcResult>, AppError> {
    let mut results = Vec::with_capacity(sources.len());

    // 使用 tokio 并行处理
    let tasks: Vec<_> = sources.into_iter().map(|req| {
        tokio::spawn(async move {
            image_to_data_uri(req.src, req.base_dir, req.resize).await
        })
    }).collect();

    for task in tasks {
        match task.await {
            Ok(Ok(result)) => results.push(result),
            Ok(Err(e)) => results.push(ImageSrcResult {
                original_src: String::new(),
                data_uri: None,
                original_width: None,
                resized_width: None,
                original_size: None,
                final_size: None,
                error: Some(e.to_string()),
            }),
            Err(e) => results.push(ImageSrcResult {
                original_src: String::new(),
                data_uri: None,
                original_width: None,
                resized_width: None,
                original_size: None,
                final_size: None,
                error: Some(format!("任务执行失败: {}", e)),
            }),
        }
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// F1: DOCX 导出核心 — Markdown AST → docx-rs 文档
// ---------------------------------------------------------------------------
//
// docx-rs 0.4.20 API 要点（编译验证）：
// - Style::new(id, StyleType)           双参数
// - Paragraph::add_run(run)             单数，无 add_runs
// - Run::fonts(RunFonts)               替代 Run::font()
// - Run::add_image(Pic)                不是 Image
// - Pic::new_with_dimensions(buf, w, h) 写入图片
// - Docx::build() → XMLDocx            再调 .pack(&mut buf)
// - Table::new(Vec<TableRow>)          单参数
// - TableRow::new(Vec<TableCell>)       单参数
// - TableCell::new()                    无参数，用 .add_paragraph()
//
// pulldown-cmark 0.12 API 要点：
// - Tag::BlockQuote(Option<BlockQuoteKind>)  元组变体
// - Tag::List(Option<u64>)                   元组变体
// - TagEnd::List(bool)                       元组变体
// - Tag::TaskCheckbox / TagEnd::TaskCheckbox  不存在，改用 Event::TaskListMarker(bool)
// - CowStr 用 .to_string() 转换（非 .into()）
// - Tag::CodeBlock(CodeBlockKind)            元组变体
// ---------------------------------------------------------------------------

/// 页边距映射（单位: 英寸）。
fn page_margin_inches(margin: &str) -> (f32, f32, f32, f32) {
    match margin {
        "narrow" => (0.5, 0.5, 0.5, 0.5),
        "wide" => (1.0, 2.0, 1.0, 2.0),
        _ => (1.0, 1.0, 1.0, 1.0), // normal
    }
}

/// 页面尺寸映射（单位: 英寸）。
fn page_size_inches(size: &str) -> (f32, f32) {
    match size {
        "Letter" => (8.5, 11.0),
        _ => (8.27, 11.69), // A4
    }
}

/// 辅助：逐个 add_run 构建 Paragraph（docx-rs 只有 add_run，没有 add_runs）。
/// 可选注入行高 line_spacing（None 时跳过，段落将继承样式定义或默认值）。
fn paragraph_from_runs(
    runs: Vec<docx_rs::Run>,
    line_spacing: Option<&docx_rs::LineSpacing>,
) -> docx_rs::Paragraph {
    let mut p = docx_rs::Paragraph::new();
    for run in runs {
        p = p.add_run(run);
    }
    if let Some(ls) = line_spacing {
        p = p.line_spacing(ls.clone());
    }
    p
}

/// 辅助：段落 + 样式。
fn paragraph_from_runs_with_style(
    runs: Vec<docx_rs::Run>,
    style: &str,
    line_spacing: Option<&docx_rs::LineSpacing>,
) -> docx_rs::Paragraph {
    paragraph_from_runs(runs, line_spacing).style(style)
}

/// 辅助：刷新当前段落到 doc。
fn flush_paragraph(
    doc: docx_rs::Docx,
    runs: &mut Vec<docx_rs::Run>,
    line_spacing: Option<&docx_rs::LineSpacing>,
) -> docx_rs::Docx {
    if !runs.is_empty() {
        let drained: Vec<_> = runs.drain(..).collect();
        let doc = doc.add_paragraph(paragraph_from_runs(drained, line_spacing));
        doc
    } else {
        doc
    }
}

/// 从 Markdown 源码生成 DOCX 字节流。
///
/// 异步函数：为支持远程 URL 图片的 reqwest 异步下载。
pub async fn markdown_to_docx(req: &ExportDocxRequest) -> AppResult<(Vec<u8>, u32, Vec<String>)> {
    use docx_rs::*;

    let mut warnings = Vec::new();
    let mut image_count: u32 = 0;

    // 1. pulldown-cmark 解析 Markdown → AST Events
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(&req.markdown, opts);

    // 2. 页面尺寸
    let (page_w, _page_h) = page_size_inches(&req.page_size);
    let (_margin_top, margin_right, _margin_bottom, margin_left) = page_margin_inches(&req.page_margin);
    let content_width_inches = page_w - margin_left - margin_right;

    // 3. 构建 docx-rs 文档对象 + 默认样式
    let mut doc = Docx::new();

    // 自定义字体设置
    let ascii_font = req.font_family.as_deref().unwrap_or("Calibri");
    let east_asia_font = req.font_family.as_deref().unwrap_or("宋体");
    let normal_size_hp = (req.font_size * 2.0) as usize; // half-points

    // 行高设置：OOXML 中 w:line 值 = 倍数 × 240（240 = 单倍行距）
    // line_rule=Auto 表示倍数行距
    let line_spacing_val = (req.line_height * 240.0) as i32;
    let normal_line_spacing = LineSpacing::new()
        .line_rule(docx_rs::LineSpacingType::Auto)
        .line(line_spacing_val);

    // Normal 样式（Style::new 双参数：id + StyleType）
    doc = doc.add_style(
        Style::new("Normal", StyleType::Paragraph)
            .name("Normal")
            .size(normal_size_hp)
            .fonts(RunFonts::new().ascii(ascii_font).east_asia(east_asia_font))
    );

    // Heading 1–6 样式
    for i in 1..=6 {
        let size = match i {
            1 => 48, // 24pt
            2 => 36, // 18pt
            3 => 28, // 14pt
            4 => 24, // 12pt
            5 => 22, // 11pt
            6 => 20, // 10pt
            _ => 22,
        };
        let id = format!("Heading{}", i);
        doc = doc.add_style(
            Style::new(&id, StyleType::Paragraph)
                .name(&format!("heading {}", i))
                .size(size)
                .bold()
                .fonts(RunFonts::new().ascii(ascii_font).east_asia(east_asia_font))
        );
    }

    // 4. 遍历 AST Events 构建段落
    let mut current_runs: Vec<Run> = Vec::new();
    // 行高引用：所有段落统一注入（None = 默认行高由样式决定）
    let line_spacing_ref: Option<&LineSpacing> = Some(&normal_line_spacing);
    let mut in_code_block = false;
    let mut _code_block_lang: String = String::new();
    let mut code_block_lines: Vec<String> = Vec::new();
    let mut in_table = false;
    let mut table_rows: Vec<Vec<Vec<Run>>> = Vec::new();   // rows → cells → runs
    let mut current_table_row: Vec<Vec<Run>> = Vec::new();  // cells → runs
    let mut current_cell_runs: Vec<Run> = Vec::new();
    let mut in_list_item = false;
    let mut list_is_ordered = false;
    let mut list_counter: usize = 0;

    // 收集 events
    let events: Vec<Event> = parser.collect();

    let mut i = 0;
    while i < events.len() {
        let event = &events[i];
        match event {
            // --- 标题 ---
            Event::Start(Tag::Heading { level: _, .. }) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
            }
            Event::End(TagEnd::Heading(level)) => {
                let heading_num = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                let drained: Vec<_> = current_runs.drain(..).collect();
                doc = doc.add_paragraph(
                    paragraph_from_runs_with_style(drained, &format!("Heading{}", heading_num), line_spacing_ref)
                );
            }

            // --- 段落 ---
            Event::Start(Tag::Paragraph) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
            }
            Event::End(TagEnd::Paragraph) => {
                let drained: Vec<_> = current_runs.drain(..).collect();
                doc = doc.add_paragraph(paragraph_from_runs(drained, line_spacing_ref));
            }

            // --- 文本 ---
            Event::Text(text) => {
                if in_code_block {
                    code_block_lines.push(text.to_string());
                } else if in_table {
                    current_cell_runs.push(Run::new().add_text(text.to_string()));
                } else {
                    current_runs.push(Run::new().add_text(text.to_string()));
                }
            }

            // --- 粗体 ---
            Event::Start(Tag::Strong) => {}
            Event::End(TagEnd::Strong) => {
                if let Some(run) = current_runs.last_mut() {
                    *run = std::mem::take(run).bold();
                }
                // 表格单元格中的粗体
                if in_table {
                    if let Some(run) = current_cell_runs.last_mut() {
                        *run = std::mem::take(run).bold();
                    }
                }
            }

            // --- 斜体 ---
            Event::Start(Tag::Emphasis) => {}
            Event::End(TagEnd::Emphasis) => {
                if let Some(run) = current_runs.last_mut() {
                    *run = std::mem::take(run).italic();
                }
                if in_table {
                    if let Some(run) = current_cell_runs.last_mut() {
                        *run = std::mem::take(run).italic();
                    }
                }
            }

            // --- 删除线 ---
            Event::Start(Tag::Strikethrough) => {}
            Event::End(TagEnd::Strikethrough) => {
                if let Some(run) = current_runs.last_mut() {
                    *run = std::mem::take(run).strike();
                }
                if in_table {
                    if let Some(run) = current_cell_runs.last_mut() {
                        *run = std::mem::take(run).strike();
                    }
                }
            }

            // --- 行内代码 ---
            Event::Code(code_text) => {
                current_runs.push(
                    Run::new().add_text(code_text.to_string())
                        .fonts(RunFonts::new().ascii("Consolas").east_asia("Consolas"))
                        .size(20) // 10pt
                );
            }

            // --- 代码块 ---
            Event::Start(Tag::CodeBlock(kind)) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
                in_code_block = true;
                code_block_lines.clear();
                _code_block_lang = match kind {
                    CodeBlockKind::Fenced(lang) => lang.to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
                let code_text = code_block_lines.join("");
                code_block_lines.clear();
                // 代码块渲染为等宽字体段落
                let run = Run::new()
                    .add_text(&code_text)
                    .fonts(RunFonts::new().ascii("Consolas").east_asia("Consolas"))
                    .size(20);
                doc = doc.add_paragraph(Paragraph::new().add_run(run));
            }

            // --- 列表 ---
            Event::Start(Tag::List(start_num)) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
                list_is_ordered = start_num.is_some();
                list_counter = start_num.unwrap_or(1) as usize;
                if list_counter == 0 { list_counter = 1; }
                in_list_item = false;
            }
            Event::End(TagEnd::List(_is_ordered)) => {
                // flush 最后一个 list item（如有残余内容）
                if in_list_item && !current_runs.is_empty() {
                    let prefix = if list_is_ordered {
                        format!("{}. ", list_counter)
                    } else {
                        "• ".to_string()
                    };
                    let prefix_run = Run::new().add_text(&prefix);
                    let mut all_runs = vec![prefix_run];
                    all_runs.extend(current_runs.drain(..));
                    doc = doc.add_paragraph(paragraph_from_runs(all_runs, line_spacing_ref));
                    list_counter += 1;
                    in_list_item = false;
                }
                list_is_ordered = false;
            }
            Event::Start(Tag::Item) => {
                // 如果之前有 list item 内容，先 flush
                if in_list_item && !current_runs.is_empty() {
                    let prefix = if list_is_ordered {
                        format!("{}. ", list_counter)
                    } else {
                        "• ".to_string()
                    };
                    let prefix_run = Run::new().add_text(&prefix);
                    let mut all_runs = vec![prefix_run];
                    all_runs.extend(current_runs.drain(..));
                    doc = doc.add_paragraph(paragraph_from_runs(all_runs, line_spacing_ref));
                    list_counter += 1;
                }
                in_list_item = true;
            }
            Event::End(TagEnd::Item) => {
                if !current_runs.is_empty() {
                    let prefix = if list_is_ordered {
                        format!("{}. ", list_counter)
                    } else {
                        "• ".to_string()
                    };
                    let prefix_run = Run::new().add_text(&prefix);
                    let mut all_runs = vec![prefix_run];
                    all_runs.extend(current_runs.drain(..));
                    doc = doc.add_paragraph(paragraph_from_runs(all_runs, line_spacing_ref));
                    list_counter += 1;
                }
                in_list_item = false;
            }

            // --- 任务列表 checkbox（pulldown-cmark 0.12 用 Event::TaskListMarker） ---
            Event::TaskListMarker(checked) => {
                let symbol = if *checked { "☑ " } else { "☐ " };
                current_runs.push(Run::new().add_text(symbol));
            }

            // --- 链接 ---
            Event::Start(Tag::Link { dest_url: _, .. }) => {
                // docx-rs 不直接支持超链接 Run，暂存为文本 + 蓝色
                current_runs.push(Run::new().add_text("[").color("0563C1"));
            }
            Event::End(TagEnd::Link) => {
                // 显示 URL
                // 注意：dest_url 在 End 事件中不可直接获取，需在 Start 中暂存
                current_runs.push(Run::new().add_text("]").color("0563C1"));
            }

            // --- 图片 ---
            Event::Start(Tag::Image { dest_url, .. }) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);

                if req.image_embed {
                    let base_dir = if req.pathname.is_empty() {
                        ".".to_string()
                    } else {
                        Path::new(&req.pathname)
                            .parent()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| ".".to_string())
                    };

                    // dest_url 是 &CowStr，转为 String
                    let dest = dest_url.to_string();

                    let img_result = embed_image_to_docx(
                        &dest,
                        &base_dir,
                        &req.image_resize,
                        req.image_max_width,
                        content_width_inches,
                    ).await;

                    match img_result {
                        Ok(Some(paragraph)) => {
                            doc = doc.add_paragraph(paragraph);
                            image_count += 1;
                        }
                        Ok(None) => {
                            doc = doc.add_paragraph(
                                Paragraph::new().add_run(Run::new().add_text(&format!("[图片: {}]", dest)))
                            );
                            warnings.push(format!("图片无法内嵌: {}", dest));
                            image_count += 1;
                        }
                        Err(e) => {
                            warnings.push(format!("图片处理失败: {} - {}", dest, e));
                            doc = doc.add_paragraph(
                                Paragraph::new().add_run(Run::new().add_text(&format!("[图片缺失: {}]", dest)))
                            );
                        }
                    }
                } else {
                    let dest = dest_url.to_string();
                    doc = doc.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_text(&format!("[图片: {}]", dest)))
                    );
                    image_count += 1;
                }
            }
            Event::End(TagEnd::Image) => {
                // 图片已在 Start 中处理
            }

            // --- 引用块（Tag::BlockQuote 是元组变体） ---
            Event::Start(Tag::BlockQuote(_kind)) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
            }
            Event::End(TagEnd::BlockQuote(_kind)) => {
                // flush 引用内容
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
                // TODO: 未来可添加左边框和缩进样式
            }

            // --- 表格 ---
            Event::Start(Tag::Table(_alignment)) => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
                in_table = true;
                table_rows.clear();
                current_table_row.clear();
            }
            Event::End(TagEnd::Table) => {
                in_table = false;
                // 构建 docx-rs 表格
                if !table_rows.is_empty() {
                    let docx_rows: Vec<TableRow> = table_rows.iter().map(|row| {
                        let cells: Vec<TableCell> = row.iter().map(|cell_runs| {
                            let cell_paragraph = paragraph_from_runs(cell_runs.clone(), None);
                            TableCell::new().add_paragraph(cell_paragraph)
                        }).collect();
                        TableRow::new(cells)
                    }).collect();

                    doc = doc.add_table(Table::new(docx_rows));
                }
                table_rows.clear();
                current_table_row.clear();
            }
            Event::Start(Tag::TableHead) => {
                current_cell_runs.clear();
            }
            Event::End(TagEnd::TableHead) => {
                current_table_row.push(current_cell_runs.drain(..).collect());
            }
            Event::Start(Tag::TableRow) => {
                current_cell_runs.clear();
                current_table_row.clear();
            }
            Event::End(TagEnd::TableRow) => {
                table_rows.push(current_table_row.drain(..).collect());
            }
            Event::Start(Tag::TableCell) => {
                current_cell_runs.clear();
            }
            Event::End(TagEnd::TableCell) => {
                current_table_row.push(current_cell_runs.drain(..).collect());
            }

            // --- 水平线 ---
            Event::Rule => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
                doc = doc.add_paragraph(
                    Paragraph::new().add_run(Run::new().add_text("────────────────────────"))
                );
            }

            // --- SoftBreak / HardBreak ---
            Event::SoftBreak => {
                current_runs.push(Run::new().add_text(" "));
            }
            Event::HardBreak => {
                doc = flush_paragraph(doc, &mut current_runs, line_spacing_ref);
            }

            // --- Footnote ---
            Event::Start(Tag::FootnoteDefinition(_label)) => {}
            Event::End(TagEnd::FootnoteDefinition) => {}

            // --- HTML（忽略 Front-matter 等） ---
            Event::Html(_html) => {}

            // --- 忽略未知事件 ---
            _ => {}
        }

        i += 1;
    }

    // flush 残余段落
    if !current_runs.is_empty() {
        let drained: Vec<_> = current_runs.drain(..).collect();
        doc = doc.add_paragraph(paragraph_from_runs(drained, line_spacing_ref));
    }

    // 5. 生成 DOCX 字节流（build → XMLDocx，再 pack → bytes）
    let mut buf = Cursor::new(Vec::<u8>::new());
    doc.build()
        .pack(&mut buf)
        .map_err(|e| AppError::Other(format!("DOCX 生成失败: {}", e)))?;

    let bytes = buf.into_inner();
    Ok((bytes, image_count, warnings))
}

/// 将图片内嵌到 DOCX 段落中。
/// 返回 None 表示无法内嵌（SVG 暂不支持或远程下载失败需进一步处理）。
///
/// **支持的图片来源**（PRD AC-2/AC-31/AC-32 强约束）：
/// - 本地相对路径 / 绝对路径 / `file://` URL
/// - `data:` URI（base64 内联图）
/// - `http(s)` 远程 URL（reqwest 异步下载，失败降级为占位符 + warning）
/// - SVG：docx-rs 不支持 SVG，降级为占位符 + warning
async fn embed_image_to_docx(
    dest_url: &str,
    base_dir: &str,
    resize_mode: &str,
    max_width: u32,
    content_width_inches: f32,
) -> AppResult<Option<docx_rs::Paragraph>> {
    use docx_rs::*;

    // 1. 读取图片字节
    let (raw_bytes, path_for_mime) = if dest_url.starts_with("data:") {
        let (bytes, _) = decode_data_uri(dest_url)?;
        (bytes, PathBuf::from("image.png"))
    } else if dest_url.starts_with("http://") || dest_url.starts_with("https://") {
        // 远程 URL：reqwest 异步下载（PRD AC-11 / AC-32 强约束自包含）
        match reqwest::get(dest_url).await {
            Ok(resp) if resp.status().is_success() => {
                match resp.bytes().await {
                    Ok(bytes) => {
                        // 从 URL 路径提取扩展名用于 MIME 识别
                        let url_path = reqwest::Url::parse(dest_url)
                            .ok()
                            .and_then(|u| u.path_segments()
                                .and_then(|mut segs| segs.next_back().map(String::from)))
                                .unwrap_or_default();
                        (bytes.to_vec(), PathBuf::from(url_path))
                    }
                    Err(e) => {
                        log::warn!("远程图片读取失败: {} - {}", dest_url, e);
                        return Ok(None);
                    }
                }
            }
            Ok(resp) => {
                log::warn!("远程图片 HTTP {}: {}", resp.status(), dest_url);
                return Ok(None);
            }
            Err(e) => {
                log::warn!("远程图片下载失败: {} - {}", dest_url, e);
                return Ok(None);
            }
        }
    } else {
        match read_local_image(dest_url, base_dir) {
            Ok((bytes, path)) => (bytes, path),
            Err(e) => return Err(e),
        }
    };

    // 2. 检测 MIME
    let mime = detect_mime(&raw_bytes, &path_for_mime);

    // 3. SVG 不做内嵌（docx-rs 不支持 SVG），返回 None
    if mime == "image/svg+xml" {
        return Ok(None);
    }

    // 4. 可选缩放 + 确保转为 PNG（docx-rs Pic 最可靠支持 PNG）
    let png_bytes = if resize_mode == "auto" {
        // resize_if_needed 对超宽图缩放并统一输出 PNG
        resize_if_needed(&raw_bytes, max_width, &mime)?
    } else {
        // 即使不缩放，也需确保是 PNG 格式（JPEG → PNG 转换以保证 docx-rs 兼容性）
        if mime == "image/png" {
            raw_bytes
        } else {
            // 非 PNG 格式：解码后重新编码为 PNG
            let img = image::load_from_memory(&raw_bytes)
                .map_err(|e| AppError::Other(format!("图片解码失败: {}", e)))?;
            let mut buf = Vec::new();
            img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
                .map_err(|e| AppError::Other(format!("PNG 编码失败: {}", e)))?;
            buf
        }
    };

    // 5. 获取图片像素尺寸
    let img = image::load_from_memory(&png_bytes)
        .map_err(|e| AppError::Other(format!("PNG 解码失败: {}", e)))?;
    let (img_w, img_h) = (img.width(), img.height());

    // 6. 计算 DOCX 中的显示尺寸（EMU：1 px = 9525 EMU）
    let max_display_width_emu = (content_width_inches * 914400.0) as u32;
    let img_width_emu = (img_w as f32 * 9525.0) as u32;
    let img_height_emu = (img_h as f32 * 9525.0) as u32;

    let (display_w, display_h) = if img_width_emu > max_display_width_emu {
        let ratio = max_display_width_emu as f32 / img_width_emu as f32;
        (max_display_width_emu, (img_height_emu as f32 * ratio) as u32)
    } else {
        (img_width_emu, img_height_emu)
    };

    // 7. 创建 docx-rs 图片段落（使用 Pic::new_with_dimensions）
    let pic = Pic::new_with_dimensions(png_bytes, img_w, img_h)
        .size(display_w, display_h);

    let paragraph = Paragraph::new().add_run(Run::new().add_image(pic));

    Ok(Some(paragraph))
}

// ---------------------------------------------------------------------------
// F1: export_docx 命令
// ---------------------------------------------------------------------------

/// 导出 Markdown 文件为 DOCX 格式。
#[tauri::command]
pub async fn export_docx(
    app: tauri::AppHandle,
    req: ExportDocxRequest,
) -> Result<ExportResult, AppError> {
    // 1. 生成 DOCX 字节流
    let (docx_bytes, image_count, warnings) = markdown_to_docx(&req).await?;

    // 2. 弹出保存对话框
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .add_filter("Word Document", &["docx"])
        .set_file_name("document.docx")
        .blocking_save_file()
        .ok_or_else(|| AppError::Other("用户取消保存".to_string()))?;

    let path_str = file_path.to_string();

    // 3. 写入文件
    fs::write(&path_str, &docx_bytes)?;

    let file_size = docx_bytes.len() as u64;

    Ok(ExportResult {
        path: path_str,
        size: file_size,
        image_count,
        warnings,
    })
}

// ---------------------------------------------------------------------------
// 单元测试
//
// 覆盖范围：所有不依赖 AppHandle 的纯函数。
// markdown_to_docx 是 async 函数但不依赖 AppHandle，通过 poll_once 即可测试。
// export_docx 依赖 AppHandle（弹保存对话框），不在单元测试覆盖范围。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // === detect_mime 测试 ===

    #[test]
    fn detect_mime_by_extension_png() {
        assert_eq!(
            detect_mime(b"\x89PNG", Path::new("photo.png")),
            "image/png"
        );
    }

    #[test]
    fn detect_mime_by_extension_jpg() {
        assert_eq!(
            detect_mime(b"\xFF\xD8", Path::new("photo.jpg")),
            "image/jpeg"
        );
        assert_eq!(
            detect_mime(b"\xFF\xD8", Path::new("photo.jpeg")),
            "image/jpeg"
        );
    }

    #[test]
    fn detect_mime_by_extension_case_insensitive() {
        assert_eq!(
            detect_mime(b"xxxx", Path::new("PHOTO.PNG")),
            "image/png"
        );
        assert_eq!(
            detect_mime(b"xxxx", Path::new("Photo.Svg")),
            "image/svg+xml"
        );
    }

    #[test]
    fn detect_mime_by_extension_all_types() {
        assert_eq!(detect_mime(b"x", Path::new("a.gif")), "image/gif");
        assert_eq!(detect_mime(b"x", Path::new("a.svg")), "image/svg+xml");
        assert_eq!(detect_mime(b"x", Path::new("a.webp")), "image/webp");
        assert_eq!(detect_mime(b"x", Path::new("a.bmp")), "image/bmp");
        assert_eq!(detect_mime(b"x", Path::new("a.ico")), "image/x-icon");
        assert_eq!(detect_mime(b"x", Path::new("a.tiff")), "image/tiff");
        assert_eq!(detect_mime(b"x", Path::new("a.tif")), "image/tiff");
    }

    #[test]
    fn detect_mime_magic_bytes_png() {
        // 无扩展名，靠 magic bytes 识别
        let png_bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(detect_mime(&png_bytes, Path::new("noext")), "image/png");
    }

    #[test]
    fn detect_mime_magic_bytes_jpeg() {
        let jpg_bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert_eq!(detect_mime(&jpg_bytes, Path::new("noext")), "image/jpeg");
    }

    #[test]
    fn detect_mime_magic_bytes_gif() {
        let gif_bytes = b"GIF89a...";
        assert_eq!(detect_mime(gif_bytes, Path::new("noext")), "image/gif");
    }

    #[test]
    fn detect_mime_magic_bytes_webp() {
        // RIFF....WEBP
        let webp_bytes = [
            0x52, 0x49, 0x46, 0x46, // RIFF
            0x00, 0x00, 0x00, 0x00, // size
            0x57, 0x45, 0x42, 0x50, // WEBP
        ];
        assert_eq!(detect_mime(&webp_bytes, Path::new("noext")), "image/webp");
    }

    #[test]
    fn detect_mime_magic_bytes_svg_xml() {
        let svg = b"<?xml version=\"1.0\"?><svg></svg>";
        assert_eq!(detect_mime(svg, Path::new("noext")), "image/svg+xml");
    }

    #[test]
    fn detect_mime_magic_bytes_svg_bare() {
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert_eq!(detect_mime(svg, Path::new("noext")), "image/svg+xml");
    }

    #[test]
    fn detect_mime_unknown_fallback() {
        assert_eq!(
            detect_mime(b"random data", Path::new("noext")),
            "application/octet-stream"
        );
    }

    #[test]
    fn detect_mime_extension_overrides_magic_bytes() {
        // 扩展名优先于 magic bytes：文件名是 .png 但内容是 JPEG magic
        let jpg_bytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert_eq!(
            detect_mime(&jpg_bytes, Path::new("mislabeled.png")),
            "image/png"
        );
    }

    // === percent_decode 测试 ===

    #[test]
    fn percent_decode_simple_space() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
    }

    #[test]
    fn percent_decode_windows_path() {
        // Tauri asset protocol 中常见的编码路径
        assert_eq!(
            percent_decode("C%3A%5CUsers%5CLenovo%5Ctest.png"),
            "C:\\Users\\Lenovo\\test.png"
        );
    }

    #[test]
    fn percent_decode_no_encoded_chars() {
        assert_eq!(percent_decode("plain/path/file.txt"), "plain/path/file.txt");
    }

    #[test]
    fn percent_decode_multiple_encoded() {
        assert_eq!(percent_decode("%2F%2F%2F"), "///");
    }

    #[test]
    fn percent_decode_invalid_hex_passthrough() {
        // % 后面不是合法十六进制，原样输出
        assert_eq!(percent_decode("100%done"), "100%done");
    }

    #[test]
    fn percent_decode_empty() {
        assert_eq!(percent_decode(""), "");
    }

    // === page_size_inches 测试 ===

    #[test]
    fn page_size_a4() {
        let (w, h) = page_size_inches("A4");
        assert!((w - 8.27).abs() < 0.01);
        assert!((h - 11.69).abs() < 0.01);
    }

    #[test]
    fn page_size_letter() {
        let (w, h) = page_size_inches("Letter");
        assert!((w - 8.5).abs() < 0.01);
        assert!((h - 11.0).abs() < 0.01);
    }

    #[test]
    fn page_size_unknown_defaults_a4() {
        let (w, _) = page_size_inches("Foo");
        assert!((w - 8.27).abs() < 0.01);
    }

    // === page_margin_inches 测试 ===

    #[test]
    fn page_margin_normal() {
        let (t, r, b, l) = page_margin_inches("normal");
        assert!((t - 1.0).abs() < 0.01);
        assert!((r - 1.0).abs() < 0.01);
        assert!((b - 1.0).abs() < 0.01);
        assert!((l - 1.0).abs() < 0.01);
    }

    #[test]
    fn page_margin_narrow() {
        let (t, r, b, l) = page_margin_inches("narrow");
        assert!((t - 0.5).abs() < 0.01);
        assert!((r - 0.5).abs() < 0.01);
        assert!((b - 0.5).abs() < 0.01);
        assert!((l - 0.5).abs() < 0.01);
    }

    #[test]
    fn page_margin_wide() {
        let (t, r, b, l) = page_margin_inches("wide");
        assert!((t - 1.0).abs() < 0.01);
        assert!((r - 2.0).abs() < 0.01);
        assert!((b - 1.0).abs() < 0.01);
        assert!((l - 2.0).abs() < 0.01);
    }

    #[test]
    fn page_margin_unknown_defaults_normal() {
        let (t, r, b, l) = page_margin_inches("Foo");
        assert!((t - 1.0).abs() < 0.01);
        assert!((r - 1.0).abs() < 0.01);
        assert!((b - 1.0).abs() < 0.01);
        assert!((l - 1.0).abs() < 0.01);
    }

    // === resolve_image_path 测试 ===

    #[test]
    fn resolve_image_path_data_uri_returns_none() {
        assert_eq!(
            resolve_image_path("data:image/png;base64,xxxx", "/tmp"),
            None
        );
    }

    #[test]
    fn resolve_image_path_http_returns_none() {
        assert_eq!(
            resolve_image_path("http://example.com/a.png", "/tmp"),
            None
        );
        assert_eq!(
            resolve_image_path("https://example.com/a.png", "/tmp"),
            None
        );
    }

    #[test]
    fn resolve_image_path_absolute_file_path() {
        let result = resolve_image_path("/home/user/img.png", "/tmp/base");
        assert_eq!(result, Some(PathBuf::from("/home/user/img.png")));
    }

    #[test]
    fn resolve_image_path_relative_with_dir_base() {
        // base_dir 是目录 → base.join(path)
        let tmp = std::env::temp_dir().join("mt_test_resolve_dir");
        let _ = std::fs::create_dir_all(&tmp);
        let result = resolve_image_path("img.png", tmp.to_str().unwrap());
        assert_eq!(result, Some(tmp.join("img.png")));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_image_path_relative_with_file_base() {
        // base_dir 是文件路径 → base.parent().join(path)
        let result = resolve_image_path("img.png", "/tmp/document.md");
        assert_eq!(result, Some(PathBuf::from("/tmp/img.png")));
    }

    #[test]
    fn resolve_image_path_file_protocol() {
        let result = resolve_image_path("file:///home/user/img.png", "/tmp");
        // file:// 前缀被去掉后，/home/user/img.png 是绝对路径
        // 注意：trim_start_matches("//") 只去掉 file:// 后的 //
        let cleaned = "/home/user/img.png";
        assert_eq!(result, Some(PathBuf::from(cleaned)));
    }

    #[test]
    fn resolve_image_path_asset_protocol_absolute() {
        let result = resolve_image_path(
            "asset://localhost/C%3A%5CUsers%5Cimg.png",
            "/tmp",
        );
        // percent-decode 后是绝对路径
        assert_eq!(result, Some(PathBuf::from("C:\\Users\\img.png")));
    }

    // === decode_data_uri 测试 ===

    #[test]
    fn decode_data_uri_png_base64() {
        // 1x1 透明 PNG 的 base64
        let src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        let (bytes, mime) = decode_data_uri(src).unwrap();
        assert_eq!(mime, "image/png");
        assert!(!bytes.is_empty());
        // PNG magic bytes
        assert_eq!(&bytes[0..4], &[0x89, 0x50, 0x4E, 0x47]);
    }

    #[test]
    fn decode_data_uri_rejects_non_data_uri() {
        let result = decode_data_uri("http://example.com/img.png");
        assert!(result.is_err());
    }

    #[test]
    fn decode_data_uri_rejects_non_base64() {
        let result = decode_data_uri("data:image/png;utf8,xxxx");
        assert!(result.is_err());
    }

    #[test]
    fn decode_data_uri_rejects_missing_comma() {
        let result = decode_data_uri("data:image/png;base64");
        assert!(result.is_err());
    }

    #[test]
    fn decode_data_uri_rejects_missing_semicolon() {
        let result = decode_data_uri("data:image/png");
        assert!(result.is_err());
    }

    // === ExportDocxRequest serde 默认值测试 ===

    #[test]
    fn export_docx_request_defaults_when_omitted() {
        // 只提供必填字段，所有 #[serde(default)] 字段应使用默认值
        // 注意：不用 raw string，避免 # 在 Rust 2021 edition 中的歧义
        let json = "{\"markdown\":\"hello\",\"pathname\":\"/tmp/a.md\"}";
        let req: ExportDocxRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.markdown, "hello");
        assert_eq!(req.pathname, "/tmp/a.md");
        assert_eq!(req.image_embed, true);
        assert_eq!(req.image_resize, "auto");
        assert_eq!(req.image_max_width, 1024);
        assert_eq!(req.page_size, "A4");
        assert_eq!(req.page_margin, "normal");
    }

    #[test]
    fn export_docx_request_camel_case_deserialization() {
        // 验证 #[serde(rename_all = "camelCase")] 生效
        // 使用 serde_json::json! 宏避免手写 JSON 转义
        let json = serde_json::json!({
            "markdown": "hello",
            "pathname": "/tmp/a.md",
            "imageEmbed": false,
            "imageResize": "original",
            "imageMaxWidth": 2048,
            "pageSize": "Letter",
            "pageMargin": "wide"
        }).to_string();
        let req: ExportDocxRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.image_embed, false);
        assert_eq!(req.image_resize, "original");
        assert_eq!(req.image_max_width, 2048);
        assert_eq!(req.page_size, "Letter");
        assert_eq!(req.page_margin, "wide");
    }

    // === resize_if_needed 测试 ===

    #[test]
    fn resize_if_needed_svg_no_resize() {
        let svg = b"<?xml version=\"1.0\"?><svg></svg>";
        let result = resize_if_needed(svg, 100, "image/svg+xml").unwrap();
        // SVG 不缩放，原样返回
        assert_eq!(result, svg.to_vec());
    }

    #[test]
    fn resize_if_needed_small_image_no_resize() {
        // 创建一个 10x10 的小图（小于 max_width=100），不应缩放
        let img = image::DynamicImage::new_rgba8(10, 10);
        let mut buf = Vec::new();
        img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png).unwrap();
        let result = resize_if_needed(&buf, 100, "image/png").unwrap();
        // 不需要缩放时返回原始字节
        assert_eq!(result, buf);
    }

    #[test]
    fn resize_if_needed_large_image_resized() {
        // 创建一个 200x100 的图，max_width=100，应等比缩放为 100x50
        let img = image::DynamicImage::new_rgba8(200, 100);
        let mut buf = Vec::new();
        img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Png).unwrap();
        let result = resize_if_needed(&buf, 100, "image/png").unwrap();
        // 缩放后的结果应能解码，且宽度为 100
        let resized = image::load_from_memory(&result).unwrap();
        assert_eq!(resized.width(), 100);
        assert_eq!(resized.height(), 50); // 等比缩放 200:100 → 100:50
    }

    #[test]
    fn resize_if_needed_invalid_image_errors() {
        let result = resize_if_needed(b"not an image", 100, "image/png");
        assert!(result.is_err());
    }

    // === markdown_to_docx 集成测试（async，不依赖 AppHandle） ===

    /// 同步执行 async 函数（用于 markdown_to_docx 测试）。
    /// markdown_to_docx 是 async 函数（因 reqwest 远程下载分支），
    /// 但测试中的 markdown 不含远程 URL，实际不会触发真正的 IO 阻塞。
    fn poll_once<F: std::future::Future>(f: F) -> F::Output {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime for test");
        rt.block_on(f)
    }

    #[test]
    fn markdown_to_docx_basic_heading_and_paragraph() {
        let req = ExportDocxRequest {
            markdown: "# Title\n\nHello world.\n".to_string(),
            pathname: String::new(),
            image_embed: true,
            image_resize: "auto".to_string(),
            image_max_width: 1024,
            page_size: "A4".to_string(),
            page_margin: "normal".to_string(),
            font_family: None,
            font_size: 11.0,
            line_height: 1.5,
        };
        let (bytes, image_count, warnings) = poll_once(markdown_to_docx(&req)).unwrap();
        assert!(!bytes.is_empty(), "DOCX bytes should not be empty");
        assert_eq!(image_count, 0);
        assert!(warnings.is_empty(), "No warnings for simple markdown");
    }

    #[test]
    fn markdown_to_docx_empty_markdown() {
        let req = ExportDocxRequest {
            markdown: String::new(),
            pathname: String::new(),
            image_embed: true,
            image_resize: "auto".to_string(),
            image_max_width: 1024,
            page_size: "A4".to_string(),
            page_margin: "normal".to_string(),
            font_family: None,
            font_size: 11.0,
            line_height: 1.5,
        };
        let (bytes, _img_count, _warnings) = poll_once(markdown_to_docx(&req)).unwrap();
        // 空 markdown 也应生成合法的 docx（至少有 docx 头部）
        assert!(!bytes.is_empty(), "Empty markdown should still produce valid docx");
        // docx 是 zip，magic bytes 是 PK
        assert_eq!(&bytes[0..2], b"PK", "DOCX should be a ZIP archive");
    }

    #[test]
    fn markdown_to_docx_with_code_block() {
        let md = "Here is code:\n\n```rust\nfn main() {}\n```\n";
        let req = ExportDocxRequest {
            markdown: md.to_string(),
            pathname: String::new(),
            image_embed: true,
            image_resize: "auto".to_string(),
            image_max_width: 1024,
            page_size: "A4".to_string(),
            page_margin: "normal".to_string(),
            font_family: None,
            font_size: 11.0,
            line_height: 1.5,
        };
        let (bytes, image_count, _warnings) = poll_once(markdown_to_docx(&req)).unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(image_count, 0);
    }

    #[test]
    fn markdown_to_docx_with_list() {
        let md = "- item one\n- item two\n- item three\n";
        let req = ExportDocxRequest {
            markdown: md.to_string(),
            pathname: String::new(),
            image_embed: true,
            image_resize: "auto".to_string(),
            image_max_width: 1024,
            page_size: "A4".to_string(),
            page_margin: "normal".to_string(),
            font_family: None,
            font_size: 11.0,
            line_height: 1.5,
        };
        let (bytes, _img, _warn) = poll_once(markdown_to_docx(&req)).unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn markdown_to_docx_with_table() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
        let req = ExportDocxRequest {
            markdown: md.to_string(),
            pathname: String::new(),
            image_embed: true,
            image_resize: "auto".to_string(),
            image_max_width: 1024,
            page_size: "A4".to_string(),
            page_margin: "normal".to_string(),
            font_family: None,
            font_size: 11.0,
            line_height: 1.5,
        };
        let (bytes, _img, _warn) = poll_once(markdown_to_docx(&req)).unwrap();
        assert!(!bytes.is_empty());
    }

    /// 验证 ExportDocxRequest 的字体字段能被 markdown_to_docx 正确接收。
    /// 字体已应用到 Normal/Heading 样式的 RunFonts 中。
    /// 完整的 docx XML 字体验证需要 zip crate，当前仅验证函数不 panic 且输出合法 ZIP。
    #[test]
    fn markdown_to_docx_applies_custom_font() {
        let req = ExportDocxRequest {
            markdown: "# Title\n\nText.\n".to_string(),
            pathname: String::new(),
            image_embed: true,
            image_resize: "auto".to_string(),
            image_max_width: 1024,
            page_size: "A4".to_string(),
            page_margin: "normal".to_string(),
            font_family: Some("隶书".to_string()),
            font_size: 16.0,
            line_height: 1.5,
        };
        let (bytes, _, _) = poll_once(markdown_to_docx(&req)).unwrap();
        assert!(!bytes.is_empty(), "DOCX bytes should not be empty");
        // 验证 docx 是合法的 ZIP 文件
        assert!(bytes.len() > 4, "DOCX should be a valid ZIP");
        assert_eq!(&bytes[0..4], b"PK\x03\x04", "DOCX should start with ZIP magic");
    }
}

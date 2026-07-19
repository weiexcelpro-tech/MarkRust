//! 文件系统命令（16 个），对应原 Electron 版本的 `mt::fs::*` + `mt::paths::is-image` IPC 通道。
//!
//! 契约参考：`marktext-develop/packages/desktop/src/main/ipc/fs.ts`。
//!
//! 所有 command 返回 `AppResult<T>`（bool 类查询除外，它们对错误返回 `false`，与 Node.js 原实现一致）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::commands::encoding::{decode, detect_encoding, encode, ReadFileResult};
use crate::error::AppResult;

/// 与 TS 端 `SerializedStat` 对齐：`mtimeMs` / `ctimeMs` 为 Unix 毫秒时间戳（f64）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedStat {
    pub size: u64,
    pub mtime_ms: f64,
    pub ctime_ms: f64,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
}

#[tauri::command]
pub fn fs_is_file(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
pub fn fs_is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn fs_path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_ensure_dir(path: String) -> AppResult<()> {
    std::fs::create_dir_all(&path)?;
    Ok(())
}

/// 清空目录内容但保留目录本身。
///
/// 用 walkdir 收集后按深度降序删除：先删文件、再删空目录。
#[tauri::command]
pub fn fs_empty_dir(path: String) -> AppResult<()> {
    let mut entries: Vec<walkdir::DirEntry> = walkdir::WalkDir::new(&path)
        .min_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .collect();
    // 深度降序：保证子节点先于父节点被删，remove_dir 才不会因非空失败
    entries.sort_by(|a, b| b.depth().cmp(&a.depth()));
    for entry in entries {
        let p = entry.path();
        if entry.file_type().is_dir() {
            std::fs::remove_dir(p)?;
        } else {
            std::fs::remove_file(p)?;
        }
    }
    Ok(())
}

/// 复制文件或目录。dest 为已存在目录时拼接 src 的文件名（与 fs-extra 行为一致）。
#[tauri::command]
pub fn fs_copy(src: String, dest: String) -> AppResult<()> {
    let src_path = Path::new(&src);
    let dest_path = PathBuf::from(&dest);

    let dest_final = if dest_path.is_dir() {
        let name = src_path.file_name().ok_or_else(|| {
            crate::error::AppError::PathNotFound(format!("cannot copy '{src}': no file name"))
        })?;
        dest_path.join(name)
    } else {
        dest_path
    };

    let metadata = std::fs::metadata(src_path)?;
    if metadata.is_file() {
        std::fs::copy(src_path, &dest_final)?;
    } else if metadata.is_dir() {
        copy_dir_recursive(src_path, &dest_final)?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest)?;
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        let entry = entry?;
        let relative = entry.path().strip_prefix(src).map_err(|e| {
            crate::error::AppError::Other(format!("strip_prefix failed: {e}"))
        })?;
        let target = dest.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 移动文件或目录。跨盘符时 fallback 到 copy + delete。
///
/// Windows 上跨卷 rename 返回 ERROR_NOT_SAME_DEVICE (17)，需要手动回退。
#[tauri::command]
pub fn fs_move(src: String, dest: String) -> AppResult<()> {
    match std::fs::rename(&src, &dest) {
        Ok(()) => Ok(()),
        Err(e) => {
            // 17 = Windows ERROR_NOT_SAME_DEVICE, 18 = Linux EXDEV
            let is_cross_device = matches!(e.raw_os_error(), Some(17) | Some(18));
            if !is_cross_device {
                return Err(e.into());
            }
            let src_path = Path::new(&src);
            let dest_path = PathBuf::from(&dest);
            let metadata = std::fs::metadata(src_path)?;
            if metadata.is_dir() {
                copy_dir_recursive(src_path, &dest_path)?;
                std::fs::remove_dir_all(src_path)?;
            } else {
                std::fs::copy(src_path, &dest_path)?;
                std::fs::remove_file(src_path)?;
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub fn fs_unlink(path: String) -> AppResult<()> {
    std::fs::remove_file(&path)?;
    Ok(())
}

#[tauri::command]
pub fn fs_readdir(path: String) -> AppResult<Vec<String>> {
    let names: Vec<String> = std::fs::read_dir(&path)?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str().map(str::to_owned))
        .collect();
    Ok(names)
}

/// 读取 Markdown 文件并检测行尾、编码、BOM 等元数据。
///
/// 对应原 Electron 版 `loadMarkdownFile`，返回完整元信息供前端创建文档标签页。
/// 前端内部统一使用 LF，此命令在 Rust 侧完成行尾规范化并报告原始类型。
///
/// 行尾检测逻辑与原版一致：
/// - `LF_LINE_ENDING_REG = /(?:[^\r]\n)|(?:^\n$)/` → 检测 LF
/// - `CRLF_LINE_ENDING_REG = /\r\n/` → 检测 CRLF
/// - 既非 LF 又非 CRLF（如独自 `\r`）→ `isUnknownEnding`，按首选 EOL 处理
#[tauri::command]
pub fn fs_read_markdown(
    path: String,
    preferred_eol: Option<String>,
    auto_guess_encoding: Option<bool>,
    trim_trailing_newline: Option<i32>,
    auto_normalize_line_endings: Option<bool>,
) -> AppResult<MarkdownFileResult> {
    let bytes = std::fs::read(&path)?;
    let auto_guess = auto_guess_encoding.unwrap_or(true);
    let preferred = preferred_eol.as_deref().unwrap_or("lf");
    let trim_opt = trim_trailing_newline.unwrap_or(2);
    let auto_norm = auto_normalize_line_endings.unwrap_or(false);

    // 1. 编码探测
    let is_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let enc = if auto_guess {
        detect_encoding(&bytes)
    } else {
        encoding_rs::UTF_8
    };
    let (cow, _) = enc.decode_without_bom_handling(&bytes);
    let mut markdown = cow.into_owned();
    let encoding_name = enc.name().to_ascii_lowercase();

    // 2. 行尾检测（与原版 loadMarkdownFile regex 语义对齐）
    let has_crlf = markdown.contains("\r\n");
    // LF_LINE_ENDING_REG: /(?:[^\r]\n)|(?:^\n$)/
    //    即：一个非 \r 字符后跟 \n，或整个字符串是单个 \n
    let has_lf = if markdown == "\n" {
        true
    } else {
        // 查找 \n 前面不是 \r 的位置
        let mut found = false;
        let mut iter = markdown.chars().peekable();
        let mut prev: Option<char> = None;
        while let Some(ch) = iter.next() {
            if ch == '\n' && prev != Some('\r') {
                found = true;
                break;
            }
            prev = Some(ch);
        }
        found
    };

    let is_mixed = has_lf && has_crlf;
    let is_unknown_ending = !has_lf && !has_crlf;

    // 确定原始行尾类型
    let mut line_ending = preferred.to_string();
    if has_lf && !has_crlf {
        line_ending = "lf".to_string();
    } else if has_crlf && !has_lf {
        line_ending = "crlf".to_string();
    }

    // 3. 行尾规范化：内部统一 LF
    let mut adjust_line_ending_on_save = false;
    if is_mixed || is_unknown_ending || line_ending != "lf" {
        // LINE_ENDING_REG = /(?:\r\n|\n)/g → 统一替换为 LF
        // 先处理 \r\n，再处理独自 \r
        markdown = markdown.replace("\r\n", "\n");
        markdown = markdown.replace('\r', "\n");
        adjust_line_ending_on_save = !auto_norm && line_ending != "lf";
    }

    // 4. trimTrailingNewline 检测（与原版 loadMarkdownFile 逻辑对齐）
    //    2 = 自动检测; 1 = 保留至多一个; 0 = 保持不变; 3 = 不处理
    let final_trim = if trim_opt == 2 {
        if markdown.is_empty() {
            3
        } else {
            let last = markdown.as_bytes().last().unwrap();
            if *last == b'\n' && markdown.len() >= 2 && markdown.as_bytes()[markdown.len() - 2] == b'\n' {
                2 // 多个末尾换行，需要收紧
            } else if *last == b'\n' {
                1 // 恰好一个末尾换行
            } else {
                0 // 无末尾换行
            }
        }
    } else {
        trim_opt
    };

    let filename = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    Ok(MarkdownFileResult {
        markdown,
        filename,
        pathname: path,
        encoding: EncodingInfo {
            encoding: encoding_name,
            is_bom,
        },
        line_ending,
        adjust_line_ending_on_save,
        trim_trailing_newline: final_trim,
        is_mixed_line_endings: is_mixed,
    })
}

/// 与前端 `IFileState.encoding` 对齐：`{ encoding: string, isBom: boolean }`。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodingInfo {
    pub encoding: String,
    pub is_bom: bool,
}

/// 与前端 `mt::open-new-tab` payload 对齐（`MarkdownDocumentRaw`）。
///
/// 驼峰序列化以匹配 TS 端 `documentStateKeys` 的字段名。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFileResult {
    pub markdown: String,
    pub filename: String,
    pub pathname: String,
    pub encoding: EncodingInfo,
    pub line_ending: String,
    pub adjust_line_ending_on_save: bool,
    pub trim_trailing_newline: i32,
    pub is_mixed_line_endings: bool,
}

/// 读取文件。`encoding = None` 时自动探测；指定编码则按 Node.js BufferEncoding 语义解码。
#[tauri::command]
pub fn fs_read_file(path: String, encoding: Option<String>) -> AppResult<ReadFileResult> {
    let bytes = std::fs::read(&path)?;
    Ok(decode(&bytes, encoding.as_deref()))
}

#[tauri::command]
pub fn fs_write_file(path: String, data: Vec<u8>) -> AppResult<()> {
    std::fs::write(&path, &data)?;
    Ok(())
}

/// 确保父目录存在后写文件（对应 fs-extra outputFile）。
#[tauri::command]
pub fn fs_output_file(path: String, data: Vec<u8>) -> AppResult<()> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(p, &data)?;
    Ok(())
}

/// 保存 Markdown 文件，支持行尾还原、BOM、编码与末尾换行处理。
///
/// 对应原 Electron 版 `mt::fs::markdown-save` IPC 通道。前端内部始终使用 LF，
/// 保存时按 `line_ending` + `adjust_line_ending_on_save` 还原 CRLF。
///
/// `trim_trailing_newline` 语义：
/// - 0：保持不变
/// - 1：去除多余末尾换行（保留至多一个 `\n`；无末尾换行则不添加）
/// - 2（默认）：去除全部末尾换行后确保恰好一个 `\n`（空串保持为空）
#[tauri::command]
pub fn markdown_save(
    path: String,
    markdown: String,
    line_ending: Option<String>,
    adjust_line_ending_on_save: Option<bool>,
    encoding: Option<String>,
    is_bom: Option<bool>,
    trim_trailing_newline: Option<i32>,
) -> AppResult<bool> {
    let mut content = markdown;

    // 1. 末尾换行处理（在 LF 上操作，因为前端内部统一 LF）
    let trim_opt = trim_trailing_newline.unwrap_or(2);
    content = apply_trim_trailing_newline(content, trim_opt);

    // 2. 行尾还原：保存时按 line_ending + adjustLineEndingOnSave 将 LF 转回 CRLF
    let adjust_crlf = adjust_line_ending_on_save.unwrap_or(false);
    let le = line_ending.as_deref().unwrap_or("lf");
    if adjust_crlf && le.eq_ignore_ascii_case("crlf") {
        // 先规范化为 LF（防御性，防止混合行尾），再统一转 CRLF
        content = content.replace("\r\n", "\n");
        content = content.replace('\n', "\r\n");
    }

    // 3. 编码为字节流
    let enc_name = encoding.as_deref().unwrap_or("utf-8");
    let is_utf8 = enc_name.eq_ignore_ascii_case("utf-8")
        || enc_name.eq_ignore_ascii_case("utf8");
    let mut bytes = if is_utf8 {
        content.into_bytes()
    } else {
        encode(&content, enc_name)
    };

    // 4. UTF-8 BOM（0xEF 0xBB 0xBF）
    if is_bom.unwrap_or(false) && is_utf8 {
        let mut with_bom = Vec::with_capacity(bytes.len() + 3);
        with_bom.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        with_bom.extend_from_slice(&bytes);
        bytes = with_bom;
    }

    // 5. 写文件
    std::fs::write(&path, &bytes)?;
    Ok(true)
}

/// 按选项处理字符串末尾换行符。
///
/// 在 LF 内容上操作（调用前不应已完成 CRLF 转换）。
fn apply_trim_trailing_newline(mut markdown: String, option: i32) -> String {
    match option {
        0 => markdown,
        1 => {
            // 去除多余末尾换行，保留至多一个 `\n`
            while markdown.ends_with("\n\n") {
                markdown.pop();
            }
            markdown
        }
        2 => {
            // 去除全部末尾换行后确保恰好一个 `\n`
            while markdown.ends_with('\n') {
                markdown.pop();
            }
            if !markdown.is_empty() {
                markdown.push('\n');
            }
            markdown
        }
        _ => markdown,
    }
}

#[tauri::command]
pub fn fs_stat(path: String) -> AppResult<SerializedStat> {
    let metadata = std::fs::metadata(&path)?;
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    let ctime_ms = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Ok(SerializedStat {
        size: metadata.len(),
        mtime_ms,
        ctime_ms,
        is_file: metadata.is_file(),
        is_directory: metadata.is_dir(),
        is_symbolic_link: metadata.file_type().is_symlink(),
    })
}

/// Windows 上只判 is_file（与原实现一致；Unix 才需检查可执行位）。
#[tauri::command]
pub fn fs_is_executable(path: String) -> bool {
    std::fs::metadata(&path)
        .map(|m| m.is_file())
        .unwrap_or(false)
}

/// 将文件移到系统回收站（不可恢复）。
#[tauri::command]
pub fn fs_trash_item(path: String) -> AppResult<()> {
    trash::delete(&path).map_err(|e| {
        crate::error::AppError::Other(format!("trash delete failed: {e}"))
    })?;
    Ok(())
}

/// 判断路径是否为图片扩展名（png/jpg/jpeg/gif/webp/bmp/svg/ico）。
///
/// 仅检查扩展名，不访问文件系统（与原 `isImageFile` 的 isFile 检查不同，
/// 前端按需自行验证文件存在性）。
#[tauri::command]
pub fn fs_is_image_path(path: String) -> bool {
    const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"];
    Path::new(&path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

// ─── 目录树（fs_list_tree）─────────────────────────────────

/// 与前端 `TreeNode` 接口对齐的文件树节点（驼峰序列化）。
///
/// 契约：前端 `OPEN_PROJECT` 创建空根节点后调用 `fs_list_tree` 填充，
/// 替代原 Electron 版 `mt::update-object-tree` 事件推送。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub pathname: String,
    pub name: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub is_markdown: bool,
    pub folders: Vec<FileTreeNode>,
    pub files: Vec<FileTreeNode>,
}

/// Markdown 扩展名白名单（与原版 marktext-develop 及前端 tauri-bridge.ts 对齐）。
const MARKDOWN_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdx", "mdwn", "mdown", "mkd", "mkdn", "mmd", "mdtxt", "mdtext",
    "text", "txt",
];

/// 构建产物 / 依赖目录名，遍历时整体跳过（不递归进入）。
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist"];

/// 判断文件名是否属于 Markdown / 纯文本扩展名（小写比较）。
pub(crate) fn is_markdown_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 判断 walkdir 条目是否应被剪枝（不进入遍历结果）。
///
/// 根条目（`depth == 0`）始终保留；其余跳过隐藏条目（`.` 前缀）和
/// node_modules / target / dist 构建产物目录（仅目录跳过，同名文件保留）。
fn should_prune(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    let name = match entry.file_name().to_str() {
        Some(n) => n,
        None => return false,
    };
    if name.starts_with('.') {
        return true;
    }
    entry.file_type().is_dir() && SKIPPED_DIRS.contains(&name)
}

/// 递归排序节点的 folders / files 子列表（按 `name` 字母序）。
fn sort_tree(node: &mut FileTreeNode) {
    node.folders.sort_by(|a, b| a.name.cmp(&b.name));
    node.files.sort_by(|a, b| a.name.cmp(&b.name));
    for child in node.folders.iter_mut() {
        sort_tree(child);
    }
    for child in node.files.iter_mut() {
        sort_tree(child);
    }
}

/// 递归构建目录树。
///
/// 用 walkdir 平坦遍历（`max_depth = 15`），通过 `filter_entry` 剪枝隐藏文件
/// 与 node_modules / target / dist 目录。收集后以路径为键构建节点映射，逆序
/// 链接子→父（walkdir 先序的逆序保证子节点先于父节点被处理，take 出的子树
/// 已含全部后代）。单个条目读取失败时跳过（`filter_map`），不中断整个遍历。
#[tauri::command]
pub fn fs_list_tree(path: String) -> AppResult<FileTreeNode> {
    let root_path = Path::new(&path);
    if !root_path.exists() {
        return Err(crate::error::AppError::PathNotFound(format!(
            "list_tree: path not found: {path}"
        )));
    }

    // 平坦遍历 + 剪枝 + 容错：filter_entry 阻止进入被跳过的目录子树，
    // filter_map 跳过读取失败的条目。
    let entries: Vec<walkdir::DirEntry> = walkdir::WalkDir::new(root_path)
        .max_depth(15)
        .into_iter()
        .filter_entry(|e| !should_prune(e))
        .filter_map(|e| e.ok())
        .collect();

    // 根条目是首个（depth == 0）；用其路径作为规范键，避免输入路径尾部斜杠等差异。
    let root_key = entries
        .first()
        .ok_or_else(|| {
            crate::error::AppError::Other(format!("list_tree: no entries for {path}"))
        })?
        .path()
        .to_path_buf();

    // 第一遍：以路径为键创建所有节点（folders/files 暂为空）
    // 非 Markdown 文件直接跳过，不出现在目录树中；空目录保留（可能含 Markdown 子文件）。
    let mut nodes: HashMap<PathBuf, FileTreeNode> = HashMap::with_capacity(entries.len());
    for entry in &entries {
        let p = entry.path();
        let name = entry
            .file_name()
            .to_str()
            .map(str::to_owned)
            .unwrap_or_else(|| p.to_string_lossy().into_owned());
        let is_dir = entry.file_type().is_dir();
        let is_file = entry.file_type().is_file();
        // 跳过非 Markdown 文件
        if is_file && !is_markdown_name(&name) {
            continue;
        }
        let node = FileTreeNode {
            pathname: p.to_string_lossy().into_owned(),
            is_markdown: is_file,
            name,
            is_directory: is_dir,
            is_file,
            folders: Vec::new(),
            files: Vec::new(),
        };
        nodes.insert(p.to_path_buf(), node);
    }

    // 第二遍：逆序遍历 entries（先序逆序 → 子先于父），take 出子节点挂到父节点。
    // walkdir 先序保证：任一节点的全部后代在该节点之后、下个兄弟之前出现；
    // 逆序后后代先于该节点被处理，故 take 出时其 folders/files 已含完整子树。
    for entry in entries.iter().skip(1).rev() {
        let child_path = entry.path();
        let parent_path = match child_path.parent() {
            Some(p) => p,
            None => continue,
        };
        let child = match nodes.remove(child_path) {
            Some(n) => n,
            None => continue,
        };
        if let Some(parent) = nodes.get_mut(parent_path) {
            if child.is_directory {
                parent.folders.push(child);
            } else {
                parent.files.push(child);
            }
        }
    }

    // 提取根节点并递归排序
    let mut root_node = nodes
        .remove(&root_key)
        .ok_or_else(|| {
            crate::error::AppError::Other(format!("list_tree: root node missing for {path}"))
        })?;
    sort_tree(&mut root_node);
    Ok(root_node)
}

// ─── 单元测试 ─────────────────────────────────────────────
//
// 不依赖 tempfile crate（Cargo.toml 未引入 dev-dependencies），改用 std::env::temp_dir
// + TempGuard RAII 自动清理，避免测试间状态泄漏。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::encoding::ReadFileResult;

    /// RAII 临时文件/目录守卫：drop 时自动删除，无视错误。
    struct TempGuard(PathBuf);

    impl TempGuard {
        fn file(name: &str) -> Self {
            let p = std::env::temp_dir().join(name);
            // 确保起始状态干净（上次测试可能崩溃残留）
            let _ = std::fs::remove_file(&p);
            TempGuard(p)
        }

        fn dir(name: &str) -> Self {
            let p = std::env::temp_dir().join(name);
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).expect("create temp dir");
            TempGuard(p)
        }

        fn path_str(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempGuard {
        fn drop(&mut self) {
            let md = std::fs::metadata(&self.0);
            match md {
                Ok(m) if m.is_dir() => {
                    let _ = std::fs::remove_dir_all(&self.0);
                }
                Ok(_) => {
                    let _ = std::fs::remove_file(&self.0);
                }
                Err(_) => {}
            }
        }
    }

    #[test]
    fn fs_is_file_true_for_existing_file() {
        let guard = TempGuard::file("mt_test_fs_is_file_true.txt");
        std::fs::write(guard.path(), b"hi").unwrap();
        assert!(fs_is_file(guard.path_str()));
    }

    #[test]
    fn fs_is_file_false_for_directory() {
        let guard = TempGuard::dir("mt_test_fs_is_file_dir");
        assert!(!fs_is_file(guard.path_str()));
    }

    #[test]
    fn fs_is_file_false_for_nonexistent_path() {
        assert!(!fs_is_file("/nonexistent/path/should/not/exist.txt".to_string()));
    }

    #[test]
    fn fs_is_directory_true_for_existing_dir() {
        let guard = TempGuard::dir("mt_test_fs_is_directory_true");
        assert!(fs_is_directory(guard.path_str()));
    }

    #[test]
    fn fs_is_directory_false_for_file() {
        let guard = TempGuard::file("mt_test_fs_is_directory_file.txt");
        std::fs::write(guard.path(), b"x").unwrap();
        assert!(!fs_is_directory(guard.path_str()));
    }

    #[test]
    fn fs_path_exists_true_for_existing_path() {
        let guard = TempGuard::file("mt_test_fs_path_exists.txt");
        std::fs::write(guard.path(), b"x").unwrap();
        assert!(fs_path_exists(guard.path_str()));
    }

    #[test]
    fn fs_path_exists_false_for_nonexistent_path() {
        assert!(!fs_path_exists("/nonexistent/mt_test_should_not_exist".to_string()));
    }

    #[test]
    fn fs_write_then_read_roundtrips_text_content() {
        let guard = TempGuard::file("mt_test_fs_rw_text.md");
        let content = b"# title\nhello \xe4\xb8\xad\xe6\x96\x87"; // UTF-8 "中文"
        fs_write_file(guard.path_str(), content.to_vec()).expect("write must succeed");

        let result = fs_read_file(guard.path_str(), None).expect("read must succeed");
        match result {
            ReadFileResult::Text(s) => {
                assert_eq!(s, "# title\nhello 中文");
            }
            ReadFileResult::Binary(_) => panic!("expected Text variant for UTF-8 content"),
        }
    }

    #[test]
    fn fs_read_file_with_explicit_utf8_returns_text() {
        let guard = TempGuard::file("mt_test_fs_rw_explicit_utf8.txt");
        fs_write_file(guard.path_str(), "abc".as_bytes().to_vec()).unwrap();
        let result =
            fs_read_file(guard.path_str(), Some("utf-8".to_string())).expect("read must succeed");
        match result {
            ReadFileResult::Text(s) => assert_eq!(s, "abc"),
            ReadFileResult::Binary(_) => panic!("expected Text for explicit utf-8"),
        }
    }

    #[test]
    fn fs_write_file_overwrites_existing_content() {
        let guard = TempGuard::file("mt_test_fs_overwrite.txt");
        fs_write_file(guard.path_str(), b"first".to_vec()).unwrap();
        fs_write_file(guard.path_str(), b"second".to_vec()).unwrap();
        let bytes = std::fs::read(guard.path()).unwrap();
        assert_eq!(bytes, b"second");
    }

    #[test]
    fn fs_output_file_creates_parent_dirs() {
        let dir = TempGuard::dir("mt_test_fs_output_file_dir");
        let nested = dir.path().join("sub").join("deep").join("file.txt");
        fs_output_file(
            nested.to_string_lossy().into_owned(),
            b"nested".to_vec(),
        )
        .expect("output_file must create parents and write");
        assert_eq!(std::fs::read(&nested).unwrap(), b"nested");
    }

    #[test]
    fn fs_ensure_dir_creates_nested_directories() {
        let base = TempGuard::dir("mt_test_fs_ensure_dir_base");
        let target = base.path().join("a").join("b").join("c");
        fs_ensure_dir(target.to_string_lossy().into_owned()).expect("ensure_dir must succeed");
        assert!(target.is_dir());
    }

    #[test]
    fn fs_stat_reports_file_metadata() {
        let guard = TempGuard::file("mt_test_fs_stat.txt");
        std::fs::write(guard.path(), b"stat me").unwrap();
        let stat = fs_stat(guard.path_str()).expect("stat must succeed");
        assert!(stat.is_file);
        assert!(!stat.is_directory);
        assert_eq!(stat.size, 7);
        assert!(stat.mtime_ms > 0.0);
    }

    #[test]
    fn fs_stat_reports_directory_metadata() {
        let guard = TempGuard::dir("mt_test_fs_stat_dir");
        let stat = fs_stat(guard.path_str()).expect("stat must succeed");
        assert!(stat.is_directory);
        assert!(!stat.is_file);
    }

    #[test]
    fn fs_is_image_path_returns_true_for_image_extensions() {
        assert!(fs_is_image_path("photo.png".into()));
        assert!(fs_is_image_path("/abs/path/PHOTO.JPG".into()));
        assert!(fs_is_image_path("x.webp".into()));
    }

    #[test]
    fn fs_is_image_path_returns_false_for_non_image() {
        assert!(!fs_is_image_path("readme.md".into()));
        assert!(!fs_is_image_path("archive.zip".into()));
        assert!(!fs_is_image_path("noext".into()));
    }

    #[test]
    fn fs_readdir_lists_directory_entries() {
        let dir = TempGuard::dir("mt_test_fs_readdir");
        std::fs::write(dir.path().join("a.txt"), b"x").unwrap();
        std::fs::write(dir.path().join("b.md"), b"y").unwrap();
        let mut names = fs_readdir(dir.path_str()).expect("readdir must succeed");
        names.sort();
        assert_eq!(names, vec!["a.txt".to_string(), "b.md".to_string()]);
    }

    #[test]
    fn fs_unlink_removes_file() {
        let guard = TempGuard::file("mt_test_fs_unlink.txt");
        std::fs::write(guard.path(), b"x").unwrap();
        fs_unlink(guard.path_str()).expect("unlink must succeed");
        assert!(!guard.path().exists());
    }

    #[test]
    fn fs_copy_copies_file_content() {
        let src = TempGuard::file("mt_test_fs_copy_src.txt");
        let dest = TempGuard::file("mt_test_fs_copy_dest.txt");
        std::fs::write(src.path(), b"payload").unwrap();
        fs_copy(src.path_str(), dest.path_str()).expect("copy must succeed");
        assert_eq!(std::fs::read(dest.path()).unwrap(), b"payload");
    }
}

// ---------------------------------------------------------------------------
// Image path auto-completion (P2-21)
// ---------------------------------------------------------------------------

/// 对应原 Electron 版 `imagePathAutoComplement.ts` + `edit.ts` handler。
/// 渲染层在用户输入图片路径时从此命令获取候选项。
const IMAGE_AUTOCOMPLETE_EXTS: &[&str] =
    &["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico", "tiff"];

#[derive(Serialize)]
pub struct DirOrImageEntry {
    pub file: String,
    pub r#type: String, // "directory" or "image"
}

/// 列出 `dir` 下匹配 `search_key` 前缀的目录和图片文件。
/// 对应原版 `searchFilesAndDir()` 的简化版（无缓存/watcher，用 starts_with 代替 fuzzaldrin）。
#[tauri::command]
pub fn image_auto_path(pathname: String, src: String) -> AppResult<Vec<DirOrImageEntry>> {
    if src.is_empty() {
        return Ok(vec![]);
    }

    // Resolve `src` to absolute path
    let full_path = if Path::new(&src).is_absolute() {
        PathBuf::from(&src)
    } else {
        Path::new(&pathname)
            .parent()
            .unwrap_or(Path::new("."))
            .join(&src)
    };

    // Determine directory and search key
    let (dir, search_key) = {
        let s = full_path.to_string_lossy();
        if s.ends_with('/') || s.ends_with('\\') {
            (full_path.clone(), String::new())
        } else {
            let dir = full_path.parent().unwrap_or(Path::new(".")).to_path_buf();
            let key = full_path
                .file_name()
                .map(|f| f.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            (dir, key)
        }
    };

    let read_dir = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(vec![]),
    };

    let mut entries = Vec::new();
    for entry in read_dir.flatten() {
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        // Skip recycle bin
        if name_str.starts_with("$RECYCLE.BIN") {
            continue;
        }

        // Filter by search key prefix
        if !search_key.is_empty() && !name_str.to_lowercase().starts_with(&search_key) {
            continue;
        }

        let metadata = entry.metadata();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);

        if is_dir {
            entries.push(DirOrImageEntry {
                file: name_str.into_owned(),
                r#type: "directory".to_string(),
            });
        } else {
            let ext = Path::new(name_str.as_ref())
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if IMAGE_AUTOCOMPLETE_EXTS.contains(&ext.as_str()) {
                entries.push(DirOrImageEntry {
                    file: name_str.into_owned(),
                    r#type: "image".to_string(),
                });
            }
        }
    }

    Ok(entries)
}

//! 统一错误类型，所有 command 的 Result 都使用 [`AppError`]。
//!
//! 实现了 `serde::Serialize` 以便错误能通过 Tauri IPC 返回给前端。
//! 前端收到的错误形如 `{ "error": "IO error: ..." }`（Tauri 会自动包装）。

use thiserror::Error;

/// 应用级错误类型，覆盖 IO、路径、编码、ripgrep 四类场景。
#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Path not found: {0}")]
    PathNotFound(String),

    #[error("Encoding error: {0}")]
    #[allow(dead_code)]
    Encoding(String),

    #[error("Ripgrep error: {0}")]
    Ripgrep(String),

    #[error("Walkdir error: {0}")]
    Walkdir(String),

    #[error("Image error: {0}")]
    Image(String),

    /// B09 保存冲突：磁盘文件 mtime 与调用方预期不一致（文件已被外部修改）。
    ///
    /// 序列化为结构化对象而非字符串（见下方 Serialize impl）：
    /// `{ "kind": "conflict", "disk_mtime_ms": f64, "disk_size": u64 }`，
    /// 前端据此弹「覆盖 / 另存 / 重载」冲突三选。
    #[error("Save conflict: file changed on disk")]
    Conflict {
        disk_mtime_ms: f64,
        disk_size: u64,
    },

    #[error("{0}")]
    Other(String),
}

impl From<walkdir::Error> for AppError {
    fn from(e: walkdir::Error) -> Self {
        AppError::Walkdir(e.to_string())
    }
}

impl From<image::ImageError> for AppError {
    fn from(e: image::ImageError) -> Self {
        AppError::Image(e.to_string())
    }
}

// 手动实现 Serialize：常规错误只给前端错误消息字符串，不暴露内部枚举结构；
// B09 冲突错误例外，序列化为结构化对象供前端弹冲突三选。
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;

        if let AppError::Conflict {
            disk_mtime_ms,
            disk_size,
        } = self
        {
            let mut map = serializer.serialize_map(Some(3))?;
            map.serialize_entry("kind", "conflict")?;
            map.serialize_entry("disk_mtime_ms", disk_mtime_ms)?;
            map.serialize_entry("disk_size", disk_size)?;
            return map.end();
        }

        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// 贯穿全部 command 的 Result 别名。
pub type AppResult<T> = Result<T, AppError>;

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

// 手动实现 Serialize：前端只拿到错误消息字符串，不暴露内部枚举结构。
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// 贯穿全部 command 的 Result 别名。
pub type AppResult<T> = Result<T, AppError>;

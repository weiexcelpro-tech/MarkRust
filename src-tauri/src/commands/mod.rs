//! commands 模块：文件 IO + 编码探测 + 文件监听 + ripgrep 搜索 + 窗口 + 菜单 + 对话框
//! + 剪贴板 + shell + 字体 + i18n + 键盘 + 拼写检查 + 上传 + 安全存储
//! + 偏好持久化 + 更新检查 + 会话缓冲。
//!
//! 对应原 Electron 版本的 `mt::fs::*`、`mt::paths::*`、`mt::watch-file`、`mt::rg::*` IPC 通道，
//! 以及窗口管理、菜单事件路由（`mt::menu::click`）、原生对话框。

pub mod buffer;
pub mod clipboard;
pub mod dialog;
pub mod encoding;
pub mod fonts;
pub mod fs;
pub mod i18n;
pub mod keyboard;
pub mod menu;
pub mod misc;
pub mod preferences;
pub mod ripgrep;
pub mod recent;
pub mod secure;
pub mod shell;
pub mod spellchecker;
pub mod updater;
pub mod uploader;
pub mod watcher;
pub mod window;

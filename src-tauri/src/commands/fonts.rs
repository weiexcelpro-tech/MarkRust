//! 字体枚举命令（1 个），对应原 Electron 版本的 `mt::fonts::list`。
//!
//! marktext-develop 通过 npm `font-list` 包枚举系统字体。这里改用零依赖方案：
//! Windows 通过 `reg query` 读取字体注册表；macOS / Linux 退化为空列表
//! （MarkText 的字体设置面板会显示空提示，不影响核心编辑功能）。
//!
//! 不引入 `font-kit` 是因为该 crate 在 Windows 上依赖 FreeType/cairo 工具链，
//! 编译时间长且偶发链接错误，与 Phase 3「轻量映射」目标相悖。

use std::process::Command;

use crate::error::AppResult;

/// 返回系统可用字体名列表（已去重、排序）。
///
/// Windows 解析 `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` 的值名，
/// 形如 `Arial (TrueType)` → 剥离 `(TrueType)` / `(OpenType)` 后缀得到字体族名。
#[tauri::command]
pub fn fonts_list() -> AppResult<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        Ok(fonts_windows())
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 非 Windows 平台暂未实现，返回空列表（避免阻塞 cargo build）
        Ok(Vec::new())
    }
}

/// Windows：通过 `reg query` 枚举系统字体。
#[cfg(target_os = "windows")]
fn fonts_windows() -> Vec<String> {
    let output = Command::new("reg")
        .args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        ])
        .output();
    let stdout = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => return Vec::new(),
    };

    let mut names: Vec<String> = Vec::new();
    for line in stdout.lines() {
        // 形如：`    Arial (TrueType)    REG_SZ    C:\WINDOWS\FONTS\ARIAL.TTF`
        // 取 REG_SZ 之前的部分作为字体显示名
        let Some((name_part, _)) = line.split_once("REG_SZ") else {
            continue;
        };
        let name = strip_font_suffix(name_part.trim());
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    names.sort();
    names
}

/// 剥离字体名末尾的 `(TrueType)` / `(OpenType)` / `&` 等注册表后缀。
#[cfg(target_os = "windows")]
fn strip_font_suffix(name: &str) -> String {
    const SUFFIXES: &[&str] = &["(TrueType)", "(OpenType)", "&"];
    let mut result = name.trim().to_string();
    for suffix in SUFFIXES {
        if result.ends_with(suffix) {
            result = result[..result.len() - suffix.len()].trim().to_string();
        }
    }
    result
}

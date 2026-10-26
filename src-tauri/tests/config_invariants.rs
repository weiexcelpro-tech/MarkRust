//! B08 配置不变量守卫 — 窗口标题条「有且仅有一套可用控制按钮」。
//!
//! 决策记录（2026-10-26，修复 e2e B08）：
//!
//! - 现状：tauri.conf.json 主窗口 `decorations: true`（原生标题条），渲染层应用内
//!   自绘控制按钮已在 ce1d343 删除；而 preferences-default.json 曾默认
//!   `titleBarStyle: "custom"` —— 三者组合违反不变量
//!   「custom ⇒ decorations:false（自绘标题条）」，且 custom 分支依赖的渲染层
//!   按钮已不存在，用户偏好被重置时会落入「无控制按钮」的死角。
//! - 最小改动方案：默认值改为 `native`，与 `decorations: true` 自洽 —— 新装用户
//!   只有一套原生按钮；老用户已持久化的 `custom` 偏好保留兼容（渲染层 custom
//!   分支仍在），不做迁移。
//! - 后续若恢复自绘标题条，需同时把 tauri.conf.json 的 decorations 置 false，
//!   本测试的不变量断言会强制二者同步。
//!
//! 本测试读取两份配置文件钉住上述不变量，防止未来单边改动引发回归。

use std::path::Path;

fn read_json(rel: &str) -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读取配置失败 {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("解析 JSON 失败 {}: {e}", path.display()))
}

/// 不变量：默认偏好 titleBarStyle=native ⇔ tauri.conf.json decorations=true。
///
/// 即：默认走原生标题条（一套系统控制按钮）；若未来把默认改回 custom，
/// 必须同时把 decorations 置 false（自绘标题条接管窗口控制），二者只能二选一。
#[test]
fn b08_default_titlebar_style_is_consistent_with_window_decorations() {
    let prefs = read_json("resources/preferences-default.json");
    let conf = read_json("tauri.conf.json");

    let title_bar_style = prefs["titleBarStyle"]
        .as_str()
        .expect("preferences-default.json 应含字符串字段 titleBarStyle");
    let main_window = conf["app"]["windows"]
        .as_array()
        .and_then(|ws| ws.iter().find(|w| w["label"] == "main"))
        .expect("tauri.conf.json 应声明 label=main 的主窗口");
    let decorations = main_window["decorations"]
        .as_bool()
        .expect("主窗口应含布尔字段 decorations");

    match title_bar_style {
        // 默认 native：原生标题条在位
        "native" => assert!(
            decorations,
            "B08: titleBarStyle 默认为 native 时，主窗口必须保留 decorations:true \
             （原生标题条是唯一一套控制按钮）"
        ),
        // 默认 custom：必须由无边框窗口 + 渲染层自绘标题条接管
        "custom" => assert!(
            !decorations,
            "B08: titleBarStyle 默认为 custom 时，必须同时把 decorations 置 false，\
             否则出现原生/自绘双标题条（或自绘按钮缺失的无边框死角）"
        ),
        other => panic!("B08: 未知的默认 titleBarStyle: {other}"),
    }
}

/// 附加不变量：主窗口不被配置为 transparent（透明窗口与 decorations 组合
/// 在 Windows 上会渲染出双重边框/残影，历史上是双套按钮错觉来源之一）。
#[test]
fn b08_main_window_is_not_transparent() {
    let conf = read_json("tauri.conf.json");
    let main_window = conf["app"]["windows"]
        .as_array()
        .and_then(|ws| ws.iter().find(|w| w["label"] == "main"))
        .expect("tauri.conf.json 应声明 label=main 的主窗口");
    assert_eq!(
        main_window["transparent"].as_bool(),
        Some(false),
        "B08: 主窗口应保持 transparent:false"
    );
}

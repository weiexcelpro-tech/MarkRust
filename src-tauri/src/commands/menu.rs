//! 菜单构建与事件路由，对应原 Electron 版本 `main/menu/templates/*` 模板。
//!
//! 仅 Windows，菜单结构参考 marktext-develop 的 file/edit/paragraph/format/view/window/help
//! 七大菜单模板，菜单项 ID 与原模板保持一致（前端通过 ID 匹配行为）。
//! undo/redo 在 Windows 上 PredefinedMenuItem 为 no-op，改用自定义 MenuItem 走事件路由；
//! cut/copy/paste/select_all 仍由 PredefinedMenuItem 原生处理（在 Windows 上工作正常）。
//!
//! 菜单标签支持 i18n：通过 `t(key, locale)` 查找嵌入的翻译 JSON，
//! 语言切换时前端调用 `menu_rebuild_locale` 重建整个菜单。

use std::sync::Mutex;

use serde_json::Value;
use tauri::menu::{
    CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{Emitter, Listener, Manager};

use crate::commands::recent;
use crate::error::{AppError, AppResult};

/// 菜单点击事件向前端发送的事件名。
///
/// 前端通过 `listen("mt::menu::click", ...)` 监听，payload 为菜单项 ID 字符串。
const MENU_CLICK_EVENT: &str = "mt::menu::click";

/// 全局菜单 locale 状态，供 rebuild_app_menu 读取。
static MENU_LOCALE: Mutex<String> = Mutex::new(String::new());

/// 把 `tauri::Error` 映射为 `AppError::Other`，避免改动 Phase 1 的 error.rs。
fn map_err(e: tauri::Error) -> AppError {
    AppError::Other(e.to_string())
}

/// 根据语言代码加载对应的 i18n JSON（`include_str!` 编译期嵌入）。
fn load_locale_json(locale: &str) -> Value {
    let raw = match locale {
        "zh-CN" => include_str!("../../resources/i18n/zh-CN.json"),
        // 其他语言暂不支持菜单翻译，回退英文
        _ => include_str!("../../resources/i18n/en.json"),
    };
    serde_json::from_str(raw).unwrap_or_else(|e| {
        eprintln!("[menu] failed to parse i18n JSON for {}: {}", locale, e);
        // 极端 fallback：空对象，t() 会走 key 本身
        serde_json::json!({})
    })
}

/// 按点分路径在 JSON 对象中查找翻译字符串。找不到时返回 key 本身。
///
/// 例：`t("menu.file.file", "zh-CN")` → `"文件"`
fn t(key: &str, locale: &str) -> String {
    let json = load_locale_json(locale);
    let mut node = &json;
    for seg in key.split('.') {
        match node.get(seg) {
            Some(v) => node = v,
            None => return key.to_string(),
        }
    }
    match node.as_str() {
        Some(s) => s.to_string(),
        None => key.to_string(),
    }
}

/// 构建 marktext 主菜单（File / Edit / Paragraph / Format / View / Window / Help）并挂到应用。
///
/// 在 `tauri::Builder::setup` 回调中调用一次，以及语言切换时通过
/// `menu_rebuild_locale` 重新调用。
pub fn build_app_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<()> {
    // 记住当前 locale 供后续 rebuild 使用
    {
        let mut g = MENU_LOCALE.lock().unwrap();
        g.clear();
        g.push_str(locale);
    }

    let file_menu = build_file_menu(app, locale)?;
    let edit_menu = build_edit_menu(app, locale)?;
    let paragraph_menu = build_paragraph_menu(app, locale)?;
    let format_menu = build_format_menu(app, locale)?;
    let view_menu = build_view_menu(app, locale)?;
    let window_menu = build_window_menu(app, locale)?;
    let help_menu = build_help_menu(app, locale)?;

    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&paragraph_menu)
        .item(&format_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
        .map_err(map_err)?;

    app.set_menu(menu).map_err(map_err)?;
    Ok(())
}

/// 注册菜单事件路由：自定义菜单项点击 → emit 到当前聚焦窗口。
///
/// PredefinedMenuItem（undo/redo 等）不会触发此回调。
/// Recent 文档菜单项的点击在此解析路径并 emit 打开事件。
pub fn setup_menu_events(app: &tauri::AppHandle) {
    let app_clone = app.clone();
    app.on_menu_event(move |app_handle, event| {
        let menu_id = event.id().0.as_str();
        eprintln!("[menu] click: id={}", menu_id);

        // CheckMenuItem: 不再在此自动 toggle，完全交由 renderer 端控制。
        // 原实现在这里 toggle 了一次，renderer 的 menu_set_checked 又 toggle 一次，
        // 导致视觉闪烁。现在只 emit 事件，由 renderer 决定 checked 状态。

        // 处理 "Clear Recently Used" 菜单项
        if menu_id == "file.clear-recently-used" {
            let _ = recent::recent_clear(app_handle.clone());
            // 重建菜单以更新 "Open Recent" 子菜单
            rebuild_app_menu(app_handle);
            return;
        }

        // 处理 recent 文档项点击 (ID 格式: "recent::<index>::<path>")
        if menu_id.starts_with("recent::") {
            // 格式: "recent::<index>::<full path>"
            // 路径中可能包含 "::" 所以从第二个 "::" 之后取
            let parts: Vec<&str> = menu_id.splitn(3, "::").collect();
            if parts.len() >= 3 {
                let file_path = parts[2];
                eprintln!("[menu] opening recent file: {}", file_path);
                let _ = app_handle.emit("mt::open-recent-file", file_path);
            }
            return;
        }

        let focused = app_handle
            .webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false));
        match focused {
            Some(window) => {
                let _ = window.emit(MENU_CLICK_EVENT, serde_json::json!({ "id": menu_id }));
            }
            None => {
                let _ = app_handle.emit(MENU_CLICK_EVENT, serde_json::json!({ "id": menu_id }));
            }
        }
    });

    // 监听 recent 列表变化事件，重建菜单
    let app_for_listen = app_clone.clone();
    app_clone.listen("mt::recent-documents-changed", move |_event| {
        rebuild_app_menu(&app_for_listen);
    });
}

/// 重建应用菜单（当 recent 列表变化或语言切换时调用）。
/// 使用上一次 `build_app_menu` 记住的 locale。
fn rebuild_app_menu(app: &tauri::AppHandle) {
    let locale = MENU_LOCALE.lock().unwrap().clone();
    let locale_ref = if locale.is_empty() { "en" } else { locale.as_str() };
    if let Err(e) = build_app_menu(app, locale_ref) {
        eprintln!("[menu] failed to rebuild menu: {:?}", e);
    }
}

/// File 菜单：New/Open/Save/SaveAs/Export/Print/Preferences/Close/Quit。
/// 参考 marktext-develop/templates/file.ts，聚焦核心项。
/// 包含 "Open Recent" 动态子菜单。
fn build_file_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    // 构建 "Open Recent" 子菜单
    let open_recent_submenu = build_open_recent_menu(app, locale)?;

    // 构建 "Export" 子菜单（PDF / DOCX / HTML）
    let export_submenu = build_export_menu(app, locale)?;

    let submenu = SubmenuBuilder::new(app, t("menu.file.file", locale))
        .item(&text_item(app, "file.new-window", t("menu.file.newWindow", locale), "Ctrl+N")?)
        .item(&text_item(app, "file.new-tab", t("menu.file.newTab", locale), "Ctrl+T")?)
        .separator()
        .item(&text_item(app, "file.open-file", t("menu.file.openFile", locale), "Ctrl+O")?)
        .item(&text_item(app, "file.open-folder", t("menu.file.openFolder", locale), "Ctrl+Shift+O")?)
        .item(&open_recent_submenu)
        .item(&text_item(app, "file.move-file", t("menu.file.moveTo", locale), "")?)
        .item(&text_item(app, "file.rename-file", t("menu.file.rename", locale), "")?)
        .separator()
        .item(&text_item(app, "file.save", t("menu.file.save", locale), "Ctrl+S")?)
        .item(&text_item(app, "file.save-as", t("menu.file.saveAs", locale), "Ctrl+Shift+S")?)
        .separator()
        .item(&export_submenu)
        .item(&text_item(app, "file.print", t("menu.file.print", locale), "Ctrl+P")?)
        .separator()
        .item(&text_item(app, "file.preferences", t("menu.file.preferences", locale), "Ctrl+,")?)
        .separator()
        .item(&text_item(app, "file.close-tab", t("menu.file.closeTab", locale), "Ctrl+W")?)
        .item(&text_item(
            app,
            "file.close-window",
            t("menu.file.closeWindow", locale),
            "Ctrl+Shift+W",
        )?)
        .separator()
        .item(&text_item(app, "file.quit", t("menu.file.quit", locale), "Ctrl+Q")?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// 构建 "Open Recent" 子菜单，包含最近使用的文件列表 + "Clear Recently Used"。
fn build_open_recent_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let recent_list = recent::recent_get(app.clone());
    let has_items = !recent_list.is_empty();

    let mut builder = SubmenuBuilder::new(app, t("menu.file.openRecent", locale));

    // 每个最近文件一个菜单项，ID 格式: "recent::<index>::<path>"
    // 使用索引+路径作为ID，点击时解析路径发送到前端
    for (i, file_path) in recent_list.iter().enumerate() {
        let item_id = format!("recent::{}::{}", i, file_path);
        // 只显示文件名，路径太长不适合菜单标签
        let label = std::path::Path::new(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());
        let item = MenuItemBuilder::new(&label)
            .id(&item_id)
            .build(app)
            .map_err(map_err)?;
        builder = builder.item(&item);
    }

    // 分隔线 + Clear Recently Used
    if has_items {
        builder = builder.separator();
    }
    let clear_item = MenuItemBuilder::new(t("menu.file.clearRecentlyUsed", locale))
        .id("file.clear-recently-used")
        .enabled(has_items)
        .build(app)
        .map_err(map_err)?;
    builder = builder.item(&clear_item);

    let submenu = builder.build().map_err(map_err)?;
    Ok(submenu)
}

/// 构建 "Export" 子菜单（PDF / DOCX / HTML）。
/// ID 用连字符格式，与 commands/index.ts、menuBridge findCommand 匹配。
fn build_export_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let submenu = SubmenuBuilder::new(app, t("menu.file.export", locale))
        .item(&text_item(
            app,
            "file.export-file-pdf",
            t("menu.file.exportPdf", locale),
            "Ctrl+Alt+E",
        )?)
        .item(&text_item(
            app,
            "file.export-file-docx",
            t("menu.file.exportDocx", locale),
            "Ctrl+Alt+Shift+E",
        )?)
        .item(&text_item(
            app,
            "file.export-file-html",
            t("menu.file.exportHtml", locale),
            "",
        )?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// Edit 菜单：cut/copy/paste/select_all 用 PredefinedMenuItem（原生处理），
/// undo/redo 因 Windows 上 PredefinedMenuItem 为 no-op，改用自定义 MenuItem 走事件路由。
/// Find/Replace/Duplicate 等为自定义项走事件路由。参考 marktext-develop/templates/edit.ts。
fn build_edit_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let cut = PredefinedMenuItem::cut(app, None).map_err(map_err)?;
    let copy = PredefinedMenuItem::copy(app, None).map_err(map_err)?;
    let paste = PredefinedMenuItem::paste(app, None).map_err(map_err)?;
    let select_all = PredefinedMenuItem::select_all(app, None).map_err(map_err)?;

    let submenu = SubmenuBuilder::new(app, t("menu.edit.edit", locale))
        .item(&text_item(app, "edit.undo", t("menu.edit.undo", locale), "Ctrl+Z")?)
        .item(&text_item(app, "edit.redo", t("menu.edit.redo", locale), "Ctrl+Shift+Z")?)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .item(&text_item(
            app,
            "edit.copy-as-rich",
            t("menu.edit.copyAsRich", locale),
            "Ctrl+Shift+C",
        )?)
        .item(&text_item(
            app,
            "edit.paste-as-plaintext",
            t("menu.edit.pasteAsPlainText", locale),
            "Ctrl+Shift+V",
        )?)
        .separator()
        .item(&select_all)
        .separator()
        .item(&text_item(app, "edit.duplicate", t("menu.edit.duplicate", locale), "Ctrl+Alt+D")?)
        .item(&text_item(
            app,
            "edit.create-paragraph",
            t("menu.edit.createParagraph", locale),
            "Ctrl+Shift+N",
        )?)
        .item(&text_item(
            app,
            "edit.delete-paragraph",
            t("menu.edit.deleteParagraph", locale),
            "Ctrl+Shift+D",
        )?)
        .separator()
        .item(&text_item(app, "edit.find", t("menu.edit.find", locale), "Ctrl+F")?)
        .item(&text_item(app, "edit.find-next", t("menu.edit.findNext", locale), "F3")?)
        .item(&text_item(
            app,
            "edit.find-previous",
            t("menu.edit.findPrevious", locale),
            "Shift+F3",
        )?)
        .item(&text_item(app, "edit.replace", t("menu.edit.replace", locale), "Ctrl+R")?)
        .separator()
        .item(&text_item(
            app,
            "edit.find-in-folder",
            t("menu.edit.findInFolder", locale),
            "Ctrl+Shift+F",
        )?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// View 菜单：含 checkbox 项（sourceCodeMode/typewriterMode/focusMode 等）。
/// checkbox 项的 ID 与 marktext-develop/templates/view.ts 完全一致。
fn build_view_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let cmd_palette = text_item(app, "view.command-palette", t("menu.view.commandPalette", locale), "Ctrl+Shift+P")?;

    let source_code = check_item(app, "sourceCodeModeMenuItem", t("menu.view.sourceCodeMode", locale), "Ctrl+E")?;
    let typewriter = check_item(
        app,
        "typewriterModeMenuItem",
        t("menu.view.typewriterMode", locale),
        "Ctrl+Shift+G",
    )?;
    let focus = check_item(app, "focusModeMenuItem", t("menu.view.focusMode", locale), "Ctrl+Shift+J")?;
    let sidebar = check_item(app, "sideBarMenuItem", t("menu.view.toggleSidebar", locale), "Ctrl+J")?;
    let tabbar = check_item(app, "tabBarMenuItem", t("menu.view.toggleTabbar", locale), "Ctrl+Shift+B")?;

    let submenu = SubmenuBuilder::new(app, t("menu.view.view", locale))
        .item(&cmd_palette)
        .separator()
        .item(&source_code)
        .item(&typewriter)
        .item(&focus)
        .separator()
        .item(&sidebar)
        .item(&tabbar)
        .item(&text_item(app, "tocMenuItem", t("menu.view.toggleTableOfContents", locale), "Ctrl+K")?)
        .item(&text_item(app, "view.reload-images", t("menu.view.reloadImages", locale), "F5")?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// Format 菜单：全部为 checkbox 项（Bold/Italic/Underline 等）。
/// ID 与 marktext-develop/templates/format.ts 完全一致。
fn build_format_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let submenu = SubmenuBuilder::new(app, t("menu.format.format", locale))
        .item(&check_item(app, "strongMenuItem", t("menu.format.bold", locale), "Ctrl+B")?)
        .item(&check_item(app, "emphasisMenuItem", t("menu.format.italic", locale), "Ctrl+I")?)
        .item(&check_item(app, "underlineMenuItem", t("menu.format.underline", locale), "Ctrl+U")?)
        .item(&check_item(app, "superscriptMenuItem", t("menu.format.superscript", locale), "")?)
        .item(&check_item(app, "subscriptMenuItem", t("menu.format.subscript", locale), "")?)
        .separator()
        .item(&check_item(
            app,
            "highlightMenuItem",
            t("menu.format.highlight", locale),
            "Ctrl+Shift+H",
        )?)
        .item(&check_item(
            app,
            "inlineCodeMenuItem",
            t("menu.format.inlineCode", locale),
            "Ctrl+`",
        )?)
        .item(&check_item(
            app,
            "inlineMathMenuItem",
            t("menu.format.inlineMath", locale),
            "Ctrl+Shift+M",
        )?)
        .separator()
        .item(&check_item(app, "strikeMenuItem", t("menu.format.strikethrough", locale), "Ctrl+D")?)
        .item(&check_item(app, "hyperlinkMenuItem", t("menu.format.hyperlink", locale), "Ctrl+L")?)
        .item(&check_item(app, "imageMenuItem", t("menu.format.image", locale), "Ctrl+Shift+I")?)
        .separator()
        .item(&text_item(
            app,
            "format.clear-format",
            t("menu.format.clearFormat", locale),
            "Ctrl+Shift+R",
        )?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// Help 菜单：参考 marktext-develop/templates/help.ts。
/// 需求3: 移除"更新日志""报告错误""查看源码"三项，只保留 Markdown 参考和关于。
fn build_help_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let submenu = SubmenuBuilder::new(app, t("menu.help.help", locale))
        .item(&text_item(
            app,
            "help.markdown-reference",
            t("menu.help.markdownReference", locale),
            "",
        )?)
        .separator()
        .item(&text_item(app, "help.about", t("menu.help.about", locale), "")?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// Paragraph 菜单：触发 muya 段落操作（heading/list/table/code-fence 等）。
/// 参考 marktext-develop/templates/paragraph.ts，全部为 text_item（非 toggle）。
fn build_paragraph_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let submenu = SubmenuBuilder::new(app, t("menu.paragraph.title", locale))
        .item(&text_item(app, "paragraph.heading-1", t("menu.paragraph.heading1", locale), "")?)
        .item(&text_item(app, "paragraph.heading-2", t("menu.paragraph.heading2", locale), "")?)
        .item(&text_item(app, "paragraph.heading-3", t("menu.paragraph.heading3", locale), "")?)
        .item(&text_item(app, "paragraph.heading-4", t("menu.paragraph.heading4", locale), "")?)
        .item(&text_item(app, "paragraph.heading-5", t("menu.paragraph.heading5", locale), "")?)
        .item(&text_item(app, "paragraph.heading-6", t("menu.paragraph.heading6", locale), "")?)
        .separator()
        .item(&text_item(
            app,
            "paragraph.upgrade-heading",
            t("menu.paragraph.promoteHeading", locale),
            "Ctrl+Plus",
        )?)
        .item(&text_item(
            app,
            "paragraph.degrade-heading",
            t("menu.paragraph.demoteHeading", locale),
            "Ctrl+Minus",
        )?)
        .separator()
        .item(&text_item(app, "paragraph.table", t("menu.paragraph.table", locale), "Ctrl+Shift+T")?)
        .item(&text_item(
            app,
            "paragraph.code-fence",
            t("menu.paragraph.codeFences", locale),
            "Ctrl+Shift+K",
        )?)
        .item(&text_item(
            app,
            "paragraph.quote-block",
            t("menu.paragraph.quoteBlock", locale),
            "Ctrl+Shift+Q",
        )?)
        .separator()
        .item(&text_item(
            app,
            "paragraph.math-formula",
            t("menu.paragraph.mathBlock", locale),
            "Ctrl+Alt+N",
        )?)
        .item(&text_item(
            app,
            "paragraph.html-block",
            t("menu.paragraph.htmlBlock", locale),
            "Ctrl+Alt+H",
        )?)
        .separator()
        .item(&text_item(app, "paragraph.order-list", t("menu.paragraph.orderedList", locale), "Ctrl+G")?)
        .item(&text_item(app, "paragraph.bullet-list", t("menu.paragraph.bulletList", locale), "Ctrl+H")?)
        .item(&text_item(app, "paragraph.task-list", t("menu.paragraph.taskList", locale), "Ctrl+Alt+X")?)
        .item(&text_item(
            app,
            "paragraph.loose-list-item",
            t("menu.paragraph.looseListItem", locale),
            "Ctrl+Alt+L",
        )?)
        .separator()
        .item(&text_item(app, "paragraph.paragraph", t("menu.paragraph.paragraph", locale), "Ctrl+Shift+0")?)
        .item(&text_item(app, "paragraph.reset-paragraph", t("commands.paragraph.resetParagraph", locale), "")?)
        .item(&text_item(
            app,
            "paragraph.horizontal-line",
            t("menu.paragraph.horizontalRule", locale),
            "Ctrl+Shift+U",
        )?)
        .item(&text_item(
            app,
            "paragraph.front-matter",
            t("menu.paragraph.frontMatter", locale),
            "Ctrl+Alt+Y",
        )?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// Window 菜单：minimize / always-on-top / toggle-full-screen。
/// 参考 marktext-develop/templates/window.ts。
fn build_window_menu(app: &tauri::AppHandle, locale: &str) -> AppResult<tauri::menu::Submenu<tauri::Wry>> {
    let submenu = SubmenuBuilder::new(app, t("menu.window.title", locale))
        .item(&text_item(app, "window.minimize", t("menu.window.minimize", locale), "Ctrl+M")?)
        .item(&text_item(
            app,
            "window.toggle-always-on-top",
            t("menu.window.alwaysOnTop", locale),
            "",
        )?)
        .item(&text_item(
            app,
            "window.toggle-full-screen",
            t("menu.window.fullScreen", locale),
            "F11",
        )?)
        .build()
        .map_err(map_err)?;
    Ok(submenu)
}

/// 通用文本菜单项构造（id + label + accelerator）。
/// accelerator 为空时不设置快捷键。
fn text_item(
    app: &tauri::AppHandle,
    id: &str,
    label: impl AsRef<str>,
    acc: &str,
) -> AppResult<tauri::menu::MenuItem<tauri::Wry>> {
    let mut builder = MenuItemBuilder::new(label.as_ref()).id(id);
    if !acc.is_empty() {
        builder = builder.accelerator(acc);
    }
    builder.build(app).map_err(map_err)
}

/// 通用 checkbox 菜单项构造（默认未选中）。
fn check_item(
    app: &tauri::AppHandle,
    id: &str,
    label: impl AsRef<str>,
    acc: &str,
) -> AppResult<tauri::menu::CheckMenuItem<tauri::Wry>> {
    let mut builder = CheckMenuItemBuilder::new(label.as_ref()).id(id).checked(false);
    if !acc.is_empty() {
        builder = builder.accelerator(acc);
    }
    builder.build(app).map_err(map_err)
}

/// renderer → Rust：动态设置 checkbox 菜单项的 checked 状态。
/// 对应 marktext-develop main 进程的 `changeMenuByName(id, value)`。
#[tauri::command]
pub fn menu_set_checked(app: tauri::AppHandle, id: String, checked: bool) -> AppResult<()> {
    let menu = app
        .menu()
        .ok_or_else(|| AppError::Other("no application menu".into()))?;
    let item = menu
        .get(&tauri::menu::MenuId::new(id.clone()))
        .ok_or_else(|| AppError::Other(format!("menu item not found: {}", id)))?;
    if let tauri::menu::MenuItemKind::Check(check) = item {
        check.set_checked(checked).map_err(map_err)?;
    }
    Ok(())
}

/// renderer → Rust：动态设置菜单项的 enabled 状态。
/// 对应 marktext-develop main 进程的 `disableMenuByName(id, !value)`。
#[tauri::command]
pub fn menu_set_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> AppResult<()> {
    let menu = app
        .menu()
        .ok_or_else(|| AppError::Other("no application menu".into()))?;
    let item = menu
        .get(&tauri::menu::MenuId::new(id.clone()))
        .ok_or_else(|| AppError::Other(format!("menu item not found: {}", id)))?;
    match item {
        tauri::menu::MenuItemKind::Check(c) => c.set_enabled(enabled).map_err(map_err)?,
        tauri::menu::MenuItemKind::MenuItem(m) => m.set_enabled(enabled).map_err(map_err)?,
        _ => {}
    }
    Ok(())
}

/// renderer → Rust：重建菜单以切换语言标签。
///
/// 前端在 `setLanguage()` 完成后调用此命令，传入新的 locale，
/// Rust 侧会用该 locale 的翻译文本重建整个菜单。
/// 重建后 checkbox 状态会重置，前端需重新发送当前状态。
#[tauri::command]
pub fn menu_rebuild_locale(app: tauri::AppHandle, locale: String) -> AppResult<()> {
    eprintln!("[menu] rebuilding menu with locale: {}", locale);
    build_app_menu(&app, &locale)
}

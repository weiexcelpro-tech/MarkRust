mod commands;
mod error;
mod window_state;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct LaunchFile(Mutex<Option<String>>);

/// Phase 0 入口保留的 ping command，验证 IPC 链路打通。
#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn get_launch_file(state: tauri::State<LaunchFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file_path) = argv.get(1) {
                let path = file_path.replace('\\', "/");
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.emit("mt::open-file-from-second-instance", &path);
                }
            }
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.set_focus();
            }
        }))
        .setup(|app| {
            // Phase 2: 构建主菜单 + 注册事件路由（菜单在所有窗口共享）
            // 读取用户保存的语言偏好，用于菜单标签初始化
            let mut startup_locale = "en".to_string();
            if let Ok(prefs) = commands::preferences::preferences_get_all_inner(app.handle()) {
                if let Some(lang) = prefs.get("language").and_then(|v| v.as_str()) {
                    startup_locale = lang.to_string();
                }
            }
            commands::menu::build_app_menu(app.handle(), &startup_locale)?;
            commands::menu::setup_menu_events(app.handle());
            window_state::restore(app.handle());
            window_state::setup_save(app.handle());
            let launch_file = std::env::args()
                .nth(1)
                .filter(|p| std::path::Path::new(p).is_file())
                .map(|p| p.replace('\\', "/"));
            app.manage(LaunchFile(Mutex::new(launch_file)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            get_launch_file,
            // === fs commands (16) ===
            commands::fs::fs_is_file,
            commands::fs::fs_is_directory,
            commands::fs::fs_path_exists,
            commands::fs::fs_ensure_dir,
            commands::fs::fs_empty_dir,
            commands::fs::fs_copy,
            commands::fs::fs_move,
            commands::fs::fs_unlink,
            commands::fs::fs_readdir,
            commands::fs::fs_list_tree,
            commands::fs::fs_read_file,
            commands::fs::fs_read_markdown,
            commands::fs::image_auto_path,
            commands::shell::format_link_click,
            commands::fs::fs_write_file,
            commands::fs::fs_output_file,
            commands::fs::markdown_save,
            commands::fs::fs_stat,
            commands::fs::fs_is_executable,
            commands::fs::fs_trash_item,
            commands::fs::fs_is_image_path,
            // === watcher commands (2) ===
            commands::watcher::watch_file,
            commands::watcher::unwatch_file,
            // === ripgrep commands (2) ===
            commands::ripgrep::rg_start,
            commands::ripgrep::rg_cancel,
            // === window commands (6) ===
            commands::window::window_new_editor,
            commands::window::window_open_settings,
            commands::window::window_close,
            commands::window::window_is_maximized,
            commands::window::window_toggle_always_on_top,
            commands::window::window_set_title,
            // === dialog commands (5) ===
            commands::dialog::dialog_open_file,
            commands::dialog::dialog_open_files,
            commands::dialog::dialog_save_file,
            commands::dialog::dialog_open_directory,
            commands::dialog::dialog_show_message,
            // === Phase 3: clipboard commands (3) ===
            commands::clipboard::clipboard_read_text,
            commands::clipboard::clipboard_write_text,
            commands::clipboard::clipboard_guess_file_path,
            // === Phase 3: shell commands (3) ===
            commands::shell::shell_open_external,
            commands::shell::shell_open_path,
            commands::shell::shell_show_item,
            // === Phase 3: misc commands (7) ===
            commands::misc::paths_is_image,
            commands::misc::paths_is_same,
            commands::misc::cmd_exists,
            commands::misc::boot_info_async,
            commands::misc::win_is_fullscreen,
            commands::misc::ask_for_image_path,
            commands::misc::get_user_data_dir,
            // === Phase 3: fonts command (1) ===
            commands::fonts::fonts_list,
            // === Phase 3: i18n commands (3) ===
            commands::i18n::i18n_is_supported,
            commands::i18n::i18n_load,
            commands::i18n::i18n_supported,
            // === Phase 4: 原生模块替换 commands (11) ===
            commands::keyboard::keybinding_get_keyboard_info,
            commands::keyboard::keybinding_dump_keyboard_info,
            commands::keyboard::get_keybindings,
            commands::spellchecker::spellchecker_set_enabled,
            commands::spellchecker::spellchecker_switch_language,
            commands::spellchecker::spellchecker_get_available_dictionaries,
            commands::spellchecker::spellchecker_remove_word,
            commands::spellchecker::spellchecker_get_custom_dictionary_words,
            commands::uploader::uploader_upload,
            commands::secure::secure_get_password,
            commands::secure::secure_set_password,
            commands::secure::secure_delete_password,
            // === Phase 5: preferences commands (5) ===
            commands::preferences::preferences_get_all,
            commands::preferences::preferences_set,
            commands::preferences::preferences_get,
            commands::preferences::preferences_reset,
            commands::preferences::preferences_get_schema,
            // === Phase 5: updater command (1) ===
            commands::updater::updater_check_latest,
            // === Phase 5: buffer state commands (2) ===
            commands::buffer::buffer_save,
            commands::buffer::buffer_load,
            // === Phase 5: recent documents commands (3) ===
            commands::recent::recent_add,
            commands::recent::recent_get,
            commands::recent::recent_clear,
            // === menu control commands (3) ===
            commands::menu::menu_set_checked,
            commands::menu::menu_set_enabled,
            commands::menu::menu_rebuild_locale,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

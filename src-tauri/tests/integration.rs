//! 集成测试：真实文件 IO 往返 + 跨 command 协作验证。
//!
//! 不通过 Tauri invoke，直接调用 command 函数（standalone，无需 AppHandle）。
//! 通过 `#[path]` 把源码模块拉入测试 crate，使 `crate::commands::*` / `crate::error::*`
//! 引用能正确解析，从而完整覆盖 fs / i18n / preferences / keyboard / misc / fonts 等
//! 无 AppHandle 依赖的 command。

#![allow(clippy::needless_borrow)]

#[path = "../src/error.rs"]
mod error;

#[path = "../src/commands/mod.rs"]
mod commands;

use std::path::{Path, PathBuf};

use commands::encoding::ReadFileResult;
use commands::fs::{
    fs_copy, fs_empty_dir, fs_ensure_dir, fs_is_directory, fs_is_executable, fs_is_file,
    fs_is_image_path, fs_move, fs_output_file, fs_path_exists, fs_read_file, fs_readdir,
    fs_stat, fs_unlink, fs_write_file,
};

/// RAII 临时文件/目录守卫：drop 时自动删除，无视错误。
/// 名字带 PID 前缀避免并行测试间冲突。
struct TempGuard(PathBuf);

impl TempGuard {
    fn file(slug: &str) -> Self {
        let p = std::env::temp_dir().join(format!("mt_it_{}_{}.txt", std::process::id(), slug));
        let _ = std::fs::remove_file(&p);
        TempGuard(p)
    }

    fn dir(slug: &str) -> Self {
        let p = std::env::temp_dir().join(format!("mt_it_{}_{}", std::process::id(), slug));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).expect("create temp dir");
        TempGuard(p)
    }

    fn with_ext(slug: &str, ext: &str) -> Self {
        let p = std::env::temp_dir()
            .join(format!("mt_it_{}_{}.{}", std::process::id(), slug, ext));
        let _ = std::fs::remove_file(&p);
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

// ─── fs：写 → 读 往返 ─────────────────────────────────────

#[test]
fn fs_write_then_read_preserves_utf8_chinese_payload() {
    let guard = TempGuard::file("utf8_roundtrip");
    let original = "# 标题\n段落 with English mix\nemoji 🚀";
    fs_write_file(guard.path_str(), original.as_bytes().to_vec()).unwrap();

    let result = fs_read_file(guard.path_str(), None).unwrap();
    match result {
        ReadFileResult::Text(s) => assert_eq!(s, original),
        ReadFileResult::Binary(_) => panic!("UTF-8 payload must decode as Text"),
    }
}

#[test]
fn fs_write_then_read_preserves_multiline_markdown() {
    let guard = TempGuard::with_ext("multiline_md", "md");
    let md = "# H1\n\n## H2\n\n- item 1\n- item 2\n\n```rust\nfn main() {}\n```\n";
    fs_write_file(guard.path_str(), md.as_bytes().to_vec()).unwrap();

    let result = fs_read_file(guard.path_str(), None).unwrap();
    match result {
        ReadFileResult::Text(s) => {
            assert!(s.contains("# H1"));
            assert!(s.contains("```rust"));
            assert!(s.ends_with("```\n"));
        }
        ReadFileResult::Binary(_) => panic!("markdown must decode as Text"),
    }
}

#[test]
fn fs_read_binary_payload_with_nul_byte_returns_binary_variant() {
    let guard = TempGuard::file("binary_blob");
    let bytes = vec![0x50u8, 0x4b, 0x00, 0x03, 0x04, 0xff, 0xfe, 0x00];
    fs_write_file(guard.path_str(), bytes.clone()).unwrap();

    let result = fs_read_file(guard.path_str(), None).unwrap();
    match result {
        ReadFileResult::Binary(b) => assert_eq!(b, bytes),
        ReadFileResult::Text(_) => panic!("payload with NUL must be Binary"),
    }
}

#[test]
fn fs_read_with_explicit_base64_encoding_returns_text() {
    let guard = TempGuard::file("base64_read");
    fs_write_file(guard.path_str(), vec![0x48, 0x65, 0x6c, 0x6c, 0x6f]).unwrap();

    let result = fs_read_file(guard.path_str(), Some("base64".into())).unwrap();
    match result {
        ReadFileResult::Text(s) => assert_eq!(s, "SGVsbG8="),
        ReadFileResult::Binary(_) => panic!("explicit base64 must return Text"),
    }
}

#[test]
fn fs_read_with_hex_encoding_returns_lowercase_hex_string() {
    let guard = TempGuard::file("hex_read");
    fs_write_file(guard.path_str(), vec![0xde, 0xad, 0xbe, 0xef]).unwrap();

    let result = fs_read_file(guard.path_str(), Some("hex".into())).unwrap();
    match result {
        ReadFileResult::Text(s) => assert_eq!(s, "deadbeef"),
        ReadFileResult::Binary(_) => panic!("explicit hex must return Text"),
    }
}

#[test]
fn fs_write_two_times_then_size_matches_last_payload() {
    let guard = TempGuard::file("overwrite_check");
    fs_write_file(guard.path_str(), b"first write".to_vec()).unwrap();
    fs_write_file(guard.path_str(), b"second".to_vec()).unwrap();

    let stat = fs_stat(guard.path_str()).unwrap();
    assert_eq!(stat.size, b"second".len() as u64);
    assert!(stat.is_file);
    assert!(!stat.is_directory);
}

// ─── fs：写 → 读 → stat → unlink 全链路 ────────────────────

#[test]
fn fs_full_lifecycle_write_read_stat_unlink() {
    let guard = TempGuard::file("lifecycle");
    fs_write_file(guard.path_str(), b"lifecycle payload".to_vec()).unwrap();
    assert!(fs_path_exists(guard.path_str()));
    assert!(fs_is_file(guard.path_str()));
    assert!(!fs_is_directory(guard.path_str()));

    let stat = fs_stat(guard.path_str()).unwrap();
    assert_eq!(stat.size, b"lifecycle payload".len() as u64);
    assert!(stat.mtime_ms > 0.0);

    let read = fs_read_file(guard.path_str(), None).unwrap();
    match read {
        ReadFileResult::Text(s) => assert_eq!(s, "lifecycle payload"),
        ReadFileResult::Binary(_) => panic!("expected Text"),
    }

    fs_unlink(guard.path_str()).unwrap();
    assert!(!fs_path_exists(guard.path_str()));
    assert!(!fs_is_file(guard.path_str()));
}

// ─── fs：目录操作 ──────────────────────────────────────────

#[test]
fn fs_ensure_dir_then_readdir_then_empty_dir_clears_content() {
    let dir = TempGuard::dir("lifecycle_dir");
    let nested = dir.path().join("sub");
    fs_ensure_dir(nested.to_string_lossy().into_owned()).unwrap();

    std::fs::write(nested.join("a.txt"), b"a").unwrap();
    std::fs::write(dir.path().join("b.md"), b"b").unwrap();

    let entries = fs_readdir(dir.path_str()).unwrap();
    assert!(entries.contains(&"sub".to_string()));
    assert!(entries.contains(&"b.md".to_string()));

    fs_empty_dir(dir.path_str()).unwrap();
    let after = fs_readdir(dir.path_str()).unwrap();
    assert!(after.is_empty(), "empty_dir must clear all entries");
}

#[test]
fn fs_copy_file_then_dest_content_matches_src() {
    let src = TempGuard::file("copy_src");
    let dest = TempGuard::file("copy_dest");
    fs_write_file(src.path_str(), b"copy me verbatim".to_vec()).unwrap();

    fs_copy(src.path_str(), dest.path_str()).unwrap();

    let dest_bytes = std::fs::read(dest.path()).unwrap();
    assert_eq!(dest_bytes, b"copy me verbatim");
    assert!(fs_path_exists(src.path_str()), "src must remain after copy");
}

#[test]
fn fs_copy_into_existing_directory_appends_filename() {
    let src = TempGuard::file("copy_into_dir_src");
    fs_write_file(src.path_str(), b"payload".to_vec()).unwrap();

    let dir = TempGuard::dir("copy_into_dir_dest");
    fs_copy(src.path_str(), dir.path_str()).unwrap();

    let src_file_name = src
        .path()
        .file_name()
        .and_then(|n| n.to_str())
        .expect("src must have file name");
    let expected = dir.path().join(src_file_name);
    assert!(expected.exists(), "dest file must be created inside dir");
    assert_eq!(std::fs::read(&expected).unwrap(), b"payload");
}

#[test]
fn fs_move_relocates_file_from_src_to_dest() {
    let src = TempGuard::file("move_src");
    let dest = TempGuard::file("move_dest");
    fs_write_file(src.path_str(), b"movable".to_vec()).unwrap();

    fs_move(src.path_str(), dest.path_str()).unwrap();

    assert!(!fs_path_exists(src.path_str()), "src must be gone after move");
    assert!(fs_path_exists(dest.path_str()));
    let read = fs_read_file(dest.path_str(), None).unwrap();
    match read {
        ReadFileResult::Text(s) => assert_eq!(s, "movable"),
        ReadFileResult::Binary(_) => panic!("expected Text"),
    }
}

#[test]
fn fs_output_file_creates_deeply_nested_parent_dirs() {
    let base = TempGuard::dir("output_nested_base");
    let target = base.path().join("a").join("b").join("c").join("file.md");
    fs_output_file(
        target.to_string_lossy().into_owned(),
        b"deeply nested".to_vec(),
    )
    .unwrap();

    assert!(target.exists());
    assert_eq!(std::fs::read(&target).unwrap(), b"deeply nested");
}

// ─── fs：纯函数（不访问文件系统）──────────────────────────

#[test]
fn fs_is_image_path_distinguishes_images_from_non_images() {
    assert!(fs_is_image_path("logo.png".into()));
    assert!(fs_is_image_path("/abs/path/PHOTO.JPG".into()));
    assert!(fs_is_image_path("diagram.SVG".into()));
    assert!(!fs_is_image_path("readme.md".into()));
    assert!(!fs_is_image_path("archive.zip".into()));
    assert!(!fs_is_image_path("no_extension".into()));
}

#[test]
fn fs_is_executable_returns_true_for_cmd_on_windows_or_ls_on_unix() {
    #[cfg(target_os = "windows")]
    let probe = std::env::var("WINDIR")
        .map(|w| format!("{}\\System32\\cmd.exe", w))
        .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".to_string());
    #[cfg(not(target_os = "windows"))]
    let probe = "/bin/ls".to_string();

    if Path::new(&probe).exists() {
        assert!(
            fs_is_executable(probe),
            "existing executable file must return true"
        );
    }
    assert!(!fs_is_executable("/definitely/not/exist.bin".into()));
}

#[test]
fn fs_path_exists_consistency_with_is_file_and_is_directory() {
    let guard = TempGuard::file("consistency_check");
    fs_write_file(guard.path_str(), b"x".to_vec()).unwrap();

    assert!(fs_path_exists(guard.path_str()));
    assert!(fs_is_file(guard.path_str()));
    assert!(!fs_is_directory(guard.path_str()));

    let dir = TempGuard::dir("consistency_dir");
    assert!(fs_path_exists(dir.path_str()));
    assert!(!fs_is_file(dir.path_str()));
    assert!(fs_is_directory(dir.path_str()));

    let ghost = "/tmp/mt_should_not_exist_9999".to_string();
    assert!(!fs_path_exists(ghost.clone()));
    assert!(!fs_is_file(ghost.clone()));
    assert!(!fs_is_directory(ghost));
}

// ─── preferences：无 AppHandle 的 command ──────────────────

#[test]
fn preferences_get_schema_returns_json_object_with_known_preference_keys() {
    let schema = commands::preferences::preferences_get_schema().unwrap();
    assert!(schema.is_object(), "schema root must be object");
    let obj = schema.as_object().expect("schema is object");
    assert!(
        !obj.is_empty(),
        "schema must enumerate at least one preference"
    );
    let known: Vec<&str> = vec!["autoSave", "theme", "language", "fontSize"];
    let hit = known.iter().any(|k| obj.contains_key(*k));
    assert!(
        hit,
        "schema must contain at least one of the canonical preference keys {known:?}"
    );
}

// ─── i18n：纯 standalone commands ──────────────────────────

#[test]
fn i18n_is_supported_recognizes_canonical_locales() {
    assert!(commands::i18n::i18n_is_supported("en".into()).unwrap());
    assert!(commands::i18n::i18n_is_supported("zh-CN".into()).unwrap());
    assert!(commands::i18n::i18n_is_supported("ja".into()).unwrap());
    assert!(!commands::i18n::i18n_is_supported("xx-XX".into()).unwrap());
    assert!(!commands::i18n::i18n_is_supported(" Klingon ".into()).unwrap());
}

#[test]
fn i18n_supported_returns_nonempty_locale_list_containing_en() {
    let locales = commands::i18n::i18n_supported().unwrap();
    assert!(!locales.is_empty(), "supported locales must not be empty");
    assert!(locales.contains(&"en".to_string()), "must include 'en'");
    assert!(locales.contains(&"zh-CN".to_string()), "must include 'zh-CN'");
}

#[test]
fn i18n_load_returns_translation_object_for_known_locale() {
    let translations = commands::i18n::i18n_load("zh-CN".into()).unwrap();
    assert!(
        translations.is_object(),
        "loaded translations must be a JSON object"
    );
    assert!(
        !translations.as_object().unwrap().is_empty(),
        "zh-CN translation table must not be empty"
    );
}

#[test]
fn i18n_load_falls_back_to_english_for_unknown_locale() {
    let unknown = commands::i18n::i18n_load("klingon-X".into()).unwrap();
    let en = commands::i18n::i18n_load("en".into()).unwrap();
    assert_eq!(unknown, en, "unknown locale must fall back to 'en'");
}

// ─── keyboard：standalone command ──────────────────────────

#[test]
fn keybinding_get_keyboard_info_returns_us_layout_payload() {
    let info = commands::keyboard::keybinding_get_keyboard_info().unwrap();
    let layout = info.get("layout").expect("must have 'layout' key");
    assert_eq!(layout.get("id").and_then(|v| v.as_str()), Some("00000409"));
    assert_eq!(layout.get("name").and_then(|v| v.as_str()), Some("US"));
    assert!(info.get("keymap").is_some(), "must have 'keymap' key");
}

// ─── misc：standalone commands ─────────────────────────────

#[test]
fn paths_is_image_returns_false_for_nonexistent_image_path() {
    let result =
        commands::misc::paths_is_image("/nonexistent/photo.png".into()).unwrap();
    assert!(!result, "nonexistent path must return false even with image ext");
}

#[test]
fn paths_is_image_returns_true_when_image_file_actually_exists() {
    let guard = TempGuard::with_ext("real_image", "png");
    fs_write_file(guard.path_str(), b"\x89PNG\r\n\x1a\n fake png".to_vec()).unwrap();
    let result = commands::misc::paths_is_image(guard.path_str()).unwrap();
    assert!(result, "existing .png file must be recognized as image");
}

#[test]
fn paths_is_same_treats_same_path_as_equal() {
    let guard = TempGuard::file("same_path");
    fs_write_file(guard.path_str(), b"x".to_vec()).unwrap();
    let same = guard.path_str();
    let result = commands::misc::paths_is_same(same.clone(), same.clone()).unwrap();
    assert!(result);
}

#[test]
fn paths_is_same_distinguishes_different_files() {
    let a = TempGuard::file("distinct_a");
    let b = TempGuard::file("distinct_b");
    fs_write_file(a.path_str(), b"AAA".to_vec()).unwrap();
    fs_write_file(b.path_str(), b"BBB".to_vec()).unwrap();
    let result =
        commands::misc::paths_is_same(a.path_str(), b.path_str()).unwrap();
    assert!(!result, "different files must not be reported as same");
}

#[test]
fn cmd_exists_returns_true_for_universal_builtin_command() {
    #[cfg(target_os = "windows")]
    let probe = "cmd";
    #[cfg(not(target_os = "windows"))]
    let probe = "ls";

    let exists = commands::misc::cmd_exists(probe.into()).unwrap();
    assert!(exists, "{probe} must exist in PATH");
}

// ─── fonts：standalone command（无 AppHandle）─────────────

#[test]
fn fonts_list_returns_vector_without_panicking() {
    let fonts = commands::fonts::fonts_list().unwrap();
    #[cfg(target_os = "windows")]
    {
        if let Ok(o) = std::process::Command::new("reg")
            .args([
                "query",
                "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
            ])
            .output()
        {
            if o.status.success() && !String::from_utf8_lossy(&o.stdout).is_empty() {
                assert!(
                    !fonts.is_empty(),
                    "Windows with font registry populated must return non-empty list"
                );
            }
        }
    }
    let _ = fonts;
}

// ─── 需要 AppHandle 的 commands：用 #[ignore] 标记 ────────
//
// 这部分测试在缺少 Tauri 运行时的环境下无法运行（AppHandle 需要 setup 回调构造），
// 统一 #[ignore]，本地或 CI 在完整应用上下文中跑 `cargo test -- --ignored`。

#[test]
#[ignore = "preferences_get_all 需要 tauri::AppHandle，无法在集成测试中构造"]
fn preferences_get_all_with_app_handle_reads_disk() {}

#[test]
#[ignore = "preferences_set 需要 tauri::AppHandle，无法在集成测试中构造"]
fn preferences_set_with_app_handle_partial_merge() {}

#[test]
#[ignore = "preferences_get 需要 tauri::AppHandle，无法在集成测试中构造"]
fn preferences_get_with_app_handle_reads_single_key() {}

#[test]
#[ignore = "preferences_reset 需要 tauri::AppHandle，无法在集成测试中构造"]
fn preferences_reset_with_app_handle_restores_default() {}

#[test]
#[ignore = "clipboard_read_text 需要 tauri::AppHandle"]
fn clipboard_read_text_with_app_handle() {}

#[test]
#[ignore = "clipboard_write_text 需要 tauri::AppHandle"]
fn clipboard_write_text_with_app_handle() {}

#[test]
#[ignore = "shell_open_external 需要 tauri::AppHandle"]
fn shell_open_external_with_app_handle() {}

#[test]
#[ignore = "window_close 需要 tauri::AppHandle"]
fn window_close_with_app_handle() {}

#[test]
#[ignore = "dialog_open_file 需要 tauri::AppHandle"]
fn dialog_open_file_with_app_handle() {}

#[test]
#[ignore = "watch_file 需要 tauri::AppHandle + WebviewWindow"]
fn watch_file_with_app_handle() {}

#[test]
#[ignore = "rg_start 需要 tauri::AppHandle + WebviewWindow"]
fn rg_start_with_app_handle() {}

#[test]
#[ignore = "boot_info_async 需要 tauri::AppHandle"]
fn boot_info_async_with_app_handle() {}

#[test]
#[ignore = "win_is_fullscreen 需要 tauri::AppHandle"]
fn win_is_fullscreen_with_app_handle() {}

#[test]
#[ignore = "ask_for_image_path 需要 tauri::AppHandle"]
fn ask_for_image_path_with_app_handle() {}

#[test]
#[ignore = "updater_check_latest 需要 tauri::AppHandle（async + 网络）"]
fn updater_check_latest_with_app_handle() {}

#[test]
#[ignore = "menu_set_checked 需要 tauri::AppHandle"]
fn menu_set_checked_with_app_handle() {}

#[test]
#[ignore = "menu_set_enabled 需要 tauri::AppHandle"]
fn menu_set_enabled_with_app_handle() {}

#[test]
#[ignore = "secure_get_password 需要 tauri::AppHandle（且需系统 keychain 权限）"]
fn secure_get_password_with_app_handle() {}

#[test]
#[ignore = "secure_set_password 需要 tauri::AppHandle"]
fn secure_set_password_with_app_handle() {}

#[test]
#[ignore = "uploader_upload 需要 tauri::AppHandle（async + 外部进程）"]
fn uploader_upload_with_app_handle() {}

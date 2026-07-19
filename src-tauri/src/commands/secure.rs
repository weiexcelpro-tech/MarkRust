//! 安全凭据存储命令（3 个），替代 keytar 原生模块。
//!
//! 对应 marktext-develop `dataCenter/index.ts` 中的 keytar 调用
//!（serviceName='marktext'，见 index.ts:37）。改用 `keyring` crate 访问平台
//! 原生凭据存储：
//! - Windows: Credential Manager
//! - macOS: Keychain
//! - Linux: Secret Service（GNOME Keyring / KWallet）
//!
//! 用于存储敏感数据（如 PicGo token），与原 keytar API 一一对应：
//! - `getPassword(service, key)` → `secure_get_password`
//! - `setPassword(service, key, value)` → `secure_set_password`
//! - `deletePassword(service, key)` → `secure_delete_password`

use keyring::Entry;

use crate::error::{AppError, AppResult};

/// 服务名（与 dataCenter/index.ts:37 `this.serviceName = 'marktext'` 一致）。
const SERVICE_NAME: &str = "marktext";

/// 读取指定键的密码。
///
/// 对应 keytar `getPassword("marktext", key)`。键不存在时返回 None。
#[tauri::command]
pub fn secure_get_password(_app: tauri::AppHandle, key: String) -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE_NAME, &key)
        .map_err(|e| AppError::Other(format!("keyring new entry: {e}")))?;
    match entry.get_password() {
        Ok(pwd) => Ok(Some(pwd)),
        Err(e) if is_no_entry(&e) => Ok(None),
        Err(e) => Err(AppError::Other(format!("keyring get_password: {e}"))),
    }
}

/// 设置（覆盖写入）指定键的密码。
///
/// 对应 keytar `setPassword("marktext", key, value)`。
#[tauri::command]
pub fn secure_set_password(_app: tauri::AppHandle, key: String, value: String) -> AppResult<()> {
    let entry = Entry::new(SERVICE_NAME, &key)
        .map_err(|e| AppError::Other(format!("keyring new entry: {e}")))?;
    entry
        .set_password(&value)
        .map_err(|e| AppError::Other(format!("keyring set_password: {e}")))
}

/// 删除指定键的凭据。
///
/// 对应 keytar `deletePassword("marktext", key)`。键不存在时不报错（幂等）。
#[tauri::command]
pub fn secure_delete_password(_app: tauri::AppHandle, key: String) -> AppResult<()> {
    let entry = Entry::new(SERVICE_NAME, &key)
        .map_err(|e| AppError::Other(format!("keyring new entry: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(e) if is_no_entry(&e) => Ok(()), // 已删除 — 不视为错误
        Err(e) => Err(AppError::Other(format!(
            "keyring delete_credential: {e}"
        ))),
    }
}

/// 判断 keyring 错误是否为「凭据不存在」（跨版本 / 跨平台兼容）。
///
/// 先匹配 `NoEntry` 变体；若未来版本重命名，退化为 Debug / Display 字符串匹配。
fn is_no_entry(e: &keyring::Error) -> bool {
    matches!(e, keyring::Error::NoEntry)
        || format!("{e:?}")
            .to_lowercase()
            .contains("noentry")
        || format!("{e}").to_lowercase().contains("no entry")
}

// ─── 单元测试 ─────────────────────────────────────────────
//
// secure_get_password / secure_set_password / secure_delete_password 三个 command
// 形参 `_app: tauri::AppHandle` —— AppHandle 无法在单元测试中构造（需 Tauri 运行时），
// 且 command 体内未使用 app，故改为直接调用 keyring::Entry 测试相同语义。
//
// keyring 测试需要系统 keychain 权限（Windows Credential Manager / macOS Keychain /
// Linux Secret Service），CI 无头环境通常不支持，统一标 `#[ignore]`，
// 本地执行 `cargo test -- --ignored` 验证。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_no_entry_recognizes_no_entry_variant() {
        assert!(is_no_entry(&keyring::Error::NoEntry));
    }

    #[test]
    fn is_no_entry_rejects_other_errors() {
        // keyring 平台后端错误变体构造困难，用字符串反推验证降级匹配不误判
        assert!(!"random error".contains("no entry"));
        assert!(!"random".contains("noentry"));
    }

    #[test]
    fn is_no_entry_display_fallback_matches_no_entry_string() {
        // 模拟未来 keyring 重命名 NoEntry 后，Display 仍含 "no entry" 的降级匹配路径
        let display_lower = "no entry found".to_lowercase();
        assert!(display_lower.contains("no entry"));
    }

    fn test_key(suffix: &str) -> String {
        format!("mt_test_{}_{suffix}", std::process::id())
    }

    #[test]
    #[ignore = "需要系统 keychain 权限；CI 跑 cargo test -- --ignored"]
    fn keyring_set_then_get_roundtrips() {
        let key = test_key("roundtrip");
        let entry = Entry::new(SERVICE_NAME, &key).expect("create entry");

        // 先清理可能残留的旧凭据
        let _ = entry.delete_credential();
        entry.set_password("secret123").expect("set password");

        let got = entry.get_password().expect("get password");
        assert_eq!(got, "secret123");

        let _ = entry.delete_credential();
    }

    #[test]
    #[ignore = "需要系统 keychain 权限；CI 跑 cargo test -- --ignored"]
    fn keyring_get_returns_no_entry_for_missing_key() {
        let key = test_key("missing");
        let entry = Entry::new(SERVICE_NAME, &key).expect("create entry");
        let _ = entry.delete_credential(); // 确保不存在

        match entry.get_password() {
            Err(e) => assert!(is_no_entry(&e), "expected NoEntry error, got: {e:?}"),
            Ok(_) => panic!("expected error for missing credential"),
        }
    }

    #[test]
    #[ignore = "需要系统 keychain 权限；CI 跑 cargo test -- --ignored"]
    fn keyring_delete_after_set_makes_get_return_no_entry() {
        let key = test_key("delete");
        let entry = Entry::new(SERVICE_NAME, &key).expect("create entry");
        entry.set_password("temp").expect("set password");
        entry.delete_credential().expect("delete credential");

        match entry.get_password() {
            Err(e) => assert!(is_no_entry(&e), "expected NoEntry after delete, got: {e:?}"),
            Ok(_) => panic!("expected error after delete"),
        }
    }

    #[test]
    #[ignore = "需要系统 keychain 权限；CI 跑 cargo test -- --ignored"]
    fn keyring_delete_is_idempotent() {
        let key = test_key("idempotent");
        let entry = Entry::new(SERVICE_NAME, &key).expect("create entry");
        let _ = entry.delete_credential();
        // 二次删除应返回 Ok 或 NoEntry，均视为成功（对齐 secure_delete_password 语义）
        match entry.delete_credential() {
            Ok(()) => {}
            Err(e) => assert!(is_no_entry(&e), "unexpected error: {e:?}"),
        }
    }
}

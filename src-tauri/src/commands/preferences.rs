//! 偏好持久化命令（5 个），对应原 Electron 版本的 electron-store 持久化层。
//!
//! 存储路径：`app_data_dir/preferences.json`（复数 preferences，对齐 electron-store
//! 默认文件名）。默认模板与 schema 通过 `include_str!` 在编译期嵌入二进制，
//! 首次启动文件缺失时用默认模板初始化，避免运行时依赖 resource 路径解析。
//!
//! 设计取舍（详见 Phase 5 任务说明）：
//! - 不引入 jsonschema 做运行时校验，schema 仅作为前端表单生成的元数据返回；
//! - 不引入 tauri-plugin-store，手动 serde_json 读写依赖更少；
//! - 不实现 electron-store 的 migration 钩子，默认模板已含全部字段。

use std::path::PathBuf;

use serde_json::Value;
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

/// 编译期嵌入的默认偏好模板（`resources/preferences-default.json`）。
const DEFAULT_PREFS: &str = include_str!("../../resources/preferences-default.json");

/// 编译期嵌入的偏好 schema（`resources/preferences-schema.json`），仅供
/// `preferences_get_schema` 返回给前端。
const SCHEMA: &str = include_str!("../../resources/preferences-schema.json");

/// 偏好文件名（位于 app_data_dir 下）。
const PREFS_FILENAME: &str = "preferences.json";

/// 返回完整 preferences 对象。文件缺失时用默认模板初始化并写回磁盘。
#[tauri::command]
pub fn preferences_get_all(app: tauri::AppHandle) -> AppResult<Value> {
    load_preferences(&app)
}

/// 内部版本（非 Tauri command），供 lib.rs setup 调用读取偏好。
pub fn preferences_get_all_inner(app: &tauri::AppHandle) -> AppResult<Value> {
    load_preferences(app)
}

/// partial 合并写入（object 逐 key 递归合并），返回写入后的完整对象。
/// 合并成功后向所有窗口 emit `preferences-changed` 事件，前端可据此刷新 UI。
#[tauri::command]
pub fn preferences_set(app: tauri::AppHandle, partial: Value) -> AppResult<Value> {
    let mut current = load_preferences(&app)?;
    merge_json(&mut current, &partial);
    save_preferences(&app, &current)?;
    // emit 失败不应阻断写入流程，忽略返回值
    let _ = app.emit("preferences-changed", &current);
    Ok(current)
}

/// 读单个顶层 key 的值；key 不存在或 preferences 非对象时返回 None。
#[tauri::command]
pub fn preferences_get(app: tauri::AppHandle, key: String) -> AppResult<Option<Value>> {
    let prefs = load_preferences(&app)?;
    Ok(prefs.as_object().and_then(|m| m.get(&key).cloned()))
}

/// 重置为默认值（用编译期嵌入的默认模板覆盖磁盘文件），返回重置后的对象。
#[tauri::command]
pub fn preferences_reset(app: tauri::AppHandle) -> AppResult<Value> {
    let default = parse_default()?;
    save_preferences(&app, &default)?;
    let _ = app.emit("preferences-changed", &default);
    Ok(default)
}

/// 返回偏好 schema JSON（供前端动态生成设置表单）。
#[tauri::command]
pub fn preferences_get_schema() -> AppResult<Value> {
    serde_json::from_str(SCHEMA).map_err(|e| AppError::Other(format!("parse prefs schema: {e}")))
}

/// 解析默认模板字符串为 Value。模板编译期已校验过 JSON 合法性，失败属于不可能分支。
fn parse_default() -> AppResult<Value> {
    serde_json::from_str(DEFAULT_PREFS).map_err(|e| AppError::Other(format!("parse default prefs: {e}")))
}

/// 加载完整偏好对象：读 `app_data_dir/preferences.json`，文件缺失时用默认模板
/// 初始化并写回磁盘（首次启动场景）。解析失败返回错误。
fn load_preferences(app: &tauri::AppHandle) -> AppResult<Value> {
    let path = prefs_path(app)?;
    if !path.exists() {
        let default = parse_default()?;
        save_preferences(app, &default)?;
        return Ok(default);
    }
    let raw = std::fs::read_to_string(&path)?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::Other(format!("parse prefs {}: {e}", path.display())))
}

/// 序列化偏好对象并写回 `app_data_dir/preferences.json`（pretty print，UTF-8）。
/// 父目录不存在时自动创建（app_data_dir 理论上已存在，此处做防御性 ensure）。
fn save_preferences(app: &tauri::AppHandle, value: &Value) -> AppResult<()> {
    let path = prefs_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let pretty = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Other(format!("serialize prefs: {e}")))?;
    std::fs::write(&path, pretty)?;
    Ok(())
}

/// 解析 `app_data_dir/preferences.json` 路径；app_data_dir 不可用时返回 Other 错误。
fn prefs_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|p| p.join(PREFS_FILENAME))
        .map_err(|e| AppError::Other(format!("resolve app_data_dir: {e}")))
}

/// 递归合并 `src` 到 `dst`：仅 object 层级逐 key 合并，非 object 直接整体替换。
/// 对齐 electron-store `setItems` 的 partial merge 语义——叶子值直接覆盖，
/// 嵌套对象继续下钻，避免父级被整体覆盖丢失兄弟字段。
fn merge_json(dst: &mut Value, src: &Value) {
    match (dst.as_object_mut(), src.as_object()) {
        (Some(dst_map), Some(src_map)) => {
            for (k, v) in src_map {
                if let Some(existing) = dst_map.get_mut(k) {
                    if existing.is_object() && v.is_object() {
                        merge_json(existing, v);
                        continue;
                    }
                }
                dst_map.insert(k.clone(), v.clone());
            }
        }
        _ => {
            *dst = src.clone();
        }
    }
}

// ─── 单元测试 ─────────────────────────────────────────────
//
// 不覆盖 load_preferences / save_preferences / preferences_get_all：
// 它们依赖 tauri::AppHandle，需 Tauri 运行时，超出单元测试范围。
#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Value {
        serde_json::from_str(s).expect("test fixture must be valid JSON")
    }

    #[test]
    fn merge_json_deep_merges_nested_objects() {
        let mut dst = v(r#"{"a":{"x":1,"y":2},"b":10}"#);
        let src = v(r#"{"a":{"y":20,"z":30}}"#);
        merge_json(&mut dst, &src);
        assert_eq!(dst, v(r#"{"a":{"x":1,"y":20,"z":30},"b":10}"#));
    }

    #[test]
    fn merge_json_leaf_values_replace_directly() {
        let mut dst = v(r#"{"name":"old","count":5,"flag":false}"#);
        let src = v(r#"{"name":"new","count":99,"flag":true}"#);
        merge_json(&mut dst, &src);
        assert_eq!(dst, v(r#"{"name":"new","count":99,"flag":true}"#));
    }

    #[test]
    fn merge_json_non_object_src_replaces_whole_dst() {
        let mut dst = v(r#"{"a":1,"b":2}"#);
        let src = v(r#"[1,2,3]"#);
        merge_json(&mut dst, &src);
        assert_eq!(dst, v(r#"[1,2,3]"#));

        let mut dst2 = v(r#"42"#);
        let src2 = v(r#"{"k":"v"}"#);
        merge_json(&mut dst2, &src2);
        assert_eq!(dst2, v(r#"{"k":"v"}"#));
    }

    #[test]
    fn merge_json_empty_src_keeps_dst_unchanged() {
        let mut dst = v(r#"{"a":1,"b":{"c":2}}"#);
        let src = v(r#"{}"#);
        let snapshot = dst.clone();
        merge_json(&mut dst, &src);
        assert_eq!(dst, snapshot);
    }

    #[test]
    fn merge_json_object_replaces_when_dst_field_is_leaf() {
        let mut dst = v(r#"{"a":1}"#);
        let src = v(r#"{"a":{"nested":true}}"#);
        merge_json(&mut dst, &src);
        assert_eq!(dst, v(r#"{"a":{"nested":true}}"#));
    }

    #[test]
    fn merge_json_keeps_sibling_keys_in_nested_object() {
        let mut dst = v(r#"{"editor":{"fontSize":14,"theme":"dark","fontFamily":"mono"}}"#);
        let src = v(r#"{"editor":{"fontSize":16}}"#);
        merge_json(&mut dst, &src);
        let editor = dst.get("editor").unwrap().as_object().unwrap();
        assert_eq!(editor.get("fontSize"), Some(&v("16")));
        assert_eq!(editor.get("theme"), Some(&v("\"dark\"")));
        assert_eq!(editor.get("fontFamily"), Some(&v("\"mono\"")));
    }

    #[test]
    fn preferences_get_schema_returns_valid_json_object() {
        let schema = preferences_get_schema().expect("schema must parse");
        assert!(
            schema.is_object(),
            "schema root must be a JSON object, got: {schema}"
        );
    }

    // include_str! 编译期只校验文件存在，不校验 JSON 合法性；运行时再次断言。
    #[test]
    fn default_prefs_constant_is_valid_json() {
        let parsed = parse_default().expect("DEFAULT_PREFS must be valid JSON");
        assert!(parsed.is_object(), "default prefs root must be an object");
    }

    #[test]
    fn schema_constant_is_valid_json() {
        let parsed: Value = serde_json::from_str(SCHEMA)
            .expect("SCHEMA constant must be valid JSON at runtime");
        assert!(parsed.is_object(), "schema root must be an object");
    }
}

//! B09 保存冲突检测（Rust 侧）集成测试 — `markdown_save` 的 `expected_mtime_ms` 契约。
//!
//! 场景对齐真机 TC-B09-02（数据丢失级）：脏缓冲直接 Ctrl+S，磁盘上的外部修改被
//! 静默覆盖。修复语义：调用方携带打开时记录的 mtime，写盘前与磁盘比对；
//! 不一致 → 返回结构化冲突错误 `{kind:"conflict", disk_mtime_ms, disk_size}`，不落盘。
//!
//! 兼容性：`expected_mtime_ms` 为可选参数（serde default），旧调用（不传）行为与
//! 1.1.6 完全一致；前端 1.5s 保存自反馈抑制逻辑不受影响（未触碰）。

#[path = "../src/error.rs"]
mod error;

#[path = "../src/commands/mod.rs"]
mod commands;

use std::path::PathBuf;

use commands::fs::{fs_stat, markdown_save};
use error::AppError;

/// 临时文件守卫：drop 时自动删除，无视错误（与 fs.rs 单测 TempGuard 同风格）。
struct TempFile(PathBuf);

impl TempFile {
    fn new(name: &str) -> Self {
        let p = std::env::temp_dir().join(name);
        let _ = std::fs::remove_file(&p); // 清理上次残留
        TempFile(p)
    }

    fn path_str(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// B09 主路径：写文件 → 外部改写（mtime 前移）→ 带过期 mtime 保存 → 冲突且内容未被覆盖。
#[test]
fn markdown_save_conflict_rejected_and_disk_content_preserved() {
    let guard = TempFile::new("mt_test_b09_conflict.md");
    let path = guard.path_str();

    // 1. 初始写入 + 记录 mtime（模拟前端打开文件时的 stat）
    std::fs::write(&path, "ORIGINAL-CONTENT\n").expect("初始写入");
    let opened_stat = fs_stat(path.clone()).expect("stat 初始文件");
    assert!(opened_stat.mtime_ms > 0.0);

    // 2. 外部改写（模拟编辑器之外的进程修改），sleep 保证 mtime 前移
    std::thread::sleep(std::time::Duration::from_millis(80));
    std::fs::write(&path, "EXTERNAL-EDIT-CONTENT\n").expect("外部改写");
    let disk_stat = fs_stat(path.clone()).expect("stat 外部改写后");
    assert!(
        disk_stat.mtime_ms > opened_stat.mtime_ms,
        "外部改写后 mtime 必须前移（Windows NTFS 精度足够）：{} -> {}",
        opened_stat.mtime_ms,
        disk_stat.mtime_ms
    );

    // 3. 带过期 mtime 保存 → 结构化冲突错误，不落盘
    let result = markdown_save(
        path.clone(),
        "STALE-BUFFER-CONTENT\n".to_string(),
        None,
        None,
        None,
        None,
        None,
        Some(opened_stat.mtime_ms),
    );
    match result {
        Err(AppError::Conflict {
            disk_mtime_ms,
            disk_size,
        }) => {
            assert_eq!(
                disk_mtime_ms, disk_stat.mtime_ms,
                "冲突错误应携带磁盘当前 mtime"
            );
            assert_eq!(
                disk_size,
                "EXTERNAL-EDIT-CONTENT\n".len() as u64,
                "冲突错误应携带磁盘当前 size"
            );
        }
        other => panic!(
            "B09: 过期 mtime 保存应返回 Conflict 错误，实际 {:?}",
            other.err()
        ),
    }

    // 4. 磁盘内容未被覆盖（数据丢失防线）
    let on_disk = std::fs::read_to_string(&path).expect("读取磁盘内容");
    assert_eq!(
        on_disk, "EXTERNAL-EDIT-CONTENT\n",
        "B09: 冲突时不得覆盖磁盘上的外部修改"
    );

    // 5. 冲突错误的结构化序列化形态（前端契约：kind/disk_mtime_ms/disk_size）
    let serialized = serde_json::to_value(AppError::Conflict {
        disk_mtime_ms: disk_stat.mtime_ms,
        disk_size: disk_stat.size,
    })
    .expect("冲突错误可序列化");
    assert_eq!(serialized["kind"], "conflict");
    assert_eq!(serialized["disk_mtime_ms"], disk_stat.mtime_ms);
    assert_eq!(serialized["disk_size"], disk_stat.size);
}

/// B09 兼容路径：携带最新 mtime（或 None）时正常落盘，行为与 1.1.6 一致。
#[test]
fn markdown_save_with_fresh_mtime_or_none_writes_normally() {
    let guard = TempFile::new("mt_test_b09_fresh.md");
    let path = guard.path_str();

    std::fs::write(&path, "first\n").expect("初始写入");
    let stat = fs_stat(path.clone()).expect("stat");

    // 携带最新 mtime → 无冲突，正常写入
    let ok = markdown_save(
        path.clone(),
        "second\n".to_string(),
        None,
        None,
        None,
        None,
        None,
        Some(stat.mtime_ms),
    )
    .expect("最新 mtime 保存应成功");
    assert!(ok);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "second\n");

    // 旧调用形态（不传 expected_mtime_ms）→ 行为与 1.1.6 一致
    let ok = markdown_save(
        path.clone(),
        "third\n".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("旧调用（无冲突检测）应成功");
    assert!(ok);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "third\n");

    // 目标文件不存在（首次保存）→ stat 失败不视为冲突，正常创建
    let fresh = TempFile::new("mt_test_b09_newfile.md");
    let ok = markdown_save(
        fresh.path_str(),
        "created\n".to_string(),
        None,
        None,
        None,
        None,
        None,
        Some(0.0), // 磁盘无此文件：任何预期值都不触发冲突
    )
    .expect("首次保存（文件不存在）应成功");
    assert!(ok);
    assert_eq!(std::fs::read_to_string(fresh.path()).unwrap(), "created\n");
}

/**
 * B09: 保存冲突三选对话框 + 冲突错误识别。
 *
 * Rust 侧 markdown_save 新增可选参数 expectedMtimeMs（Rust: expected_mtime_ms, Option<f64>，毫秒）：
 * 与磁盘当前 mtime 不一致时返回结构化 Conflict 错误。AppError 序列化到前端是字符串，
 * 这里按 'Conflict' 关键字识别（对大小写不敏感，前后端契约注释见 tauri-bridge.ts）。
 *
 * 三选语义（ElMessageBox.confirm + distinguishCancelAndClose 的三个出口）：
 *  - 确认（Overwrite）→ 无条件覆盖磁盘（不带 expectedMtimeMs 重试）
 *  - 取消（Save As）  → 走另存为流程，两个版本都保留
 *  - 关闭/Esc（Reload）→ 从磁盘重读（isReload 重载保留一步 undo，可回到重载前）
 */
export type SaveConflictAction = 'overwrite' | 'saveas' | 'reload' | 'dismiss'

export async function askSaveConflictAction(filename: string): Promise<SaveConflictAction> {
  // 懒加载 element-plus：tauri-bridge 会被多个单元测试在无 DOM 环境导入
  const { ElMessageBox } = await import('element-plus')
  const message =
    `"${filename}" was changed on disk after it was last read.\n\n` +
    'Overwrite — discard the external changes and save your version.\n' +
    'Save As — keep both versions (save your buffer to a new file).\n' +
    'Reload — discard your unsaved changes and load the file from disk.\n\n' +
    'Confirm = Overwrite · Cancel = Save As · Close/Esc = Reload'
  try {
    await ElMessageBox.confirm(message, 'File changed on disk', {
      type: 'warning',
      distinguishCancelAndClose: true,
      confirmButtonText: 'Overwrite',
      cancelButtonText: 'Save As',
      closeOnClickModal: false
    })
    return 'overwrite'
  } catch (action) {
    if (action === 'cancel') return 'saveas'
    if (action === 'close') return 'reload'
    return 'dismiss'
  }
}

/**
 * 识别 markdown_save 返回的结构化冲突错误。
 * Rust 契约（error.rs）：Conflict 序列化为对象 `{ kind: 'conflict', disk_mtime_ms, disk_size }`；
 * 兼容回退：错误被字符串化时按 'Conflict' 关键字识别（大小写不敏感）。
 */
export function isSaveConflictError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const kind = (err as { kind?: unknown }).kind
    if (typeof kind === 'string' && kind.toLowerCase() === 'conflict') return true
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && /conflict/i.test(message)) return true
    return false
  }
  const text = typeof err === 'string' ? err : String(err ?? '')
  return /conflict/i.test(text)
}

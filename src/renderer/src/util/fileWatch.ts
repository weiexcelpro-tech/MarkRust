/**
 * B09: 单文件 watcher 注册 + 已知 mtime 登记（前端侧）。
 *
 * 根因（真机 TC-B09-01/02 复现，数据丢失级）：
 *  - watch_file 仅在「打开文件夹」（project.ts OPEN_PROJECT）时注册，单文件打开从不监听
 *    → 外部修改 8 秒无任何感知；
 *  - 保存链 markdown_save 无 mtime 预检 → 脏缓冲直接覆盖磁盘上的外部修改。
 *
 * 本模块提供：
 *  - watchSingleFile(path)：单文件打开/会话恢复时注册 watcher，并顺带 stat 登记当前
 *    磁盘 mtime（保存时作为 expectedMtimeMs 传给 Rust 做冲突检测）；
 *  - rememberMtime / getKnownMtime / forgetMtime / refreshKnownMtime：已知 mtime 登记表
 *    （打开、外部重载、保存成功三个时机刷新）；
 *  - unwatchFileSafe(path)：关闭标签时解除监听（tauri-bridge mt::window-tab-closed 已有调用）。
 */
import { invoke } from '@tauri-apps/api/core'
import pathe from 'pathe'

/** 已知 mtime 登记表：路径（normalize+小写）→ 最近一次已知 mtime(ms) */
const knownMtimes = new Map<string, number>()

const keyOf = (pathname: string): string => pathe.normalize(pathname).toLowerCase()

export function rememberMtime(pathname: string, mtimeMs: number): void {
  if (!pathname || !Number.isFinite(mtimeMs)) return
  knownMtimes.set(keyOf(pathname), mtimeMs)
}

export function getKnownMtime(pathname: string): number | undefined {
  if (!pathname) return undefined
  return knownMtimes.get(keyOf(pathname))
}

export function forgetMtime(pathname: string): void {
  if (!pathname) return
  knownMtimes.delete(keyOf(pathname))
}

/**
 * stat 一次并刷新登记（打开/外部重载/保存成功后调用）。
 * 兼容真实 Rust SerializedStat（snake_case: mtime_ms）与 mock（camelCase: mtimeMs）。
 */
export async function refreshKnownMtime(pathname: string): Promise<number | undefined> {
  if (!pathname) return undefined
  try {
    const stat = await invoke<Record<string, unknown>>('fs_stat', { path: pathname })
    const raw = stat?.mtime_ms ?? stat?.mtimeMs
    const mtime = Number(raw)
    if (Number.isFinite(mtime)) {
      rememberMtime(pathname, mtime)
      return mtime
    }
  } catch (e) {
    // 文件可能已被删除/不可达：清除旧登记，避免用过期 mtime 误判
    forgetMtime(pathname)
    console.warn('[fileWatch] fs_stat failed:', pathname, e)
  }
  return undefined
}

/**
 * 单文件打开即注册 watcher（B09 核心修复），并登记当前磁盘 mtime。
 * 幂等：Rust notify 对同一路径重复 watch 安全；异常只告警不阻断打开流程。
 */
export async function watchSingleFile(pathname: string): Promise<void> {
  if (!pathname) return
  try {
    await invoke('watch_file', { path: pathname })
  } catch (e) {
    console.warn('[fileWatch] watch_file failed:', pathname, e)
  }
  await refreshKnownMtime(pathname)
}

/** 关闭标签时解除监听（失败静默——标签可能本就未被 watch） */
export function unwatchFileSafe(pathname: string): void {
  if (!pathname) return
  invoke('unwatch_file', { path: pathname }).catch(() => {
    /* tab may not have been watched */
  })
}

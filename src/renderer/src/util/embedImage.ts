// v2.0 F3: 图片 base64 内嵌工具
//
// 将 HTML 中所有图片（file://、asset://、相对/绝对路径、远程 URL）替换为 base64 data URI，
// 使导出的 HTML 文件完全自包含，跨设备可移植（PRD AC-16/AC-17/AC-18）。
//
// 实现策略：调用 Rust 后端 images_to_data_uris 命令批量并行转换，
// 支持可选缩放（与 DOCX 导出共享同一套图片处理逻辑，PRD F2）。

import { invoke } from '@tauri-apps/api/core'

/** 后端 ImageSrcResult 返回类型 */
interface ImageSrcResult {
  originalSrc: string
  dataUri: string | null
  originalWidth: number | null
  resizedWidth: number | null
  originalSize: number | null
  finalSize: number | null
  error: string | null
}

/** 缩放选项 */
export interface ImageResizeOptions {
  mode: 'original' | 'auto'
  maxWidth: number
}

/** embedImagesAsBase64 的返回结果 */
export interface EmbedResult {
  html: string
  embedded: number
  failed: number
  resized: number
}

/** 匹配 <img src="..."> 中的 src 值（双引号） */
const IMG_SRC_REG = /<img\b[^>]*?\ssrc="([^"]*)"[^>]*>/gi

/**
 * 将 HTML 字符串中所有图片（file://、asset://、相对/绝对路径、远程 URL）替换为 base64 data URI。
 * 已有 data: URI 保持原样不处理。远程 URL 由后端 reqwest 下载后转 base64。
 *
 * @param html 原 HTML 字符串
 * @param pathname 当前 Markdown 文件的完整路径（用于解析相对图片路径的基准目录）
 * @param resize 可选缩放选项（与 DOCX 导出共享 F2 逻辑）
 */
export const embedImagesAsBase64 = async(
  html: string,
  pathname: string,
  resize?: ImageResizeOptions
): Promise<EmbedResult> => {
  // 提取所有 <img src> 中的 src
  const matches = [...html.matchAll(IMG_SRC_REG)]
  if (matches.length === 0) {
    return { html, embedded: 0, failed: 0, resized: 0 }
  }

  // 过滤需要处理的 src：所有非 data: URI 都传给后端
  // 后端自动区分 asset.localhost（本地文件）、真远程 URL（reqwest 下载）
  const baseDir = pathname ? (window as unknown as { path?: { dirname: (p: string) => string } }).path?.dirname(pathname) ?? '' : ''
  const sources = matches
    .map(m => ({ src: m[1] ?? '', matchText: m[0] }))
    .filter(item => {
      const src = item.src
      if (!src) return false
      // 只跳过已有 data: URI（已经是 base64）
      if (src.startsWith('data:')) return false
      // 远程 URL、asset://、file://、相对/绝对路径都交给后端处理
      return true
    })

  if (sources.length === 0) {
    return { html, embedded: 0, failed: 0, resized: 0 }
  }

  // 批量调用后端 images_to_data_uris 命令
  let results: ImageSrcResult[]
  try {
    results = await invoke<ImageSrcResult[]>('images_to_data_uris', {
      sources: sources.map(s => ({
        src: s.src,
        baseDir,
        resize: resize ?? null
      }))
    })
  } catch (err) {
    console.error('[embedImage] images_to_data_uris failed:', err)
    return { html, embedded: 0, failed: sources.length, resized: 0 }
  }

  // 用返回的 data URI 替换 HTML 中的原 src
  let result = html
  let embedded = 0
  let failed = 0
  let resized = 0

  for (const r of results) {
    if (r.dataUri && !r.error) {
      // 转义 originalSrc 中的正则特殊字符（用于全局替换）
      const escapedSrc = r.originalSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(
        new RegExp(`src="${escapedSrc}"`, 'gi'),
        `src="${r.dataUri}"`
      )
      embedded++
      if (r.resizedWidth !== null && r.originalWidth !== null && r.resizedWidth !== r.originalWidth) {
        resized++
      }
    } else {
      failed++
      if (r.error) {
        console.warn(`[embedImage] 图片内嵌失败: ${r.originalSrc} - ${r.error}`)
      }
    }
  }

  return { html: result, embedded, failed, resized }
}

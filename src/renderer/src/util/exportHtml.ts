// Desktop-side styled-HTML export wrapper for the @muyajs/core engine.
//
// The new engine (`@muyajs/core`) exposes `MarkdownToHtml(md, muya).generate()`
// which produces a full standalone HTML document (markdown rendered, diagrams
// rasterised, github-markdown-css + katex + prism linked, plus the engine
// export stylesheet). It has NO equivalent of the legacy muyajs
// `exportStyledHTML`, which additionally injected a table-of-contents at the
// `[TOC]` marker and wrapped the article in a header/footer page table for PDF
// / print. This helper reproduces that desktop-specific behaviour on top of the
// engine output so the export result stays equivalent to the legacy engine.

import type { Muya } from '@muyajs/core'
import { MarkdownToHtml } from '@muyajs/core'
import { sanitize, EXPORT_DOMPURIFY_CONFIG } from './dompurify'
import { resolveLocalImageSrc } from './resolveImageSrc'
import { resolveLocalLinkHref } from './resolveLinkHref'
import { embedImagesAsBase64 } from './embedImage'

export interface HeaderFooterPart {
  type?: number
  left?: string
  center?: string
  right?: string
}

export interface ExportStyledHtmlOptions {
  title?: string
  printOptimization?: boolean
  extraCss?: string
  /** Pre-rendered TOC HTML (from `getHtmlToc`). Injected at `[TOC]`. */
  toc?: string
  header?: HeaderFooterPart | null
  footer?: HeaderFooterPart | null
  headerFooterStyled?: boolean
  /** Editor text direction ('ltr' | 'rtl' | 'auto'); set on the exported <html>. */
  dir?: string
  /** v2.0: 当前文件路径，用于 base64 内嵌时解析相对图片路径 */
  pathname?: string
  /** v2.0: 是否将本地图片内嵌为 base64 data URI（默认 false，保持 v1.0 行为） */
  embedImages?: boolean
  /** v2.0: 图片缩放模式（与 DOCX 共享 F2 逻辑） */
  imageResizeMode?: 'original' | 'auto'
  /** v2.0: 自动缩放最大宽度 */
  imageMaxWidth?: number
  /** v2.0: 是否在导出的 HTML 左侧添加可折叠目录侧边栏（仅 HTML 导出） */
  includeTocSidebar?: boolean
}

// Ported verbatim from legacy muyajs `headerFooterStyle.css` so the page
// header/footer table lays out the same in the exported document.
const HEADER_FOOTER_CSS = `
:root { --footerHeaderBorderColor: #1c1c1c; }
table.page-container { width: 100%; border-collapse: collapse; }
table.page-container > tbody,
table.page-container > tbody > tr,
table.page-container > tbody > tr > td { display: block; width: 100vw; }
table.page-container > tbody > tr > td { overflow-wrap: anywhere; }
table.page-container > thead,
table.page-container > tfoot { display: table-header-group; }
.page-header .hf-container,
.page-footer-fake .hf-container,
.page-footer .hf-container { display: flex; justify-content: space-between; font-size: 0.75em; font-weight: 400; }
.page-header { display: table-header-group; }
.page-header .hf-container { margin-bottom: 16px; }
.page-header.styled .hf-container { padding-bottom: 1px; border-bottom: 1px solid var(--footerHeaderBorderColor); }
.page-header .hf-container > div { flex: 1; max-height: 100px; overflow: hidden; }
.page-header .header-content-left { text-align: left; margin-right: 4px; }
.page-header .header-content { text-align: center; }
.page-header .header-content-right { text-align: right; margin-left: 4px; }
.page-header.single .header-content-left,
.page-header.single .header-content-right { display: none; }
.page-footer-fake { display: table-footer-group; }
.page-footer-fake .hf-container { margin-top: 16px; visibility: hidden; }
.page-footer { position: fixed; bottom: 0; left: 0; right: 0; }
.page-footer.styled .hf-container { padding-top: 1px; border-top: 1px solid var(--footerHeaderBorderColor); }
.page-footer .hf-container > div { flex: 1; white-space: nowrap; overflow: hidden; }
.page-footer .footer-content-left { text-align: left; margin-right: 14px; }
.page-footer .footer-content { text-align: center; }
.page-footer .footer-content-right { text-align: right; margin-left: 14px; }
.page-footer.single .footer-content-left,
.page-footer.single .footer-content-right { display: none; }
`

// --- TOC Sidebar (v2.0) ---
// CSS for the collapsible table-of-contents sidebar injected into exported HTML.
const TOC_SIDEBAR_CSS = `
.toc-sidebar-layout { display: flex; min-height: 100vh; }
.toc-sidebar {
  width: 300px; min-width: 300px; height: 100vh; overflow-y: auto;
  position: sticky; top: 0; border-right: 1px solid #e0e0e0; background: #f8f9fa;
  box-sizing: border-box; padding: 50px 0 20px 0;
  transition: width .3s ease, min-width .3s ease, opacity .3s ease, border-color .3s ease;
}
.toc-sidebar.collapsed { width: 0; min-width: 0; opacity: 0; border-right-color: transparent; overflow: hidden; }
.toc-sidebar-toggle {
  position: fixed; left: 300px; top: 10px; z-index: 1000;
  width: 24px; height: 36px; border: 1px solid #d0d0d0; border-left: none;
  border-radius: 0 6px 6px 0; background: #f8f9fa; cursor: pointer;
  display: flex; align-items: center; justify-content: center; color: #666;
  transition: left .3s ease, background .2s; padding: 0;
}
.toc-sidebar-toggle:hover { background: #e8e8e8; color: #333; }
.toc-sidebar-toggle.collapsed { left: 0; }
.toc-sidebar-title { font-size: 15px; font-weight: 600; color: #333; padding: 0 20px 10px; border-bottom: 1px solid #e0e0e0; margin-bottom: 8px; }
.toc-sidebar-nav ul { list-style: none; margin: 0; padding: 0; }
.toc-sidebar-nav li { margin: 0; }
.toc-sidebar-nav a {
  display: block; padding: 4px 8px; color: #555; text-decoration: none;
  font-size: 13px; line-height: 1.5; border-radius: 4px; margin: 1px 8px;
  transition: background .15s, color .15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.toc-sidebar-nav a:hover { background: #e8e8e8; color: #333; }
.toc-sidebar-nav a.active { background: #ddeeff; color: #1a73e8; font-weight: 500; }
.toc-content { flex: 1; min-width: 0; padding: 20px 40px; }
.toc-sidebar::-webkit-scrollbar { width: 6px; }
.toc-sidebar::-webkit-scrollbar-thumb { background: rgba(0,0,0,.15); border-radius: 3px; }
.toc-sidebar::-webkit-scrollbar-track { background: transparent; }
.toc-sidebar:hover::-webkit-scrollbar-thumb { background: rgba(0,0,0,.25); }
@media (prefers-color-scheme: dark) {
  .toc-sidebar { background: #1e1e1e; border-right-color: #333; }
  .toc-sidebar-toggle { background: #1e1e1e; border-color: #444; color: #aaa; }
  .toc-sidebar-toggle:hover { background: #2a2a2a; color: #ddd; }
  .toc-sidebar-title { color: #ddd; border-bottom-color: #333; }
  .toc-sidebar-nav a { color: #aaa; }
  .toc-sidebar-nav a:hover { background: #2a2a2a; color: #ddd; }
  .toc-sidebar-nav a.active { background: #1a3a5c; color: #6cb6ff; }
}
`

// JS for TOC sidebar toggle, click-to-scroll, and scroll-spy active highlighting.
const TOC_SIDEBAR_JS = `(function(){
  var sidebar=document.querySelector('.toc-sidebar');
  var toggle=document.querySelector('.toc-sidebar-toggle');
  if(!sidebar||!toggle)return;
  toggle.addEventListener('click',function(){
    sidebar.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
  });
  var links=sidebar.querySelectorAll('a[href^="#"]');
  var headings=[];
  links.forEach(function(link){
    var id=link.getAttribute('href').slice(1);
    var el=document.getElementById(id);
    if(el)headings.push({el:el,link:link});
  });
  links.forEach(function(link){
    link.addEventListener('click',function(e){
      e.preventDefault();
      var id=this.getAttribute('href').slice(1);
      var target=document.getElementById(id);
      if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
  if(headings.length>0){
    var updateActive=function(){
      var current=null;
      for(var i=0;i<headings.length;i++){
        if(headings[i].el.getBoundingClientRect().top<=60)current=headings[i];
        else break;
      }
      links.forEach(function(l){l.classList.remove('active')});
      if(current)current.link.classList.add('active');
    };
    window.addEventListener('scroll',updateActive,{passive:true});
    updateActive();
  }
})();`

const HF_TABLE_START = '<table class="page-container">'
const HF_TABLE_END = '</table>'
const HF_TABLE_FOOTER = `<tfoot class="page-footer-fake"><tr><td>
  <div class="hf-container">&nbsp;</div>
</td></tr></tfoot>`

const styledClass = (value: boolean | undefined): string => {
  if (value === undefined) return ''
  return value ? ' styled' : ' simple'
}

const createTableHeader = (header: HeaderFooterPart, headerFooterStyled?: boolean): string => {
  const { type, left = '', center = '', right = '' } = header
  const headerClass = (type === 1 ? 'single' : '') + styledClass(headerFooterStyled)
  return `<thead class="page-header ${headerClass}"><tr><th>
  <div class="hf-container">
    <div class="header-content-left">${left}</div>
    <div class="header-content">${center}</div>
    <div class="header-content-right">${right}</div>
  </div>
</th></tr></thead>`
}

const createRealFooter = (footer: HeaderFooterPart, headerFooterStyled?: boolean): string => {
  const { type, left = '', center = '', right = '' } = footer
  const footerClass = (type === 1 ? 'single' : '') + styledClass(headerFooterStyled)
  return `<div class="page-footer ${footerClass}">
  <div class="hf-container">
    <div class="footer-content-left">${left}</div>
    <div class="footer-content">${center}</div>
    <div class="footer-content-right">${right}</div>
  </div>
</div>`
}

const createTableBody = (article: string): string =>
  `<tbody><tr><td>
  <div class="main-container">
    ${article}
  </div>
</td></tr></tbody>`

// Match a standalone `[TOC]` line (mirrors legacy marked TOC block token).
const TOC_REG = /^ {0,3}\[TOC\] *$/im

// Match the `src="…"` of an <img> tag in the (already sanitized, double-quoted)
// engine output, so relative image paths can be rewritten to absolute `file://`
// URLs. A string rewrite avoids re-serializing the whole article DOM (which
// holds rendered KaTeX / diagram SVG).
const IMG_SRC_REG = /(<img\b[^>]*?\ssrc=")([^"]*)(")/gi

/**
 * Rewrite relative / absolute-local `<img src>` to absolute `file://` URLs so a
 * saved styled-HTML document still resolves its images after it is moved out of
 * the source folder (legacy muyajs `correctImageSrc` parity, issue 230). Remote
 * URLs and `data:` URIs are left untouched. Idempotent: a `file://` src is left
 * as-is, so the PDF / print path (which rewrites again via printService) is a
 * no-op the second time.
 */
const rewriteImageSrcs = (html: string): string =>
  html.replace(IMG_SRC_REG, (match, pre: string, src: string, post: string) => {
    const resolved = resolveLocalImageSrc(src)
    return resolved === src ? match : `${pre}${resolved}${post}`
  })

// Match the `href="…"` of an <a> tag in the (already sanitized, double-quoted)
// engine output, so relative local links are rewritten to absolute `file://`
// URLs the same way images are.
const ANCHOR_HREF_REG = /(<a\b[^>]*?\shref=")([^"]*)(")/gi

/**
 * Rewrite relative / absolute-local `<a href>` to absolute `file://` URLs so a
 * link to a local file still resolves after the saved document is moved out of
 * the source folder (#1688). Remote URLs, `mailto:`/`data:` schemes and in-page
 * fragment anchors are left untouched.
 */
const rewriteAnchorHrefs = (html: string): string =>
  html.replace(ANCHOR_HREF_REG, (match, pre: string, href: string, post: string) => {
    const resolved = resolveLocalLinkHref(href)
    return resolved === href ? match : `${pre}${resolved}${post}`
  })

/**
 * Extract h1-h6 headings (with their id) from rendered article HTML and build
 * a nested TOC sidebar `<nav>` structure. Returns '' if no headings are found.
 */
const buildTocSidebarHtml = (html: string): string => {
  const headingReg = /<h([1-6])[^>]*\sid="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi
  const headings: Array<{ level: number; id: string; text: string }> = []
  let match: RegExpExecArray | null
  while ((match = headingReg.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1], 10),
      id: match[2],
      text: match[3].replace(/<[^>]*>/g, '').trim()
    })
  }
  if (headings.length === 0) return ''
  const minLevel = Math.min(...headings.map(h => h.level))
  let tocHtml = '<nav class="toc-sidebar-nav">\n'
  tocHtml += '<div class="toc-sidebar-title">\u76EE\u5F55</div>\n'
  tocHtml += '<ul>\n'
  for (const h of headings) {
    const indent = (h.level - minLevel) * 14
    tocHtml += `  <li style="padding-left:${indent + 8}px"><a href="#${h.id}">${h.text}</a></li>\n`
  }
  tocHtml += '</ul>\n</nav>\n'
  return tocHtml
}

/**
 * Wrap the `<body>` content in a flex layout with a TOC sidebar on the left.
 * Injects sidebar CSS into `<head>` and sidebar JS before `</body>`.
 */
const injectTocSidebar = (html: string, tocSidebarHtml: string): string => {
  const bodyMatch = /<body>([\s\S]*)<\/body>/.exec(html)
  if (!bodyMatch) return html
  const bodyContent = bodyMatch[1].trim()
  const newBody = `<body>
  <button class="toc-sidebar-toggle" title="Toggle TOC" aria-label="Toggle table of contents">\n    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>\n  </button>
  <div class="toc-sidebar-layout">
    <aside class="toc-sidebar">\n${tocSidebarHtml}\n    </aside>
    <main class="toc-content">\n${bodyContent}\n    </main>
  </div>
  <script>${TOC_SIDEBAR_JS}</script>\n</body>`
  let result = html.replace(/<body>[\s\S]*<\/body>/, newBody)
  result = result.replace(/<\/head>/, `<style>${TOC_SIDEBAR_CSS}</style>\n</head>`)
  return result
}

/**
 * Build a styled, standalone HTML document equivalent to legacy muyajs
 * `exportStyledHTML`. Renders markdown through the new engine, injects the TOC
 * at the `[TOC]` marker, and — when a header/footer is supplied — wraps the
 * article in the page-container table for paged PDF / print export.
 */
export const exportStyledHTML = async(
  muya: Muya,
  markdown: string,
  options: ExportStyledHtmlOptions = {}
): Promise<string> => {
  const {
    title = '',
    toc = '',
    header,
    footer,
    headerFooterStyled,
    dir,
    pathname = '',
    embedImages = false,
    imageResizeMode = 'auto',
    imageMaxWidth = 1024,
    includeTocSidebar = false
  } = options
  let { extraCss = '' } = options

  // The header/footer page table needs its own stylesheet — fold it into
  // extraCss (which `generate` injects into <head>) up front so we only render
  // the document once.
  const appendHeaderFooter = !!header || !!footer
  if (appendHeaderFooter) {
    extraCss = extraCss ? HEADER_FOOTER_CSS + extraCss : HEADER_FOOTER_CSS
  }

  // Render the engine's full HTML document. We re-extract its <article> body so
  // we can inject the TOC / header-footer, then re-emit the document shell.
  const fullDoc = await new MarkdownToHtml(markdown, muya).generate({
    title,
    extraCSS: extraCss,
    dir
  })

  const articleMatch = /<article class="markdown-body">([\s\S]*)<\/article>/.exec(fullDoc)
  let article = articleMatch ? articleMatch[1] : fullDoc

  // Resolve relative image paths to absolute file:// URLs so the saved document
  // still shows its images when opened from a different folder (issue 230).
  article = rewriteImageSrcs(article)
  // Same for relative local links so they still resolve after the document is
  // moved out of the source folder (#1688).
  article = rewriteAnchorHrefs(article)

  // Inject the TOC at the `[TOC]` marker (legacy behaviour: only appears when
  // the document explicitly contains `[TOC]`). The marker is rendered as a
  // paragraph by marked, so replace the rendered `<p>[TOC]</p>` first, falling
  // back to a raw `[TOC]` if present.
  if (toc) {
    if (/<p>\s*\[TOC\]\s*<\/p>/i.test(article)) {
      article = article.replace(/<p>\s*\[TOC\]\s*<\/p>/i, toc)
    } else if (TOC_REG.test(article)) {
      article = article.replace(TOC_REG, toc)
    }
  }

  let bodyHtml: string
  if (!appendHeaderFooter) {
    bodyHtml = `<article class="markdown-body">${article}</article>`
  } else {
    let output = HF_TABLE_START
    if (header) output += createTableHeader(header, headerFooterStyled)
    if (footer) {
      output += HF_TABLE_FOOTER
      output = createRealFooter(footer, headerFooterStyled) + output
    }
    output += createTableBody(`<article class="markdown-body">${article}</article>`)
    output += HF_TABLE_END
    bodyHtml = sanitize(output, EXPORT_DOMPURIFY_CONFIG) as string
  }

  // Re-emit the engine document shell with the (possibly augmented) body.
  let result = fullDoc.replace(/<body>[\s\S]*<\/body>/, `<body>\n  ${bodyHtml}\n</body>`)

  // v2.0 F3: 若启用 base64 内嵌，将所有本地图片转为 data URI（PRD AC-16/AC-17）
  if (embedImages) {
    const embedResult = await embedImagesAsBase64(result, pathname, {
      mode: imageResizeMode,
      maxWidth: imageMaxWidth
    })
    result = embedResult.html
    if (embedResult.failed > 0) {
      console.warn(`[exportHtml] ${embedResult.failed} 张图片内嵌失败，保留原 src`)
    }
  }

  // v2.0: 若启用目录侧边栏，注入侧边栏 HTML/CSS/JS
  if (includeTocSidebar) {
    const tocSidebarHtml = buildTocSidebarHtml(result)
    if (tocSidebarHtml) {
      result = injectTocSidebar(result, tocSidebarHtml)
    }
  }

  return result
}

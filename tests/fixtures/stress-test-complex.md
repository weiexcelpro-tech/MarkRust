---
title: "MarkRust 端到端测试物料 · 压力测试文档"
author: "Mr. Jin <weiexcelpro@outlook.com>"
date: 2026-07-21
tags: [e2e, stress-test, html-export, 中文测试]
description: "用于验证 HTML 导出功能的复杂 Markdown 物料，覆盖 frontmatter、多级标题、表格、代码块、数学公式、脚注、任务列表、引用块、图片、emoji、HTML 实体、TOC 等全部语法元素。"
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '6a479206-d6e2-4a9e-bca4-668cfc0b9582'
  PropagateID: '6a479206-d6e2-4a9e-bca4-668cfc0b9582'
  ReservedCode1: 'bf697f05-e56e-471f-9c65-2257a0ba51fe'
  ReservedCode2: 'bf697f05-e56e-471f-9c65-2257a0ba51fe'
---

[TOC]

# 一级标题：HTML 导出端到端测试

本物料用于验证 `exportStyledHTML()` 在面对复杂 Markdown 时的正确性。覆盖以下语法：

- 多级标题（H1–H6）
- **粗体**、*斜体*、~~删除线~~、`行内代码`、==标记==
- [普通链接](https://github.com/weiexcelpro-tech/MarkRust)、自动链接 <https://tauri.app>
- 本地图片、远程图片、data URI 图片
- 有序列表、无序列表、任务列表（已勾选 / 未勾选）
- 嵌套列表（3 层）
- 表格（左对齐 / 居中 / 右对齐）
- 代码块（多语言：rust、typescript、python、json、sh）
- 数学公式（inline $E=mc^2$ 与 block $$\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}$$）
- 脚注[^1]、引用块、分割线
- emoji（🚀🦀🐱）、HTML 实体（&amp; &lt; &gt; &copy;）

## 二级标题：文本修饰与链接

普通段落，包含 **加粗**、*斜体*、***粗斜体***、~~删除线~~、`行内代码`、上标 H~2~O、下标 X^2^、==高亮标记==。

链接形式：

- [GitHub 仓库](https://github.com/weiexcelpro-tech/MarkRust "MarkRust Repo")
- 自动链接：<https://tauri.app>
- 引用式链接 [Tauri 文档][tauri-doc]

[tauri-doc]: https://v2.tauri.app "Tauri v2 Docs"

### 三级标题：图片资源

本地图片（应被 base64 内嵌）：

![本地截图](./screenshots/editor.png)

远程图片（应保留原 URL，不内嵌）：

![Tauri Logo](https://v2.tauri.app/_next/static/media/tauri.3f2dd9f4.svg)

data URI 图片（应原样保留）：

![内联 base64 红点](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcf+WsAAAAASUVORK5CYII=)

#### 四级标题

##### 五级标题

###### 六级标题 — 最深嵌套

## 二级标题：列表家族

### 无序列表

- 一层项 A
- 一层项 B
  - 二层项 B1
  - 二层项 B2
    - 三层项 B2a
    - 三层项 B2b
  - 二层项 B3
- 一层项 C

### 有序列表

1. 第一步：安装 Rust 工具链
2. 第二步：克隆仓库
3. 第三步：编译运行
   1. 子步骤 3.1
   2. 子步骤 3.2
4. 第四步：测试导出

### 任务列表

- [x] 实现 HTML 导出菜单项
- [x] 修复 `fs_write_file` 类型不匹配
- [x] 改造 `dialog_save_file` 支持自定义后缀
- [ ] 端到端测试通过
- [ ] 发布 v1.2.0

## 二级标题：表格

### 简单表格

| 功能 | 状态 | 备注 |
|------|------|------|
| HTML 导出 | ✅ | 强制 base64 自包含 |
| PDF 导出 | ✅ | 通过打印渲染 |
| DOCX 导出 | ✅ | Rust 后端 pulldown-cmark + docx-rs |

### 对齐表格

| 左对齐 | 居中对齐 | 右对齐 |
|:-------|:--------:|-------:|
| left   | center   | right  |
| 左     | 中       | 右     |
| 长文字测试 | 长文字测试 | 长文字测试 |

### 复杂表格（含代码与链接）

| 命令 | 参数 | 返回值 |
|------|------|--------|
| `dialog_save_file` | `default_name, exts` | `Option<String>` |
| `fs_write_file` | `path, data: Vec<u8>` | `AppResult<()>` |
| [`export_docx`](https://github.com) | `req: ExportDocxRequest` | `ExportResult` |

## 二级标题：代码块

### Rust 代码

```rust
use std::path::Path;

/// 写文件到磁盘。data 必须是 Vec<u8>，不能是 string，
/// 否则 Tauri v2 serde 会反序列化失败。
#[tauri::command]
pub fn fs_write_file(path: String, data: Vec<u8>) -> AppResult<()> {
    std::fs::write(&path, &data)?;
    Ok(())
}

fn main() {
    let bytes = b"hello \xe4\xb8\x96\xe7\x95\x8c"; // UTF-8 编码的 "hello 世界"
    let _ = fs_write_file("/tmp/test.txt".into(), bytes.to_vec());
}
```

### TypeScript 代码

```typescript
// v2.0 修复：HTML 内容是 string，必须 TextEncoder 编码为字节数组
// 直接传 string 会触发 Rust 端 "invalid type: string, expected a sequence"
async function exportHtml(content: string, savePath: string): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(content))
  await invoke('fs_write_file', { path: savePath, data: bytes })
}
```

### Python 代码（带中文注释）

```python
# 端到端测试物料生成器
def generate_fixture():
    """生成包含全部 Markdown 语法的压力测试文档。"""
    elements = [
        "frontmatter", "headings", "lists", "tables",
        "code_blocks", "math", "footnotes", "images",
    ]
    return "\n\n".join(f"## {e}" for e in elements)
```

### Shell 脚本

```sh
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# 编译 Rust 后端
cargo build --release --manifest-path src-tauri/Cargo.toml

# 启动开发服务器
npm run dev
```

### JSON 配置

```json
{
  "version": "1.2.0",
  "channel": "stable",
  "features": ["html-export", "docx-export", "pdf-export"],
  "minRustVersion": "1.75.0"
}
```

## 二级标题：数学公式

### 行内公式

质能方程 $E = mc^2$，欧拉恒等式 $e^{i\pi} + 1 = 0$，二次方程求根 $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$。

### 块级公式

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

矩阵：

$$
A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}, \quad \det(A) = a_{11}a_{22} - a_{12}a_{21}
$$

## 二级标题：脚注与引用

这是一段带脚注的文字[^1]，引用了详细说明。还有另一个脚注[^note2]。

[^1]: 这是一个示例脚注，验证脚注渲染正确。
[^note2]: 这是第二个脚注，使用命名标识符。

> 这是一段引用。
>
> 引用内部也可以有 **加粗** 和 `代码`。
>
> > 嵌套引用：第二层引用。
> >
> > 嵌套引用的第二段。

## 二级标题：特殊字符与实体

- HTML 实体：&amp; &lt; &gt; &quot; &apos; &copy; &reg; &trade; &nbsp;
- Unicode：中文测试 · emoji 测试 🚀🦀🐱
- 转义字符：\*not bold\* \_not italic\_ \[not a link\]
- 引号："smart quotes" ‘single quotes’

## 二级标题：分割线与结构

以上是内容。

---

以下是另一段内容。

***

又一段分隔。

___

## 二级标题：长文本压力测试

以下段落意在测试渲染器对长文本的换行与排版能力。

马克吐温曾说："好的决策来自经验，而经验来自坏的决策。" 在软件开发中更是如此。HTML 导出功能看似简单——把 Markdown 渲染成 HTML 包一层样式表即可——但实际链路上每一个环节都可能藏雷：从前端 muya 引擎的 sanitize 配置，到 IPC 序列化时的类型不匹配，再到 Rust 端 `Vec<u8>` 反序列化失败，每一层都需要端到端测试来兜底。本物料就是为这张防护网编织的最后一道经纬。

中文长段落，验证 UTF-8 字符的字节流正确性。"你好世界"四个字在 UTF-8 下是 12 字节，每字 3 字节。如果 TextEncoder 漏掉任一字节，base64 解码会失败或字符显示为 ���。本测试会在断言中逐字节检查保存的字节流是否与 TextEncoder 直接编码一致，确保不出现因 string→Vec\<u8\> 隐式 latin-1 编码导致的中文乱码问题。

[^note2]: 命名脚注的具体内容。
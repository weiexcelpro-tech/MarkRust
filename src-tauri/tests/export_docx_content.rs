//! DOCX 导出【内容级】集成测试 — bug #10（导出丢表头）与 #11（mermaid 导出源码）。
//!
//! 基线：分支 e2e-test = v1.1.6（commit f7b916a），export.rs 主循环 markdown_to_docx。
//!
//! 【修复阶段语义】TC-B10-01~07 与 TC-B11-03 现为回归测试：断言「修复后的正确行为」，
//! FAIL = 回归。TC-B11-01/02 保留为现状对照（新契约下前端导出前把 mermaid 块替换为
//! data URI 图片，Rust 侧代码块仍按源码文本输出，两个测试继续有效）。
//!
//! 方法：markdown_to_docx 返回 Vec<u8>（标准 OOXML zip），用 zip crate 解包
//! word/document.xml 后做字符串级断言（w:tbl / w:tr / w:tc / w:tblHeader / Consolas）。
//!
//! 事件流依据（pulldown-cmark 0.12.2 实测探针，2026-10-26）：
//! - Start(TableHead) 内部与数据行完全一样发出 Start/End(TableCell)（firstpass.rs:452-454
//!   header 行复用 parse_table_row_inner，仅将 row 节点改名为 TableHead）；
//! - 表头单元格内可行内构造实际产生的事件：
//!     `code`      → Event::Code            （export.rs:715 无条件写 current_runs，泄漏）
//!     [L](u)      → Start/End(Link)+Text   （export.rs:809-817 括号写 current_runs，泄漏）
//!     <auto>      → Start/End(Link)+Text   （同上，Autolink 类型）
//!     <br>        → Event::InlineHtml      （export.rs:953 忽略，换行丢失）
//!     ![](x)      → Start/End(Image)+Text  （export.rs:820 游离段落）
//!     <b>x</b>    → InlineHtml + Text      （Text 保留，标签忽略）
//!   注意：GFM 表格单元格内【不可能】产生 SoftBreak / HardBreak / TaskListMarker 事件
//!   （单元格是单行 inline 解析；列表是块级结构），export.rs:803/:941/:944 三条泄漏
//!   通道对表头场景不可达——真正的可达通道是 Code / Link / InlineHtml / Image。

#![allow(dead_code)]

#[path = "../src/error.rs"]
mod error;

#[path = "../src/commands/mod.rs"]
mod commands;

use std::io::Read;

use base64::Engine as _;

use commands::export::{markdown_to_docx, ExportDocxRequest};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// 最小合法 ExportDocxRequest（无图片 / 无字体定制，所有字段显式赋值）。
fn make_req(markdown: &str) -> ExportDocxRequest {
    ExportDocxRequest {
        markdown: markdown.to_string(),
        pathname: String::new(),
        image_embed: true,
        image_resize: "auto".to_string(),
        image_max_width: 1024,
        page_size: "A4".to_string(),
        page_margin: "normal".to_string(),
        font_family: None,
        font_size: 11.0,
        line_height: 1.5,
    }
}

/// 同 make_req，但关闭图片内嵌（图片路径不存在的确定性降级路径）。
fn make_req_no_embed(markdown: &str) -> ExportDocxRequest {
    let mut r = make_req(markdown);
    r.image_embed = false;
    r
}

/// 同步执行 async markdown_to_docx（测试输入不含远程图片，无真实网络 IO）。
fn run_export(req: &ExportDocxRequest) -> (Vec<u8>, u32, Vec<String>) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    rt.block_on(markdown_to_docx(req))
        .expect("markdown_to_docx should succeed")
}

/// 解包 DOCX zip：返回 (word/document.xml 全文, 全部条目名列表)。
fn unpack_docx(bytes: &[u8]) -> (String, Vec<String>) {
    assert!(
        bytes.len() > 2 && &bytes[0..2] == b"PK",
        "DOCX 必须是合法 zip（PK magic）"
    );
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .expect("DOCX 应可按 zip 打开");
    let mut names = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        names.push(
            archive
                .by_index(i)
                .expect("zip entry readable")
                .name()
                .to_string(),
        );
    }
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .expect("word/document.xml 必须存在")
        .read_to_string(&mut xml)
        .expect("document.xml 必须是合法 UTF-8");
    (xml, names)
}

/// 找 open 标签第一次出现位置，兼容「无属性 `<w:tbl>`」与「带属性 `<w:tbl …>`」两种输出形式。
fn find_open(hay: &str, exact: &str, prefixed: &str) -> Option<usize> {
    match (hay.find(exact), hay.find(prefixed)) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// 文档中第一个 <w:tbl>…</w:tbl> 片段（不含闭合标签本身）。
fn first_table(xml: &str) -> String {
    let start = find_open(xml, "<w:tbl>", "<w:tbl ").expect("document.xml 应含 w:tbl");
    let end_rel = xml[start..].find("</w:tbl>").expect("w:tbl 应闭合");
    xml[start..start + end_rel].to_string()
}

/// 表格之后的所有内容（游离段落检测用）。
fn body_after_first_table(xml: &str) -> &str {
    match xml.find("</w:tbl>") {
        Some(p) => &xml[p + "</w:tbl>".len()..],
        None => "",
    }
}

/// 第一个 <w:tr…>…</w:tr> 行片段（用于 tblHeader 检测）。
fn first_row_segment(xml: &str) -> String {
    let start = find_open(xml, "<w:tr>", "<w:tr ").expect("document.xml 应含 w:tr");
    let end_rel = xml[start..].find("</w:tr>").expect("w:tr 应闭合");
    xml[start..start + end_rel].to_string()
}

/// 提取一个表格片段内【所有行】的单元格文本（行 → 单元格文本）。
fn table_rows(tbl: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut rest = tbl;
    while let Some(pos) = find_open(rest, "<w:tr>", "<w:tr ") {
        let after = &rest[pos..];
        let end = after.find("</w:tr>").expect("w:tr 应闭合");
        rows.push(row_cells(&after[..end]));
        rest = &after[end + "</w:tr>".len()..];
    }
    rows
}

/// 提取一行片段内所有单元格的可见文本。
fn row_cells(tr: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut rest = tr;
    while let Some(pos) = find_open(rest, "<w:tc>", "<w:tc ") {
        let after = &rest[pos..];
        let end = after.find("</w:tc>").expect("w:tc 应闭合");
        cells.push(cell_text(&after[..end]));
        rest = &after[end + "</w:tc>".len()..];
    }
    cells
}

/// 提取一个单元格片段内的全部可见文本（拼接所有 w:t 节点，做 XML 反转义）。
fn cell_text(tc: &str) -> String {
    let mut out = String::new();
    let mut rest = tc;
    while let Some(pos) = rest.find("<w:t") {
        let after = &rest[pos + 4..];
        // <w:t 后必须紧跟 '>' / ' ' / '/' 才是真文本节点；
        // <w:tc>、<w:tab/>、<w:tbl> 等以 "<w:t" 开头的标签在这里跳过。
        if !(after.starts_with('>') || after.starts_with(' ') || after.starts_with('/')) {
            rest = after;
            continue;
        }
        let gt = after.find('>').expect("w:t 标签应闭合");
        let body = &after[gt + 1..];
        match body.find("</w:t>") {
            Some(close) => {
                out.push_str(&body[..close]);
                rest = &body[close + "</w:t>".len()..];
            }
            None => break,
        }
    }
    unescape_xml(&out)
}

fn unescape_xml(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// 返回包含 needle 文本的完整 <w:r>…</w:r> run 片段（检查字体用）。
/// 注意精确匹配 `<w:r>` / `<w:r `（`<w:rPr` 是 run 内属性节点，不能作为 run 起点）。
fn run_containing<'a>(xml: &'a str, needle: &str) -> Option<&'a str> {
    let pos = xml.find(needle)?;
    let r_start = xml[..pos]
        .rfind("<w:r>")
        .or_else(|| xml[..pos].rfind("<w:r "))?;
    let r_end_rel = xml[pos..].find("</w:r>")?;
    Some(&xml[r_start..pos + r_end_rel + "</w:r>".len()])
}

/// 一个 3 列 × 3 行（1 表头 + 2 数据）的通用测试表。
const TABLE_3X3_MD: &str = "| 名称 | Type | 备注 |\n|---|---|---|\n| 甲 | A | ok |\n| 乙 | B | fine |\n";

// ---------------------------------------------------------------------------
// TC-B10 系列 — bug #10：导出 docx 丢表头（内容级根因）
// ---------------------------------------------------------------------------

/// TC-B10-01 纯文本表头 3×3 表：首行单元格文本 = 表头内容，行数 = 数据行数+1。
///
/// 预期：结构层修复（7edd0d3，export.rs:912-917）后纯文本表头不丢行。
/// 实测将暴露【新发现】：End(TagEnd::TableHead) 在 TableCell 事件已收齐单元格后
/// 又 push 一次 current_cell_runs（export.rs:913），表头行恒多 1 个空单元格（4 列）。
#[test]
fn tc_b10_01_plain_text_header_table_structure() {
    let (bytes, _, warnings) = run_export(&make_req(TABLE_3X3_MD));
    assert!(
        warnings.is_empty(),
        "纯文本表不应产生 warnings: {:?}",
        warnings
    );
    let (xml, _) = unpack_docx(&bytes);

    let rows = table_rows(&first_table(&xml));

    // 行数 = 数据行数 + 1（表头 + 2 数据行）—— 结构层修复后应成立
    assert_eq!(
        rows.len(),
        3,
        "TC-B10-01: 表格应有 3 行（1 表头 + 2 数据行），实际 {:?}",
        rows
    );

    // 表头行文本完整性（中英混合，同时验证 UTF-8 编码正确）
    assert_eq!(
        rows[0],
        vec!["名称".to_string(), "Type".to_string(), "备注".to_string()],
        "TC-B10-01: 表头行应恰好 3 个单元格且文本完整（若多出空单元格/丢文本即复现）"
    );

    // 数据行不受影响
    assert_eq!(rows[1], vec!["甲", "A", "ok"], "TC-B10-01: 数据行 1");
    assert_eq!(rows[2], vec!["乙", "B", "fine"], "TC-B10-01: 数据行 2");
}

/// TC-B10-02 表头含行内代码 `` `code` ``：断言表头行完整性。
///
/// 锚定泄漏通道 ①a：export.rs:715-721 Event::Code 无条件写 current_runs（段落缓冲），
/// 不检查 in_table → 代码文本漏出单元格，header cell 变空，文本以游离段落出现在表格之后。
/// 当前代码必失败 = 复现「有时丢表头」的内容级根因。
#[test]
fn tc_b10_02_header_cell_with_inline_code() {
    let md = "| `Name` | Base |\n|---|---|\n| a | b |\n";
    let (bytes, _, _) = run_export(&make_req(md));
    let (xml, _) = unpack_docx(&bytes);

    let rows = table_rows(&first_table(&xml));

    assert_eq!(
        rows[0],
        vec!["Name".to_string(), "Base".to_string()],
        "TC-B10-02: 行内代码表头的文本必须留在表头单元格内 \
         （实际：Code 事件写入段落缓冲 current_runs，cell 丢失文本、内容游离到表格外段落）"
    );

    // 泄漏检测：表头文本不得作为游离段落出现在表格之后
    assert!(
        !body_after_first_table(&xml).contains("Name"),
        "TC-B10-02: 表头文本 'Name' 泄漏到表格之后的游离段落（current_runs 未按 in_table 分流）"
    );
}

/// TC-B10-03 表头含链接 `[text](url)`：断言表头行完整性。
///
/// 锚定泄漏通道 ①b：export.rs:809-817 Start/End(Tag::Link) 把渲染括号 "[", "]"
/// 无条件写入 current_runs → 表头 cell 只剩链接文本，括号游离到表格外段落。
/// 当前代码必失败 = 复现。
#[test]
fn tc_b10_03_header_cell_with_link() {
    let md = "| [Docs](https://example.com) | Base |\n|---|---|\n| a | b |\n";
    let (bytes, _, _) = run_export(&make_req(md));
    let (xml, _) = unpack_docx(&bytes);

    let rows = table_rows(&first_table(&xml));

    // 实现对链接的降级渲染语义是蓝色 "[文本]"，全部内容应留在单元格内
    assert_eq!(
        rows[0],
        vec!["[Docs]".to_string(), "Base".to_string()],
        "TC-B10-03: 链接表头应渲染为 '[Docs]' 且完整留在单元格 \
         （实际：Link 括号写入 current_runs 游离，cell 只剩 'Docs'）"
    );

    // 泄漏检测：游离的链接括号不得出现在表格之后
    let after = body_after_first_table(&xml);
    assert!(
        !after.contains("[") && !after.contains("]"),
        "TC-B10-03: 链接渲染括号 '[',']' 泄漏到表格之后的游离段落"
    );
}

/// TC-B10-04 表头含换行（`<br>`）：断言换行不丢、内容不粘连。
///
/// 说明：GFM 表格单元格内无法产生 SoftBreak / HardBreak 事件（单元格为单行 inline
/// 解析，probe 实证），单元格内真实可达的换行只有 `<br>` → InlineHtml 事件。
/// 修复后语义：`<br>` 输出为真实 `<w:br/>`（docx-rs BreakType::TextWrapping），
/// 文本节点内容不变（"A" / "B"），故 cell_text 拼接为 "AB"；换行正确性以
/// `<w:br` 标记存在 + A 在前 B 在后钉住。
#[test]
fn tc_b10_04_header_cell_with_line_break() {
    let md = "| A<br>B | Base |\n|---|---|\n| a | b |\n";
    let (bytes, _, _) = run_export(&make_req(md));
    let (xml, _) = unpack_docx(&bytes);

    let tbl = first_table(&xml);
    let rows = table_rows(&tbl);
    // 文本不丢（换行是标签不是文本节点，拼接为 "AB"）
    assert_eq!(
        rows[0][0], "AB",
        "TC-B10-04: 表头单元格内 <br> 两侧文本不得丢失"
    );

    // 真实换行标记：首行应含 <w:br/>，且 "A" 在 br 之前、"B" 在其后
    let first_row = first_row_segment(&tbl);
    let br_pos = first_row
        .find("<w:br")
        .expect("TC-B10-04: 表头单元格内的 <br> 应输出为 <w:br/> 换行标记");
    assert!(
        first_row[..br_pos].contains(">A<"),
        "TC-B10-04: 文本 'A' 应位于换行标记之前（首行片段：{first_row}）"
    );
    assert!(
        first_row[br_pos..].contains(">B<"),
        "TC-B10-04: 文本 'B' 应位于换行标记之后（首行片段：{first_row}）"
    );
}

/// TC-B10-05 内联构造全遍历：逐个在表头单元格内放置各类 pulldown-cmark 内联事件，
/// 断言单元格文本完整性 + 无游离泄漏，找出【所有】触发丢失的通道。
///
/// 判定口径：
/// - expected_cell = 该构造按实现语义应完整留在单元格内的可见文本；
/// - forbidden_after_table = 不得出现在表格之后（游离段落）的文本。
/// 当前代码下 code / link / autolink / footnote-ref / image 占位 必然进失败清单。
#[test]
fn tc_b10_05_inline_constructs_sweep() {
    struct Case {
        name: &'static str,
        /// 表头第一个单元格的 markdown 片段
        header_cell: &'static str,
        /// 应完整留在单元格内的可见文本
        expected_cell: &'static str,
        /// 不得出现在表格之后的内容（游离泄漏物），None = 该构造无游离物
        forbidden_after_table: Option<&'static str>,
        /// 附加到文档末尾的 markdown（footnote definition 等）
        extra_suffix: &'static str,
        /// 是否关闭图片内嵌（image case 用，避免文件 IO / 网络）
        no_embed: bool,
    }

    let cases = vec![
        Case {
            name: "strong 粗体",
            header_cell: "**Bold**",
            expected_cell: "Bold",
            forbidden_after_table: None,
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "emphasis 斜体",
            header_cell: "*Ital*",
            expected_cell: "Ital",
            forbidden_after_table: None,
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "strikethrough 删除线",
            header_cell: "~~Gone~~",
            expected_cell: "Gone",
            forbidden_after_table: None,
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "inline code 行内代码",
            header_cell: "`Cdy`",
            expected_cell: "Cdy",
            forbidden_after_table: Some("Cdy"),
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "link 链接",
            header_cell: "[Lk](https://example.com)",
            expected_cell: "[Lk]",
            forbidden_after_table: Some("["),
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "autolink 自动链接",
            header_cell: "<https://example.com>",
            expected_cell: "[https://example.com]",
            forbidden_after_table: Some("["),
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "inline html 包裹",
            header_cell: "<b>Wrp</b>",
            expected_cell: "Wrp",
            forbidden_after_table: None,
            extra_suffix: "",
            no_embed: false,
        },
        Case {
            name: "footnote reference 脚注引用",
            header_cell: "Ft[^1]",
            expected_cell: "Ft[^1]",
            forbidden_after_table: Some("[^1]"),
            extra_suffix: "\n[^1]: note text\n",
            no_embed: false,
        },
        Case {
            name: "image 图片（embed=false 占位降级）",
            header_cell: "![pic](missing.png)",
            expected_cell: "pic",
            forbidden_after_table: Some("[图片:"),
            extra_suffix: "",
            no_embed: true,
        },
    ];

    let mut failures: Vec<String> = Vec::new();

    for c in &cases {
        let md = format!(
            "| {} | Base |\n|---|---|\n| a | b |\n{}",
            c.header_cell, c.extra_suffix
        );
        let req = if c.no_embed {
            make_req_no_embed(&md)
        } else {
            make_req(&md)
        };
        let (bytes, _, _) = run_export(&req);
        let (xml, _) = unpack_docx(&bytes);
        let rows = table_rows(&first_table(&xml));

        let cell0 = rows.first().and_then(|r| r.first()).cloned().unwrap_or_default();
        if cell0 != c.expected_cell {
            failures.push(format!(
                "[{}] 单元格文本不完整：期望 {:?}，实际 {:?}",
                c.name, c.expected_cell, cell0
            ));
        }
        if let Some(forbidden) = c.forbidden_after_table {
            if body_after_first_table(&xml).contains(forbidden) {
                failures.push(format!(
                    "[{}] 内容泄漏到表格之后的游离段落（发现 {:?}）",
                    c.name, forbidden
                ));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "TC-B10-05: 以下表头内联构造触发内容丢失/泄漏（共 {} 项）：\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// TC-B10-06 Word 语义表头标记：首行应含 w:trPr/w:tblHeader（跨页重复表头）。
///
/// 锚定通道 ②：export.rs:896-904 TableRow::new 未调用 .table_header(true)。
/// 当前代码必失败 = 复现（Word 跨页时表头行不重复）。
#[test]
fn tc_b10_06_first_row_marked_as_word_header() {
    let (bytes, _, _) = run_export(&make_req(TABLE_3X3_MD));
    let (xml, _) = unpack_docx(&bytes);

    let first_row = first_row_segment(&xml);
    assert!(
        first_row.contains("w:tblHeader"),
        "TC-B10-06: 表格首行应含 <w:trPr><w:tblHeader/></w:trPr>（Word 跨页重复表头）\
         ——export.rs:896-904 TableRow::new 缺少 .table_header(true)，实际首行片段：\n{}",
        first_row
    );
    // 全文档级别也不应存在任何 tblHeader 标记（直接钉住通道 ②）
    assert!(
        xml.contains("w:tblHeader"),
        "TC-B10-06: 整个 document.xml 无任何 w:tblHeader 标记 = 首行未标记 Word 表头"
    );
}

// ---------------------------------------------------------------------------
// TC-B11 系列 — bug #11：mermaid 导出为源码（现状证实型，PASS = 复现）
// ---------------------------------------------------------------------------

/// TC-B11-01 含 ```mermaid 块的文档：证实「源码直出」。
///
/// 断言（bug 现状证实，全部 PASS = bug 存在；若未来修复则本测试 FAIL 提示更新）：
/// 1. document.xml 中存在 mermaid 源码文本（graph TD / A-->B）——源码直出；
/// 2. 该文本所在 run 使用 Consolas 等宽字体 —— 走的是普通代码块文本段落路径；
/// 3. zip 中无 word/media/ 条目 —— 没有任何渲染产物（无图片内嵌）。
#[test]
fn tc_b11_01_mermaid_block_exported_as_source_text() {
    let md = concat!(
        "# Mermaid Doc\n\n",
        "```mermaid\n",
        "graph TD;\n",
        "A-->B;\n",
        "```\n\n",
        "正文段落。\n",
    );
    let (bytes, image_count, warnings) = run_export(&make_req(md));
    let (xml, names) = unpack_docx(&bytes);

    // 1. 源码文本原样存在（源码直出）。
    // 注意：docx-rs 会把 '>' 转义为 &gt;（实测 'A--&gt;B;'），故先反转义再比对字面量。
    let unescaped_xml = unescape_xml(&xml);
    assert!(
        unescaped_xml.contains("graph TD") && unescaped_xml.contains("A-->B"),
        "TC-B11-01: mermaid 源码文本 'graph TD' / 'A-->B' 应存在于 document.xml \
         （若修复为渲染图片，此处将不再出现源码文本，本测试需同步更新）"
    );

    // 2. 该文本在 Consolas 等宽 run 内 = 走普通代码块文本段落路径（export.rs:724-743）
    let run = run_containing(&xml, "graph TD")
        .expect("document.xml 应存在包含 'graph TD' 的 run");
    assert!(
        run.contains("Consolas"),
        "TC-B11-01: mermaid 源码应以等宽文本段落输出（run 内应有 Consolas 字体声明），run 片段：\n{}",
        run
    );

    // 3. 无渲染产物：zip 条目中不得出现 word/media/（无图片内嵌）
    let media: Vec<&String> = names.iter().filter(|n| n.starts_with("word/media/")).collect();
    assert!(
        media.is_empty(),
        "TC-B11-01: 证实 bug 现状应无任何媒体文件，实际发现 {:?}",
        media
    );
    assert_eq!(image_count, 0, "TC-B11-01: mermaid 源码路径不产生图片");
    assert!(
        warnings.is_empty(),
        "TC-B11-01: 源码直出甚至没有 warning 提示，实际 warnings: {:?}",
        warnings
    );
}

/// TC-B11-02 对照组：普通 ```rust 代码块与 mermaid 走完全相同的路径。
///
/// 证明「mermaid 源码直出」不是 mermaid 特有处理，而是代码块一律输出等宽文本段落
/// （_code_block_lang 从未被使用）——两种代码块行为一致即对照成立。
#[test]
fn tc_b11_02_plain_code_block_same_path_control() {
    let md = concat!(
        "# Code Doc\n\n",
        "```rust\n",
        "fn main() {}\n",
        "```\n",
    );
    let (bytes, image_count, _) = run_export(&make_req(md));
    let (xml, names) = unpack_docx(&bytes);

    // 与 mermaid 完全一致的表现：源码文本 + Consolas 等宽 run + 无媒体
    assert!(
        xml.contains("fn main() {}"),
        "TC-B11-02: 普通代码块源码文本应存在于 document.xml（与 mermaid 同路径对照）"
    );
    let run = run_containing(&xml, "fn main() {}")
        .expect("document.xml 应存在包含代码文本的 run");
    assert!(
        run.contains("Consolas"),
        "TC-B11-02: 普通代码块应输出为 Consolas 等宽文本段落，run 片段：\n{}",
        run
    );
    let media: Vec<&String> = names.iter().filter(|n| n.starts_with("word/media/")).collect();
    assert!(
        media.is_empty(),
        "TC-B11-02: 普通代码块同样无渲染产物（与 mermaid 行为一致），实际发现 {:?}",
        media
    );
    assert_eq!(image_count, 0);
}

// ---------------------------------------------------------------------------
// 修复阶段新增 — TC-B10-07（表头内 data URI 图片不崩溃）与 TC-B11-03（data URI 契约）
// ---------------------------------------------------------------------------

/// 1×1 红色像素 PNG（标准最小 PNG，所有工具链通认）。
const RED_1X1_PNG_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/// TC-B10-07 表头含 data URI 图片（B11 契约衍生场景）：导出不得崩溃，表结构完整。
///
/// 修复后语义（已知限制）：单元格内图片不内嵌（降级为 alt 文本留在单元格），
/// 不产生 word/media/，也无游离图片段落甩到表格前后。
#[test]
fn tc_b10_07_header_cell_with_data_uri_image_does_not_crash() {
    let md = format!(
        "| ![mermaid](data:image/png;base64,{}) | Base |\n|---|---|\n| a | b |\n",
        RED_1X1_PNG_BASE64
    );
    // 不崩溃（run_export 内部 expect 即崩溃哨兵）且能正常解包
    let (bytes, image_count, warnings) = run_export(&make_req(&md));
    let (xml, names) = unpack_docx(&bytes);

    // 表结构完整：1 表头 + 1 数据行 = 2 行；首行第二格文本无损
    let rows = table_rows(&first_table(&xml));
    assert_eq!(rows.len(), 2, "TC-B10-07: 表格应为 2 行（表头+数据），实际 {:?}", rows.len());
    assert_eq!(
        rows[0],
        vec!["mermaid".to_string(), "Base".to_string()],
        "TC-B10-07: 表头单元格应保留图片 alt 文本（单元格内图片降级为 alt 文本，已知限制）"
    );
    assert_eq!(rows[1], vec!["a", "b"], "TC-B10-07: 数据行不受影响");

    // 不产生媒体与图片段落；无 warning
    let media: Vec<&String> = names.iter().filter(|n| n.starts_with("word/media/")).collect();
    assert!(
        media.is_empty(),
        "TC-B10-07: 单元格内图片已知限制为不内嵌，实际出现媒体 {:?}",
        media
    );
    assert_eq!(image_count, 0, "TC-B10-07: 单元格内图片不计入 image_count");
    assert!(
        warnings.is_empty(),
        "TC-B10-07: 单元格内图片降级不应产生 warning，实际 {:?}",
        warnings
    );
}

/// TC-B11-03（B11 契约 Rust 侧）：markdown 含 data URI 图片 → 嵌入 word/media/ 且
/// document.xml 引用；超宽图片按页面内容宽缩放显示尺寸。
///
/// 契约：前端在导出前把 mermaid 代码块替换为 `![mermaid](data:image/png;base64,<b64>)`，
/// Rust 侧按普通图片事件解码内嵌（decode_data_uri → Pic）。
#[test]
fn tc_b11_03_data_uri_image_embedded_and_wide_image_scaled() {
    // —— 第一部分：1×1 PNG data URI 正常内嵌 ——
    let md_small = format!(
        "# Pic Doc\n\n![mermaid](data:image/png;base64,{})\n\n正文。\n",
        RED_1X1_PNG_BASE64
    );
    let (bytes, image_count, warnings) = run_export(&make_req(&md_small));
    let (xml, names) = unpack_docx(&bytes);

    let media: Vec<&String> = names
        .iter()
        .filter(|n| n.starts_with("word/media/") && !n.ends_with('/')) // 排除 zip 目录条目
        .collect();
    assert_eq!(
        media.len(),
        1,
        "TC-B11-03: word/media/ 应恰有 1 张内嵌图片，实际 {:?}",
        media
    );
    assert_eq!(image_count, 1, "TC-B11-03: data URI 图片应计入 image_count");
    assert!(
        warnings.is_empty(),
        "TC-B11-03: data URI 内嵌不应产生 warning，实际 {:?}",
        warnings
    );
    // document.xml 通过 r:embed 引用该图片（blip 引用关系存在）
    assert!(
        xml.contains("r:embed="),
        "TC-B11-03: document.xml 应含 r:embed 图片引用（blip）"
    );

    // —— 第二部分：2000×10 超宽 PNG → 显示宽度按页面内容宽缩放 ——
    let wide = image::RgbaImage::from_fn(2000, 10, |_, _| image::Rgba([10u8, 20, 30, 255]));
    let mut png_buf = std::io::Cursor::new(Vec::new());
    wide.write_to(&mut png_buf, image::ImageFormat::Png)
        .expect("测试 PNG 编码");
    let wide_b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
    let md_wide = format!("![wide](data:image/png;base64,{})\n", wide_b64);
    let (bytes_wide, _, _) = run_export(&make_req(&md_wide));
    let (xml_wide, _) = unpack_docx(&bytes_wide);

    // 原始 2000px → 2000*9525 = 19,050,000 EMU；resize(auto) 先缩到 1024px，
    // 再按 A4 内容宽（6.27in ≈ 5,733,287 EMU）钳制显示宽度。
    let extent_pos = xml_wide
        .find("wp:extent cx=\"")
        .expect("TC-B11-03: document.xml 应含 wp:extent 显示尺寸声明");
    let cx_start = extent_pos + "wp:extent cx=\"".len();
    let cx_end = xml_wide[cx_start..]
        .find('"')
        .expect("TC-B11-03: wp:extent cx 应闭合");
    let cx: u64 = xml_wide[cx_start..cx_start + cx_end]
        .parse()
        .expect("TC-B11-03: wp:extent cx 应为数字");
    assert!(
        cx < 19_050_000,
        "TC-B11-03: 超宽图片显示宽度应被缩放（cx={} 不应等于原始 2000px 的 19050000 EMU）",
        cx
    );
    assert!(
        (5_000_000..=6_000_000).contains(&cx),
        "TC-B11-03: 显示宽度应钳制到 A4 内容宽 ≈5,733,287 EMU，实际 cx={}",
        cx
    );
}

// ---------------------------------------------------------------------------
// TC-B10-08：真实事故回归 —— 中文长文档 + 不规则表格的 XML 良构性
// ---------------------------------------------------------------------------
// 事故（2026-10-26 手工测试发现）：用户导出《TeleAgent插件机制 PRD》时，
// v1 注入器在中文多字节偏移 + 空单元格不规则表格上错位拼接，吃掉 `<w:tblPr>`
// 开标签，产出的 docx 被 Word 与 LibreOffice 双双拒收。
// 本用例用同款输入结构钉死：导出成功 + document.xml 可被严格 XML 解析 +
// 每个表格首行都有 tblHeader + 无「吃标签」损坏特征。

/// 与事故文档同构的输入：中文标题 + 首行含空单元格的不规则表格（用户原文风格）。
const REAL_WORLD_MD: &str = r#"
# 【PRD】TeleAgent插件机制

|  | | 产品经理 | 状态 | 当前版本 | 最近更新 | | |---|---|---|---| | | TeleAgent产品组 | 草稿 | v0.9 | 2026/10/25 | |  |

## 各端涉及情况

|  | | 端 | 是否涉及 | 说明 | | |---|---|---|---| | | 桌面端 | 是 | 核心承载 | | | IM 端 | 是 | 审批与摘要 | |

## 6.4 插件工具

| 项 | 说明 |
|---|---|
| 规则 | 插件工具与内置工具同池，由模型按需调用；已启用插件的工具对全部会话可用 |
| 规则 | 单会话默认暴露给模型 ≤40 个工具，超出按需检索召回；单会话工具描述合计 ≤8k tokens |
| 异常 | 工具执行失败 → 错误信息回给模型自行调整重试；执行超时可取消，取消不记为失败 |

## 6.5 常驻提示词

| 项 | 说明 |
|---|---|
| 规则 | 分两类：静态段与动态段，动态段每次请求生成，拼接在最末，不破坏缓存 |
| 规则 | 与技能分工：技能需用户 `@` 引用才进上下文；常驻提示词随插件启用即生效 |
"#;

fn validate_xml_strict(xml: &str) {
    let mut reader = quick_xml::Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Eof) => break,
            Ok(_) => {}
            Err(e) => panic!("TC-B10-08: document.xml XML 良构性校验失败（损坏文件）: {e}"),
        }
    }
}

#[test]
fn tc_b10_08_real_world_chinese_doc_xml_wellformed() {
    let (bytes, _, _) = run_export(&make_req(REAL_WORLD_MD));
    let (xml, _) = unpack_docx(&bytes);

    // 1) 严格 XML 良构（事故的直接失败点：mismatched tag）
    validate_xml_strict(&xml);

    // 2) 无「吃标签」损坏特征：tblHeader 后紧跟的必须是合法标签，不得直接拼属性文本
    assert!(
        !xml.contains("tblHeader/>w:"),
        "TC-B10-08: 发现注入吃标签损坏特征 `tblHeader/>w:`（v1 事故指纹）"
    );

    // 3) 每个表格的首行都带 tblHeader（跨页重复表头目标达成）
    // 注：事故文档中「|  | | 产品经理 | …」式单行伪表格不构成 GFM 表格（解析为段落），
    // 仅 6.4/6.5 两个规范表格计入。
    let tbl_count = xml.matches("<w:tbl>").count();
    assert!(
        tbl_count >= 2,
        "TC-B10-08: 输入应产生 >=2 个表格，实际 {}",
        tbl_count
    );
    let mut cursor = 0usize;
    for i in 0..tbl_count {
        let tbl_start = xml[cursor..]
            .find("<w:tbl>")
            .unwrap_or_else(|| panic!("TC-B10-08: 第 {i} 个表格应存在"));
        let tbl_abs = cursor + tbl_start;
        let tbl_end = xml[tbl_abs..]
            .find("</w:tbl>")
            .unwrap_or_else(|| panic!("TC-B10-08: 第 {i} 个表格应有闭合标签"));
        let table = &xml[tbl_abs..tbl_abs + tbl_end];
        let tr_rel = table.find("<w:tr>").expect("TC-B10-08: 表格应含行");
        let first_row = &table[tr_rel..];
        let first_row_end = first_row.find("</w:tr>").expect("TC-B10-08: 首行应闭合");
        assert!(
            first_row[..first_row_end].contains("<w:tblHeader/>"),
            "TC-B10-08: 第 {i} 个表格首行应含 <w:tblHeader/>（跨页表头），实际前 {} 字节: {}",
            first_row_end,
            &first_row[..first_row_end.min(200)]
        );
        cursor = tbl_abs + tbl_end;
    }
}

/// 事故文档再生工具：设 MARKRUST_REGEN_DOC=<输入.md>|<输出.docx> 后运行
/// `cargo test --test export_docx_content regenerate_user_document -- --ignored`
/// 用修复后的管线从用户 markdown 重新生成可打开的 docx。
#[test]
#[ignore = "手动工具：需 MARKRUST_REGEN_DOC 环境变量（<输入.md>|<输出.docx>）"]
fn regenerate_user_document() {
    let spec = std::env::var("MARKRUST_REGEN_DOC").expect("需要 MARKRUST_REGEN_DOC=<in.md>|<out.docx>");
    let (in_path, out_path) = spec
        .split_once('|')
        .expect("格式应为 <输入.md>|<输出.docx>");
    let md = std::fs::read_to_string(in_path).expect("读取输入 markdown");
    let (bytes, image_count, warnings) = run_export(&make_req(&md));
    std::fs::write(out_path, &bytes).expect("写出 docx");
    println!(
        "regenerated: {} bytes, images={}, warnings={:?}",
        bytes.len(),
        image_count,
        warnings
    );
}

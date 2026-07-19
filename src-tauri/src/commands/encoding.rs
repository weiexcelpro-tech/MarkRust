//! 编码探测与转换，使用 `chardetng` + `encoding_rs`。
//!
//! 契约参考：`marktext-develop/packages/desktop/src/main/filesystem/encoding.ts`。
//!
//! 探测优先级（与原 `guessEncoding` 一致）：
//! 1. BOM 头（UTF-8 / UTF-16LE / UTF-16BE）
//! 2. 无 NUL 字节 + UTF-8 严格解码通过 → UTF-8（#3151：避免 GBK 误判）
//! 3. `chardetng` 启发式探测

use serde::Serialize;

/// `read_file` 的返回值。`untagged` 使得前端收到的要么是 string、要么是 number[]。
#[derive(Serialize)]
#[serde(untagged)]
pub enum ReadFileResult {
    Text(String),
    Binary(Vec<u8>),
}

/// 自动探测字节流的编码。
///
/// BOM → 合法 UTF-8 → chardetng，三级回退。
pub fn detect_encoding(bytes: &[u8]) -> &'static encoding_rs::Encoding {
    // BOM 优先：UTF-8 (EF BB BF) / UTF-16BE (FE FF) / UTF-16LE (FF FE)
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return encoding_rs::UTF_8;
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE;
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE;
    }

    // 合法 UTF-8 判定：NUL 字节表示二进制 / BOM-less UTF-16，不应按 UTF-8 处理。
    // 否则 chardetng 可能把含希腊字母等合法 UTF-8 误判为 GBK（#3151）。
    if !bytes.contains(&0u8) {
        let (_, _, had_errors) = encoding_rs::UTF_8.decode(bytes);
        if !had_errors {
            return encoding_rs::UTF_8;
        }
    }

    // chardetng 启发式回退
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    detector.guess(None, true)
}

/// 用指定编码名字解析为 encoding_rs 编码或特殊编码（base64/hex）。
fn resolve_encoding(name: &str) -> ResolvedEncoding {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "utf8" | "utf-8" => ResolvedEncoding::Rs(encoding_rs::UTF_8),
        "ascii" => ResolvedEncoding::Rs(encoding_rs::UTF_8),
        "utf16le" | "utf-16le" => ResolvedEncoding::Rs(encoding_rs::UTF_16LE),
        "utf16be" | "utf-16be" => ResolvedEncoding::Rs(encoding_rs::UTF_16BE),
        "latin1" | "binary" => ResolvedEncoding::Rs(encoding_rs::WINDOWS_1252),
        "base64" => ResolvedEncoding::Base64,
        "hex" => ResolvedEncoding::Hex,
        _ => match encoding_rs::Encoding::for_label(lower.as_bytes()) {
            Some(enc) => ResolvedEncoding::Rs(enc),
            None => ResolvedEncoding::Unknown,
        },
    }
}

enum ResolvedEncoding {
    Rs(&'static encoding_rs::Encoding),
    Base64,
    Hex,
    Unknown,
}

/// 解码字节流。`encoding = None` 时自动探测。
///
/// - 显式编码始终返回 `Text`（包括 base64/hex，语义与 Node.js BufferEncoding 一致）。
/// - 自动探测遇到含 NUL 字节的二进制文件时返回 `Binary`。
pub fn decode(bytes: &[u8], encoding: Option<&str>) -> ReadFileResult {
    if let Some(enc_name) = encoding {
        return decode_with_encoding(bytes, enc_name);
    }

    // 自动探测路径
    // BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let (text, _, _) = encoding_rs::UTF_8.decode(&bytes[3..]);
        return ReadFileResult::Text(text.into_owned());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        return ReadFileResult::Text(text.into_owned());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return ReadFileResult::Text(text.into_owned());
    }

    // 合法 UTF-8
    if !bytes.contains(&0u8) {
        let (text, _, had_errors) = encoding_rs::UTF_8.decode(bytes);
        if !had_errors {
            return ReadFileResult::Text(text.into_owned());
        }
    }

    // 前 8KB 含 NUL → 判定为二进制
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return ReadFileResult::Binary(bytes.to_vec());
    }

    // chardetng 回退
    let enc = detect_encoding(bytes);
    let (text, _) = enc.decode_without_bom_handling(bytes);
    ReadFileResult::Text(text.into_owned())
}

fn decode_with_encoding(bytes: &[u8], encoding: &str) -> ReadFileResult {
    match resolve_encoding(encoding) {
        ResolvedEncoding::Rs(enc) => {
            let (text, _, _) = enc.decode(bytes);
            ReadFileResult::Text(text.into_owned())
        }
        ResolvedEncoding::Base64 => ReadFileResult::Text(encode_base64(bytes)),
        ResolvedEncoding::Hex => ReadFileResult::Text(encode_hex(bytes)),
        ResolvedEncoding::Unknown => ReadFileResult::Binary(bytes.to_vec()),
    }
}

/// 用指定编码将文本编码为字节流（用于写文件）。
pub fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match resolve_encoding(encoding) {
        ResolvedEncoding::Rs(enc) => {
            let (cow, _, _) = enc.encode(text);
            cow.into_owned()
        }
        // base64/hex 是解码语义（从文本表示还原字节），写文件时直接用 UTF-8
        ResolvedEncoding::Base64 | ResolvedEncoding::Hex | ResolvedEncoding::Unknown => {
            text.as_bytes().to_vec()
        }
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// 最小 base64 编码器（不引入额外 crate）。
fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

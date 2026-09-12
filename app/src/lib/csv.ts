/**
 * CSV の読み書き。
 *
 * ライブラリは入れない（決定 D22/D23）。Excel が出す CSV を読めて、
 * Excel で開ける CSV を書ければ足りる。必要なのは次の4点だけ:
 *
 *   - 引用符の中のカンマ・改行・二重引用符
 *   - BOM（Excel が付ける）
 *   - Shift_JIS（「CSV UTF-8」ではなく素の「CSV」で保存された場合）
 *   - 行末が CRLF
 *
 * 文字コードの判別は**中身を見て決める**。拡張子や宣言は信用できない。
 */

/** 1行を解析する途中の状態を持たずに、全体を一度に読む */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // BOM は落とす。残すと1列目のヘッダ名が一致しなくなる
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // CRLF は1つの行末として扱う
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  // 最後の行。末尾に改行が無いファイルでも落とさない
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 完全な空行は捨てる（Excel が末尾に付けることがある）
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * バイト列を文字列にする。UTF-8 と Shift_JIS を判別する。
 *
 * 判別は「UTF-8 として解釈して壊れた文字（U+FFFD）が出るか」で見る。
 * Excel の既定（日本語環境）は Shift_JIS なので、これが無いと
 * 「CSV UTF-8」で保存し直してもらうまで文字化けが直らない。
 */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: string } {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return { text: utf8, encoding: "utf-8" };

  // Node には shift_jis のデコーダが入っている（ICU 付きビルド）
  try {
    const sjis = new TextDecoder("shift_jis").decode(bytes);
    if (!sjis.includes("�")) return { text: sjis, encoding: "shift_jis" };
    // どちらも壊れるなら、壊れ方が少ない方を採る
    return utf8.split("�").length <= sjis.split("�").length
      ? { text: utf8, encoding: "utf-8(一部読めません)" }
      : { text: sjis, encoding: "shift_jis(一部読めません)" };
  } catch {
    return { text: utf8, encoding: "utf-8(一部読めません)" };
  }
}

/** 1フィールドを書く。必要なときだけ引用する */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV を組み立てる。
 *
 * **BOM を付け、改行を CRLF にする。** Excel でそのまま開いたときに
 * 日本語が化けず、行が崩れないようにするため。
 */
export function buildCsv(rows: Array<Array<string | number | null>>): string {
  const body = rows.map((r) => r.map(csvField).join(",")).join("\r\n");
  return `﻿${body}\r\n`;
}

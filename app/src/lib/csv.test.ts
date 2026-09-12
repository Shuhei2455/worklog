import { describe, it, expect } from "vitest";
import { parseCsv, decodeCsv, csvField, buildCsv } from "./csv";

describe("parseCsv", () => {
  it("基本", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("CRLF を1つの行末として扱う", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("引用符の中のカンマ", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("引用符の中の改行", () => {
    expect(parseCsv('件名,詳細\n"A","1行目\n2行目"')).toEqual([
      ["件名", "詳細"],
      ["A", "1行目\n2行目"],
    ]);
  });

  it("二重引用符のエスケープ", () => {
    expect(parseCsv('a,"言った""そう""と"')).toEqual([["a", '言った"そう"と']]);
  });

  it("BOM を落とす（残すと1列目のヘッダが一致しない）", () => {
    const rows = parseCsv("﻿課題キー,件名\nAA-1,テスト");
    expect(rows[0][0]).toBe("課題キー");
  });

  it("末尾に改行が無くても最後の行を落とさない", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(2);
  });

  it("完全な空行は捨てる（Excelが末尾に付ける）", () => {
    expect(parseCsv("a,b\n1,2\n,\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("空のファイル", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("列数が揃っていない行もそのまま返す（呼び出し側で判断する）", () => {
    expect(parseCsv("a,b,c\n1,2")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });
});

describe("decodeCsv", () => {
  it("UTF-8", () => {
    const bytes = new TextEncoder().encode("課題キー,件名");
    const out = decodeCsv(bytes);
    expect(out.encoding).toBe("utf-8");
    expect(out.text).toBe("課題キー,件名");
  });

  it("BOM付きUTF-8", () => {
    const bytes = new TextEncoder().encode("﻿課題キー");
    expect(decodeCsv(bytes).encoding).toBe("utf-8");
  });

  it("Shift_JIS を判別する（Excelの既定で保存されたファイル）", () => {
    // 「あ」= 0x82 0xA0、「い」= 0x82 0xA2
    const bytes = new Uint8Array([0x82, 0xa0, 0x2c, 0x82, 0xa2]);
    const out = decodeCsv(bytes);
    expect(out.encoding).toBe("shift_jis");
    expect(out.text).toBe("あ,い");
  });

  it("ASCIIだけなら UTF-8 として読む", () => {
    const bytes = new TextEncoder().encode("a,b,c");
    expect(decodeCsv(bytes)).toEqual({ text: "a,b,c", encoding: "utf-8" });
  });
});

describe("csvField", () => {
  it("必要なときだけ引用する", () => {
    expect(csvField("abc")).toBe("abc");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("null と undefined は空", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("数値", () => {
    expect(csvField(12000)).toBe("12000");
    expect(csvField(0)).toBe("0");
  });
});

describe("buildCsv", () => {
  it("BOM付き・CRLF で出す（Excelで化けない／行が崩れない）", () => {
    const out = buildCsv([
      ["課題キー", "件名"],
      ["AA-1", "テスト"],
    ]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("\r\n");
    expect(out).toBe("﻿課題キー,件名\r\nAA-1,テスト\r\n");
  });

  it("書いたものを読み戻せる", () => {
    const rows = [
      ["件名", "詳細"],
      ['カンマ,と"引用符"', "1行目\n2行目"],
    ];
    expect(parseCsv(buildCsv(rows))).toEqual(rows);
  });
});

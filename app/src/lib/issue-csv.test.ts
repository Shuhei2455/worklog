import { describe, it, expect } from "vitest";
import { issuesToCsv, csvToIssues, BASE_COLUMNS, type ImportMasters } from "./issue-csv";
import { parseCsv } from "./csv";
import type { FieldDef } from "./custom-field";

const listField: FieldDef = {
  id: 3,
  name: "対応区分",
  typeId: "single_list",
  required: false,
  settings: {},
  items: [
    { id: 2, name: "新規" },
    { id: 4, name: "調査" },
  ],
};

const numField: FieldDef = {
  id: 2,
  name: "見積金額",
  typeId: "number",
  required: false,
  settings: { unit: "円", min: 0 },
  items: [],
};

const masters = (over: Partial<ImportMasters> = {}): ImportMasters => ({
  statuses: new Map([
    ["未対応", 1],
    ["処理中", 2],
    ["完了", 4],
  ]),
  issueTypes: new Map([
    ["タスク", 1],
    ["バグ", 2],
  ]),
  users: new Map([["管理者", 1]]),
  categories: new Map([["基盤", 1]]),
  versions: new Map([
    ["v1.0", 1],
    ["v1.1", 2],
  ]),
  issueKeys: new Map([["AA-1", 100]]),
  fields: [numField, listField],
  ...over,
});

describe("issuesToCsv", () => {
  it("ヘッダは固定列＋カスタム属性名", () => {
    const csv = issuesToCsv([], [numField, listField]);
    const [header] = parseCsv(csv);
    expect(header).toEqual([...BASE_COLUMNS, "見積金額", "対応区分"]);
  });

  it("値を人が読める形で出す", () => {
    const csv = issuesToCsv(
      [
        {
          issueKey: "AA-1",
          summary: "テスト課題",
          description: "詳細\nです",
          statusName: "処理中",
          issueTypeName: "タスク",
          priorityId: 2,
          assigneeName: "管理者",
          resolutionId: null,
          startDate: new Date("2026-09-01T00:00:00Z"),
          dueDate: new Date("2026-09-30T00:00:00Z"),
          estimatedHours: 8,
          actualHours: null,
          parentIssueKey: null,
          categoryNames: ["基盤"],
          milestoneNames: ["v1.0", "v1.1"],
          versionNames: [],
          creatorName: "管理者",
          createdAt: new Date("2026-09-01T10:00:00Z"),
          updatedAt: new Date("2026-09-02T11:30:00Z"),
          customValues: {
            2: { kind: "number", value: 12000 },
            3: { kind: "list", itemIds: [4] },
          },
        },
      ],
      [numField, listField],
    );
    const rows = parseCsv(csv);
    const row = rows[1];
    expect(row[0]).toBe("AA-1");
    expect(row[1]).toBe("テスト課題");
    // 改行を含む詳細も読み戻せる
    expect(row[2]).toBe("詳細\nです");
    expect(row[3]).toBe("処理中");
    expect(row[5]).toBe("高");
    expect(row[8]).toBe("2026-09-01");
    expect(row[10]).toBe("8");
    expect(row[11]).toBe(""); // 実績時間は未入力
    expect(row[14]).toBe("v1.0 / v1.1");
    // カスタム属性
    expect(row[19]).toBe("12000 円");
    expect(row[20]).toBe("調査");
  });
});

describe("csvToIssues", () => {
  it("ヘッダ名で列を対応づける（順番に依存しない）", () => {
    const out = csvToIssues("件名,種別,状態\n並べ替えた表,バグ,処理中", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({
      summary: "並べ替えた表",
      issueTypeId: 2,
      statusId: 2,
    });
  });

  it("件名の列が無ければ何も取り込まない", () => {
    const out = csvToIssues("名前,種別\nA,タスク", masters());
    expect(out.issues).toEqual([]);
    expect(out.errors[0]).toContain("「件名」の列がありません");
  });

  it("種別を省略すると先頭の種別を使う", () => {
    const out = csvToIssues("件名\n種別なし", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0].issueTypeId).toBe(1);
  });

  it("名前で引けないマスタは**エラーにする**（黙って落とさない）", () => {
    const out = csvToIssues("件名,種別\nA,存在しない種別", masters());
    expect(out.issues).toEqual([]);
    expect(out.errors[0]).toContain("種別「存在しない種別」");
  });

  it("担当者が参加ユーザーにいなければエラー", () => {
    const out = csvToIssues("件名,担当者\nA,誰か", masters());
    expect(out.errors[0]).toContain("担当者「誰か」");
  });

  it("日付は YYYY/MM/DD も受ける（Excelが出す形）", () => {
    const out = csvToIssues("件名,開始日\nA,2026/09/01", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0].startDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("日付の形が違えばエラー", () => {
    const out = csvToIssues("件名,期限日\nA,九月一日", masters());
    expect(out.errors[0]).toContain("期限日");
  });

  it("複数値の列は / でもカンマでも区切れる", () => {
    const out = csvToIssues(
      '件名,マイルストーン\nA,"v1.0,v1.1"',
      masters(),
    );
    expect(out.errors).toEqual([]);
    expect(out.issues[0].milestoneIds).toEqual([1, 2]);
  });

  it("カスタム属性を列名で拾う", () => {
    const out = csvToIssues("件名,見積金額,対応区分\nA,15000,調査", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0].customFieldValues).toEqual({
      2: { kind: "number", value: 15000 },
      3: { kind: "list", itemIds: [4] },
    });
  });

  it("選択肢に無い値はエラー", () => {
    const out = csvToIssues("件名,対応区分\nA,未知", masters());
    expect(out.errors[0]).toContain("対応区分「未知」");
  });

  it("カスタム属性の範囲も見る", () => {
    const out = csvToIssues("件名,見積金額\nA,-5", masters());
    expect(out.errors[0]).toContain("見積金額");
  });

  it("行番号をエラーに含める", () => {
    const out = csvToIssues("件名,種別\nA,タスク\nB,無い種別", masters());
    expect(out.errors[0]).toContain("2行目");
  });

  it("知らない列は無視して報告する", () => {
    const out = csvToIssues("件名,社内メモ\nA,xxx", masters());
    expect(out.errors).toEqual([]);
    expect(out.ignoredColumns).toEqual(["社内メモ"]);
  });

  it("空の件名はエラーにして行を飛ばす", () => {
    const out = csvToIssues("件名\n\nA", masters());
    expect(out.issues).toHaveLength(1);
  });

  it("出した CSV をそのまま読み戻せる", () => {
    const csv = issuesToCsv(
      [
        {
          issueKey: "AA-1",
          summary: "往復の確認",
          description: null,
          statusName: "処理中",
          issueTypeName: "バグ",
          priorityId: 3,
          assigneeName: "管理者",
          resolutionId: null,
          startDate: null,
          dueDate: new Date("2026-10-01T00:00:00Z"),
          estimatedHours: null,
          actualHours: null,
          parentIssueKey: null,
          categoryNames: ["基盤"],
          milestoneNames: [],
          versionNames: [],
          creatorName: "管理者",
          createdAt: new Date("2026-09-01T00:00:00Z"),
          updatedAt: new Date("2026-09-01T00:00:00Z"),
          customValues: { 3: { kind: "list", itemIds: [2] } },
        },
      ],
      [numField, listField],
    );

    const out = csvToIssues(csv, masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0]).toMatchObject({
      summary: "往復の確認",
      issueTypeId: 2,
      statusId: 2,
      assigneeId: 1,
      categoryIds: [1],
    });
    expect(out.issues[0].customFieldValues).toEqual({
      3: { kind: "list", itemIds: [2] },
    });
  });
});

describe("親課題の列（M5レビューで見つけた抜け）", () => {
  it("既存の課題キーを親として解決する", () => {
    const out = csvToIssues("件名,親課題\n子の課題,AA-1", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0].parentIssueId).toBe(100);
  });

  it("小文字で書かれても引ける", () => {
    const out = csvToIssues("件名,親課題\n子の課題,aa-1", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0].parentIssueId).toBe(100);
  });

  it("存在しない課題キーはエラー（黙って無視しない）", () => {
    const out = csvToIssues("件名,親課題\n子の課題,AA-999", masters());
    expect(out.issues).toEqual([]);
    expect(out.errors[0]).toContain("親課題「AA-999」");
  });

  it("同じCSV内の行を親にしようとしたらエラーで知らせる", () => {
    // 取り込み前なのでIDが無い。黙って無視すると階層が崩れたまま入る
    const out = csvToIssues("件名,親課題\n親になる行,\n子の行,親になる行", masters());
    expect(out.errors.some((e) => e.includes("同じCSV内の行は親にできません"))).toBe(true);
  });

  it("空欄なら親なし", () => {
    const out = csvToIssues("件名,親課題\n単独の課題,", masters());
    expect(out.errors).toEqual([]);
    expect(out.issues[0].parentIssueId).toBeNull();
  });
});

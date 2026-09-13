import { buildCsv, parseCsv } from "@/lib/csv";
import { PRIORITIES, RESOLUTIONS } from "@/lib/constants";
import { formatFieldValue, parseFieldValue, type FieldDef } from "@/lib/custom-field";

/**
 * 課題の CSV 入出力。
 *
 * 列の並びは「出したものをそのまま読み戻せる」ことを基準に決めた（決定 D23）。
 * 本家の CSV の列順は公開されていないため合わせる対象が無い。
 *
 * **取り込みはヘッダ名で列を対応づける。** 列の順番に依存すると、
 * 既存のExcel表を並べ替えただけで壊れる。
 */

/** 固定列。カスタム属性はこの後ろに名前そのままで並ぶ */
export const BASE_COLUMNS = [
  "課題キー",
  "件名",
  "詳細",
  "状態",
  "種別",
  "優先度",
  "担当者",
  "完了理由",
  "開始日",
  "期限日",
  "予定時間",
  "実績時間",
  "親課題",
  "カテゴリー",
  "マイルストーン",
  "発生バージョン",
  "登録者",
  "登録日",
  "更新日",
] as const;

export type IssueRow = {
  issueKey: string;
  summary: string;
  description: string | null;
  statusName: string;
  issueTypeName: string;
  priorityId: number;
  assigneeName: string | null;
  resolutionId: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: unknown;
  actualHours: unknown;
  parentIssueKey: string | null;
  categoryNames: string[];
  milestoneNames: string[];
  versionNames: string[];
  creatorName: string;
  createdAt: Date;
  updatedAt: Date;
  customValues: Record<number, unknown>;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
const hours = (v: unknown) => (v == null ? "" : String(Number(v)));

/** 課題一覧を CSV にする */
export function issuesToCsv(issues: IssueRow[], fields: FieldDef[]): string {
  const header = [...BASE_COLUMNS, ...fields.map((f) => f.name)];

  const rows = issues.map((i) => [
    i.issueKey,
    i.summary,
    i.description ?? "",
    i.statusName,
    i.issueTypeName,
    PRIORITIES.find((p) => p.id === i.priorityId)?.label ?? "",
    i.assigneeName ?? "",
    i.resolutionId == null
      ? ""
      : (RESOLUTIONS.find((r) => r.id === i.resolutionId)?.label ?? ""),
    day(i.startDate),
    day(i.dueDate),
    hours(i.estimatedHours),
    hours(i.actualHours),
    i.parentIssueKey ?? "",
    i.categoryNames.join(" / "),
    i.milestoneNames.join(" / "),
    i.versionNames.join(" / "),
    i.creatorName,
    stamp(i.createdAt),
    stamp(i.updatedAt),
    ...fields.map((f) => formatFieldValue(f, i.customValues[f.id] ?? null)),
  ]);

  return buildCsv([header as unknown as string[], ...rows]);
}

// ---- 取り込み --------------------------------------------------------------

export type ImportMasters = {
  statuses: Map<string, number>;
  issueTypes: Map<string, number>;
  users: Map<string, number>;
  categories: Map<string, number>;
  versions: Map<string, number>;
  /** 既存の課題キー → id。親課題の解決に使う */
  issueKeys: Map<string, number>;
  fields: FieldDef[];
};

export type ParsedIssue = {
  /** 行番号（1始まり、ヘッダを除く）。エラー表示に使う */
  line: number;
  summary: string;
  description: string | null;
  statusId?: number;
  issueTypeId: number;
  priorityId?: number;
  assigneeId?: number | null;
  resolutionId?: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  /** 親課題。既存の課題キーで指定する。同じCSV内の行は親にできない */
  parentIssueId: number | null;
  categoryIds: number[];
  milestoneIds: number[];
  versionIds: number[];
  customFieldValues: Record<number, unknown>;
};

export type ImportResult = {
  issues: ParsedIssue[];
  /** 行ごとのエラー。1件でもあれば取り込まない */
  errors: string[];
  /** ヘッダにあったが使わなかった列。取り違えに気づけるように返す */
  ignoredColumns: string[];
};

const toDate = (s: string): Date | null => {
  const t = s.trim();
  if (!t) return null;
  // Excel が出しがちな YYYY/MM/DD も受ける
  const normalized = t.replace(/\//g, "-");
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) return null;
  const d = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toNumber = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 複数値の列は「/」「,」「改行」のいずれでも区切れるようにする */
const splitMulti = (s: string): string[] =>
  s
    .split(/[\/,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * CSV を課題の入力に変換する。
 *
 * **1件でもエラーがあれば取り込まない**（`errors` が空でないときは呼び出し側が
 * 中止する）。半分だけ入った状態は、やり直しが一番面倒になる。
 */
export function csvToIssues(text: string, masters: ImportMasters): ImportResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length === 0) {
    return { issues: [], errors: ["行がありません"], ignoredColumns: [] };
  }

  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);

  if (col("件名") === -1) {
    return {
      issues: [],
      errors: ['「件名」の列がありません（1行目がヘッダである必要があります）'],
      ignoredColumns: [],
    };
  }

  const fieldByName = new Map(masters.fields.map((f) => [f.name, f]));
  const known = new Set<string>([...BASE_COLUMNS, ...fieldByName.keys()]);
  const ignoredColumns = header.filter((h) => h && !known.has(h));

  const issues: ParsedIssue[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const at = (name: string) => {
      const i = col(name);
      return i === -1 ? "" : (row[i] ?? "").trim();
    };
    const line = r; // ヘッダを除いた行番号
    const where = `${line}行目`;

    const summary = at("件名");
    if (!summary) {
      errors.push(`${where}: 件名が空です`);
      continue;
    }

    // 種別は必須。名前で引けないと課題を作れない
    const typeName = at("種別");
    const issueTypeId = typeName
      ? masters.issueTypes.get(typeName)
      : [...masters.issueTypes.values()][0];
    if (!issueTypeId) {
      errors.push(
        `${where}: 種別「${typeName}」がこのプロジェクトにありません`,
      );
      continue;
    }

    const statusName = at("状態");
    const statusId = statusName ? masters.statuses.get(statusName) : undefined;
    if (statusName && !statusId) {
      errors.push(`${where}: 状態「${statusName}」がありません`);
      continue;
    }

    const priorityName = at("優先度");
    const priorityId = priorityName
      ? PRIORITIES.find((p) => p.label === priorityName || p.name === priorityName)?.id
      : undefined;
    if (priorityName && !priorityId) {
      errors.push(`${where}: 優先度「${priorityName}」は 高/中/低 のいずれかです`);
      continue;
    }

    const assigneeName = at("担当者");
    const assigneeId = assigneeName ? masters.users.get(assigneeName) : null;
    if (assigneeName && !assigneeId) {
      errors.push(`${where}: 担当者「${assigneeName}」が参加ユーザーにいません`);
      continue;
    }

    const resolutionName = at("完了理由");
    const resolutionId = resolutionName
      ? RESOLUTIONS.find((x) => x.label === resolutionName)?.id
      : null;
    if (resolutionName && !resolutionId) {
      errors.push(`${where}: 完了理由「${resolutionName}」がありません`);
      continue;
    }

    const startRaw = at("開始日");
    const dueRaw = at("期限日");
    const startDate = toDate(startRaw);
    const dueDate = toDate(dueRaw);
    if (startRaw && !startDate) {
      errors.push(`${where}: 開始日「${startRaw}」は YYYY-MM-DD で書いてください`);
      continue;
    }
    if (dueRaw && !dueDate) {
      errors.push(`${where}: 期限日「${dueRaw}」は YYYY-MM-DD で書いてください`);
      continue;
    }

    const estRaw = at("予定時間");
    const actRaw = at("実績時間");
    const estimatedHours = toNumber(estRaw);
    const actualHours = toNumber(actRaw);
    if (estRaw && estimatedHours === null) {
      errors.push(`${where}: 予定時間「${estRaw}」は数値で書いてください`);
      continue;
    }
    if (actRaw && actualHours === null) {
      errors.push(`${where}: 実績時間「${actRaw}」は数値で書いてください`);
      continue;
    }

    // 親課題。**既存の課題だけ**を親にできる。
    // 同じCSV内の行を親にしようとしても、その時点ではまだIDが無い
    const parentRaw = at("親課題");
    let parentIssueId: number | null = null;
    if (parentRaw) {
      const id = masters.issueKeys.get(parentRaw.toUpperCase());
      if (!id) {
        errors.push(
          `${where}: 親課題「${parentRaw}」が見つかりません` +
            "（既存の課題キーを書いてください。同じCSV内の行は親にできません）",
        );
        continue;
      }
      parentIssueId = id;
    }

    // 名前で引けないマスタは「無視」ではなくエラーにする。
    // 黙って落とすと、取り込んだ後に気づけない
    const resolveMulti = (
      label: string,
      map: Map<string, number>,
    ): number[] | null => {
      const out: number[] = [];
      for (const name of splitMulti(at(label))) {
        const id = map.get(name);
        if (!id) {
          errors.push(`${where}: ${label}「${name}」がありません`);
          return null;
        }
        out.push(id);
      }
      return out;
    };

    const categoryIds = resolveMulti("カテゴリー", masters.categories);
    const milestoneIds = resolveMulti("マイルストーン", masters.versions);
    const versionIds = resolveMulti("発生バージョン", masters.versions);
    if (!categoryIds || !milestoneIds || !versionIds) continue;

    // カスタム属性。列名が属性名と一致するものを拾う
    const customFieldValues: Record<number, unknown> = {};
    let cfError = false;
    for (const [name, def] of fieldByName) {
      const i = col(name);
      if (i === -1) continue;
      const raw = (row[i] ?? "").trim();

      // リスト系は選択肢名で書かれているので、IDに直してから検証する
      let input: string | string[] = raw;
      if (def.items.length > 0) {
        const names = splitMulti(raw);
        const ids: string[] = [];
        for (const n of names) {
          const item = def.items.find((x) => x.name === n);
          if (!item) {
            errors.push(`${where}: ${name}「${n}」は選択肢にありません`);
            cfError = true;
            break;
          }
          ids.push(String(item.id));
        }
        if (cfError) break;
        input = ids;
      }

      const parsed = parseFieldValue(def, input);
      if (!parsed.ok) {
        errors.push(`${where}: ${parsed.error}`);
        cfError = true;
        break;
      }
      if (parsed.value !== null) customFieldValues[def.id] = parsed.value;
    }
    if (cfError) continue;

    issues.push({
      line,
      summary,
      description: at("詳細") || null,
      statusId,
      issueTypeId,
      priorityId,
      assigneeId: assigneeId ?? null,
      resolutionId: resolutionId ?? null,
      startDate,
      dueDate,
      estimatedHours,
      actualHours,
      parentIssueId,
      categoryIds,
      milestoneIds,
      versionIds,
      customFieldValues,
    });
  }

  return { issues, errors, ignoredColumns };
}

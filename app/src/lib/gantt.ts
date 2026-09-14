import { STATUS_ID_CLOSED } from "@/lib/constants";

/**
 * ガントチャートの帯を決める純関数。
 *
 * **仕様の分岐が多く目視デバッグに向かないので、必ずここに集約する。**
 * 画面・エクスポート・API が全部これを通る。
 *
 * 根拠: docs/00-spec-verified.md 5章
 * 出典: https://support-ja.backlog.com/hc/ja/articles/360036144673
 *
 * v1設計では「開始日と期限日が揃った課題だけ」と誤っていた。
 * さらに2026-09-12の再確認で、v2の記述にも2箇所の誤りが見つかっている:
 * - 「4パターン」ではなく5通り＋非表示の6分岐
 * - マイルストーンと完了日は並列ではなく、マイルストーンが優先
 */

export type GanttKind =
  /** 開始日と期限日の両方あり */
  | "range"
  /** 開始日のみ */
  | "startOnly"
  /** 期限日のみ */
  | "dueOnly"
  /** 日付なし・マイルストーンに終了日あり */
  | "milestone"
  /** 日付なし・マイルストーンに終了日なし・状態が「完了」 */
  | "completed";

export type GanttBar = {
  from: Date;
  to: Date;
  kind: GanttKind;
};

/** 判定に必要な情報だけを持つ型。Prismaのモデルに依存させない */
export type GanttIssueInput = {
  startDate: Date | null;
  dueDate: Date | null;
  statusId: number;
  completedAt: Date | null;
  /**
   * この課題に紐づくマイルストーンの終了日。
   * 複数ある場合は呼び出し側が渡す配列のうち最も早いものを使う。
   * null や undefined の要素は「終了日なし」として無視する。
   */
  milestoneReleaseDueDates?: Array<Date | null | undefined>;
};

/** 時刻を落として日付だけにする。帯の位置は日単位で決まる */
function atDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 課題1件からガントの帯を返す。表示対象でなければ null。
 *
 * 判定の順序が仕様そのものなので、条件を入れ替えないこと。
 */
export function resolveGanttBar(issue: GanttIssueInput): GanttBar | null {
  const start = issue.startDate ? atDay(issue.startDate) : null;
  const due = issue.dueDate ? atDay(issue.dueDate) : null;

  // 1. 開始日と期限日の両方あり
  if (start && due) {
    // 期限が開始より前に入っていても帯が裏返らないようにする
    return start <= due
      ? { from: start, to: due, kind: "range" }
      : { from: due, to: start, kind: "range" };
  }

  // 2. 開始日のみ
  if (start) return { from: start, to: start, kind: "startOnly" };

  // 3. 期限日のみ
  if (due) return { from: due, to: due, kind: "dueOnly" };

  // --- ここから「開始日も期限日も無い」場合 ---
  // 本家はマイルストーンの設定状況で分岐する。
  // マイルストーンと完了日は並列ではなく、マイルストーンが優先される

  // 4. マイルストーンに終了日あり
  const releaseDates = (issue.milestoneReleaseDueDates ?? [])
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());
  if (releaseDates.length > 0) {
    // 複数のマイルストーンを持つときにどれを使うかは本家の挙動が未確認。
    // 最も早い終了日を使う（決定 D15）
    const d = atDay(releaseDates[0]);
    return { from: d, to: d, kind: "milestone" };
  }

  // 5. マイルストーンに終了日なし・状態が「完了」
  if (issue.statusId === STATUS_ID_CLOSED && issue.completedAt) {
    const d = atDay(issue.completedAt);
    return { from: d, to: d, kind: "completed" };
  }

  // 6. どれにも当たらない＝表示されない
  return null;
}

/** 表示開始日の既定は当日の1週間前 */
export function defaultGanttStart(today = new Date()): Date {
  const d = atDay(today);
  d.setDate(d.getDate() - 7);
  return d;
}

export type TimeScale = "day" | "week" | "month" | "quarter";

/** タイムスケールごとの、1目盛りが表す日数 */
export const SCALE_DAYS: Record<TimeScale, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 91,
};

/** 表示範囲の日数。スケールに応じて広げる */
export function ganttRangeDays(scale: TimeScale): number {
  switch (scale) {
    case "day":
      return 35;
    case "week":
      return 120;
    case "month":
      return 365;
    case "quarter":
      return 730;
  }
}

/** 帯の左端と幅を、表示開始日からの日数で返す（描画用） */
export function barOffset(
  bar: GanttBar,
  rangeStart: Date,
): { offsetDays: number; spanDays: number } {
  const ms = 24 * 60 * 60 * 1000;
  const offsetDays = Math.round((bar.from.getTime() - atDay(rangeStart).getTime()) / ms);
  // 1日だけの帯も幅0にならないよう最低1日ぶんの幅を持たせる
  const spanDays = Math.max(1, Math.round((bar.to.getTime() - bar.from.getTime()) / ms) + 1);
  return { offsetDays, spanDays };
}

/** グルーピングの軸。本家と同じ5つ */
export const GANTT_GROUP_BY = [
  "assignee",
  "issueType",
  "milestone",
  "category",
  "parentIssue",
] as const;
export type GanttGroupBy = (typeof GANTT_GROUP_BY)[number];

export const GANTT_GROUP_LABELS: Record<GanttGroupBy, string> = {
  assignee: "担当者",
  issueType: "種別",
  milestone: "マイルストーン",
  category: "カテゴリー",
  parentIssue: "親課題",
};

/* ------------------------------------------------------------------ *
 * 日付の目盛り
 * ------------------------------------------------------------------ */

/**
 * 目盛りの1マス。
 *
 * `label` が空文字のマスは日付を出さない（週・月スケールで間引くため）。
 */
export type GanttTick = {
  /** 表示開始日からの日数 */
  i: number;
  label: string;
  weekend: boolean;
  today: boolean;
};

/** 月の帯。ヘッダの上段に出す */
export type GanttMonthBand = {
  /** `2026年9月` の形 */
  label: string;
  /** この月が占めるマスの数 */
  days: number;
};

/**
 * 目盛りを作る。
 *
 * **日スケールでは日付だけを出す**（`9/14` ではなく `14`）。
 * 1マス22pxに対して `12/31` は25px必要で**はみ出して隣と重なる**ため。
 * 月は上段の帯（`monthBands`）で分かるので、情報は落ちない。
 *
 * 週以上のスケールは間引くので余白があり、`M/D` のまま出す。
 */
export function ganttTicks(
  rangeStart: Date,
  days: number,
  scale: TimeScale,
  today = new Date(),
): GanttTick[] {
  const step = scale === "day" ? 1 : scale === "week" ? 7 : scale === "month" ? 30 : 91;
  const todayStr = today.toDateString();
  const ticks: GanttTick[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    const show = i % step === 0;
    ticks.push({
      i,
      label: !show
        ? ""
        : scale === "day"
          ? String(d.getDate())
          : `${d.getMonth() + 1}/${d.getDate()}`,
      weekend: d.getDay() === 0 || d.getDay() === 6,
      today: d.toDateString() === todayStr,
    });
  }
  return ticks;
}

/**
 * 連続する日を月ごとにまとめる。ヘッダ上段の帯に使う。
 *
 * 端の月は途中から始まる・途中で終わるので、`days` は実際に含まれる
 * マスの数になる（月の日数とは限らない）。
 */
export function ganttMonthBands(rangeStart: Date, days: number): GanttMonthBand[] {
  const bands: GanttMonthBand[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.days += 1;
    else bands.push({ label, days: 1 });
  }
  return bands;
}

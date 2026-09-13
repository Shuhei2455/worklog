import { prisma } from "@/lib/db";
import { STATUS_ID_CLOSED, STATUS_ID_OPEN } from "@/lib/constants";

/**
 * プロジェクトの進捗。
 *
 * **本家には無い機能**（ユーザーの要望）。本家は課題一覧の件数と
 * バーンダウン（マイルストーン単位）はあるが、
 * 「プロジェクト全体がどのくらい進んでいるか」を一覧で見る画面が無い。
 *
 * 決定 D29: 進捗率は**課題の件数**で出す。予定時間ベースにしないのは、
 * 予定時間が未入力の課題が多い運用では 0% に張り付いて使えないため
 * （バーンダウンで同じ問題に当たって、件数の線を併記した経緯がある）。
 * 予定時間が入っているぶんの進捗は別に添える。
 */

export type StatusCount = {
  statusId: number;
  /** その状態の課題数 */
  count: number;
};

export type ProjectProgressInput = {
  /** 状態ごとの件数。プロジェクトの全課題ぶん */
  byStatus: StatusCount[];
  /** 期限を過ぎていて、まだ完了していない課題数 */
  overdue: number;
  /** 予定時間の合計と、完了した課題ぶんの合計 */
  hours?: { total: number; done: number };
};

export type ProjectProgress = {
  total: number;
  /** 完了（状態=完了）の件数 */
  done: number;
  /** 未着手（状態=未対応）の件数 */
  notStarted: number;
  /** 進行中（未対応でも完了でもない）の件数 */
  inProgress: number;
  overdue: number;
  /** 完了率（0〜100の整数）。課題が0件なら0 */
  percent: number;
  /** 予定時間ベースの完了率。予定時間が1件も入っていなければ null */
  hoursPercent: number | null;
};

export function computeProgress(input: ProjectProgressInput): ProjectProgress {
  const total = input.byStatus.reduce((sum, s) => sum + s.count, 0);
  const done = input.byStatus
    .filter((s) => s.statusId === STATUS_ID_CLOSED)
    .reduce((sum, s) => sum + s.count, 0);
  const notStarted = input.byStatus
    .filter((s) => s.statusId === STATUS_ID_OPEN)
    .reduce((sum, s) => sum + s.count, 0);

  const hours = input.hours;
  return {
    total,
    done,
    notStarted,
    inProgress: total - done - notStarted,
    overdue: input.overdue,
    // 0件のときに NaN を出さない。「課題が無い＝0%」として扱う
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    hoursPercent:
      !hours || hours.total === 0 ? null : Math.round((hours.done / hours.total) * 100),
  };
}

/**
 * 進捗の状態を一言で表す。
 *
 * 「％だけ見ても判断できない」ので、目を向けるべきものを出す。
 * 判定の順は**まずい方から**——期限切れがあるなら、進捗率が高くてもそれを言う。
 */
export type ProgressTone = "danger" | "warn" | "done" | "normal" | "empty";

export function progressTone(p: ProjectProgress): ProgressTone {
  if (p.total === 0) return "empty";
  if (p.overdue > 0) return "danger";
  if (p.percent === 100) return "done";
  // 未着手が全体の7割を超えていたら、動いていない可能性が高い
  if (p.notStarted / p.total > 0.7) return "warn";
  return "normal";
}

/**
 * 複数プロジェクトの進捗をまとめて取る。
 *
 * **プロジェクトごとにクエリを投げない。** 一覧に20件並ぶとN+1で20倍になる。
 * `groupBy` で3本にまとめ、アプリ側で projectId に配る。
 *
 * 権限は呼び出し側で解決しておくこと（`visibleProjectIds()` の結果を渡す）。
 * ここは渡された ID をそのまま信じる。
 */
export async function loadProjectProgress(
  projectIds: number[],
  /** 期限切れの判定に使う「今日」。テストと表示のズレを防ぐため引数で受ける */
  today: Date = new Date(),
): Promise<Map<number, ProjectProgress>> {
  const result = new Map<number, ProjectProgress>();
  if (projectIds.length === 0) return result;

  const inProjects = { projectId: { in: projectIds } };

  const [byStatus, overdue, hoursTotal, hoursDone] = await Promise.all([
    prisma.issue.groupBy({
      by: ["projectId", "statusId"],
      where: inProjects,
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ["projectId"],
      // 期限日は date 型。今日ぶんはまだ切れていないので「今日より前」で見る
      where: { ...inProjects, statusId: { not: STATUS_ID_CLOSED }, dueDate: { lt: today } },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ["projectId"],
      where: inProjects,
      _sum: { estimatedHours: true },
    }),
    prisma.issue.groupBy({
      by: ["projectId"],
      where: { ...inProjects, statusId: STATUS_ID_CLOSED },
      _sum: { estimatedHours: true },
    }),
  ]);

  const overdueBy = new Map(overdue.map((r) => [r.projectId, r._count._all]));
  // Decimal で返るので number に落とす。予定時間は小数第2位までなので精度は足りる
  const num = (v: { toNumber(): number } | null) => (v ? v.toNumber() : 0);
  const totalHoursBy = new Map(hoursTotal.map((r) => [r.projectId, num(r._sum.estimatedHours)]));
  const doneHoursBy = new Map(hoursDone.map((r) => [r.projectId, num(r._sum.estimatedHours)]));

  const statusesBy = new Map<number, StatusCount[]>();
  for (const row of byStatus) {
    const list = statusesBy.get(row.projectId) ?? [];
    list.push({ statusId: row.statusId, count: row._count._all });
    statusesBy.set(row.projectId, list);
  }

  // 課題が1件も無いプロジェクトは groupBy に出てこない。空で埋めて取りこぼさない
  for (const id of projectIds) {
    result.set(
      id,
      computeProgress({
        byStatus: statusesBy.get(id) ?? [],
        overdue: overdueBy.get(id) ?? 0,
        hours: { total: totalHoursBy.get(id) ?? 0, done: doneHoursBy.get(id) ?? 0 },
      }),
    );
  }
  return result;
}

import { DEFAULT_STATUSES } from "@/lib/constants";
import { translator, type Locale } from "@/lib/i18n";
import { progressTone, type ProjectProgress } from "@/lib/project-progress";

/**
 * プロジェクトの進捗バー。
 *
 * **本家に無い画面なので、寄せる相手がいない。**（決定 D29）
 * そのぶん色だけは本家の状態色を使う——利用者は課題一覧で
 * 「青＝処理中」「黄緑＝完了」を見慣れているので、進捗バーだけ別の配色に
 * すると読み替えが要る。
 */
const COLOR = Object.fromEntries(DEFAULT_STATUSES.map((s) => [s.id, s.color])) as Record<
  number,
  string
>;

export function ProgressBar({
  progress,
  locale = "ja",
}: {
  progress: ProjectProgress;
  locale?: Locale;
}) {
  const p = progress;
  const t = translator(locale);

  if (p.total === 0) {
    return <div className="h-2 rounded-pill bg-slate-200" aria-hidden />;
  }

  // 積み上げの順は課題の進み方と同じ（完了 → 進行中 → 未着手）。
  // 左から埋まっていくので、バーの伸びが進捗として読める
  const parts = [
    { key: "done", width: (p.done / p.total) * 100, color: COLOR[4] },
    { key: "doing", width: (p.inProgress / p.total) * 100, color: COLOR[2] },
    { key: "open", width: (p.notStarted / p.total) * 100, color: COLOR[1] },
  ].filter((s) => s.width > 0);

  return (
    <div
      className="flex h-2 overflow-hidden rounded-pill bg-slate-200"
      role="img"
      aria-label={t("progress.legend", {
        done: p.done,
        doing: p.inProgress,
        open: p.notStarted,
        total: p.total,
      })}
    >
      {parts.map((s) => (
        <div key={s.key} style={{ width: `${s.width}%`, backgroundColor: s.color }} />
      ))}
    </div>
  );
}

/** 進捗率の数字。目を向けるべき状態なら色を変える */
export function ProgressPercent({ progress }: { progress: ProjectProgress }) {
  const tone = progressTone(progress);
  const color =
    tone === "done"
      ? "text-[#a1af2f]"
      : tone === "danger"
        ? "text-red-700"
        : tone === "empty"
          ? "text-slate-400"
          : "text-ink";
  return (
    <span className={`tabular-nums font-semibold ${color}`}>
      {progress.total === 0 ? "—" : `${progress.percent}%`}
    </span>
  );
}

/** バーの下に添える内訳。「％だけでは判断できない」を埋める */
export function ProgressBreakdown({
  progress,
  locale = "ja",
}: {
  progress: ProjectProgress;
  locale?: Locale;
}) {
  const p = progress;
  const t = translator(locale);
  if (p.total === 0) {
    return <span className="text-sm text-slate-400">{t("progress.noIssues")}</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
      <span className="tabular-nums">
        {t("progress.doneOf", { done: p.done, total: p.total })}
      </span>
      {p.inProgress > 0 && <span>{t("progress.inProgress", { count: p.inProgress })}</span>}
      {p.notStarted > 0 && <span>{t("progress.notStarted", { count: p.notStarted })}</span>}
      {p.overdue > 0 && (
        <span className="font-medium text-red-700">
          {t("progress.overdue", { count: p.overdue })}
        </span>
      )}
      {/* 件数と時間がずれているとき（例: 件数80%・時間30%）は、
          残っているのが重いタスクだという合図になる */}
      {p.hoursPercent !== null && (
        <span className="text-slate-500">
          {t("progress.byHours", { percent: p.hoursPercent })}
        </span>
      )}
    </span>
  );
}

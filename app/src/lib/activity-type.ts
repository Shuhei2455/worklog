import type { ActivityType } from "@prisma/client";

/**
 * 内部の活動種別と、本家APIの整数値の対応。
 *
 * 本家は type も activityTypeId も整数で返す
 * (docs/00-spec-verified.md 9.3)。webhook の購読設定もこの整数で指定する。
 *
 * 内部は文字列で持っている。読んで分かる方が実装を間違えにくいため。
 * API と webhook で外に出すときだけここで写像する。
 */

/** 内部の種別 → 本家の整数 */
export const ACTIVITY_TYPE_ID: Record<ActivityType, number> = {
  issue_created: 1,
  issue_updated: 2,
  comment: 3,
  issue_deleted: 4,
  wiki_created: 5,
  wiki_updated: 6,
  wiki_deleted: 7,
  file_added: 8,
  file_updated: 9,
  git_push: 12,
  pull_request_created: 18,
  pull_request_updated: 19,
  project_user_added: 15,
  project_user_removed: 16,
};

/** 本家の整数 → 内部の種別 */
export const ACTIVITY_TYPE_BY_ID = new Map<number, ActivityType>(
  Object.entries(ACTIVITY_TYPE_ID).map(([k, v]) => [v, k as ActivityType]),
);

/** 画面に出す日本語 */
export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  issue_created: "タスクの追加",
  issue_updated: "タスクの更新",
  comment: "タスクへのコメント",
  issue_deleted: "タスクの削除",
  wiki_created: "Wikiの追加",
  wiki_updated: "Wikiの更新",
  wiki_deleted: "Wikiの削除",
  file_added: "ファイルの追加",
  file_updated: "ファイルの更新",
  git_push: "Gitのプッシュ",
  pull_request_created: "プルリクエストの追加",
  pull_request_updated: "プルリクエストの更新",
  project_user_added: "参加ユーザーの追加",
  project_user_removed: "参加ユーザーの削除",
};

/**
 * 画面に出す英語。
 *
 * 状態や優先度と同じ扱い（i18n.ts の `masterName()` を参照）。
 * 辞書ではなくマスタ側に英語名を持たせるのは、
 * 種別を足したときに**両方書かないと型が通らない**ようにするため。
 */
export const ACTIVITY_TYPE_LABEL_EN: Record<ActivityType, string> = {
  issue_created: "Issue created",
  issue_updated: "Issue updated",
  comment: "Comment added",
  issue_deleted: "Issue deleted",
  wiki_created: "Wiki page created",
  wiki_updated: "Wiki page updated",
  wiki_deleted: "Wiki page deleted",
  file_added: "File added",
  file_updated: "File updated",
  git_push: "Git push",
  pull_request_created: "Pull request created",
  pull_request_updated: "Pull request updated",
  project_user_added: "Member added",
  project_user_removed: "Member removed",
};

export function activityTypeLabel(locale: "ja" | "en", type: ActivityType): string {
  return locale === "en" ? ACTIVITY_TYPE_LABEL_EN[type] : ACTIVITY_TYPE_LABEL[type];
}

/**
 * 内部の通知理由 → 本家の reason（整数）。
 *
 * **意味が一致しない。** 本アプリの reason は「なぜ自分に通知が来たか」、
 * 本家の reason は「何が起きたか」に近い(9.3)。
 * 近いものに寄せ、当てはまらないものは 9:Other にする。
 */
export function toBacklogReason(
  reason: "notified" | "assigned" | "mentioned" | "watching",
  activityType: ActivityType,
): number {
  if (reason === "assigned") return 1; // Assigned to Issue
  if (activityType === "comment") return 2; // Issue Commented
  if (activityType === "issue_created") return 3; // Issue Created
  if (activityType === "issue_updated") return 4; // Issue Updated
  return 9; // Other
}

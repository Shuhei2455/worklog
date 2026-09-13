/**
 * 表示言語の切り替え。
 *
 * `users.lang` に持つ（M0 から列はあった。本家の API も `lang` を返す）。
 * 既定は `ja`。画面の文字列はここの辞書から引く。
 *
 * **ライブラリは入れない。** 必要なのは「辞書を引く」「値を差し込む」の2つだけで、
 * サーバーコンポーネントが主体なので実行時の言語切り替えも要らない
 * （ページを描くときに確定する）。
 *
 * 用語は本家の英語版に合わせる。状態・優先度・完了理由の英語名は
 * 公式APIドキュメントに載っており、`constants.ts` が既に `name` として
 * 持っている（docs/00-spec-verified.md 1章）。
 */

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function toLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/**
 * 辞書。
 *
 * キーは `画面.要素` の形にする。日本語をそのままキーにすると、
 * 同じ語が別の意味で使われたとき（「登録」= 作成 / 登録者）に分けられない。
 */
const MESSAGES = {
  ja: {
    // 共通
    "app.name": "Kadai",
    "app.tagline": "プロジェクト管理",
    "common.add": "追加",
    "common.create": "作成",
    "common.save": "保存",
    "common.delete": "削除",
    "common.remove": "外す",
    "common.edit": "編集",
    "common.cancel": "キャンセル",
    "common.apply": "適用",
    "common.clear": "クリア",
    "common.search": "検索",
    "common.all": "すべて",
    "common.none": "なし",
    "common.unset": "未設定",
    "common.unassigned": "未割り当て",
    "common.loading": "読み込み中",
    "common.back": "戻る",
    "common.next": "次へ",
    "common.prev": "前へ",
    "common.logout": "ログアウト",
    "common.language": "表示言語",

    // グローバルナビ
    "nav.dashboard": "ダッシュボード",
    "nav.projects": "プロジェクト",
    "nav.search": "検索",
    "nav.notifications": "通知",
    "nav.users": "ユーザー",
    "nav.teams": "チーム",
    "nav.audit": "監査ログ",
    "nav.password": "パスワード",
    "nav.apiKey": "APIキー",
    "nav.git": "Git",

    // プロジェクトのサイドバー
    "project.home": "ホーム",
    "project.addIssue": "課題の追加",
    "project.issues": "課題",
    "project.board": "ボード",
    "project.gantt": "ガントチャート",
    "project.burndown": "バーンダウン",
    "project.wiki": "Wiki",
    "project.files": "ファイル",
    "project.settings": "プロジェクト設定",

    // 課題の属性
    "issue.key": "キー",
    "issue.summary": "件名",
    "issue.description": "詳細",
    "issue.status": "状態",
    "issue.issueType": "種別",
    "issue.priority": "優先度",
    "issue.assignee": "担当者",
    "issue.resolution": "完了理由",
    "issue.startDate": "開始日",
    "issue.dueDate": "期限日",
    "issue.estimatedHours": "予定時間",
    "issue.actualHours": "実績時間",
    "issue.parent": "親課題",
    "issue.category": "カテゴリー",
    "issue.milestone": "マイルストーン",
    "issue.version": "発生バージョン",
    "issue.createdUser": "登録者",
    "issue.created": "登録日",
    "issue.updated": "更新日",
    "issue.attachments": "添付ファイル",
    "issue.sharedFiles": "共有ファイル",
    "issue.comments": "コメントと変更履歴",
    "issue.customFields": "カスタム属性",
    "issue.watch": "ウォッチ",
    "issue.watching": "ウォッチ中",
  },
  en: {
    "app.name": "Kadai",
    "app.tagline": "Project management",
    "common.add": "Add",
    "common.create": "Create",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.remove": "Remove",
    "common.edit": "Edit",
    "common.cancel": "Cancel",
    "common.apply": "Apply",
    "common.clear": "Clear",
    "common.search": "Search",
    "common.all": "All",
    "common.none": "None",
    "common.unset": "Not set",
    "common.unassigned": "Unassigned",
    "common.loading": "Loading",
    "common.back": "Back",
    "common.next": "Next",
    "common.prev": "Previous",
    "common.logout": "Log out",
    "common.language": "Language",

    "nav.dashboard": "Dashboard",
    "nav.projects": "Projects",
    "nav.search": "Search",
    "nav.notifications": "Notifications",
    "nav.users": "Users",
    "nav.teams": "Teams",
    "nav.audit": "Audit log",
    "nav.password": "Password",
    "nav.apiKey": "API key",
    "nav.git": "Git",

    "project.home": "Home",
    "project.addIssue": "Add issue",
    "project.issues": "Issues",
    "project.board": "Board",
    "project.gantt": "Gantt chart",
    "project.burndown": "Burndown chart",
    "project.wiki": "Wiki",
    "project.files": "Files",
    "project.settings": "Project settings",

    "issue.key": "Key",
    "issue.summary": "Subject",
    "issue.description": "Description",
    "issue.status": "Status",
    "issue.issueType": "Issue type",
    "issue.priority": "Priority",
    "issue.assignee": "Assignee",
    "issue.resolution": "Resolution",
    "issue.startDate": "Start date",
    "issue.dueDate": "Due date",
    "issue.estimatedHours": "Estimated hours",
    "issue.actualHours": "Actual hours",
    "issue.parent": "Parent issue",
    "issue.category": "Category",
    "issue.milestone": "Milestone",
    "issue.version": "Version",
    "issue.createdUser": "Created by",
    "issue.created": "Created",
    "issue.updated": "Updated",
    "issue.attachments": "Attachments",
    "issue.sharedFiles": "Shared files",
    "issue.comments": "Comments and history",
    "issue.customFields": "Custom fields",
    "issue.watch": "Watch",
    "issue.watching": "Watching",
  },
} as const;

/** 日本語の辞書をキーの正としてすべて揃える。英語に抜けがあれば型で分かる */
export type MessageKey = keyof (typeof MESSAGES)["ja"];

/** 英語の辞書が日本語と同じキーを持つことを型で強制する */
const _completeness: Record<MessageKey, string> = MESSAGES.en;
void _completeness;

/**
 * 訳を引く。
 *
 * **無い訳は日本語に落とす。** 英語が未整備でも画面が壊れないようにする
 * （空文字やキー文字列が出るより、日本語が出る方が使える）。
 */
export function translator(locale: Locale) {
  return function t(key: MessageKey, vars?: Record<string, string | number>): string {
    const dict = MESSAGES[locale] as Record<string, string>;
    let text = dict[key] ?? (MESSAGES.ja as Record<string, string>)[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
}

export type T = ReturnType<typeof translator>;

/**
 * マスタの名前を言語に応じて出す。
 *
 * 状態・優先度・完了理由は**本家が英語名を持っている**ので、
 * `constants.ts` の `name`（英語）と `label`（日本語）を切り替える。
 * ユーザーが独自に足した状態や課題種別には英語名が無いので、そのまま出す。
 */
export function masterName(
  locale: Locale,
  item: { name?: string | null; label?: string | null },
): string {
  if (locale === "en") return item.name ?? item.label ?? "";
  return item.label ?? item.name ?? "";
}

/** 日付の表示。英語では月名を使う本家に合わせる */
export function formatDate(locale: Locale, d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString(locale === "en" ? "en-US" : "ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: locale === "en" ? "short" : "numeric",
    day: "numeric",
  });
}

/** 日時の表示 */
export function formatDateTime(locale: Locale, d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleString(locale === "en" ? "en-US" : "ja-JP", {
    timeZone: "Asia/Tokyo",
    hour12: locale === "en",
  });
}

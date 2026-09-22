/**
 * 権限チェック。**APIルートの入口で必ずこれを通す。**
 *
 * 根拠は docs/00-spec-verified.md 7章と7.1の権限マトリクス
 * （2026-09-12 に一次情報で確認した表をそのまま写している）。
 *
 * 本家は「ユーザー種別 × 追加権限 × 制限」の3軸で、単純なロール列挙ではない。
 * 単一のロールにまとめると必ず破綻するので、ここでも3軸のまま扱う。
 *
 * 一覧クエリでは、この関数で1件ずつ判定してはいけない。
 * 取得後にフィルタすると件数とページングが壊れる。
 * 一覧には visibleProjectIds() で得た条件を where に注入する。
 */

/** ユーザー種別。DBの UserType と同じ */
export type UserType = "admin" | "member" | "guest";

/** 制限。DBの Restriction と同じ */
export type Restriction = "none" | "issue_create_only" | "issue_view_only";

/** 権限判定に必要なユーザー情報だけを持つ型。Prismaのモデルに依存させない */
export type ActorUser = {
  id: number;
  userType: UserType;
  restriction: Restriction;
  disabledAt?: Date | null;
};

/** 判定対象。プロジェクトに属さない操作では projectId を省く */
export type Resource = {
  projectId?: number;
  /** 対象がプロジェクトに属する場合、actor がそのプロジェクトの参加者か */
  isMember?: boolean;
  /** 対象プロジェクトでプロジェクト管理者フラグが立っているか */
  isProjectAdmin?: boolean;
};

export type Action =
  // スペース全体
  | "space.edit"
  | "project.create"
  | "project.delete"
  | "projectAdmin.assign"
  // プロジェクト
  | "project.edit"
  | "issueType.manage"
  | "category.manage"
  | "version.manage"
  // 課題
  | "issue.view"
  | "issue.create"
  | "issue.edit"
  | "issue.delete"
  | "comment.manage"
  | "issueAttachment.add"
  | "issueAttachment.delete"
  // Wiki
  | "wiki.view"
  | "wiki.edit"
  // 共有ファイル
  | "sharedFile.access"
  // Git
  | "git.access"
  // 個人設定
  | "personalSettings.edit";

/**
 * 制限ごとに「できること」を定義する。
 *
 * 一般ユーザーとゲストは、同じ制限なら課題まわりの権限が同一
 * （7.1のマトリクスで一般とゲストの列が一致している）。
 * 違うのはプロジェクト管理者になれるかと、参照できるユーザーの範囲だけ。
 * そのため種別ではなく制限で引く表にしてある。
 */
const ALLOWED_BY_RESTRICTION: Record<Restriction, ReadonlySet<Action>> = {
  none: new Set<Action>([
    "issueType.manage",
    "category.manage",
    "version.manage",
    "issue.view",
    "issue.create",
    "issue.edit",
    "comment.manage",
    "issueAttachment.add",
    "issueAttachment.delete",
    "wiki.view",
    "wiki.edit",
    "sharedFile.access",
    "git.access",
    "personalSettings.edit",
  ]),
  issue_create_only: new Set<Action>([
    "issue.view",
    "issue.create",
    // 課題を「追加」できるが「編集」はできない。自分が作った課題も編集できない
    "comment.manage",
    "issueAttachment.add",
    "wiki.view",
    "personalSettings.edit",
  ]),
  issue_view_only: new Set<Action>([
    "issue.view",
    "wiki.view",
    // コメントも付けられない（マトリクスで「コメント追加/編集/削除」が ×）
    "personalSettings.edit",
  ]),
};

/** プロジェクト管理者に許される操作。プロジェクトに関しては管理者と同等 */
const PROJECT_ADMIN_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "project.edit",
  "issueType.manage",
  "category.manage",
  "version.manage",
  "issue.view",
  "issue.create",
  "issue.edit",
  // 課題の削除は管理者とプロジェクト管理者だけ。制限なしの一般ユーザーでもできない
  "issue.delete",
  "comment.manage",
  "issueAttachment.add",
  "issueAttachment.delete",
  "wiki.view",
  "wiki.edit",
  "sharedFile.access",
  "git.access",
  "personalSettings.edit",
  // ※1 付きの △。7章本文の「一般ユーザー(制限なし)のみが設定可能」に従う
  "projectAdmin.assign",
]);

/** プロジェクトに属さない＝スペース全体の操作 */
const SPACE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "space.edit",
  "project.create",
  "project.delete",
  "personalSettings.edit",
]);

/**
 * actor が resource に対して action を行えるか。
 *
 * **本家と意図的に相違している**（決定 D31、2026-09-22 にユーザーが指示）:
 *
 * - 管理者は参加していないプロジェクトも編集・削除できる
 *   （本家は管理者でも未参加プロジェクトに触れない）
 * - 一般ユーザー（制限なし）はプロジェクトを作成でき、参加している
 *   プロジェクトなら課題もプロジェクト自体も削除できる
 *   （本家では課題の削除は管理者とプロジェクト管理者だけ）
 * - 一般・ゲストにとって、参加していないプロジェクトは**名前が見えるだけ**。
 *   課題・Wiki・共有ファイルは開けない
 */
export function can(
  actor: ActorUser,
  action: Action,
  resource: Resource = {},
): boolean {
  // 無効化されたユーザーは何もできない
  if (actor.disabledAt) return false;

  // --- スペース全体の操作 ---------------------------------------------
  if (SPACE_ACTIONS.has(action) && resource.projectId === undefined) {
    if (action === "personalSettings.edit") return true;
    // 決定 D31: プロジェクトの作成は一般ユーザー（制限なし）にも許す。
    // 削除は対象プロジェクトが決まって初めて判定できるので、ここでは扱わない
    if (action === "project.create") {
      return actor.userType !== "guest" && actor.restriction === "none";
    }
    return actor.userType === "admin";
  }

  // --- ここから先はプロジェクトに属する操作 ---------------------------
  if (resource.projectId === undefined) {
    // プロジェクトを特定できない状態でプロジェクト権限は判定できない
    return false;
  }

  // 決定 D31: スペース管理者は参加していないプロジェクトも操作できる。
  // **本家と意図的に相違**（本家は管理者でも未参加プロジェクトに触れない）。
  // isMember の判定より前に置く
  if (actor.userType === "admin") return true;

  // 一般・ゲストは、参加していないプロジェクトの中身には触れない。
  // 一覧に名前が出るだけで、課題もWikiも開けない
  if (!resource.isMember) return false;

  // プロジェクト管理者は、そのプロジェクトに関して管理者と同等。
  // ただしゲストはプロジェクト管理者になれない（本家の明記された制約）
  if (resource.isProjectAdmin && actor.userType !== "guest") {
    if (PROJECT_ADMIN_ACTIONS.has(action)) return true;
  }

  // 決定 D31: 参加しているプロジェクトなら、一般ユーザー（制限なし）も
  // 課題とプロジェクトを削除できる。**本家と意図的に相違**。
  //
  // ALLOWED_BY_RESTRICTION は一般とゲストで共用しているので、そちらに足すと
  // **ゲストにも削除権限が漏れる**。ゲストは対象外なのでここで分ける
  if (actor.userType !== "guest" && actor.restriction === "none") {
    if (action === "issue.delete" || action === "project.delete") return true;
  }

  return ALLOWED_BY_RESTRICTION[actor.restriction].has(action);
}

/**
 * 本家APIの roleType へ写像する。
 *
 * roleType は「種別 × 制限」を1つの数値に潰したもので、
 * **ゲストを区別しない**（docs/00-spec-verified.md 7章）。
 * API v2 互換のために必要。内部モデルは3軸のまま保つこと。
 */
export function toRoleType(actor: Pick<ActorUser, "userType" | "restriction">): number {
  if (actor.userType === "admin") return 1;
  switch (actor.restriction) {
    case "none":
      return 2;
    case "issue_create_only":
      return 3;
    case "issue_view_only":
      return 4;
  }
}

import { PRIORITIES, RESOLUTIONS } from "@/lib/constants";
import { toRoleType } from "@/lib/permissions";

/**
 * 本家と同じ形のレスポンスに整える。
 *
 * **キー名は本家に合わせる。** `category` と `milestone` が単数形キーで
 * 配列を返すといった癖もそのまま踏襲する(CLAUDE.md)。
 * 既存の Backlog 向けスクリプトが、ホスト名を差し替えるだけで動くようにするため。
 */

type UserLike = {
  id: number;
  userId: string;
  name: string;
  email: string;
  userType: "admin" | "member" | "guest";
  restriction: "none" | "issue_create_only" | "issue_view_only";
  lang?: string | null;
};

export function serializeUser(u: UserLike) {
  return {
    id: u.id,
    userId: u.userId,
    name: u.name,
    // roleType は「種別 × 制限」を潰した値。ゲストは区別されない
    roleType: toRoleType(u),
    lang: u.lang ?? "ja",
    mailAddress: u.email,
  };
}

export function serializeProject(p: {
  id: number;
  key: string;
  name: string;
  chartEnabled: boolean;
  subtaskingEnabled: boolean;
  projectLeaderCanEditProjectLeader: boolean;
  textFormattingRule: string;
  archived: boolean;
}) {
  return {
    id: p.id,
    projectKey: p.key,
    name: p.name,
    chartEnabled: p.chartEnabled,
    subtaskingEnabled: p.subtaskingEnabled,
    projectLeaderCanEditProjectLeader: p.projectLeaderCanEditProjectLeader,
    textFormattingRule: p.textFormattingRule,
    archived: p.archived,
  };
}

export function serializeStatus(s: {
  id: number;
  projectId: number;
  name: string;
  color: string;
  displayOrder: number;
}) {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    color: s.color,
    displayOrder: s.displayOrder,
  };
}

export function serializeIssueType(t: {
  id: number;
  projectId: number;
  name: string;
  color: string;
  displayOrder: number;
}) {
  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    color: t.color,
    displayOrder: t.displayOrder,
  };
}

export const serializePriorities = () =>
  PRIORITIES.map((p) => ({ id: p.id, name: p.name }));

export const serializeResolutions = () =>
  RESOLUTIONS.map((r) => ({ id: r.id, name: r.name }));

/** yyyy-MM-dd。本家の日付フィールドはこの形 */
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** ISO8601。created / updated はこの形 */
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

type IssueLike = {
  id: number;
  projectId: number;
  keyId: number;
  summary: string;
  description: string | null;
  statusId: number;
  priorityId: number;
  resolutionId: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: unknown;
  actualHours: unknown;
  parentIssueId: number | null;
  createdAt: Date;
  updatedAt: Date;
  project: { key: string };
  issueType: Parameters<typeof serializeIssueType>[0];
  status: Parameters<typeof serializeStatus>[0];
  assignee: UserLike | null;
  creator: UserLike;
  updater: UserLike;
  categories?: Array<{ categoryId: number }>;
  milestones?: Array<{ versionId: number }>;
  versions?: Array<{ versionId: number }>;
};

export function serializeIssue(
  i: IssueLike,
  names: {
    categories: Map<number, string>;
    versions: Map<number, { name: string; description: string | null }>;
  },
) {
  const cat = (id: number) => ({
    id,
    projectId: i.projectId,
    name: names.categories.get(id) ?? "",
  });
  const ver = (id: number) => ({
    id,
    projectId: i.projectId,
    name: names.versions.get(id)?.name ?? "",
    description: names.versions.get(id)?.description ?? "",
  });

  return {
    id: i.id,
    projectId: i.projectId,
    // 表示用のキーと、プロジェクト内連番は別フィールド
    issueKey: `${i.project.key}-${i.keyId}`,
    keyId: i.keyId,
    issueType: serializeIssueType(i.issueType),
    summary: i.summary,
    description: i.description ?? "",
    resolution:
      i.resolutionId != null
        ? {
            id: i.resolutionId,
            name: RESOLUTIONS.find((r) => r.id === i.resolutionId)?.name ?? "",
          }
        : null,
    priority: {
      id: i.priorityId,
      name: PRIORITIES.find((p) => p.id === i.priorityId)?.name ?? "",
    },
    status: serializeStatus(i.status),
    // 担当者は単一。配列にしない
    assignee: i.assignee ? serializeUser(i.assignee) : null,
    // 単数形キーで配列を返すのは本家の癖。そのまま踏襲する
    category: (i.categories ?? []).map((c) => cat(c.categoryId)),
    versions: (i.versions ?? []).map((v) => ver(v.versionId)),
    milestone: (i.milestones ?? []).map((m) => ver(m.versionId)),
    startDate: day(i.startDate),
    dueDate: day(i.dueDate),
    estimatedHours: i.estimatedHours == null ? null : Number(i.estimatedHours),
    actualHours: i.actualHours == null ? null : Number(i.actualHours),
    parentIssueId: i.parentIssueId,
    createdUser: serializeUser(i.creator),
    created: stamp(i.createdAt),
    updatedUser: serializeUser(i.updater),
    updated: stamp(i.updatedAt),
    customFields: [],
    attachments: [],
    sharedFiles: [],
    stars: [],
  };
}

export function serializeComment(a: {
  id: number;
  content: string | null;
  changes: unknown;
  createdAt: Date;
  updatedAt: Date;
  user: UserLike;
}) {
  return {
    id: a.id,
    content: a.content ?? "",
    changeLog: Array.isArray(a.changes) ? a.changes : [],
    createdUser: serializeUser(a.user),
    created: stamp(a.createdAt),
    updated: stamp(a.updatedAt),
    stars: [],
    notifications: [],
  };
}

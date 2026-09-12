import { prisma } from "@/lib/db";
import { describeChanges, type ChangeLookups } from "@/lib/describe-changes";

/**
 * 課題詳細に出す情報をまとめて引く。
 *
 * コメントと変更履歴は `activities` に統合してあるので、
 * 結合して並べ直す必要がない。そのまま時系列で出せる。
 */

/** "PROJ-12" を projectKey と keyId に分ける */
export function parseIssueKey(raw: string): { projectKey: string; keyId: number } | null {
  const m = /^([A-Z][A-Z0-9_]{0,9})-(\d+)$/.exec(raw.toUpperCase());
  if (!m) return null;
  return { projectKey: m[1], keyId: Number(m[2]) };
}

/** describeChanges に渡す辞書をプロジェクト単位で組む */
export async function changeLookupsFor(projectId: number): Promise<ChangeLookups> {
  const [statuses, issueTypes, categories, versions, members, issues, customFields] =
    await Promise.all([
      prisma.status.findMany({ where: { projectId } }),
      prisma.issueType.findMany({ where: { projectId } }),
      prisma.category.findMany({ where: { projectId } }),
      prisma.version.findMany({ where: { projectId } }),
      prisma.projectMember.findMany({
        where: { projectId },
        include: { user: true },
      }),
      prisma.issue.findMany({
        where: { projectId },
        select: { id: true, keyId: true, project: { select: { key: true } } },
      }),
      prisma.customField.findMany({
        where: { projectId },
        include: { items: { orderBy: { displayOrder: "asc" } } },
      }),
    ]);

  return {
    statuses: new Map(statuses.map((s) => [s.id, s.name])),
    issueTypes: new Map(issueTypes.map((t) => [t.id, t.name])),
    categories: new Map(categories.map((c) => [c.id, c.name])),
    versions: new Map(versions.map((v) => [v.id, v.name])),
    users: new Map(members.map((m) => [m.userId, m.user.name])),
    issues: new Map(issues.map((i) => [i.id, `${i.project.key}-${i.keyId}`])),
    customFields: new Map(
      customFields.map((f) => [
        f.id,
        {
          id: f.id,
          name: f.name,
          typeId: f.typeId,
          required: f.required,
          settings: (f.settings ?? {}) as Record<string, never>,
          items: f.items.map((i) => ({ id: i.id, name: i.name })),
        },
      ]),
    ),
  };
}

/**
 * 「最近見た課題」に記録する。
 * 閲覧のたびに時刻を更新するだけなので upsert で足りる。
 */
export async function recordRecentlyViewed(userId: number, issueId: number) {
  await prisma.recentlyViewedIssue.upsert({
    where: { userId_issueId: { userId, issueId } },
    update: { viewedAt: new Date() },
    create: { userId, issueId },
  });
}

/** 課題1件と、その活動履歴 */
export async function loadIssueDetail(
  projectKey: string,
  keyId: number,
  viewerId?: number,
) {
  const project = await prisma.project.findUnique({ where: { key: projectKey } });
  if (!project) return null;

  const issue = await prisma.issue.findUnique({
    where: { projectId_keyId: { projectId: project.id, keyId } },
    include: {
      issueType: true,
      status: true,
      assignee: true,
      creator: true,
      updater: true,
      parent: { select: { id: true, keyId: true } },
      children: {
        select: { id: true, keyId: true, summary: true, statusId: true },
        orderBy: { keyId: "asc" },
      },
      categories: true,
      milestones: true,
      versions: true,
      relationsFrom: {
        include: {
          relatedIssue: { select: { id: true, keyId: true, summary: true } },
        },
      },
      participants: { include: { user: true } },
    },
  });
  if (!issue) return null;

  const activities = await prisma.activity.findMany({
    where: { issueId: issue.id },
    include: {
      user: true,
      notifiedUsers: { include: { user: true } },
      stars: { select: { userId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const lookups = await changeLookupsFor(project.id);

  return {
    project,
    issue,
    lookups,
    // コメントと変更履歴が混ざった時系列。1テーブルなので並べ直しが要らない
    timeline: activities.map((a) => ({
      id: a.id,
      type: a.type,
      user: a.user,
      content: a.content,
      createdAt: a.createdAt,
      described: describeChanges(a.changes, lookups),
      notifiedUsers: a.notifiedUsers.map((n) => n.user),
      starCount: a.stars.length,
      starredByMe: viewerId ? a.stars.some((s) => s.userId === viewerId) : false,
    })),
  };
}

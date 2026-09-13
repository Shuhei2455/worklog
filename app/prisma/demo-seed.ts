import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { DEFAULT_STATUSES, DEFAULT_ISSUE_TYPES } from "../src/lib/constants";

/**
 * 動作確認用のデータを作る。
 *
 *   docker compose exec app pnpm demo:seed
 *
 * **既存のデータを全部消してから入れ直す。** 動作確認のために
 * 「どの機能にも中身がある」状態を作るのが目的なので、継ぎ足しにすると
 * 前の検証で作った半端なデータが混ざる。
 *
 * 消すのは backlog データベースだけ。Gitea 側（リポジトリの実体）は触らない
 * ——消すとコードが失われるうえ、作り直しに時間がかかる。
 *
 * 全機能に中身が入るようにしてある:
 *   ユーザー3人（管理者 / 一般 / 閲覧のみ）・チーム・プロジェクト2つ・
 *   カスタム属性4種・課題（親子・関連・期限切れ・完了済み）・コメント・
 *   スター・ウォッチ・通知・Wiki（履歴つき）・共有ファイル・
 *   マイルストーン（バーンダウンが描ける期間つき）・監査ログ
 */

const prisma = new PrismaClient();

/** 今日を基準に日付を作る。実行日に関係なく「期限切れ」「今週」が成立する */
const today = new Date();
const day = (offset: number): Date => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
};
const at = (offsetDays: number, hour = 10): Date => {
  const d = day(offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function wipe() {
  // 依存の深い順に消す。truncate cascade はマイグレーション履歴も飛ぶので使わない
  const tables = [
    "notifications",
    "activity_notified_users",
    "activities",
    "stars",
    "watchings",
    "issue_participants",
    "issue_custom_field_values",
    "issue_categories",
    "issue_milestones",
    "issue_versions",
    "issue_attachments",
    "issue_shared_files",
    "comment_attachments",
    "issue_relations",
    "commit_issue_links",
    "pull_requests",
    "wiki_tags",
    "wiki_attachments",
    "wiki_shared_files",
    "wiki_revisions",
    "wiki_pages",
    "shared_files",
    "attachments",
    "issues",
    "repositories",
    "custom_field_items",
    "custom_fields",
    "webhooks",
    "saved_filters",
    "recently_viewed_issues",
    "recently_viewed_projects",
    "recently_viewed_wikis",
    "statuses",
    "issue_types",
    "categories",
    "versions",
    "project_teams",
    "project_members",
    "projects",
    "team_members",
    "teams",
    "audit_logs",
    "api_tokens",
    "users",
  ];
  for (const t of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }
  // 連番を戻す。課題キーが AA-1 から始まるようにする
  for (const t of ["users", "projects", "issues", "activities", "teams", "audit_logs"]) {
    await prisma.$executeRawUnsafe(
      `ALTER SEQUENCE IF EXISTS "${t}_id_seq" RESTART WITH 1`,
    );
  }
  console.log("  既存データを削除しました");
}

async function main() {
  console.log("== 動作確認用データの投入 ==");
  await wipe();

  // ---- ユーザー（3種類の権限を並べる） ----
  const pw = (p: string) => hashPassword(p);
  const admin = await prisma.user.create({
    data: {
      userId: "admin", name: "管理者", email: "admin@example.local",
      userType: "admin", restriction: "none", passwordHash: pw("kadai-demo-2026"),
      lang: "ja",
    },
  });
  const member = await prisma.user.create({
    data: {
      userId: "yamada", name: "山田", email: "yamada@example.local",
      userType: "member", restriction: "none", passwordHash: pw("kadai-demo-2026"),
      lang: "ja",
    },
  });
  const viewer = await prisma.user.create({
    data: {
      userId: "suzuki", name: "鈴木", email: "suzuki@example.local",
      userType: "member", restriction: "issue_view_only",
      passwordHash: pw("kadai-demo-2026"), lang: "en",
    },
  });
  console.log("  ユーザー3人（admin / yamada / suzuki[閲覧のみ・英語]）");

  // ---- チーム ----
  const team = await prisma.team.create({
    data: {
      name: "開発チーム", displayOrder: 1,
      createdById: admin.id, updatedById: admin.id,
      members: { create: [{ userId: admin.id }, { userId: member.id }] },
    },
  });

  // ---- プロジェクト ----
  async function makeProject(key: string, name: string, opts: { chart?: boolean } = {}) {
    const p = await prisma.project.create({
      data: {
        key, name,
        chartEnabled: opts.chart ?? true,
        members: {
          create: [
            { userId: admin.id, isProjectAdmin: true },
            { userId: member.id },
            { userId: viewer.id },
          ],
        },
        statuses: { create: DEFAULT_STATUSES.map((s) => ({ ...s })) },
        issueTypes: { create: DEFAULT_ISSUE_TYPES.map((t) => ({ ...t })) },
      },
    });
    return p;
  }

  const web = await makeProject("WEB", "社内ポータル刷新");
  const ops = await makeProject("OPS", "運用改善");
  await prisma.projectTeam.create({ data: { projectId: web.id, teamId: team.id } });

  // ---- カテゴリー・マイルストーン ----
  const cats = await Promise.all(
    ["フロントエンド", "バックエンド", "インフラ"].map((name, i) =>
      prisma.category.create({
        data: { projectId: web.id, id: i + 1, name, displayOrder: (i + 1) * 1000 },
      }),
    ),
  );
  // バーンダウンが描けるよう、今日をまたぐ期間にする
  const v1 = await prisma.version.create({
    data: {
      projectId: web.id, id: 1, name: "v1.0",
      startDate: day(-10), releaseDueDate: day(10), displayOrder: 1000,
    },
  });
  await prisma.version.create({
    data: {
      projectId: web.id, id: 2, name: "v1.1",
      startDate: day(11), releaseDueDate: day(40), displayOrder: 2000,
    },
  });

  // ---- カスタム属性（4種類の型を並べる） ----
  const cfText = await prisma.customField.create({
    data: {
      projectId: web.id, id: 1, typeId: "text", name: "顧客名",
      description: "問い合わせ元", required: false,
      applicableIssueTypes: [], settings: {}, displayOrder: 1,
    },
  });
  const cfNum = await prisma.customField.create({
    data: {
      projectId: web.id, id: 2, typeId: "number", name: "見積金額",
      required: false, applicableIssueTypes: [],
      settings: { unit: "円", min: 0 }, displayOrder: 2,
    },
  });
  const cfList = await prisma.customField.create({
    data: {
      projectId: web.id, id: 3, typeId: "single_list", name: "対応区分",
      required: false, applicableIssueTypes: [], settings: {}, displayOrder: 3,
      items: {
        create: [
          { name: "新規", displayOrder: 1 },
          { name: "改修", displayOrder: 2 },
          { name: "調査", displayOrder: 3 },
        ],
      },
    },
  });
  // 選択肢は別に作る。入れ子の create では projectId を書けない
  // （複合キーの親から引き継がれるため）が、こちらは id が要るので作り直す
  const cfItems = await prisma.customFieldItem.findMany({
    where: { projectId: web.id, customFieldId: cfList.id },
    orderBy: { displayOrder: "asc" },
  });
  await prisma.customField.create({
    data: {
      projectId: web.id, id: 4, typeId: "date", name: "顧客希望日",
      required: false, applicableIssueTypes: [],
      settings: { initialValueType: 1 }, displayOrder: 4,
    },
  });
  console.log("  カスタム属性4種（文字列・数値・リスト・日付）");

  // ---- 課題 ----
  type IssueSpec = {
    summary: string;
    typeId?: number;
    statusId?: number;
    priorityId?: number;
    assignee?: number | null;
    start?: number | null;
    due?: number | null;
    est?: number | null;
    act?: number | null;
    cat?: number[];
    ms?: number[];
    desc?: string;
    parentOf?: string;
    cf?: Prisma.InputJsonValue extends never ? never : Record<number, unknown>;
  };

  const specs: IssueSpec[] = [
    { summary: "ログイン画面のデザインを刷新する", statusId: 2, priorityId: 2,
      assignee: member.id, start: -8, due: 3, est: 16, act: 6, cat: [cats[0].id], ms: [v1.id],
      desc: "既存のログイン画面は古いので作り直す。\n\n- [ ] 配色を決める\n- [x] 画面構成の案出し",
      cf: { [cfText.id]: { kind: "text", value: "ヌーラボ商事" },
            [cfNum.id]: { kind: "number", value: 250000 },
            [cfList.id]: { kind: "list", itemIds: [cfItems[1].id] } } },
    { summary: "セッションが切れると500になる", typeId: 2, statusId: 1, priorityId: 2,
      assignee: admin.id, due: -3, est: 4, cat: [cats[1].id], ms: [v1.id],
      desc: "**期限切れの課題。** 一覧で赤く出るはず。" },
    { summary: "検索の応答が遅い", typeId: 2, statusId: 2, priorityId: 3,
      assignee: member.id, start: -5, due: 7, est: 8, act: 3, cat: [cats[1].id], ms: [v1.id] },
    { summary: "本番環境のバックアップを自動化する", typeId: 1, statusId: 3, priorityId: 3,
      assignee: admin.id, start: -9, due: -1, est: 12, act: 12, cat: [cats[2].id], ms: [v1.id] },
    { summary: "利用マニュアルを作る", typeId: 1, statusId: 4, priorityId: 4,
      assignee: member.id, start: -10, due: -5, est: 6, act: 5, ms: [v1.id] },
    { summary: "ダークモードに対応してほしい", typeId: 3, statusId: 1, priorityId: 4,
      assignee: null, ms: [v1.id], desc: "要望として登録。担当は未定。" },
    { summary: "画面の文言を英語にも対応させる", typeId: 3, statusId: 2, priorityId: 3,
      assignee: admin.id, start: -2, due: 9, est: 10, act: 2, ms: [v1.id] },
    { summary: "通知メールが二重に届くことがある", typeId: 2, statusId: 1, priorityId: 2,
      assignee: member.id, due: 1, est: 3, cat: [cats[1].id], ms: [v1.id] },
  ];

  const made: Array<{ id: number; keyId: number }> = [];
  for (const [i, s] of specs.entries()) {
    const keyId = i + 1;
    const issue = await prisma.issue.create({
      data: {
        projectId: web.id, keyId,
        summary: s.summary,
        description: s.desc ?? null,
        issueTypeId: s.typeId ?? 1,
        statusId: s.statusId ?? 1,
        priorityId: s.priorityId ?? 3,
        assigneeId: s.assignee ?? null,
        startDate: s.start != null ? day(s.start) : null,
        dueDate: s.due != null ? day(s.due) : null,
        estimatedHours: s.est ?? null,
        actualHours: s.act ?? null,
        completedAt: s.statusId === 4 ? at(-5, 17) : null,
        createdBy: admin.id, updatedBy: admin.id,
        createdAt: at(-(specs.length - i) - 2),
        categories: { create: (s.cat ?? []).map((id) => ({ projectId: web.id, categoryId: id })) },
        milestones: { create: (s.ms ?? []).map((id) => ({ projectId: web.id, versionId: id })) },
      },
    });
    made.push({ id: issue.id, keyId });

    if (s.cf) {
      for (const [fid, value] of Object.entries(s.cf)) {
        await prisma.issueCustomFieldValue.create({
          data: {
            issueId: issue.id, projectId: web.id,
            customFieldId: Number(fid), value: value as Prisma.InputJsonValue,
          },
        });
      }
    }

    // 参加者。登録者と担当者
    const parts = new Set<number>([admin.id]);
    if (s.assignee) parts.add(s.assignee);
    await prisma.issueParticipant.createMany({
      data: [...parts].map((userId) => ({ issueId: issue.id, userId })),
      skipDuplicates: true,
    });

    // 登録の活動
    await prisma.activity.create({
      data: {
        projectId: web.id, issueId: issue.id, userId: admin.id,
        type: "issue_created", createdAt: at(-(specs.length - i) - 2),
      },
    });
  }
  await prisma.project.update({ where: { id: web.id }, data: { lastIssueNo: specs.length } });
  console.log(`  課題${specs.length}件（期限切れ・完了済み・未割り当てを含む）`);

  // ---- 親子・関連 ----
  await prisma.issue.update({
    where: { id: made[2].id }, data: { parentIssueId: made[0].id },
  });
  await prisma.issueRelation.create({
    data: { issueId: made[1].id, relatedIssueId: made[7].id },
  });

  // ---- コメント・状態変更の履歴 ----
  const commented = made[0];
  await prisma.activity.create({
    data: {
      projectId: web.id, issueId: commented.id, userId: member.id,
      type: "comment", content: "配色の案を3つ作りました。<@U" + admin.id + "> 確認をお願いします。",
      createdAt: at(-4, 14),
    },
  });
  const statusChange = await prisma.activity.create({
    data: {
      projectId: web.id, issueId: commented.id, userId: admin.id,
      type: "issue_updated",
      changes: [{ field: "statusId", from: "1", to: "2" }] as Prisma.InputJsonValue,
      content: "着手します。",
      createdAt: at(-3, 9),
    },
  });

  // ---- 通知（未読を残して、通知欄に件数を出す） ----
  await prisma.notification.createMany({
    data: [
      { userId: member.id, activityId: statusChange.id, reason: "watching" },
      { userId: admin.id, activityId: statusChange.id, reason: "assigned", readAt: at(-2) },
    ],
  });

  // ---- スター・ウォッチ ----
  await prisma.star.create({ data: { userId: admin.id, issueId: commented.id } });
  await prisma.star.create({ data: { userId: member.id, issueId: made[1].id } });
  await prisma.watching.create({ data: { userId: member.id, issueId: commented.id } });

  // ---- Wiki（履歴つき） ----
  const wiki = await prisma.wikiPage.create({
    data: {
      projectId: web.id, name: "開発の進め方",
      content: "# 開発の進め方\n\n## ブランチ\n\n`WEB-123/短い説明` の形にする。\n\n## レビュー\n\n- 1人以上の承認が必要\n- CIが通ってからマージ",
      createdBy: admin.id, updatedBy: member.id, revision: 2,
      tags: { create: [{ tag: "手順書" }, { tag: "開発" }] },
    },
  });
  await prisma.wikiRevision.createMany({
    data: [
      { wikiPageId: wiki.id, content: "# 開発の進め方\n\n（書きかけ）",
        userId: admin.id, createdAt: at(-6) },
      { wikiPageId: wiki.id, content: wiki.content, userId: member.id, createdAt: at(-2) },
    ],
  });
  await prisma.wikiPage.create({
    data: {
      projectId: web.id, name: "用語集",
      content: "# 用語集\n\n| 用語 | 意味 |\n|---|---|\n| PJ | プロジェクト |\n| MS | マイルストーン |",
      createdBy: admin.id, updatedBy: admin.id, revision: 1,
      tags: { create: [{ tag: "参考" }] },
    },
  });
  console.log("  Wiki 2ページ（履歴・タグつき）");

  // ---- 監査ログ ----
  await prisma.auditLog.createMany({
    data: [
      { userId: admin.id, action: "project.create", targetType: "project",
        targetId: "WEB", detail: { name: web.name }, createdAt: at(-12) },
      { userId: admin.id, action: "user.create", targetType: "user",
        targetId: "yamada", detail: { name: "山田" }, createdAt: at(-11) },
      { userId: admin.id, action: "project.member.add", targetType: "project",
        targetId: "WEB", detail: { userId: "suzuki" }, createdAt: at(-11) },
    ],
  });

  // ---- OPS 側にも少し入れる（プロジェクトの切り替えを試せるように） ----
  for (const [i, summary] of ["月次レポートの自動生成", "監視アラートの棚卸し"].entries()) {
    await prisma.issue.create({
      data: {
        projectId: ops.id, keyId: i + 1, summary,
        issueTypeId: 1, statusId: i === 0 ? 1 : 2, priorityId: 3,
        assigneeId: admin.id, dueDate: day(14 + i * 7),
        createdBy: admin.id, updatedBy: admin.id,
      },
    });
  }
  await prisma.project.update({ where: { id: ops.id }, data: { lastIssueNo: 2 } });

  console.log("\n== できました ==");
  console.log("  ログイン: admin / yamada / suzuki   パスワードは全員 kadai-demo-2026");
  console.log("  suzuki は「閲覧のみ」かつ表示言語が英語（権限と英語版の確認用）");
  console.log("  プロジェクト: WEB（全機能）/ OPS（切り替えの確認用）");
}

main()
  .catch((e) => {
    console.error("失敗しました:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

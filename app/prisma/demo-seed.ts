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
 *   ユーザー10人（管理者・一般・ゲスト・閲覧のみ・登録のみ・英語表示）・
 *   チーム3つ・プロジェクト5つ・カスタム属性4種・
 *   課題（親子・関連・期限切れ・完了済み・未割り当て）・コメント・
 *   スター・ウォッチ・通知・Wiki（履歴つき）・共有ファイル・
 *   マイルストーン（バーンダウンが描ける期間つき）・
 *   プルリクエスト・活動履歴（全種類）・監査ログ
 *
 * **プロジェクトは進捗の出方が5通りになるようにしてある**
 * （ダッシュボードの進捗バーの確認用。progressTone の5値に対応）:
 *   WEB 期限切れあり=danger / OPS 未着手ばかり=warn /
 *   DES 全部完了=done / MKT 順調=normal / INF 課題なし=empty
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

const PASSWORD = "kadai-demo-2026";

async function main() {
  console.log("== 動作確認用データの投入 ==");
  await wipe();

  // ---- ユーザー10人 ----
  // 権限の3軸（ユーザー種別 × 制限 × プロジェクト管理者）と表示言語を一通り並べる。
  // 全員が同じ権限だと、権限まわりの画面が確認できない
  const pw = hashPassword(PASSWORD);
  const USERS = [
    { userId: "admin", name: "管理者", type: "admin", rest: "none", lang: "ja" },
    { userId: "yamada", name: "山田 太郎", type: "member", rest: "none", lang: "ja" },
    { userId: "suzuki", name: "鈴木 花子", type: "member", rest: "issue_view_only", lang: "en" },
    { userId: "sato", name: "佐藤 健", type: "member", rest: "none", lang: "ja" },
    { userId: "takahashi", name: "高橋 美咲", type: "member", rest: "none", lang: "ja" },
    { userId: "tanaka", name: "田中 誠", type: "member", rest: "none", lang: "ja" },
    { userId: "ito", name: "伊藤 由美", type: "member", rest: "issue_create_only", lang: "ja" },
    { userId: "watanabe", name: "渡辺 隆", type: "member", rest: "none", lang: "en" },
    { userId: "nakamura", name: "中村 彩", type: "member", rest: "none", lang: "ja" },
    { userId: "kobayashi", name: "小林 大輔", type: "guest", rest: "none", lang: "ja" },
  ] as const;

  const u: Record<string, { id: number; name: string }> = {};
  for (const s of USERS) {
    const created = await prisma.user.create({
      data: {
        userId: s.userId,
        name: s.name,
        email: `${s.userId}@example.local`,
        userType: s.type,
        restriction: s.rest,
        passwordHash: pw,
        lang: s.lang,
      },
    });
    u[s.userId] = { id: created.id, name: created.name };
  }
  console.log(`  ユーザー${USERS.length}人（管理者1 / 一般8 / ゲスト1）`);

  // ---- チーム ----
  const TEAMS = [
    { name: "開発チーム", members: ["yamada", "sato", "takahashi", "tanaka"] },
    { name: "デザインチーム", members: ["nakamura", "ito"] },
    { name: "インフラチーム", members: ["admin", "watanabe"] },
  ];
  const teams: Record<string, number> = {};
  for (const [i, t] of TEAMS.entries()) {
    const created = await prisma.team.create({
      data: {
        name: t.name,
        displayOrder: (i + 1) * 1000,
        createdById: u.admin.id,
        updatedById: u.admin.id,
        members: { create: t.members.map((m) => ({ userId: u[m].id })) },
      },
    });
    teams[t.name] = created.id;
  }
  console.log(`  チーム${TEAMS.length}つ`);

  // ---- プロジェクト ----
  async function makeProject(
    key: string,
    name: string,
    memberIds: string[],
    admins: string[] = ["admin"],
  ) {
    return prisma.project.create({
      data: {
        key,
        name,
        chartEnabled: true,
        members: {
          create: memberIds.map((m) => ({
            userId: u[m].id,
            isProjectAdmin: admins.includes(m),
          })),
        },
        statuses: { create: DEFAULT_STATUSES.map((s) => ({ ...s })) },
        issueTypes: { create: DEFAULT_ISSUE_TYPES.map((t) => ({ ...t })) },
      },
    });
  }

  const web = await makeProject(
    "WEB",
    "社内ポータル刷新",
    ["admin", "yamada", "suzuki", "sato", "takahashi", "tanaka", "nakamura"],
    ["admin", "yamada"],
  );
  const ops = await makeProject(
    "OPS",
    "運用改善",
    ["admin", "watanabe", "tanaka", "ito"],
    ["admin", "watanabe"],
  );
  const des = await makeProject(
    "DES",
    "デザインシステム構築",
    ["admin", "nakamura", "ito", "takahashi"],
    ["admin", "nakamura"],
  );
  const mkt = await makeProject(
    "MKT",
    "サイトリニューアル",
    ["admin", "yamada", "nakamura", "kobayashi", "sato"],
    ["admin"],
  );
  const inf = await makeProject("INF", "基盤移行", ["admin", "watanabe"], ["admin", "watanabe"]);

  await prisma.projectTeam.createMany({
    data: [
      { projectId: web.id, teamId: teams["開発チーム"] },
      { projectId: des.id, teamId: teams["デザインチーム"] },
      { projectId: ops.id, teamId: teams["インフラチーム"] },
    ],
  });
  console.log("  プロジェクト5つ（WEB / OPS / DES / MKT / INF）");

  // ---- カテゴリー・マイルストーン（WEB） ----
  const cats = await Promise.all(
    ["フロントエンド", "バックエンド", "インフラ", "デザイン"].map((name, i) =>
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
  const v11 = await prisma.version.create({
    data: {
      projectId: web.id, id: 2, name: "v1.1",
      startDate: day(11), releaseDueDate: day(40), displayOrder: 2000,
    },
  });
  // 終わったマイルストーン。アーカイブ済みの表示を確認する
  await prisma.version.create({
    data: {
      projectId: web.id, id: 3, name: "v0.9（完了）",
      startDate: day(-40), releaseDueDate: day(-11), displayOrder: 500, archived: true,
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
  // 選択肢は別に引き直す。入れ子の create では id が返らない
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
    assignee?: string | null;
    creator?: string;
    start?: number | null;
    due?: number | null;
    est?: number | null;
    act?: number | null;
    cat?: number[];
    ms?: number[];
    desc?: string;
    cf?: Record<number, unknown>;
  };

  /** 1プロジェクトぶんの課題をまとめて作る */
  async function makeIssues(projectId: number, specs: IssueSpec[]) {
    const made: Array<{ id: number; keyId: number; statusId: number }> = [];
    for (const [i, s] of specs.entries()) {
      const keyId = i + 1;
      const statusId = s.statusId ?? 1;
      const createdBy = u[s.creator ?? "admin"].id;
      const createdAt = at(-(specs.length - i) - 2);
      const issue = await prisma.issue.create({
        data: {
          projectId, keyId,
          summary: s.summary,
          description: s.desc ?? null,
          issueTypeId: s.typeId ?? 1,
          statusId,
          priorityId: s.priorityId ?? 3,
          assigneeId: s.assignee ? u[s.assignee].id : null,
          startDate: s.start != null ? day(s.start) : null,
          dueDate: s.due != null ? day(s.due) : null,
          estimatedHours: s.est ?? null,
          actualHours: s.act ?? null,
          // 完了した課題はバーンダウンのために完了日時が要る
          completedAt: statusId === 4 ? at(Math.max(-9, (s.due ?? -3) - 1), 17) : null,
          createdBy, updatedBy: createdBy,
          createdAt,
          categories: {
            create: (s.cat ?? []).map((id) => ({ projectId, categoryId: id })),
          },
          milestones: {
            create: (s.ms ?? []).map((id) => ({ projectId, versionId: id })),
          },
        },
      });
      made.push({ id: issue.id, keyId, statusId });

      if (s.cf) {
        for (const [fid, value] of Object.entries(s.cf)) {
          await prisma.issueCustomFieldValue.create({
            data: {
              issueId: issue.id, projectId,
              customFieldId: Number(fid), value: value as Prisma.InputJsonValue,
            },
          });
        }
      }

      // 参加者。登録者と担当者
      const parts = new Set<number>([createdBy]);
      if (s.assignee) parts.add(u[s.assignee].id);
      await prisma.issueParticipant.createMany({
        data: [...parts].map((userId) => ({ issueId: issue.id, userId })),
        skipDuplicates: true,
      });

      await prisma.activity.create({
        data: {
          projectId, issueId: issue.id, userId: createdBy,
          type: "issue_created", createdAt,
        },
      });
    }
    await prisma.project.update({
      where: { id: projectId }, data: { lastIssueNo: specs.length },
    });
    return made;
  }

  // WEB: 期限切れが残っている進行中のプロジェクト（進捗 = danger）
  const webIssues = await makeIssues(web.id, [
    { summary: "ログイン画面のデザインを刷新する", statusId: 2, priorityId: 2,
      assignee: "nakamura", start: -8, due: 3, est: 16, act: 6,
      cat: [cats[0].id, cats[3].id], ms: [v1.id],
      desc: "既存のログイン画面は古いので作り直す。\n\n- [ ] 配色を決める\n- [x] 画面構成の案出し",
      cf: { [cfText.id]: { kind: "text", value: "ヌーラボ商事" },
            [cfNum.id]: { kind: "number", value: 250000 },
            [cfList.id]: { kind: "list", itemIds: [cfItems[1].id] } } },
    // 以下、admin の担当は期限日の絞り込み（期限切れ/今日まで/4日以内/全て）が
    // 全部埋まるように散らしてある。ログインして最初に見る画面なので中身が要る
    { summary: "セッションが切れると500になる", typeId: 2, statusId: 1, priorityId: 2,
      assignee: "admin", creator: "suzuki", due: -3, est: 4, cat: [cats[1].id], ms: [v1.id],
      desc: "**期限切れの課題。** 一覧で赤く出るはず。\n\n再現手順:\n\n1. ログインする\n2. 30分放置する\n3. 任意の画面を開く" },
    { summary: "検索の応答が遅い", typeId: 2, statusId: 2, priorityId: 3,
      assignee: "takahashi", start: -5, due: 7, est: 8, act: 3, cat: [cats[1].id], ms: [v1.id] },
    { summary: "本番環境のバックアップを自動化する", typeId: 1, statusId: 3, priorityId: 3,
      assignee: "tanaka", start: -9, due: -1, est: 12, act: 12, cat: [cats[2].id], ms: [v1.id] },
    { summary: "利用マニュアルを作る", typeId: 1, statusId: 4, priorityId: 4,
      assignee: "yamada", start: -10, due: -5, est: 6, act: 5, ms: [v1.id] },
    { summary: "ダークモードに対応してほしい", typeId: 3, statusId: 1, priorityId: 4,
      assignee: null, creator: "ito", ms: [v11.id], desc: "要望として登録。担当は未定。" },
    { summary: "画面の文言を英語にも対応させる", typeId: 3, statusId: 2, priorityId: 3,
      assignee: "watanabe", start: -2, due: 9, est: 10, act: 2, ms: [v1.id] },
    { summary: "通知メールが二重に届くことがある", typeId: 2, statusId: 1, priorityId: 2,
      assignee: "sato", due: -1, est: 3, cat: [cats[1].id], ms: [v1.id],
      desc: "2件目の期限切れ。" },
    { summary: "スマートフォンで表が崩れる", typeId: 2, statusId: 1, priorityId: 3,
      assignee: "admin", due: 1, est: 5, cat: [cats[0].id, cats[3].id], ms: [v1.id] },
    { summary: "課題の一括更新を作る", typeId: 1, statusId: 1, priorityId: 3,
      assignee: "yamada", start: 2, due: 20, est: 20, cat: [cats[0].id], ms: [v11.id] },
    { summary: "アクセスログを月次で集計する", typeId: 1, statusId: 3, priorityId: 4,
      assignee: "tanaka", start: -7, due: 2, est: 6, act: 4, cat: [cats[2].id], ms: [v1.id] },
    { summary: "パスワードの有効期限を設定できるようにする", typeId: 3, statusId: 4,
      priorityId: 3, assignee: "admin", start: -9, due: -6, est: 8, act: 9, ms: [v1.id] },
    { summary: "リリース手順の最終確認", typeId: 1, statusId: 2, priorityId: 2,
      assignee: "admin", start: -1, due: 0, est: 3, act: 1, ms: [v1.id],
      desc: "**今日が期限。** 期限日の絞り込み「今日まで」の確認用。" },
    { summary: "問い合わせ窓口の一覧を更新する", typeId: 1, statusId: 1, priorityId: 4,
      assignee: "yamada", due: 28, est: 2, ms: [v11.id] },
  ]);

  // OPS: 始まったばかりで未着手ばかり（進捗 = warn）
  const opsIssues = await makeIssues(ops.id, [
    { summary: "月次レポートの自動生成", assignee: "watanabe", due: 14, est: 10 },
    { summary: "監視アラートの棚卸し", statusId: 2, assignee: "tanaka", start: -1, due: 21, est: 8, act: 2 },
    { summary: "バックアップの復元手順を検証する", assignee: "watanabe", due: 18, est: 6 },
    { summary: "サーバー証明書の更新手順を文書化する", assignee: "admin", due: 25, est: 4 },
    { summary: "ログ保管期間の見直し", typeId: 3, assignee: null, creator: "ito", est: 3 },
    { summary: "障害連絡のテンプレートを作る", assignee: "tanaka", due: 30, est: 2 },
    { summary: "深夜バッチの実行時間が伸びている", typeId: 2, assignee: "watanabe", due: 12, est: 6 },
  ]);

  // DES: 全部完了（進捗 = done）
  await makeIssues(des.id, [
    { summary: "カラーパレットを決める", statusId: 4, assignee: "nakamura",
      start: -30, due: -25, est: 8, act: 8 },
    { summary: "ボタンのコンポーネントを作る", statusId: 4, assignee: "nakamura",
      start: -24, due: -18, est: 12, act: 14 },
    { summary: "フォーム部品のコンポーネントを作る", statusId: 4, assignee: "ito",
      start: -20, due: -14, est: 16, act: 15 },
    { summary: "タイポグラフィの指針をまとめる", statusId: 4, assignee: "takahashi",
      start: -16, due: -12, est: 6, act: 5 },
    { summary: "アイコンセットを整理する", statusId: 4, assignee: "ito",
      start: -14, due: -9, est: 10, act: 11 },
  ]);

  // MKT: 期限切れなしで順調に進んでいる（進捗 = normal）
  await makeIssues(mkt.id, [
    { summary: "トップページの構成案を作る", statusId: 4, assignee: "nakamura",
      start: -14, due: -8, est: 8, act: 7 },
    { summary: "導入事例のページを追加する", statusId: 2, assignee: "yamada",
      start: -5, due: 8, est: 12, act: 5 },
    { summary: "問い合わせフォームを作り直す", statusId: 2, assignee: "sato",
      start: -3, due: 12, est: 10, act: 3 },
    { summary: "OGP画像を設定する", statusId: 3, assignee: "nakamura",
      start: -6, due: 4, est: 3, act: 3 },
    { summary: "計測タグを入れ替える", statusId: 4, assignee: "yamada",
      start: -12, due: -7, est: 4, act: 4 },
    { summary: "料金ページの文言を見直す", statusId: 1, assignee: "kobayashi", due: 15, est: 5 },
    { summary: "サイトマップを更新する", statusId: 1, assignee: null, due: 20, est: 2 },
  ]);

  // INF: 課題ゼロ（進捗 = empty）。作ったばかりのプロジェクトの見え方
  console.log("  課題33件（5プロジェクト・進捗の出方を5通り）");

  // ---- 親子・関連 ----
  await prisma.issue.update({
    where: { id: webIssues[2].id }, data: { parentIssueId: webIssues[0].id },
  });
  await prisma.issue.update({
    where: { id: webIssues[8].id }, data: { parentIssueId: webIssues[0].id },
  });
  await prisma.issueRelation.create({
    data: { issueId: webIssues[1].id, relatedIssueId: webIssues[7].id },
  });
  await prisma.issueRelation.create({
    data: { issueId: webIssues[2].id, relatedIssueId: webIssues[10].id },
  });

  // ---- コメント・状態変更の履歴 ----
  // 「最近の更新」に色々な種類が並ぶよう、複数の課題に散らす
  const main0 = webIssues[0];
  await prisma.activity.create({
    data: {
      projectId: web.id, issueId: main0.id, userId: u.nakamura.id,
      type: "comment", content: `配色の案を3つ作りました。<@U${u.admin.id}> 確認をお願いします。`,
      createdAt: at(-4, 14),
    },
  });
  const statusChange = await prisma.activity.create({
    data: {
      projectId: web.id, issueId: main0.id, userId: u.admin.id,
      type: "issue_updated",
      changes: [{ field: "statusId", from: "1", to: "2" }] as Prisma.InputJsonValue,
      content: "着手します。",
      createdAt: at(-3, 9),
    },
  });
  await prisma.activity.create({
    data: {
      projectId: web.id, issueId: webIssues[1].id, userId: u.sato.id,
      type: "comment", content: "再現しました。セッションの期限切れ時に例外を握りつぶしています。",
      createdAt: at(-2, 11),
    },
  });
  await prisma.activity.create({
    data: {
      projectId: web.id, issueId: webIssues[2].id, userId: u.takahashi.id,
      type: "issue_updated",
      changes: [
        { field: "assigneeId", from: String(u.yamada.id), to: String(u.takahashi.id) },
        { field: "priorityId", from: "3", to: "2" },
      ] as Prisma.InputJsonValue,
      createdAt: at(-1, 15),
    },
  });
  await prisma.activity.create({
    data: {
      projectId: ops.id, issueId: opsIssues[1].id, userId: u.tanaka.id,
      type: "comment", content: "アラートの一覧を洗い出しました。半分は不要そうです。",
      createdAt: at(-1, 16),
    },
  });
  await prisma.activity.create({
    data: {
      projectId: web.id, issueId: webIssues[4].id, userId: u.yamada.id,
      type: "issue_updated",
      changes: [{ field: "statusId", from: "3", to: "4" }] as Prisma.InputJsonValue,
      content: "レビュー済みなので完了にします。",
      createdAt: at(-5, 17),
    },
  });

  // ---- 通知（未読を残して、通知欄に件数を出す） ----
  await prisma.notification.createMany({
    data: [
      { userId: u.nakamura.id, activityId: statusChange.id, reason: "watching" },
      { userId: u.admin.id, activityId: statusChange.id, reason: "assigned", readAt: at(-2) },
      { userId: u.admin.id, activityId: statusChange.id + 2, reason: "mentioned" },
    ],
    skipDuplicates: true,
  });

  // ---- スター・ウォッチ ----
  await prisma.star.createMany({
    data: [
      { userId: u.admin.id, issueId: main0.id },
      { userId: u.yamada.id, issueId: webIssues[1].id },
      { userId: u.nakamura.id, issueId: webIssues[2].id },
    ],
    skipDuplicates: true,
  });
  await prisma.watching.createMany({
    data: [
      { userId: u.yamada.id, issueId: main0.id },
      { userId: u.admin.id, issueId: webIssues[1].id },
    ],
    skipDuplicates: true,
  });

  // ---- 最近見た課題（ダッシュボードの右側に出る） ----
  await prisma.recentlyViewedIssue.createMany({
    data: [
      { userId: u.admin.id, issueId: main0.id, viewedAt: at(0, 9) },
      { userId: u.admin.id, issueId: webIssues[1].id, viewedAt: at(-1, 18) },
      { userId: u.admin.id, issueId: opsIssues[0].id, viewedAt: at(-2, 13) },
    ],
    skipDuplicates: true,
  });

  // ---- Wiki（履歴つき） ----
  const wiki = await prisma.wikiPage.create({
    data: {
      projectId: web.id, name: "開発の進め方",
      content: "# 開発の進め方\n\n## ブランチ\n\n`WEB-123/短い説明` の形にする。\n\n## レビュー\n\n- 1人以上の承認が必要\n- CIが通ってからマージ",
      createdBy: u.admin.id, updatedBy: u.yamada.id, revision: 2,
      tags: { create: [{ tag: "手順書" }, { tag: "開発" }] },
    },
  });
  await prisma.wikiRevision.createMany({
    data: [
      { wikiPageId: wiki.id, content: "# 開発の進め方\n\n（書きかけ）",
        userId: u.admin.id, createdAt: at(-6) },
      { wikiPageId: wiki.id, content: wiki.content, userId: u.yamada.id, createdAt: at(-2) },
    ],
  });
  const wiki2 = await prisma.wikiPage.create({
    data: {
      projectId: web.id, name: "用語集",
      content: "# 用語集\n\n| 用語 | 意味 |\n|---|---|\n| PJ | プロジェクト |\n| MS | マイルストーン |",
      createdBy: u.admin.id, updatedBy: u.admin.id, revision: 1,
      tags: { create: [{ tag: "参考" }] },
    },
  });
  await prisma.wikiPage.create({
    data: {
      projectId: des.id, name: "コンポーネント一覧",
      content: "# コンポーネント一覧\n\n- Button\n- Input\n- Select\n- Modal",
      createdBy: u.nakamura.id, updatedBy: u.nakamura.id, revision: 1,
      tags: { create: [{ tag: "デザイン" }] },
    },
  });
  await prisma.activity.createMany({
    data: [
      { projectId: web.id, wikiPageId: wiki.id, userId: u.admin.id,
        type: "wiki_created", createdAt: at(-6, 10) },
      { projectId: web.id, wikiPageId: wiki.id, userId: u.yamada.id,
        type: "wiki_updated", createdAt: at(-2, 10) },
      { projectId: web.id, wikiPageId: wiki2.id, userId: u.admin.id,
        type: "wiki_created", createdAt: at(-5, 11) },
    ],
  });
  console.log("  Wiki 3ページ（履歴・タグつき）");

  // ---- 共有ファイル ----
  // 実体は置かない（ダウンロードすると404になる）。一覧の見え方の確認用
  const file = await prisma.sharedFile.create({
    data: {
      projectId: web.id, dir: "/", name: "画面設計_v2.pdf",
      size: 482_310, mime: "application/pdf",
      storageKey: "demo/screen-design-v2.pdf", createdBy: u.nakamura.id,
      createdAt: at(-4, 12),
    },
  });
  await prisma.activity.create({
    data: {
      projectId: web.id, userId: u.nakamura.id, type: "file_added",
      content: file.name, createdAt: at(-4, 12),
    },
  });

  // ---- Git（リポジトリとプルリクエスト） ----
  // Gitea 側の実体とは対応しない。ダッシュボードと一覧の見え方の確認用
  const repo = await prisma.repository.create({
    data: {
      projectId: web.id, externalRepoId: "9001", name: "portal",
      description: "社内ポータルのソース", defaultBranch: "main",
      createdById: u.admin.id, pushedAt: at(0, 11),
    },
  });
  await prisma.pullRequest.createMany({
    data: [
      { repositoryId: repo.id, externalPrNumber: 12, issueId: main0.id,
        title: "ログイン画面のマークアップを差し替える",
        body: "WEB-1 の対応。配色は暫定です。",
        baseBranch: "main", headBranch: "WEB-1/login-redesign", state: "open",
        assigneeId: u.admin.id, createdById: u.nakamura.id, createdAt: at(-2, 14) },
      { repositoryId: repo.id, externalPrNumber: 13, issueId: webIssues[2].id,
        title: "検索クエリに索引を足す",
        baseBranch: "main", headBranch: "WEB-3/search-index", state: "open",
        assigneeId: u.takahashi.id, createdById: u.admin.id, createdAt: at(-1, 9) },
      { repositoryId: repo.id, externalPrNumber: 11,
        title: "利用マニュアルの雛形を追加",
        baseBranch: "main", headBranch: "WEB-5/manual", state: "merged",
        assigneeId: u.yamada.id, createdById: u.yamada.id,
        createdAt: at(-6, 10), closeAt: at(-5, 16), mergeAt: at(-5, 16) },
    ],
  });
  const prs = await prisma.pullRequest.findMany({ where: { repositoryId: repo.id } });
  for (const pr of prs) {
    await prisma.activity.create({
      data: {
        projectId: web.id, pullRequestId: pr.id,
        userId: pr.createdById ?? u.admin.id,
        type: "pull_request_created", createdAt: pr.createdAt,
      },
    });
  }
  await prisma.activity.create({
    data: {
      projectId: web.id, userId: u.takahashi.id, type: "git_push",
      content: "portal に 3 件のコミットをプッシュしました（WEB-3/search-index）",
      createdAt: at(0, 11),
    },
  });
  console.log("  Git リポジトリ1つ・プルリクエスト3件（open2 / merged1）");

  // ---- 保存した検索条件 ----
  await prisma.savedFilter.createMany({
    data: [
      { userId: u.admin.id, name: "期限切れの課題", projectId: web.id,
        condition: { dueDateUntil: day(-1).toISOString().slice(0, 10) } },
      { userId: u.admin.id, name: "未対応のバグ", projectId: web.id,
        condition: { statusId: "1", issueTypeId: "2" } },
    ],
  });

  // ---- 監査ログ ----
  await prisma.auditLog.createMany({
    data: [
      { userId: u.admin.id, action: "project.create", targetType: "project",
        targetId: "WEB", detail: { name: web.name }, createdAt: at(-12) },
      { userId: u.admin.id, action: "user.create", targetType: "user",
        targetId: "yamada", detail: { name: "山田 太郎" }, createdAt: at(-11) },
      { userId: u.admin.id, action: "project.member.add", targetType: "project",
        targetId: "WEB", detail: { userId: "suzuki" }, createdAt: at(-11) },
      { userId: u.admin.id, action: "team.create", targetType: "team",
        targetId: "開発チーム", detail: { members: 4 }, createdAt: at(-10) },
      { userId: u.admin.id, action: "user.update", targetType: "user",
        targetId: "suzuki", detail: { restriction: "issue_view_only" }, createdAt: at(-9) },
      { userId: u.yamada.id, action: "project.create", targetType: "project",
        targetId: "DES", detail: { name: des.name }, createdAt: at(-8) },
    ],
  });

  console.log("\n== できました ==");
  console.log(`  ログイン: ${USERS.map((s) => s.userId).join(" / ")}`);
  console.log(`  パスワードは全員 ${PASSWORD}`);
  console.log("  suzuki = 閲覧のみ・英語表示 / ito = 課題登録のみ / kobayashi = ゲスト");
  console.log("  watanabe = 英語表示 / yamada・nakamura・watanabe = プロジェクト管理者");
  console.log("  進捗の見え方: WEB=期限切れあり OPS=未着手多い DES=全完了 MKT=順調 INF=課題なし");
  console.log(`  未使用プロジェクト: ${inf.key}（課題ゼロの見え方の確認用）`);
}

main()
  .catch((e) => {
    console.error("失敗しました:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

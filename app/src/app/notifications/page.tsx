import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser, visibleProjectIds } from "@/lib/session";
import { describeChanges } from "@/lib/describe-changes";
import { changeLookupsFor } from "@/lib/issue-view";
import { renderMentions } from "@/lib/mention";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui";
import { markAsRead, markAllAsRead } from "./actions";

const REASON_LABEL: Record<string, string> = {
  notified: "お知らせ",
  assigned: "担当になりました",
  mentioned: "メンション",
  watching: "ウォッチ中",
};

const REASON_STYLE: Record<string, string> = {
  notified: "bg-amber-50 text-amber-700",
  assigned: "bg-brand-50 text-brand-700",
  mentioned: "bg-purple-50 text-purple-700",
  watching: "bg-slate-100 text-slate-600",
};

const jst = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const user = await currentUser();
  const visible = await visibleProjectIds(user.id);

  const notifications = await prisma.notification.findMany({
    where: {
      userId: user.id,
      ...(all ? {} : { readAt: null }),
      // 参加していないプロジェクトの通知は出さない。
      // プロジェクトから外れた後に件名が見えると内容が推測できる
      activity: { projectId: { in: visible } },
    },
    include: {
      activity: {
        include: {
          user: true,
          project: { select: { key: true, name: true } },
          issue: { select: { keyId: true, summary: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const unread = await prisma.notification.count({
    where: { userId: user.id, readAt: null, activity: { projectId: { in: visible } } },
  });

  // 変更差分を日本語にするための辞書をプロジェクトごとに引く
  const projectIds = [...new Set(notifications.map((n) => n.activity.projectId))];
  const lookups = new Map(
    await Promise.all(
      projectIds.map(async (id) => [id, await changeLookupsFor(id)] as const),
    ),
  );
  const teamNames = new Map(
    (await prisma.team.findMany()).map((t) => [t.id, t.name]),
  );

  return (
    <Shell user={user} breadcrumbs={[{ label: "通知" }]}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          通知
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">
              {unread}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={all ? "/notifications" : "/notifications?all=1"}
            className="text-brand-700 hover:underline"
          >
            {all ? "未読のみ表示" : "すべて表示"}
          </Link>
          {unread > 0 && (
            <form action={markAllAsRead}>
              <Button variant="secondary">
                すべて既読にする
              </Button>
            </form>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          {all ? "通知はありません。" : "未読の通知はありません。"}
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {notifications.map((n) => {
            const a = n.activity;
            const lk = lookups.get(a.projectId) ?? {};
            const described = describeChanges(a.changes, lk);
            const userNames = lk.users ?? new Map();
            return (
              <li
                key={n.id}
                className={`rounded border p-3 text-sm ${
                  n.readAt
                    ? "border-slate-200 bg-white"
                    : "border-brand-200 bg-brand-50/40"
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded px-1.5 py-0.5 ${REASON_STYLE[n.reason] ?? ""}`}
                  >
                    {REASON_LABEL[n.reason] ?? n.reason}
                  </span>
                  <span className="text-slate-500">{a.project.name}</span>
                  <span className="text-slate-400">{jst(n.createdAt)}</span>
                  {!n.readAt && (
                    <form action={markAsRead} className="ml-auto">
                      <input type="hidden" name="id" value={n.id} />
                      <Button variant="link" size="xs">
                        既読にする
                      </Button>
                    </form>
                  )}
                </div>

                {a.issue && (
                  <p className="mt-1">
                    <Link
                      href={`/issues/${a.project.key}-${a.issue.keyId}`}
                      className="font-mono text-xs text-brand-700 hover:underline"
                    >
                      {a.project.key}-{a.issue.keyId}
                    </Link>{" "}
                    <Link
                      href={`/issues/${a.project.key}-${a.issue.keyId}`}
                      className="hover:underline"
                    >
                      {a.issue.summary}
                    </Link>
                  </p>
                )}

                <p className="mt-1 text-xs text-slate-500">
                  {a.user.name}
                  {a.type === "issue_created" && " が登録しました"}
                  {a.type === "comment" && " がコメントしました"}
                  {a.type === "issue_updated" && " が更新しました"}
                </p>

                {described.length > 0 && (
                  <ul className="mt-1 text-xs text-slate-600">
                    {described.map((d, i) => (
                      <li key={i}>
                        {d.label} {d.from ?? "未設定"} → {d.to ?? "未設定"}
                      </li>
                    ))}
                  </ul>
                )}

                {a.content && (
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">
                    {/* 本文には <@U5> のまま入っているので、表示時に名前へ直す */}
                    {renderMentions(a.content, { users: userNames, teams: teamNames })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

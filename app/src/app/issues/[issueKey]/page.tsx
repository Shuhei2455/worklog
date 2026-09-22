import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import {
  parseIssueKey,
  loadIssueDetail,
  recordRecentlyViewed,
} from "@/lib/issue-view";
import { PRIORITIES, PRIORITY_LABEL, RESOLUTIONS } from "@/lib/constants";
import { Shell } from "@/components/Shell";
import { PageTitle, Button, ToggleChip } from "@/components/ui";
import { CustomFieldInputs, CustomFieldValues } from "@/components/CustomFieldInputs";
import { loadFieldDefs, applicableTo } from "@/lib/custom-field-form";
import {
  editIssue,
  removeIssue,
  attachFile,
  detachFile,
  setParent,
  addRelation,
  removeRelation,
  toggleWatching,
  toggleStar,
} from "@/app/projects/[key]/issues/actions";
import { renderMentions } from "@/lib/mention";
import { Markdown } from "@/components/Markdown";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { projectNav } from "@/lib/project-nav";
import { readFlash } from "@/lib/flash";
import {
  linkSharedFileToIssue,
  unlinkSharedFileFromIssue,
} from "@/app/projects/[key]/files/actions";

const jst = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export default async function IssueDetail({
  params,
  searchParams,
}: {
  params: Promise<{ issueKey: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { issueKey } = await params;
  // クエリでも受けるが、通常はフラッシュ（cookie）から来る。
  // 同じURLへ redirect すると画面が飛ぶので、メッセージは cookie で運んでいる
  const sp = await searchParams;
  const flash = await readFlash(`/issues/${decodeURIComponent(issueKey)}`);
  const error = sp.error ?? flash.error;
  const ok = sp.ok ?? flash.ok;
  const user = await currentUser();

  const parsed = parseIssueKey(decodeURIComponent(issueKey));
  if (!parsed) notFound();

  const detail = await loadIssueDetail(parsed.projectKey, parsed.keyId, user.id);
  if (!detail) notFound();
  const { project, issue, timeline } = detail;

  const ctx = await projectContext(project.id, user.id);
  // 参加していないプロジェクトの課題は管理者でも見えない
  if (!can(user, "issue.view", ctx)) notFound();

  // ダッシュボードの「最近見た課題」に出す
  await recordRecentlyViewed(user.id, issue.id);

  const canEdit = can(user, "issue.edit", ctx);
  const canComment = can(user, "comment.manage", ctx);
  const canDelete = can(user, "issue.delete", ctx);

  const [
    statuses,
    members,
    attachments,
    watching,
    myStar,
    starCount,
    teams,
    linkedFiles,
    projectFiles,
    commitLinks,
    relatedPulls,
    fieldDefs,
    fieldValueRows,
  ] = await Promise.all([
    prisma.status.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: true },
    }),
    prisma.issueAttachment.findMany({
      where: { issueId: issue.id },
      include: { attachment: true },
      orderBy: { attachmentId: "asc" },
    }),
    prisma.watching.findUnique({
      where: { userId_issueId: { userId: user.id, issueId: issue.id } },
    }),
    prisma.star.findFirst({ where: { userId: user.id, issueId: issue.id } }),
    prisma.star.count({ where: { issueId: issue.id } }),
    prisma.team.findMany(),
    prisma.issueSharedFile.findMany({
      where: { issueId: issue.id },
      include: { sharedFile: true },
    }),
    prisma.sharedFile.findMany({
      where: { projectId: project.id },
      orderBy: [{ dir: "asc" }, { name: "asc" }],
      take: 200,
    }),
    // 課題 → コミット / PR。逆方向（コミット→課題）はGitの画面側にある。
    // 双方向に辿れることが受け入れ条件（02-roadmap.md フェーズ4）
    prisma.commitIssueLink.findMany({
      where: { issueId: issue.id },
      include: { repository: { select: { name: true } } },
      orderBy: { committedAt: "desc" },
    }),
    prisma.pullRequest.findMany({
      where: { issueId: issue.id },
      include: { repository: { select: { name: true } } },
      orderBy: { externalPrNumber: "desc" },
    }),
    loadFieldDefs(project.id),
    prisma.issueCustomFieldValue.findMany({ where: { issueId: issue.id } }),
  ]);

  const fullKey = `${project.key}-${issue.keyId}`;

  // この課題種別で有効なカスタム属性と、その値
  const activeFields = applicableTo(fieldDefs, issue.issueTypeId);
  const fieldValues = Object.fromEntries(
    fieldValueRows.map((r) => [r.customFieldId, r.value]),
  );

  return (
    <Shell
      user={user}
      // 課題はプロジェクトの中身なので、左のナビを出したままにする。
      // 一覧から開いた瞬間にナビが消えると、別の画面へ移るのに戻る操作が要る
      project={projectNav(project, user, ctx, "issues")}
    >
      {ok && (
        <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ok}
        </p>
      )}
      {error && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-start gap-3">
        <span
          className="mt-1 rounded px-2 py-0.5 text-xs text-white"
          style={{ background: issue.issueType.color }}
        >
          {issue.issueType.name}
        </span>
        <div className="flex-1">
          <p className="font-mono text-xs text-slate-500">{fullKey}</p>
          <PageTitle>{issue.summary}</PageTitle>
        </div>
        <form action={toggleStar.bind(null, fullKey)}>
          <ToggleChip on={Boolean(myStar)} tone="amber" title="スター">
            ★ {starCount}
          </ToggleChip>
        </form>
        <form action={toggleWatching.bind(null, fullKey)}>
          <ToggleChip on={Boolean(watching)} tone="brand">
            {watching ? "ウォッチ中" : "ウォッチ"}
          </ToggleChip>
        </form>
        {canDelete && (
          <form action={removeIssue.bind(null, fullKey)}>
            {/* 物理削除なので戻せない。押した瞬間に消えないよう確認を挟む */}
            <ConfirmSubmit
              variant="dangerOutline"
              message={`${fullKey}「${issue.summary}」を削除します。\n\nコメント・添付・Gitとの紐付けも一緒に消え、元に戻せません。`}
            >
              削除
            </ConfirmSubmit>
          </form>
        )}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_260px]">
        {/* ---- 本文と時系列 ---- */}
        <div>
          {issue.description && (
            <div className="rounded border border-slate-200 bg-white p-4 text-sm">
              {/* Markdown(GFM) で描く。Wiki・プルリクと同じ扱い。
                  以前は素のテキストで出しており、`- [ ] やること` が
                  そのまま見えていた（CLAUDE.md のテキスト整形ルールに反していた） */}
              <Markdown>{issue.description}</Markdown>
            </div>
          )}

          {/* ---- 添付ファイル ---- */}
          <div className="mt-4 rounded border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-600">添付ファイル</h2>
            {attachments.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">なし</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {attachments.map((a) => (
                  <li key={a.attachmentId} className="flex items-center gap-2">
                    <a
                      href={`/attachments/${a.attachmentId}`}
                      className="text-brand-700 hover:underline"
                    >
                      {a.attachment.name}
                    </a>
                    <span className="text-xs text-slate-400">
                      {Math.ceil(a.attachment.size / 1024)} KB
                    </span>
                    {can(user, "issueAttachment.delete", ctx) && (
                      <form action={detachFile.bind(null, fullKey)}>
                        <input type="hidden" name="attachmentId" value={a.attachmentId} />
                        <Button variant="danger" size="xs">
                          削除
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {can(user, "issueAttachment.add", ctx) && (
              <form
                action={attachFile.bind(null, fullKey)}
                      className="mt-3 flex items-center gap-2"
              >
                <input
                  type="file"
                  name="file"
                  required
                  className="text-xs file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs"
                />
                <Button variant="secondary">
                  添付
                </Button>
              </form>
            )}
          </div>

          {/* Git の連携。コミットメッセージにタスクキーを書くと自動で増える。
              **git.access が無い人には出さない。** 出すとリンク先が404になる
              （M3-b で共有ファイルのリンクで同じ間違いをした） */}
          {can(user, "git.access", ctx) &&
            (commitLinks.length > 0 || relatedPulls.length > 0) && (
            <div className="mt-4 rounded border border-slate-200 bg-white p-3">
              <h2 className="text-sm font-semibold text-slate-600">Git</h2>

              {relatedPulls.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {relatedPulls.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-2">
                      <a
                        href={`/projects/${project.key}/git/${encodeURIComponent(p.repository.name)}/pulls/${p.externalPrNumber}`}
                        className="text-brand-700 hover:underline"
                      >
                        {p.repository.name} #{p.externalPrNumber} {p.title}
                      </a>
                      <span className="text-xs text-slate-400">{p.state}</span>
                    </li>
                  ))}
                </ul>
              )}

              {commitLinks.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {commitLinks.map((l) => (
                    <li key={l.id} className="flex items-baseline gap-2 text-sm">
                      <a
                        href={`/projects/${project.key}/git/${encodeURIComponent(l.repository.name)}/commits/${l.commitSha}`}
                        className="font-mono text-xs text-brand-700 hover:underline"
                      >
                        {l.commitSha.slice(0, 7)}
                      </a>
                      <span className="flex-1 truncate text-slate-700">
                        {l.message.split("\n")[0]}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {l.repository.name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 共有ファイルへのリンク。添付とは別物で、
              プロジェクトの置き場にあるものを参照する */}
          {project.fileSharingEnabled && can(user, "sharedFile.access", ctx) && (
            <div className="mt-4 rounded border border-slate-200 bg-white p-3">
              <h2 className="text-sm font-semibold text-slate-600">共有ファイル</h2>
              {linkedFiles.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">なし</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {linkedFiles.map((l) => (
                    <li key={l.sharedFileId} className="flex items-center gap-2">
                      <a
                        href={`/shared-files/${l.sharedFileId}`}
                        className="text-brand-700 hover:underline"
                      >
                        {l.sharedFile.dir}
                        {l.sharedFile.name}
                      </a>
                      <form action={unlinkSharedFileFromIssue.bind(null, fullKey)}>
                        <input type="hidden" name="sharedFileId" value={l.sharedFileId} />
                        <Button variant="danger" size="xs">
                          外す
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {projectFiles.length > 0 && (
                <form
                  action={linkSharedFileToIssue.bind(null, fullKey)}
                  className="mt-3 flex items-center gap-2"
                >
                  <select
                    name="sharedFileId"
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    {projectFiles.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.dir}
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary">
                    リンク
                  </Button>
                </form>
              )}
            </div>
          )}

          <h2 className="mt-6 text-sm font-semibold text-slate-600">
            コメントと変更履歴
          </h2>
          {/*
            activities を1テーブルに統合しているので、結合して並べ直す必要がない。
            本家と同じく、変更とコメントが同時に起きた場合は1件として出る
          */}
          <ol className="mt-2 space-y-3">
            {timeline.map((t) => (
              <li
                key={t.id}
                className="rounded border border-slate-200 bg-white p-3 text-sm"
              >
                <div className="flex items-baseline gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{t.user.name}</span>
                  <span>{jst(t.createdAt)}</span>
                  {t.type === "issue_created" && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">登録</span>
                  )}
                  {/* スターはタスク・コメント・Wikiに付けられる(00-spec 9章)。
                      コメント単位のスターはここから */}
                  <form action={toggleStar.bind(null, fullKey)} className="ml-auto">
                    <input type="hidden" name="activityId" value={t.id} />
                    <button
                      className={`text-xs ${
                        t.starredByMe ? "text-amber-500" : "text-slate-300 hover:text-amber-400"
                      }`}
                      title="このコメントにスター"
                    >
                      ★{t.starCount > 0 ? t.starCount : ""}
                    </button>
                  </form>
                  {t.notifiedUsers.length > 0 && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                      お知らせ: {t.notifiedUsers.map((u) => u.name).join("、")}
                    </span>
                  )}
                </div>

                {t.described.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {t.described.map((d, i) => (
                      <li key={i}>
                        <span className="text-slate-500">{d.label}</span>{" "}
                        <span className="text-slate-400">
                          {d.from ?? "未設定"}
                        </span>{" "}
                        <span className="text-slate-400">→</span>{" "}
                        <span className="font-medium">{d.to ?? "未設定"}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {t.content && (
                  <div className="mt-2 text-sm">
                    {/* 本文には <@U5> のまま保存し、表示時に名前へ直す。
                        名前を埋め込むと改名に追随できない。
                        メンションを解決してから Markdown に渡す
                        （renderMentions は文字列を返すのでそのまま繋げられる） */}
                    <Markdown>
                      {renderMentions(t.content, {
                        users: new Map(members.map((m) => [m.userId, m.user.name])),
                        teams: new Map(teams.map((tm) => [tm.id, tm.name])),
                      })}
                    </Markdown>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {(canComment || canEdit) && (
            <form
              action={editIssue.bind(null, fullKey)}
              className="mt-4 rounded border border-slate-200 bg-white p-3"
            >
              <MarkdownEditor
                name="comment"
                rows={3}
                placeholder="コメント"
                users={members.map((m) => ({ id: m.userId, name: m.user.name }))}
                teams={teams.map((tm) => ({ id: tm.id, name: tm.name }))}
              >
              {/* メンションは `@名前` ではなく `<@U5>`（本家と同じ記法）。
                  知らないと書けないので、実際のコードをここに出す */}
              <details className="mt-1 text-xs text-slate-500">
                <summary className="cursor-pointer">
                  メンションの書き方（Markdown / GFM が使えます）
                </summary>
                <p className="mt-1">
                  下のコードをそのまま本文に貼ると、相手に通知が届きます。
                </p>
                <ul className="mt-1 space-y-0.5">
                  {members.map((m) => (
                    <li key={m.userId}>
                      <code className="rounded bg-slate-100 px-1">{`<@U${m.userId}>`}</code>{" "}
                      {m.user.name}
                    </li>
                  ))}
                  <li>
                    <code className="rounded bg-slate-100 px-1">{"<@project>"}</code>{" "}
                    このプロジェクトの参加者全員
                  </li>
                </ul>
              </details>
              </MarkdownEditor>
              <div className="mt-2 flex items-center gap-3 text-sm">
                {canEdit && (
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">状態</span>
                    <select
                      name="statusId"
                      defaultValue={issue.statusId}
                      className="rounded border border-slate-300 px-2 py-1"
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Button variant="primary" className="ml-auto">
                  {canEdit ? "更新" : "コメントする"}
                </Button>
              </div>
              {canEdit && (
                <p className="mt-2 text-xs text-slate-500">
                  状態を変えつつコメントすると、履歴には1件としてまとまります（本家と同じ）。
                </p>
              )}
            </form>
          )}
        </div>

        {/* ---- 属性 ---- */}
        <aside className="space-y-4 text-sm">
          <dl className="rounded border border-slate-200 bg-white p-3">
            {[
              ["状態", issue.status.name],
              ["優先度", PRIORITY_LABEL.get(issue.priorityId) ?? "-"],
              ["担当者", issue.assignee?.name ?? "未割り当て"],
              [
                "完了理由",
                issue.resolutionId != null
                  ? (RESOLUTIONS.find((r) => r.id === issue.resolutionId)?.label ?? "-")
                  : "未設定",
              ],
              ["開始日", issue.startDate?.toISOString().slice(0, 10) ?? "未設定"],
              ["期限日", issue.dueDate?.toISOString().slice(0, 10) ?? "未設定"],
              ["登録者", issue.creator.name],
              ["登録日", jst(issue.createdAt)],
              ["更新日", jst(issue.updatedAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2 py-1">
                <dt className="w-20 shrink-0 text-xs text-slate-500">{k}</dt>
                <dd className="text-xs">{v}</dd>
              </div>
            ))}
          </dl>

        {/* カスタム属性。このタスク種別で有効なものだけ出す */}
        {activeFields.length > 0 && (
          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-1 text-xs font-semibold text-slate-600">カスタム属性</h2>
            {canEdit ? (
              <form action={editIssue.bind(null, fullKey)} className="space-y-2">
                <CustomFieldInputs fields={activeFields} values={fieldValues} />
                <Button variant="secondary">
                  保存
                </Button>
              </form>
            ) : (
              <dl>
                <CustomFieldValues fields={activeFields} values={fieldValues} />
              </dl>
            )}
          </div>
        )}

          {project.subtaskingEnabled && (
            <div className="rounded border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">親タスク</p>
              {issue.parent ? (
                <Link
                  href={`/issues/${project.key}-${issue.parent.keyId}`}
                  className="font-mono text-xs text-brand-700 hover:underline"
                >
                  {project.key}-{issue.parent.keyId}
                </Link>
              ) : (
                <p className="text-xs text-slate-400">なし</p>
              )}
              {canEdit && (
                <form action={setParent.bind(null, fullKey)} className="mt-2 flex gap-1">
                  <input
                    name="parentKey"
                    placeholder={`${project.key}-1`}
                    defaultValue={
                      issue.parent ? `${project.key}-${issue.parent.keyId}` : ""
                    }
                    className="w-24 rounded border border-slate-300 px-1.5 py-1 font-mono text-xs"
                  />
                  <Button variant="secondary" size="xs">
                    設定
                  </Button>
                </form>
              )}
              {canEdit && (
                <p className="mt-1 text-xs text-slate-400">
                  空にすると解除。親子は1階層までです。
                </p>
              )}
            </div>
          )}

          {/* 親子とは別の、対等なリンク */}
          <div className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">関連タスク</p>
            {issue.relationsFrom.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">なし</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {issue.relationsFrom.map((r) => (
                  <li key={r.relatedIssueId} className="flex items-center gap-1 text-xs">
                    <Link
                      href={`/issues/${project.key}-${r.relatedIssue.keyId}`}
                      className="font-mono text-brand-700 hover:underline"
                    >
                      {project.key}-{r.relatedIssue.keyId}
                    </Link>
                    <span className="flex-1 truncate">{r.relatedIssue.summary}</span>
                    {canEdit && (
                      <form action={removeRelation.bind(null, fullKey)}>
                        <input
                          type="hidden"
                          name="relatedIssueId"
                          value={r.relatedIssueId}
                        />
                        <Button variant="danger">外す</Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form action={addRelation.bind(null, fullKey)} className="mt-2 flex gap-1">
                <input
                  name="relatedKey"
                  placeholder={`${project.key}-2`}
                  className="w-24 rounded border border-slate-300 px-1.5 py-1 font-mono text-xs"
                />
                <Button variant="secondary" size="xs">
                  追加
                </Button>
              </form>
            )}
          </div>

          {issue.children.length > 0 && (
            <div className="rounded border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">子タスク</p>
              <ul className="mt-1 space-y-1">
                {issue.children.map((c) => (
                  <li key={c.id} className="text-xs">
                    <Link
                      href={`/issues/${project.key}-${c.keyId}`}
                      className="font-mono text-brand-700 hover:underline"
                    >
                      {project.key}-{c.keyId}
                    </Link>{" "}
                    {c.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {watching && (
            <form
              action={toggleWatching.bind(null, fullKey)}
              className="rounded border border-slate-200 bg-white p-3"
            >
              <input type="hidden" name="intent" value="note" />
              <p className="text-xs text-slate-500">ウォッチのメモ</p>
              <input
                name="note"
                defaultValue={watching.note ?? ""}
                placeholder="なぜ見ているか"
                className="mt-1 w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
              <Button variant="secondary" size="xs" className="mt-1 w-full">
                メモを保存
              </Button>
            </form>
          )}

          <div className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">参加者</p>
            <p className="mt-1 text-xs">
              {issue.participants.map((p) => p.user.name).join("、") || "なし"}
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

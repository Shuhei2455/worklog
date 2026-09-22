import { readFlash } from "@/lib/flash";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { projectNav } from "@/lib/project-nav";
import { PageTitle, Button } from "@/components/ui";
import { BASE_COLUMNS } from "@/lib/issue-csv";
import { loadFieldDefs } from "@/lib/custom-field-form";
import { previewImport, runImport } from "./actions";

type Summary = {
  encoding: string;
  total: number;
  errors: string[];
  errorCount: number;
  ignored: string[];
  preview: string[];
};

/** CSVの取り込み。確認 → 実行の2段 */
export default async function ImportIssues({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ result?: string; error?: string }>;
}) {
  const { key } = await params;
  const flash = await readFlash(`/projects/${key}/issues/import`);
  const sp = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "issue.create", ctx)) notFound();

  const fields = await loadFieldDefs(project.id);

  let summary: Summary | null = null;
  if (sp.result) {
    try {
      summary = JSON.parse(sp.result) as Summary;
    } catch {
      summary = null;
    }
  }

  return (
    <Shell
      user={user}
      project={projectNav(project, user, ctx, "issues")}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "タスク", href: `/projects/${key}/issues` },
        { label: "CSV取り込み" },
      ]}
    >
      <PageTitle>CSVからタスクを取り込む</PageTitle>

      <div className="mt-3 rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium">使い方</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600">
          <li>
            Excel で「名前を付けて保存」→ <strong>CSV UTF-8</strong> を選ぶ
            （素の「CSV」でも Shift_JIS として読みます）
          </li>
          <li>1行目をヘッダにする。列の順番は自由で、名前で対応づけます</li>
          <li>下で確認してから取り込む。1件でもエラーがあれば何も入りません</li>
        </ol>

        <h2 className="mt-4 font-medium">使える列</h2>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {BASE_COLUMNS.join(" / ")}
        </p>
        {fields.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            カスタム属性: <span className="font-mono">{fields.map((f) => f.name).join(" / ")}</span>
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          <strong>件名</strong>だけが必須です。種別を省くと先頭の種別になります。
          状態・担当者・カテゴリーなどは<strong>名前</strong>で書いてください
          （このプロジェクトに無い名前はエラーになります）。
          複数指定する列は <code>/</code> かカンマで区切ります。
        </p>
        <p className="mt-2 text-xs text-slate-500">
          いま入っているタスクを
          <Link
            href={`/projects/${key}/issues/export`}
            className="mx-1 text-brand-700 underline"
          >
            CSVで書き出す
          </Link>
          と、そのまま雛形として使えます。
        </p>
      </div>

      {(sp.error ?? flash.error) && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error ?? flash.error}
        </p>
      )}

      <form action={previewImport.bind(null, key)} className="mt-4 flex items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-slate-500">CSVファイル</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="mt-1 text-sm file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-sm"
          />
        </label>
        <Button variant="secondary">
          確認する
        </Button>
      </form>

      {summary && (
        <div className="mt-6 rounded border border-slate-200 bg-white p-4">
          <h2 className="font-medium">確認結果</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 text-slate-500">文字コード</dt>
              <dd>{summary.encoding}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 text-slate-500">取り込める行</dt>
              <dd>{summary.total} 件</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 text-slate-500">エラー</dt>
              <dd className={summary.errorCount > 0 ? "text-red-700" : ""}>
                {summary.errorCount} 件
              </dd>
            </div>
            {summary.ignored.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">無視する列</dt>
                <dd className="text-slate-600">{summary.ignored.join(" / ")}</dd>
              </div>
            )}
          </dl>

          {summary.errors.length > 0 && (
            <ul className="mt-3 space-y-0.5 rounded bg-red-50 p-3 text-xs text-red-800">
              {summary.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {summary.errorCount > summary.errors.length && (
                <li className="text-red-600">
                  ほか {summary.errorCount - summary.errors.length} 件
                </li>
              )}
            </ul>
          )}

          {summary.preview.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-slate-500">先頭の件名</p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {summary.preview.map((p, i) => (
                  <li key={i} className="text-slate-700">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.errorCount === 0 && summary.total > 0 ? (
            <form action={runImport.bind(null, key)} className="mt-4 flex items-end gap-2">
              <label className="text-sm">
                <span className="block text-xs text-slate-500">
                  同じファイルをもう一度選んでください
                </span>
                <input
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                  className="mt-1 text-sm file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-sm"
                />
              </label>
              <Button variant="primary">
                取り込む
              </Button>
            </form>
          ) : (
            <p className="mt-4 text-xs text-slate-500">
              エラーを直してから、もう一度確認してください。
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

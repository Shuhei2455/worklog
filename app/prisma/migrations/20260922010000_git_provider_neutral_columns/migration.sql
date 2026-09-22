-- Git連携の提供元を差し替えられるようにするための列名変更（2026-09-22）。
--
-- **RENAME COLUMN で書いている。** Prisma の自動生成は DROP + ADD になり、
-- 既存の値（gitea_org 1件 / gitea_pr_number 3件 / gitea_repo_id 1件）が消える。
--
-- 識別子は提供元によって数値だったりスラッグだったりするので、
-- Int の2つは TEXT へ広げる。逆向き（TEXT→Int）は成立しないので、
-- 戻すときは値を確認すること。

-- users
ALTER TABLE "users" RENAME COLUMN "gitea_user_id" TO "git_external_id";
ALTER TABLE "users" ALTER COLUMN "git_external_id" TYPE TEXT USING "git_external_id"::text;
ALTER TABLE "users" RENAME COLUMN "gitea_login" TO "git_login";

-- projects
ALTER TABLE "projects" RENAME COLUMN "gitea_org" TO "git_owner";

-- repositories
ALTER TABLE "repositories" RENAME COLUMN "gitea_repo_id" TO "external_repo_id";
ALTER TABLE "repositories" ALTER COLUMN "external_repo_id" TYPE TEXT USING "external_repo_id"::text;

-- pull_requests（索引名も揃えないと、次の migrate で作り直しになる）
ALTER TABLE "pull_requests" RENAME COLUMN "gitea_pr_number" TO "external_pr_number";
ALTER INDEX "pull_requests_repository_id_gitea_pr_number_key"
  RENAME TO "pull_requests_repository_id_external_pr_number_key";

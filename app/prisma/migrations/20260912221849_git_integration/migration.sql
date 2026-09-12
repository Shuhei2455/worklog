/*
  Warnings:

  - Added the required column `created_by` to the `repositories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `repositories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "pull_requests" ADD COLUMN     "assignee_id" INTEGER,
ADD COLUMN     "base_commit_sha" TEXT,
ADD COLUMN     "branch_commit_sha" TEXT,
ADD COLUMN     "close_at" TIMESTAMP(3),
ADD COLUMN     "created_by" INTEGER,
ADD COLUMN     "merge_at" TIMESTAMP(3),
ADD COLUMN     "merge_commit_sha" TEXT;

-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "created_by" INTEGER NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pushed_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "pull_requests_issue_id_idx" ON "pull_requests"("issue_id");

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

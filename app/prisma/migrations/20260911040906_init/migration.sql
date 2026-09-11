-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('admin', 'member', 'guest');

-- CreateEnum
CREATE TYPE "Restriction" AS ENUM ('none', 'issue_create_only', 'issue_view_only');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('local', 'oidc', 'ldap');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('issue_created', 'issue_updated', 'issue_deleted', 'comment', 'wiki_created', 'wiki_updated', 'wiki_deleted', 'file_added', 'file_updated', 'git_push', 'pull_request_created', 'pull_request_updated', 'project_user_added', 'project_user_removed');

-- CreateEnum
CREATE TYPE "NotificationReason" AS ENUM ('notified', 'assigned', 'mentioned', 'watching');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('text', 'sentence', 'number', 'date', 'single_list', 'multiple_list', 'checkbox', 'radio');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "icon_url" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'ja',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "user_type" "UserType" NOT NULL DEFAULT 'member',
    "restriction" "Restriction" NOT NULL DEFAULT 'none',
    "auth_provider" "AuthProvider" NOT NULL DEFAULT 'local',
    "external_id" TEXT,
    "password_hash" TEXT,
    "gitea_user_id" INTEGER,
    "last_login_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "chart_enabled" BOOLEAN NOT NULL DEFAULT true,
    "subtasking_enabled" BOOLEAN NOT NULL DEFAULT true,
    "wiki_enabled" BOOLEAN NOT NULL DEFAULT true,
    "file_sharing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "git_enabled" BOOLEAN NOT NULL DEFAULT false,
    "project_leader_can_edit_project_leader" BOOLEAN NOT NULL DEFAULT false,
    "text_formatting_rule" TEXT NOT NULL DEFAULT 'markdown',
    "last_issue_no" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "is_project_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "project_teams" (
    "project_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,

    CONSTRAINT "project_teams_pkey" PRIMARY KEY ("project_id","team_id")
);

-- CreateTable
CREATE TABLE "issue_types" (
    "project_id" INTEGER NOT NULL,
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_types_pkey" PRIMARY KEY ("project_id","id")
);

-- CreateTable
CREATE TABLE "categories" (
    "project_id" INTEGER NOT NULL,
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("project_id","id")
);

-- CreateTable
CREATE TABLE "versions" (
    "project_id" INTEGER NOT NULL,
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "start_date" DATE,
    "release_due_date" DATE,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "versions_pkey" PRIMARY KEY ("project_id","id")
);

-- CreateTable
CREATE TABLE "statuses" (
    "project_id" INTEGER NOT NULL,
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statuses_pkey" PRIMARY KEY ("project_id","id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "project_id" INTEGER NOT NULL,
    "id" INTEGER NOT NULL,
    "type_id" "CustomFieldType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "applicable_issue_types" INTEGER[],
    "settings" JSONB,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("project_id","id")
);

-- CreateTable
CREATE TABLE "custom_field_items" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "custom_field_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,

    CONSTRAINT "custom_field_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "key_id" INTEGER NOT NULL,
    "issue_type_id" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "status_id" INTEGER NOT NULL,
    "priority_id" INTEGER NOT NULL,
    "resolution_id" INTEGER,
    "assignee_id" INTEGER,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER NOT NULL,
    "start_date" DATE,
    "due_date" DATE,
    "estimated_hours" DECIMAL(8,2),
    "actual_hours" DECIMAL(8,2),
    "parent_issue_id" INTEGER,
    "board_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_categories" (
    "issue_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "issue_categories_pkey" PRIMARY KEY ("issue_id","category_id")
);

-- CreateTable
CREATE TABLE "issue_milestones" (
    "issue_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "version_id" INTEGER NOT NULL,

    CONSTRAINT "issue_milestones_pkey" PRIMARY KEY ("issue_id","version_id")
);

-- CreateTable
CREATE TABLE "issue_versions" (
    "issue_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "version_id" INTEGER NOT NULL,

    CONSTRAINT "issue_versions_pkey" PRIMARY KEY ("issue_id","version_id")
);

-- CreateTable
CREATE TABLE "issue_relations" (
    "issue_id" INTEGER NOT NULL,
    "related_issue_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_relations_pkey" PRIMARY KEY ("issue_id","related_issue_id")
);

-- CreateTable
CREATE TABLE "issue_participants" (
    "issue_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_participants_pkey" PRIMARY KEY ("issue_id","user_id")
);

-- CreateTable
CREATE TABLE "issue_custom_field_values" (
    "issue_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "custom_field_id" INTEGER NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "issue_custom_field_values_pkey" PRIMARY KEY ("issue_id","custom_field_id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "type" "ActivityType" NOT NULL,
    "issue_id" INTEGER,
    "wiki_page_id" INTEGER,
    "pull_request_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "content" TEXT,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_notified_users" (
    "activity_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "activity_notified_users_pkey" PRIMARY KEY ("activity_id","user_id")
);

-- CreateTable
CREATE TABLE "stars" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "issue_id" INTEGER,
    "activity_id" INTEGER,
    "wiki_page_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "note" TEXT,
    "last_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "activity_id" INTEGER NOT NULL,
    "reason" "NotificationReason" NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_pages" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_revisions" (
    "id" SERIAL NOT NULL,
    "wiki_page_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_tags" (
    "wiki_page_id" INTEGER NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "wiki_tags_pkey" PRIMARY KEY ("wiki_page_id","tag")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_attachments" (
    "issue_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,

    CONSTRAINT "issue_attachments_pkey" PRIMARY KEY ("issue_id","attachment_id")
);

-- CreateTable
CREATE TABLE "wiki_attachments" (
    "wiki_page_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,

    CONSTRAINT "wiki_attachments_pkey" PRIMARY KEY ("wiki_page_id","attachment_id")
);

-- CreateTable
CREATE TABLE "comment_attachments" (
    "activity_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,

    CONSTRAINT "comment_attachments_pkey" PRIMARY KEY ("activity_id","attachment_id")
);

-- CreateTable
CREATE TABLE "shared_files" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "dir" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_shared_files" (
    "issue_id" INTEGER NOT NULL,
    "shared_file_id" INTEGER NOT NULL,

    CONSTRAINT "issue_shared_files_pkey" PRIMARY KEY ("issue_id","shared_file_id")
);

-- CreateTable
CREATE TABLE "wiki_shared_files" (
    "wiki_page_id" INTEGER NOT NULL,
    "shared_file_id" INTEGER NOT NULL,

    CONSTRAINT "wiki_shared_files_pkey" PRIMARY KEY ("wiki_page_id","shared_file_id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "gitea_repo_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "link_commits_to_issues" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commit_issue_links" (
    "id" SERIAL NOT NULL,
    "repository_id" INTEGER NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commit_issue_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" SERIAL NOT NULL,
    "repository_id" INTEGER NOT NULL,
    "gitea_pr_number" INTEGER NOT NULL,
    "issue_id" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "base_branch" TEXT NOT NULL,
    "head_branch" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "project_id" INTEGER,
    "name" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "hook_url" TEXT NOT NULL,
    "description" TEXT,
    "activity_types" "ActivityType"[],
    "all_event" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "detail" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recently_viewed_issues" (
    "user_id" INTEGER NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_issues_pkey" PRIMARY KEY ("user_id","issue_id")
);

-- CreateTable
CREATE TABLE "recently_viewed_projects" (
    "user_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_projects_pkey" PRIMARY KEY ("user_id","project_id")
);

-- CreateTable
CREATE TABLE "recently_viewed_wikis" (
    "user_id" INTEGER NOT NULL,
    "wiki_page_id" INTEGER NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_wikis_pkey" PRIMARY KEY ("user_id","wiki_page_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_user_id_key" ON "users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_disabled_at_idx" ON "users"("disabled_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "projects_key_key" ON "projects"("key");

-- CreateIndex
CREATE INDEX "projects_archived_idx" ON "projects"("archived");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE INDEX "custom_field_items_project_id_custom_field_id_idx" ON "custom_field_items"("project_id", "custom_field_id");

-- CreateIndex
CREATE INDEX "issues_project_id_status_id_assignee_id_idx" ON "issues"("project_id", "status_id", "assignee_id");

-- CreateIndex
CREATE INDEX "issues_assignee_id_due_date_idx" ON "issues"("assignee_id", "due_date");

-- CreateIndex
CREATE INDEX "issues_project_id_updated_at_idx" ON "issues"("project_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "issues_parent_issue_id_idx" ON "issues"("parent_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "issues_project_id_key_id_key" ON "issues"("project_id", "key_id");

-- CreateIndex
CREATE INDEX "activities_issue_id_created_at_idx" ON "activities"("issue_id", "created_at");

-- CreateIndex
CREATE INDEX "activities_project_id_created_at_idx" ON "activities"("project_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stars_user_id_issue_id_key" ON "stars"("user_id", "issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "stars_user_id_activity_id_key" ON "stars"("user_id", "activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "stars_user_id_wiki_page_id_key" ON "stars"("user_id", "wiki_page_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchings_user_id_issue_id_key" ON "watchings"("user_id", "issue_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_activity_id_key" ON "notifications"("user_id", "activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_pages_project_id_name_key" ON "wiki_pages"("project_id", "name");

-- CreateIndex
CREATE INDEX "wiki_revisions_wiki_page_id_created_at_idx" ON "wiki_revisions"("wiki_page_id", "created_at");

-- CreateIndex
CREATE INDEX "wiki_tags_tag_idx" ON "wiki_tags"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "shared_files_project_id_dir_name_key" ON "shared_files"("project_id", "dir", "name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_project_id_name_key" ON "repositories"("project_id", "name");

-- CreateIndex
CREATE INDEX "commit_issue_links_issue_id_idx" ON "commit_issue_links"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "commit_issue_links_repository_id_commit_sha_issue_id_key" ON "commit_issue_links"("repository_id", "commit_sha", "issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repository_id_gitea_pr_number_key" ON "pull_requests"("repository_id", "gitea_pr_number");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "recently_viewed_issues_user_id_viewed_at_idx" ON "recently_viewed_issues"("user_id", "viewed_at" DESC);

-- CreateIndex
CREATE INDEX "recently_viewed_projects_user_id_viewed_at_idx" ON "recently_viewed_projects"("user_id", "viewed_at" DESC);

-- CreateIndex
CREATE INDEX "recently_viewed_wikis_user_id_viewed_at_idx" ON "recently_viewed_wikis"("user_id", "viewed_at" DESC);

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_types" ADD CONSTRAINT "issue_types_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versions" ADD CONSTRAINT "versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_items" ADD CONSTRAINT "custom_field_items_project_id_custom_field_id_fkey" FOREIGN KEY ("project_id", "custom_field_id") REFERENCES "custom_fields"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_issue_type_id_fkey" FOREIGN KEY ("project_id", "issue_type_id") REFERENCES "issue_types"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_status_id_fkey" FOREIGN KEY ("project_id", "status_id") REFERENCES "statuses"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_issue_id_fkey" FOREIGN KEY ("parent_issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_categories" ADD CONSTRAINT "issue_categories_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_categories" ADD CONSTRAINT "issue_categories_project_id_category_id_fkey" FOREIGN KEY ("project_id", "category_id") REFERENCES "categories"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_milestones" ADD CONSTRAINT "issue_milestones_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_milestones" ADD CONSTRAINT "issue_milestones_project_id_version_id_fkey" FOREIGN KEY ("project_id", "version_id") REFERENCES "versions"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_versions" ADD CONSTRAINT "issue_versions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_versions" ADD CONSTRAINT "issue_versions_project_id_version_id_fkey" FOREIGN KEY ("project_id", "version_id") REFERENCES "versions"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_related_issue_id_fkey" FOREIGN KEY ("related_issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_participants" ADD CONSTRAINT "issue_participants_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_participants" ADD CONSTRAINT "issue_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_custom_field_values" ADD CONSTRAINT "issue_custom_field_values_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_custom_field_values" ADD CONSTRAINT "issue_custom_field_values_project_id_custom_field_id_fkey" FOREIGN KEY ("project_id", "custom_field_id") REFERENCES "custom_fields"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_notified_users" ADD CONSTRAINT "activity_notified_users_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_notified_users" ADD CONSTRAINT "activity_notified_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars" ADD CONSTRAINT "stars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars" ADD CONSTRAINT "stars_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars" ADD CONSTRAINT "stars_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stars" ADD CONSTRAINT "stars_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchings" ADD CONSTRAINT "watchings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchings" ADD CONSTRAINT "watchings_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_tags" ADD CONSTRAINT "wiki_tags_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_attachments" ADD CONSTRAINT "issue_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_attachments" ADD CONSTRAINT "wiki_attachments_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_attachments" ADD CONSTRAINT "wiki_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_files" ADD CONSTRAINT "shared_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_shared_files" ADD CONSTRAINT "issue_shared_files_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_shared_files" ADD CONSTRAINT "issue_shared_files_shared_file_id_fkey" FOREIGN KEY ("shared_file_id") REFERENCES "shared_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_shared_files" ADD CONSTRAINT "wiki_shared_files_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_shared_files" ADD CONSTRAINT "wiki_shared_files_shared_file_id_fkey" FOREIGN KEY ("shared_file_id") REFERENCES "shared_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commit_issue_links" ADD CONSTRAINT "commit_issue_links_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commit_issue_links" ADD CONSTRAINT "commit_issue_links_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_issues" ADD CONSTRAINT "recently_viewed_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_issues" ADD CONSTRAINT "recently_viewed_issues_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_projects" ADD CONSTRAINT "recently_viewed_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_projects" ADD CONSTRAINT "recently_viewed_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_wikis" ADD CONSTRAINT "recently_viewed_wikis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_wikis" ADD CONSTRAINT "recently_viewed_wikis_wiki_page_id_fkey" FOREIGN KEY ("wiki_page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Prisma では表現できない制約を手書きで足す
-- （スキーマ変更は必ずマイグレーションとして残す。db push で済ませない）
-- ---------------------------------------------------------------------------

-- 優先度はスペース共通の定数。2=高 / 3=中 / 4=低。1は欠番
-- (docs/00-spec-verified.md 1章)。テーブルを作らないので CHECK で縛る
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_priority_id_check"
  CHECK ("priority_id" IN (2, 3, 4));

-- 完了理由もスペース共通の定数。0..4 で、0始まりである点に注意
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_resolution_id_check"
  CHECK ("resolution_id" IS NULL OR "resolution_id" BETWEEN 0 AND 4);

-- 親子課題は1階層のみ。自分自身を親にできない
-- (「親を持つ課題は親になれない」はアプリ側でバリデートする)
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_parent_not_self_check"
  CHECK ("parent_issue_id" IS NULL OR "parent_issue_id" <> "id");

-- 関連課題は対等なリンク。自分自身とは繋げない
ALTER TABLE "issue_relations"
  ADD CONSTRAINT "issue_relations_not_self_check"
  CHECK ("issue_id" <> "related_issue_id");

-- activities は issue / wiki_page / pull_request の「どれか1つだけ」を指す。
-- Prisma に排他制約は書けないのでここで縛る。
-- どれも NULL のケース(プロジェクト全体の活動)は許す
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_target_exclusive_check"
  CHECK (
    (CASE WHEN "issue_id"        IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "wiki_page_id"    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "pull_request_id" IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

-- スターも対象は1つだけ。かつ何も指さないスターは無い
ALTER TABLE "stars"
  ADD CONSTRAINT "stars_target_exactly_one_check"
  CHECK (
    (CASE WHEN "issue_id"     IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "activity_id"  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "wiki_page_id" IS NOT NULL THEN 1 ELSE 0 END)
    = 1
  );

-- プロジェクトキーの文字種。決定 D1(本家の制約は未確認)
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_key_format_check"
  CHECK ("key" ~ '^[A-Z][A-Z0-9_]{0,9}$');

-- keyId は1始まり。欠番は許容するが0や負数は入らない
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_key_id_positive_check"
  CHECK ("key_id" >= 1);

-- プロジェクト単位マスタの id も1始まり(決定 D6)
ALTER TABLE "statuses"      ADD CONSTRAINT "statuses_id_positive_check"      CHECK ("id" >= 1);
ALTER TABLE "issue_types"   ADD CONSTRAINT "issue_types_id_positive_check"   CHECK ("id" >= 1);
ALTER TABLE "categories"    ADD CONSTRAINT "categories_id_positive_check"    CHECK ("id" >= 1);
ALTER TABLE "versions"      ADD CONSTRAINT "versions_id_positive_check"      CHECK ("id" >= 1);
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_id_positive_check" CHECK ("id" >= 1);

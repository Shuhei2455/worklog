-- チームを本家のレスポンスの形に合わせる（00-spec-verified.md 11.2）。
--
-- display_order は本家が null を返しうるので nullable。
-- created_by / updated_by も nullable にしてあるのは、
-- 既存の行（無いが）やシードで作るチームに作成者が無い場合を許すため。
--
-- name の一意制約は、チームが0件の状態で追加している。
-- 同名のチームは運用上も区別できないので弾く。
ALTER TABLE "teams" ADD COLUMN "display_order" INTEGER;
ALTER TABLE "teams" ADD COLUMN "created_by" INTEGER;
ALTER TABLE "teams" ADD COLUMN "updated_by" INTEGER;

CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

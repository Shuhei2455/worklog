-- カスタム属性の機能を廃止する（2026-09-23、ユーザーの判断）。
--
-- **入力済みの値ごと消える。** 復旧手段は無い。
-- 実行時点でデモデータに 属性4件 / 選択肢3件 / 値3件 があった。
--
-- 依存の向きは value -> field/item なので、子から順に落とす。

DROP TABLE IF EXISTS "issue_custom_field_values";
DROP TABLE IF EXISTS "custom_field_items";
DROP TABLE IF EXISTS "custom_fields";

DROP TYPE IF EXISTS "CustomFieldType";

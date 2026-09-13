import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * 監査ログ。
 *
 * **本家には API も記録項目の公開も無い**（00-spec-verified.md 11.3。
 * Nulab Pass の機能で、ヘルプも機械的に取得できない）。合わせる対象が
 * 無いので、職場で実際に聞かれること——「誰がいつ何を消したか」——に
 * 必要な最小限を独自に決めた（決定 D25）。
 *
 * 活動履歴（activities）との違い:
 *   activities  = 課題やWikiの**中身の変化**。利用者に見せるもの
 *   audit_logs  = **管理操作**。権限の変更・削除・APIキーの発行など。
 *                 管理者だけが見る
 *
 * 活動履歴に混ぜない理由は、課題の画面に「ユーザーを無効化した」が
 * 並ぶのがおかしいため。消えたものを追う用途でも、
 * カスケード削除で消えない別テーブルに置く必要がある。
 */

/**
 * 記録する操作。
 *
 * 文字列の自由入力にすると表記が揺れて後から集計できないので、
 * ここに挙げたものだけを使う。
 */
export const AUDIT_ACTIONS = {
  // ユーザーとスペース
  "user.create": "ユーザーを追加",
  "user.update": "ユーザーを変更",
  "user.disable": "ユーザーを無効化",
  "user.enable": "ユーザーを有効化",
  "user.password": "パスワードを変更",
  "apiToken.create": "APIキーを発行",
  "apiToken.revoke": "APIキーを失効",
  // プロジェクト
  "project.create": "プロジェクトを作成",
  "project.update": "プロジェクトの設定を変更",
  "project.member.add": "参加ユーザーを追加",
  "project.member.remove": "参加ユーザーを削除",
  "project.admin.grant": "プロジェクト管理者を付与",
  "project.admin.revoke": "プロジェクト管理者を解除",
  // 消えるもの
  "issue.delete": "課題を削除",
  "wiki.delete": "Wikiを削除",
  "sharedFile.delete": "共有ファイルを削除",
  "customField.delete": "カスタム属性を削除",
  "status.delete": "状態を削除",
  // チーム
  "team.create": "チームを作成",
  "team.update": "チームを変更",
  "team.delete": "チームを削除",
  // Git
  "repository.create": "リポジトリを作成",
  "repository.detach": "リポジトリの登録を解除",
  // 取り込み
  "issue.import": "CSVから課題を取り込み",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditInput = {
  action: AuditAction;
  /** 対象の種類。"issue" "user" "project" など */
  targetType: string;
  /** 対象の識別子。**消えるものは名前も detail に残す** */
  targetId?: string | number | null;
  /** 後から読んで分かるだけの情報。消えた対象の名前などを入れる */
  detail?: Prisma.InputJsonValue;
};

/**
 * 記録する。
 *
 * **失敗しても本体の操作は止めない。** 監査ログが書けないことを理由に
 * ユーザーの操作を失敗させると、運用が止まる。書けなかったことはログに出す。
 */
export async function audit(actorId: number | null, input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId == null ? null : String(input.targetId),
        detail: input.detail,
        ipAddress: await clientIp(),
      },
    });
  } catch (e) {
    console.error("[audit] 記録に失敗:", input.action, e);
  }
}

/**
 * クライアントのIPアドレス。
 *
 * Caddy の後ろにいるので `X-Forwarded-For` の**先頭**を見る。
 * 信頼できるのは自前のプロキシが付ける値だけなので、
 * 複数入っている場合は最初のものを採る。
 */
async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    return h.get("x-real-ip");
  } catch {
    // リクエストの外（バッチなど）から呼ばれた場合
    return null;
  }
}

/** 画面に出す日本語。知らない操作はそのまま出す（落とさない） */
export function auditLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
}

/**
 * リポジトリまわりの定数と純関数。
 *
 * "use server" のファイルには定数を置けないので分けてある（CLAUDE.md）。
 */

/**
 * リポジトリ名に許す形。
 *
 * Gitea 側の制約に合わせてある（英数字・ハイフン・アンダースコア・ドット）。
 * 先頭のドットを許さないのは `.git` のような名前を避けるため。
 */
export const REPO_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

/** クローンURL（HTTP）。GITEA_DOMAIN ではなく APP_URL 配下の /git を使う */
export function httpCloneUrl(org: string, name: string): string {
  return `${process.env.APP_URL ?? ""}/git/${org}/${name}.git`;
}

/**
 * Git over SSH を使える環境かどうか。
 *
 * 職場のVMは **2222番が塞がれている**ため `false` で運用する
 * （2026-09-14 にユーザーが確認。`docker-compose.prod.yml` でも
 * Gitea の `DISABLE_SSH=true` にしてある）。
 *
 * **使えないSSHのURLを画面に出さないため**に見る。
 * 出してしまうと、利用者がそれをコピーして延々つながらない所で悩む。
 */
export function isSshEnabled(): boolean {
  // 既定は無効。「設定を忘れたら出ない」側に倒す。
  // 出るべきものが出ないのはすぐ気づくが、出てはいけないものが出るのは気づかれない
  return process.env.GIT_SSH_ENABLED === "true";
}

/**
 * クローンURL（SSH）。ポートが既定の22でなければ ssh:// 形式になる。
 *
 * SSH を使えない環境では `null` を返す。呼び出し側はその行を出さない。
 */
export function sshCloneUrl(org: string, name: string): string | null {
  if (!isSshEnabled()) return null;
  const host = process.env.GITEA_DOMAIN ?? "localhost";
  const port = process.env.GITEA_SSH_PORT ?? "22";
  return port === "22"
    ? `git@${host}:${org}/${name}.git`
    : `ssh://git@${host}:${port}/${org}/${name}.git`;
}

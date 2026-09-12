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

/** クローンURL（SSH）。ポートが既定の22でなければ ssh:// 形式になる */
export function sshCloneUrl(org: string, name: string): string {
  const host = process.env.GITEA_DOMAIN ?? "localhost";
  const port = process.env.GITEA_SSH_PORT ?? "22";
  return port === "22"
    ? `git@${host}:${org}/${name}.git`
    : `ssh://git@${host}:${port}/${org}/${name}.git`;
}

/**
 * メンション記法の解析と表示。
 *
 * 記法は `@ユーザー名` ではない(docs/00-spec-verified.md 3.1)。
 * 出典: https://developer.nulab.com/docs/backlog/tips#mention-users-in-text
 *
 *   <@U{id}>   ユーザー
 *   <@T{id}>   チーム
 *   <@project> プロジェクトの全メンバー
 *
 * 本文には記法のまま保存し、**表示側で名前に解決する**。
 * 名前を埋め込む方式だと、ユーザー名を変えたときに追随できない。
 */

export type Mention =
  | { kind: "user"; id: number }
  | { kind: "team"; id: number }
  | { kind: "project" };

/** `<@U5>` `<@T3>` `<@project>` を拾う */
const MENTION_RE = /<@(?:U(\d+)|T(\d+)|project)>/g;

/** 本文からメンションを抜き出す。重複は取り除く */
export function parseMentions(text: string | null | undefined): Mention[] {
  if (!text) return [];
  const out: Mention[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(MENTION_RE)) {
    let mention: Mention;
    if (m[1] !== undefined) mention = { kind: "user", id: Number(m[1]) };
    else if (m[2] !== undefined) mention = { kind: "team", id: Number(m[2]) };
    else mention = { kind: "project" };

    const key =
      mention.kind === "project" ? "project" : `${mention.kind}:${mention.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mention);
  }
  return out;
}

/**
 * メンションから、実際に通知すべきユーザーIDの集合を返す。
 *
 * 本家の挙動(3.1):
 * - プロジェクトのメンバーでないユーザーは通知されない
 * - 存在しないIDはメンションとして扱われず、通知も飛ばない
 */
export function resolveMentionTargets(
  mentions: Mention[],
  ctx: {
    /** そのプロジェクトの参加ユーザーID */
    memberIds: number[];
    /** チームID → そのチームに属するユーザーID */
    teamMembers: Map<number, number[]>;
  },
): number[] {
  const members = new Set(ctx.memberIds);
  const out = new Set<number>();

  for (const m of mentions) {
    if (m.kind === "project") {
      for (const id of ctx.memberIds) out.add(id);
    } else if (m.kind === "user") {
      // 存在しない・参加していないユーザーは無視する
      if (members.has(m.id)) out.add(m.id);
    } else {
      for (const id of ctx.teamMembers.get(m.id) ?? []) {
        if (members.has(id)) out.add(id);
      }
    }
  }
  return [...out];
}

/**
 * 表示用に名前へ置き換える。
 *
 * 解決できないIDは記法のまま残す。消してしまうと、
 * 誰に向けた文だったのかが読めなくなる。
 */
export function renderMentions(
  text: string,
  names: { users: Map<number, string>; teams: Map<number, string> },
): string {
  return text.replace(MENTION_RE, (whole, u, t) => {
    if (u !== undefined) {
      const name = names.users.get(Number(u));
      return name ? `@${name}` : whole;
    }
    if (t !== undefined) {
      const name = names.teams.get(Number(t));
      return name ? `@${name}` : whole;
    }
    return "@プロジェクト全員";
  });
}

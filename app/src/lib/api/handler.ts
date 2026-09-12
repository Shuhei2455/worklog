import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorBody } from "./errors";
import { extractApiKey, hashApiToken } from "./token";
import { consumeRate, rateKindFor } from "./rate-limit";
import type { ActorUser } from "@/lib/permissions";

/**
 * API v2 の共通の入口。
 *
 * **すべてのルートがここを通る。** 認証・レート制限・エラー整形を
 * 一箇所に集めておかないと、ルートごとに抜けが出る。
 */

export type ApiContext = {
  user: ActorUser & { userId: string; name: string; email: string; lang: string | null };
  /** 参加しているプロジェクトのID。一覧に必ず注入する */
  visibleProjectIds: number[];
};

async function authenticate(req: Request): Promise<ApiContext["user"]> {
  const raw = extractApiKey(req);
  if (!raw) throw ApiError.unauthorized("API key is required.");

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: { user: true },
  });
  if (!token || token.revokedAt) throw ApiError.unauthorized();
  if (token.user.disabledAt) throw ApiError.unauthorized();

  // 最終利用日時は記録するが、失敗しても本体は止めない
  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const u = token.user;
  return {
    id: u.id,
    userId: u.userId,
    name: u.name,
    email: u.email,
    lang: u.lang,
    userType: u.userType,
    restriction: u.restriction,
    disabledAt: u.disabledAt,
  };
}

/**
 * ルートをこれで包む。
 *
 * 使い方:
 *   export const GET = apiRoute(async (req, ctx) => ({ ...body }));
 */
export function apiRoute<P extends Record<string, string> = Record<string, never>>(
  fn: (req: Request, ctx: ApiContext, params: P) => Promise<unknown>,
) {
  // Next.js 15 のルートハンドラは第2引数を必ず受け取る形を要求する。
  // 省略可能(`route?`)にすると本番ビルドの型チェックで落ちる
  // （dev では通ってしまうので気づきにくい）。
  return async (
    req: Request,
    route: { params: Promise<P> },
  ): Promise<NextResponse> => {
    let rateHeaders: Record<string, string> = {};
    try {
      const user = await authenticate(req);

      // レート制限は本家と同じく4種類に分けて、ユーザー単位で数える
      const url = new URL(req.url);
      const kind = rateKindFor(req.method, url.pathname);
      const rate = await consumeRate(user.id, kind);
      rateHeaders = {
        "X-RateLimit-Limit": String(rate.limit),
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.reset),
      };
      if (!rate.allowed) throw ApiError.tooManyRequests();

      const members = await prisma.projectMember.findMany({
        where: { userId: user.id },
        select: { projectId: true },
      });

      const params = ((await route?.params) ?? ({} as P)) as P;
      const body = await fn(req, {
        user,
        visibleProjectIds: members.map((m) => m.projectId),
      }, params);

      return NextResponse.json(body ?? {}, { headers: rateHeaders });
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json(errorBody(e), {
          status: e.status,
          headers: rateHeaders,
        });
      }
      // 想定外はログに残して 500 で返す。詳細は外に出さない
      console.error("[api] unexpected error:", e);
      return NextResponse.json(
        errorBody(
          new ApiError(500, 1, "Internal server error."),
        ),
        { status: 500, headers: rateHeaders },
      );
    }
  };
}

/** プロジェクトを id かキーで引く。本家の :projectIdOrKey に合わせる */
export async function findProject(idOrKey: string, ctx: ApiContext) {
  const asNumber = Number(idOrKey);
  const project = Number.isInteger(asNumber)
    ? await prisma.project.findUnique({ where: { id: asNumber } })
    : await prisma.project.findUnique({ where: { key: idOrKey.toUpperCase() } });

  if (!project) throw ApiError.notFound("project");
  // 参加していないプロジェクトは、管理者でも見えない
  if (!ctx.visibleProjectIds.includes(project.id)) throw ApiError.notFound("project");
  return project;
}

/** 課題を id か課題キーで引く。本家の :issueIdOrKey に合わせる */
export async function findIssue(idOrKey: string, ctx: ApiContext) {
  const asNumber = Number(idOrKey);
  const issue = Number.isInteger(asNumber)
    ? await prisma.issue.findUnique({ where: { id: asNumber } })
    : await (async () => {
        const m = /^([A-Z][A-Z0-9_]*)-(\d+)$/.exec(idOrKey.toUpperCase());
        if (!m) return null;
        const p = await prisma.project.findUnique({ where: { key: m[1] } });
        if (!p) return null;
        return prisma.issue.findUnique({
          where: { projectId_keyId: { projectId: p.id, keyId: Number(m[2]) } },
        });
      })();

  if (!issue) throw ApiError.notFound("issue");
  if (!ctx.visibleProjectIds.includes(issue.projectId)) throw ApiError.notFound("issue");
  return issue;
}

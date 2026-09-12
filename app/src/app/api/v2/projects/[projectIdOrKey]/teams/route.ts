import { apiRoute, findProject } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { serializeTeam } from "@/lib/api/serialize-team";
import { can } from "@/lib/permissions";
import { projectContext } from "@/lib/session";

/**
 * GET/POST/DELETE /api/v2/projects/:projectIdOrKey/teams
 * 00-spec-verified.md 11.2
 */
const include = {
  members: { include: { user: true } },
  createdBy: true,
  updatedBy: true,
} as const;

export const GET = apiRoute<{ projectIdOrKey: string }>(async (_req, ctx, params) => {
  const project = await findProject(params.projectIdOrKey, ctx);
  const rows = await prisma.projectTeam.findMany({
    where: { projectId: project.id },
    include: { team: { include } },
  });
  return rows.map((r) => serializeTeam(r.team));
});

/** teamId を body か query で受ける。本家のパラメータ名に合わせる */
async function teamIdFrom(req: Request): Promise<number> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("teamId");
  if (fromQuery) return Number(fromQuery);

  const text = await req.text().catch(() => "");
  const body = new URLSearchParams(text);
  const id = Number(body.get("teamId"));
  if (!Number.isInteger(id)) throw ApiError.invalid("teamId is required.");
  return id;
}

export const POST = apiRoute<{ projectIdOrKey: string }>(async (req, ctx, params) => {
  const project = await findProject(params.projectIdOrKey, ctx);
  await assertProjectEdit(ctx, project.id);

  const teamId = await teamIdFrom(req);
  const team = await prisma.team.findUnique({ where: { id: teamId }, include });
  if (!team) throw ApiError.notFound("team");

  await prisma.projectTeam.upsert({
    where: { projectId_teamId: { projectId: project.id, teamId } },
    update: {},
    create: { projectId: project.id, teamId },
  });
  return serializeTeam(team);
});

export const DELETE = apiRoute<{ projectIdOrKey: string }>(async (req, ctx, params) => {
  const project = await findProject(params.projectIdOrKey, ctx);
  await assertProjectEdit(ctx, project.id);

  const teamId = await teamIdFrom(req);
  const team = await prisma.team.findUnique({ where: { id: teamId }, include });
  if (!team) throw ApiError.notFound("team");

  await prisma.projectTeam.deleteMany({ where: { projectId: project.id, teamId } });
  return serializeTeam(team);
});

/** 割り当ての変更はプロジェクトの設定変更にあたる */
async function assertProjectEdit(
  ctx: { user: { id: number } & Record<string, unknown> },
  projectId: number,
) {
  const resource = await projectContext(projectId, ctx.user.id);
  if (!can(ctx.user as never, "project.edit", resource)) {
    throw ApiError.denied();
  }
}

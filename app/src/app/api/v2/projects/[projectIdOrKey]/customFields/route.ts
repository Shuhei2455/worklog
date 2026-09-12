import { apiRoute, findProject } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { CUSTOM_FIELD_TYPE_ID } from "@/lib/custom-field";

/**
 * GET /api/v2/projects/:projectIdOrKey/customFields
 * 00-spec-verified.md 11.1 で確認した形に合わせる。
 */
export const GET = apiRoute<{ projectIdOrKey: string }>(async (_req, ctx, params) => {
  const project = await findProject(params.projectIdOrKey, ctx);

  const fields = await prisma.customField.findMany({
    where: { projectId: project.id },
    include: { items: { orderBy: { displayOrder: "asc" } } },
    orderBy: { displayOrder: "asc" },
  });

  return fields.map((f) => {
    const settings = (f.settings ?? {}) as Record<string, unknown>;
    return {
      id: f.id,
      projectId: f.projectId,
      typeId: CUSTOM_FIELD_TYPE_ID[f.typeId],
      name: f.name,
      description: f.description ?? "",
      required: f.required,
      applicableIssueTypes: f.applicableIssueTypes,
      allowAddItem: Boolean(settings.allowAddItem),
      items: f.items.map((i) => ({
        id: i.id,
        name: i.name,
        displayOrder: i.displayOrder,
      })),
    };
  });
});

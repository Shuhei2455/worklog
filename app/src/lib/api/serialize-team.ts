import { serializeUser } from "./serialize";
import { toRoleType } from "@/lib/permissions";

/**
 * チームを本家の形に整える（00-spec-verified.md 11.2）。
 *
 * `displayOrder` は本家が null を返しうるのでそのまま通す。
 */
type UserRow = {
  id: number;
  userId: string;
  name: string;
  email: string;
  userType: "admin" | "member" | "guest";
  restriction: "none" | "issue_create_only" | "issue_view_only";
  lang: string | null;
};

export function serializeTeam(t: {
  id: number;
  name: string;
  displayOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: UserRow | null;
  updatedBy?: UserRow | null;
  members: Array<{ user: UserRow }>;
}) {
  const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    id: t.id,
    name: t.name,
    members: t.members.map((m) => serializeUser(m.user)),
    displayOrder: t.displayOrder,
    createdUser: t.createdBy ? serializeUser(t.createdBy) : null,
    created: stamp(t.createdAt),
    updatedUser: t.updatedBy ? serializeUser(t.updatedBy) : null,
    updated: stamp(t.updatedAt),
  };
}

/** roleType の写像が serializeUser と揃っていることを型で示す */
export const _roleType = toRoleType;

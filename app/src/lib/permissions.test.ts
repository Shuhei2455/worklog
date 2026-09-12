import { describe, it, expect } from "vitest";
import {
  can,
  toRoleType,
  type Action,
  type ActorUser,
  type Restriction,
  type UserType,
} from "./permissions";

/**
 * docs/00-spec-verified.md 7.1 の権限マトリクスをそのまま検証する。
 *
 * 表を目で読んで実装したものを目で確認しても意味がないので、
 * 表の形のままデータに起こして機械的に突き合わせる。
 * 本家の表が更新されたらこの配列を直せば、実装の漏れがそのまま落ちる。
 */

const actor = (
  userType: UserType,
  restriction: Restriction = "none",
): ActorUser => ({ id: 1, userType, restriction });

/** 参加済みプロジェクト。プロジェクト管理者フラグは個別に指定する */
const inProject = (isProjectAdmin = false) => ({
  projectId: 1,
  isMember: true,
  isProjectAdmin,
});

describe("各機能に関する権限（7.1のマトリクス）", () => {
  // 列の並び: 管理者 / PJ管理者 / 一般(なし/登録/閲覧) / ゲスト(なし/登録/閲覧)
  const columns: Array<[string, ActorUser, boolean]> = [
    ["管理者", actor("admin"), false],
    ["PJ管理者", actor("member"), true],
    ["一般:制限なし", actor("member", "none"), false],
    ["一般:登録のみ", actor("member", "issue_create_only"), false],
    ["一般:閲覧のみ", actor("member", "issue_view_only"), false],
    ["ゲスト:制限なし", actor("guest", "none"), false],
    ["ゲスト:登録のみ", actor("guest", "issue_create_only"), false],
    ["ゲスト:閲覧のみ", actor("guest", "issue_view_only"), false],
  ];

  // ○=true ×=false。表の行をそのまま写す
  const matrix: Array<[Action, boolean[]]> = [
    ["issue.view", [true, true, true, true, true, true, true, true]],
    ["issue.create", [true, true, true, true, false, true, true, false]],
    ["issue.edit", [true, true, true, false, false, true, false, false]],
    ["issue.delete", [true, true, false, false, false, false, false, false]],
    ["comment.manage", [true, true, true, true, false, true, true, false]],
    ["issueAttachment.add", [true, true, true, true, false, true, true, false]],
    ["issueAttachment.delete", [true, true, true, false, false, true, false, false]],
    ["wiki.view", [true, true, true, true, true, true, true, true]],
    ["wiki.edit", [true, true, true, false, false, true, false, false]],
    ["sharedFile.access", [true, true, true, false, false, true, false, false]],
    ["git.access", [true, true, true, false, false, true, false, false]],
    ["personalSettings.edit", [true, true, true, true, true, true, true, true]],
  ];

  for (const [action, expected] of matrix) {
    columns.forEach(([label, user, isProjectAdmin], i) => {
      it(`${action} / ${label} → ${expected[i] ? "○" : "×"}`, () => {
        expect(can(user, action, inProject(isProjectAdmin))).toBe(expected[i]);
      });
    });
  }
});

describe("プロジェクトに関する権限（7.1のマトリクス）", () => {
  const columns: Array<[string, ActorUser, boolean]> = [
    ["管理者", actor("admin"), false],
    ["PJ管理者", actor("member"), true],
    ["制限なし", actor("member", "none"), false],
    ["登録のみ", actor("member", "issue_create_only"), false],
    ["閲覧のみ", actor("member", "issue_view_only"), false],
  ];

  const matrix: Array<[Action, boolean[]]> = [
    ["project.edit", [true, true, false, false, false]],
    // 種別・カテゴリー・バージョンは「制限なし」の一般ユーザーでも編集できる。
    // プロジェクト管理者だけの機能ではない点がまぎらわしい
    ["issueType.manage", [true, true, true, false, false]],
    ["category.manage", [true, true, true, false, false]],
    ["version.manage", [true, true, true, false, false]],
  ];

  for (const [action, expected] of matrix) {
    columns.forEach(([label, user, isProjectAdmin], i) => {
      it(`${action} / ${label} → ${expected[i] ? "○" : "×"}`, () => {
        expect(can(user, action, inProject(isProjectAdmin))).toBe(expected[i]);
      });
    });
  }
});

describe("スペース全体に関する権限（7.1のマトリクス）", () => {
  const spaceActions: Action[] = [
    "space.edit",
    "project.create",
    "project.delete",
  ];

  for (const action of spaceActions) {
    it(`${action} は管理者だけ`, () => {
      expect(can(actor("admin"), action)).toBe(true);
      expect(can(actor("member", "none"), action)).toBe(false);
      expect(can(actor("guest", "none"), action)).toBe(false);
    });
  }
});

describe("参加していないプロジェクトは管理者でも見られない", () => {
  // 本家の明記された挙動で、実装で最も忘れやすい点。
  // v1設計ではここが抜けていた
  const notMember = { projectId: 1, isMember: false };

  it("管理者でも課題を閲覧できない", () => {
    expect(can(actor("admin"), "issue.view", notMember)).toBe(false);
  });

  it("管理者でもWikiを閲覧できない", () => {
    expect(can(actor("admin"), "wiki.view", notMember)).toBe(false);
  });

  it("参加していれば見られる", () => {
    expect(can(actor("admin"), "issue.view", inProject())).toBe(true);
  });
});

describe("ゲストはプロジェクト管理者になれない", () => {
  // 本家の明記された制約。フラグが立っていても昇格させない
  it("フラグが立っていても課題を削除できない", () => {
    expect(can(actor("guest", "none"), "issue.delete", inProject(true))).toBe(false);
  });

  it("フラグが立っていてもプロジェクトを編集できない", () => {
    expect(can(actor("guest", "none"), "project.edit", inProject(true))).toBe(false);
  });

  it("一般ユーザーなら同じフラグで削除できる", () => {
    expect(can(actor("member", "none"), "issue.delete", inProject(true))).toBe(true);
  });
});

describe("無効化されたユーザー", () => {
  it("管理者でも何もできない", () => {
    const disabled: ActorUser = {
      id: 1,
      userType: "admin",
      restriction: "none",
      disabledAt: new Date(),
    };
    expect(can(disabled, "issue.view", inProject())).toBe(false);
    expect(can(disabled, "personalSettings.edit")).toBe(false);
  });
});

describe("プロジェクトを特定できない場合", () => {
  it("プロジェクト権限は判定できないので拒否する", () => {
    expect(can(actor("admin"), "issue.view", {})).toBe(false);
  });
});

describe("本家APIの roleType への写像", () => {
  // roleType は「種別 × 制限」を潰したもので、ゲストを区別しない
  it("管理者は1", () => {
    expect(toRoleType({ userType: "admin", restriction: "none" })).toBe(1);
  });

  it("制限なしは、一般もゲストも2", () => {
    expect(toRoleType({ userType: "member", restriction: "none" })).toBe(2);
    expect(toRoleType({ userType: "guest", restriction: "none" })).toBe(2);
  });

  it("課題の登録のみは3", () => {
    expect(toRoleType({ userType: "member", restriction: "issue_create_only" })).toBe(3);
    expect(toRoleType({ userType: "guest", restriction: "issue_create_only" })).toBe(3);
  });

  it("課題の閲覧のみは4", () => {
    expect(toRoleType({ userType: "member", restriction: "issue_view_only" })).toBe(4);
    expect(toRoleType({ userType: "guest", restriction: "issue_view_only" })).toBe(4);
  });
});

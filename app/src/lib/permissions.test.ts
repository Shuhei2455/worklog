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
    // 決定 D31: 一般:制限なし も削除できる（本家は × ）。ゲストは × のまま
    ["issue.delete", [true, true, true, false, false, false, false, false]],
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
  // project.create は決定 D31 で一般にも開放したので、このループからは外し
  // 下に専用のテストを置く
  const spaceActions: Action[] = ["space.edit", "project.delete"];

  for (const action of spaceActions) {
    it(`${action} は管理者だけ`, () => {
      expect(can(actor("admin"), action)).toBe(true);
      expect(can(actor("member", "none"), action)).toBe(false);
      expect(can(actor("guest", "none"), action)).toBe(false);
    });
  }

  // 決定 D31: プロジェクトの作成だけは一般ユーザー（制限なし）にも開放した。
  // 本家は管理者だけ
  it("project.create は一般ユーザー（制限なし）もできる", () => {
    expect(can(actor("member", "none"), "project.create")).toBe(true);
    expect(can(actor("member", "issue_create_only"), "project.create")).toBe(false);
    expect(can(actor("guest", "none"), "project.create")).toBe(false);
  });
});

describe("参加していないプロジェクト（決定 D31）", () => {
  // 本家は「管理者でも未参加プロジェクトには触れない」だが、
  // 2026-09-22 のユーザー指示で管理者だけ例外にした
  const notMember = { projectId: 1, isMember: false };

  it("管理者は未参加でも閲覧・編集・削除できる", () => {
    expect(can(actor("admin"), "issue.view", notMember)).toBe(true);
    expect(can(actor("admin"), "wiki.view", notMember)).toBe(true);
    expect(can(actor("admin"), "project.edit", notMember)).toBe(true);
    expect(can(actor("admin"), "project.delete", notMember)).toBe(true);
  });

  it("一般・ゲストは未参加なら中身に触れない（名前が見えるだけ）", () => {
    for (const a of [actor("member", "none"), actor("guest", "none")]) {
      expect(can(a, "issue.view", notMember)).toBe(false);
      expect(can(a, "wiki.view", notMember)).toBe(false);
      expect(can(a, "project.delete", notMember)).toBe(false);
    }
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

  // 決定 D31: ゲストは制限なしでも削除できない。
  // ALLOWED_BY_RESTRICTION は一般とゲストで共用なので、そこへ足すと漏れる
  it("ゲストはプロジェクトも課題も削除できない", () => {
    expect(can(actor("guest", "none"), "issue.delete", inProject())).toBe(false);
    expect(can(actor("guest", "none"), "project.delete", inProject())).toBe(false);
  });

  it("一般（制限なし）は参加プロジェクトを削除できる", () => {
    expect(can(actor("member", "none"), "project.delete", inProject())).toBe(true);
    expect(can(actor("member", "issue_create_only"), "project.delete", inProject())).toBe(false);
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

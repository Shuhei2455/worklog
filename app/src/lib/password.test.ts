import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  PASSWORD_MIN_LENGTH,
} from "./password";

describe("hashPassword / verifyPassword", () => {
  it("同じパスワードで照合が通る", () => {
    const stored = hashPassword("tanuki-1978");
    expect(verifyPassword("tanuki-1978", stored)).toBe(true);
  });

  it("違うパスワードは通らない", () => {
    const stored = hashPassword("tanuki-1978");
    expect(verifyPassword("tanuki-1979", stored)).toBe(false);
  });

  it("毎回ソルトが変わる（同じ平文でもハッシュが違う）", () => {
    expect(hashPassword("tanuki-1978")).not.toBe(hashPassword("tanuki-1978"));
  });

  it("保存値が壊れていても例外にせず false", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "scrypt$zz")).toBe(false);
    expect(verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
    // 長さの違うハッシュ（timingSafeEqual が例外を投げる条件）
    expect(verifyPassword("x", "scrypt$aabb$ccdd")).toBe(false);
  });

  it("最小長の定数が10（決定 D27）", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });
});

describe("checkPasswordStrength（M5・決定 D27）", () => {
  const ok = (p: string, ctx = {}) => checkPasswordStrength(p, ctx).ok;
  const err = (p: string, ctx = {}) => {
    const r = checkPasswordStrength(p, ctx);
    return r.ok ? "" : r.error;
  };

  it("10文字以上で2種類以上混ざっていれば通る", () => {
    expect(ok("tanuki-1978")).toBe(true);
    // 日本語でも長さを満たせば通る（10文字以上）
    expect(ok("ケーキを3つ買ったよ")).toBe(true);
  });

  it("短いものは弾く", () => {
    expect(err("abc123")).toContain("10文字以上");
  });

  it("長すぎるものも弾く（scryptの計算時間）", () => {
    expect(err("a1".repeat(200))).toContain("長すぎます");
  });

  it("よくある文字列を含むものを弾く", () => {
    expect(err("myPassword123")).toContain("password");
    expect(err("kadai-2026-ok")).toContain("kadai");
  });

  it("ログインIDや名前を含むものを弾く", () => {
    expect(err("shuhei-no-pass", { userId: "shuhei" })).toContain("ログインID");
    expect(err("yamada-no-heya", { name: "yamada" })).toContain("ログインID");
    // 短すぎるIDは判定に使わない（"ab" が偶然含まれるのを避ける）
    // "abc123" などの定型を含まない文字列で確かめる
    expect(ok("xyzqrs74185", { userId: "ab" })).toBe(true);
  });

  it("同じ文字の繰り返しと数字だけを弾く", () => {
    expect(err("aaaaaaaaaaaa")).toContain("同じ文字");
    expect(err("12345678901")).toContain("数字だけ");
  });

  it("1種類だけなら弾く", () => {
    expect(err("abcdefghijkl")).toContain("2種類以上");
  });

  it("大文字小文字だけでも2種類なので通る", () => {
    expect(ok("AbcDefGhiJkl")).toBe(true);
  });
});

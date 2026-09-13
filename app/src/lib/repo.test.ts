import { afterEach, describe, expect, it } from "vitest";
import { httpCloneUrl, isSshEnabled, sshCloneUrl } from "./repo";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("httpCloneUrl", () => {
  it("APP_URL 配下の /git を使う（Caddy が剥がす前提）", () => {
    process.env.APP_URL = "https://192.168.10.20";
    expect(httpCloneUrl("WEB", "portal")).toBe("https://192.168.10.20/git/WEB/portal.git");
  });

  it("ポート付きの APP_URL でもそのまま組む", () => {
    process.env.APP_URL = "https://192.168.10.20:8443";
    expect(httpCloneUrl("WEB", "portal")).toBe("https://192.168.10.20:8443/git/WEB/portal.git");
  });
});

describe("isSshEnabled", () => {
  it("未設定なら無効（出てはいけないものを出さない側に倒す）", () => {
    delete process.env.GIT_SSH_ENABLED;
    expect(isSshEnabled()).toBe(false);
  });

  it("'false' はもちろん無効", () => {
    process.env.GIT_SSH_ENABLED = "false";
    expect(isSshEnabled()).toBe(false);
  });

  it("'true' のときだけ有効", () => {
    process.env.GIT_SSH_ENABLED = "true";
    expect(isSshEnabled()).toBe(true);
  });
});

describe("sshCloneUrl", () => {
  it("無効なら null（画面はこの行を出さない）", () => {
    delete process.env.GIT_SSH_ENABLED;
    expect(sshCloneUrl("WEB", "portal")).toBeNull();
  });

  it("有効かつ22番なら scp 形式", () => {
    process.env.GIT_SSH_ENABLED = "true";
    process.env.GITEA_DOMAIN = "git.example.local";
    process.env.GITEA_SSH_PORT = "22";
    expect(sshCloneUrl("WEB", "portal")).toBe("git@git.example.local:WEB/portal.git");
  });

  it("有効かつ22番以外なら ssh:// 形式", () => {
    process.env.GIT_SSH_ENABLED = "true";
    process.env.GITEA_DOMAIN = "git.example.local";
    process.env.GITEA_SSH_PORT = "2222";
    expect(sshCloneUrl("WEB", "portal")).toBe("ssh://git@git.example.local:2222/WEB/portal.git");
  });
});

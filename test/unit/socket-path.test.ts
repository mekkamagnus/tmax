import { describe, test, expect, afterEach } from "bun:test";
import { defaultSocketPath, resolveUid } from "../../src/core/socket-path.ts";

describe("socket-path (BUG-30)", () => {
  const origSocket = process.env.TMAX_SOCKET;
  const origSudo = process.env.SUDO_UID;

  afterEach(() => {
    if (origSocket === undefined) delete process.env.TMAX_SOCKET;
    else process.env.TMAX_SOCKET = origSocket;
    if (origSudo === undefined) delete process.env.SUDO_UID;
    else process.env.SUDO_UID = origSudo;
  });

  test("TMAX_SOCKET overrides everything", () => {
    process.env.TMAX_SOCKET = "/custom/sock";
    process.env.SUDO_UID = "999";
    expect(defaultSocketPath()).toBe("/custom/sock");
  });

  test("SUDO_UID is honored when set", () => {
    delete process.env.TMAX_SOCKET;
    process.env.SUDO_UID = "1000";
    expect(resolveUid()).toBe("1000");
    expect(defaultSocketPath()).toBe("/tmp/tmax-1000/server");
  });

  test("falls back to userInfo().uid when SUDO_UID unset", () => {
    delete process.env.TMAX_SOCKET;
    delete process.env.SUDO_UID;
    const uid = resolveUid();
    expect(uid).toMatch(/^\d+$/);
    expect(defaultSocketPath()).toBe(`/tmp/tmax-${uid}/server`);
  });
});

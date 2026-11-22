import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * @file binary-info-332.test.ts
 * @description #332 valve r1 — the compiled-binary regression gate:
 * rebuild dist/tmax and run the issue's repro under an ISOLATED
 * socket. Deleting either embedded .info manual from the --asset
 * list fails here (the unit tests cover path resolution only).
 */

describe("#332 — the binary Info repro (integration)", () => {
  // A UNIQUE per-run socket dir (valve r2: a fixed name can reuse a
  // stale daemon — a false pass — or stop another concurrent run).
  const socketDir = mkdtempSync(join(tmpdir(), "i332-gate-"));
  const socket = join(socketDir, "s.sock");
  let bin: string;

  beforeAll(() => {
    const out = execFileSync("bun", ["run", "build:tmax"], { cwd: process.cwd(), timeout: 120_000 }).toString();
    void out;
    bin = join(process.cwd(), "dist/tmax");
    expect(existsSync(bin)).toBe(true);
  });

  test("tmax -e '(progn (info) (buffer-current))' returns *Info*", () => {
    // A FRESH socket: never reuse a stale daemon (BUG-61's lesson —
    // a lingering daemon would answer with ITS binary's behavior).
    const r = spawnSync(bin, ["-e", "(progn (info) (buffer-current))"], {
      env: { ...process.env, TMAX_SOCKET: socket },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.stdout.trim().split("\n").pop()).toBe("*Info*");
  });

  test("BOTH manuals are embedded (tlisp.info too — the claim held only for tmax)", () => {
    const r = spawnSync(bin, ["-e", '(file-exists-p (concat (helpgrep-docs-dir) "/tlisp.info"))'], {
      env: { ...process.env, TMAX_SOCKET: socket },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.stdout.trim().split("\n").pop()?.toLowerCase()).toBe("true");
  });

  afterAll(() => {
    try {
      spawnSync(bin, ["--stop"], { env: { ...process.env, TMAX_SOCKET: socket }, timeout: 10_000 });
    } catch { /* the daemon may already be gone */ }
    try { rmSync(socketDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });
});

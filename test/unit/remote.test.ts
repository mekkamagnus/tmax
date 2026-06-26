/**
 * @file remote.test.ts
 * @description Unit tests for adws/adws-modules/remote.ts. Covers SSH config
 * parsing (listSshHosts — wildcards, hosts without HostName, multi-host lines),
 * deterministic remote name generation, command construction for
 * ensureGitRemote/pushToRemote/fetchFromRemote/dispatchToRemote/queryRemoteStatus,
 * and the dry-run launcher contract via parseSetupResult.
 *
 * All subprocess invocations go through a fake `run` that records argv. No live
 * ssh, no live git — pure command-shape assertions.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  defaultRemoteRepoPath,
  dispatchCommand,
  fetchBackInstruction,
  fetchFromRemote,
  listRemoteStatuses,
  listSshHosts,
  pushToRemote,
  queryRemoteStatus,
  remoteNameForHost,
  ensureGitRemote,
  dispatchToRemote,
  type RemoteDeps,
} from "../../adws/adws-modules/remote.ts";
import { parseSetupResult } from "../../adws/adw-launch.ts";

// ---------------------------------------------------------------------------
// Fake run — records argv, returns scripted output
// ---------------------------------------------------------------------------

interface Recorded {
  cmd: string;
  args: string[];
  cwd?: string;
}

function makeFakeRun(
  script: (rec: Recorded) => Either<string, string>,
): { deps: RemoteDeps; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const run = (cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }) => {
    return TaskEither.from(async () => {
      const rec: Recorded = { cmd, args, cwd: opts.cwd };
      calls.push(rec);
      return script(rec);
    });
  };
  return { deps: { run }, calls };
}

// ---------------------------------------------------------------------------
// listSshHosts
// ---------------------------------------------------------------------------

describe("listSshHosts", () => {
  let tmpCfg: string;
  beforeEach(() => {
    tmpCfg = mkdtempSync(join(tmpdir(), "adw-remote-"));
  });
  afterEach(() => {
    try { rmSync(tmpCfg, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test("parses Host + HostName pairs; skips wildcards and hostless entries", () => {
    const cfg = join(tmpCfg, "config");
    writeFileSync(cfg, [
      "# top comment",
      "Host mekkapi",
      "  HostName mekkapi.local",
      "  User pi",
      "",
      "Host mekkapi-ethernet",
      "  HostName 192.168.1.42",
      "",
      "Host git.charm.sh",
      "  User git",
      "",
      "Host *",
      "  ServerAliveInterval 60",
      "",
      "Host multi a b",
      "  HostName multi.example.com",
      "",
    ].join("\n"));
    const hosts = listSshHosts(cfg);
    const aliases = hosts.map((h) => h.alias);
    expect(aliases).toEqual(["mekkapi", "mekkapi-ethernet", "git.charm.sh", "multi"]);
    expect(hosts.find((h) => h.alias === "mekkapi")?.hostname).toBe("mekkapi.local");
    expect(hosts.find((h) => h.alias === "mekkapi-ethernet")?.hostname).toBe("192.168.1.42");
    expect(hosts.find((h) => h.alias === "git.charm.sh")?.hostname).toBeUndefined();
    expect(hosts.find((h) => h.alias === "multi")?.hostname).toBe("multi.example.com");
  });

  test("missing config file → empty list", () => {
    expect(listSshHosts(join(tmpCfg, "nope")).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// remoteNameForHost + defaultRemoteRepoPath
// ---------------------------------------------------------------------------

describe("remoteNameForHost", () => {
  test("adw-<host>", () => {
    expect(remoteNameForHost("mekkapi")).toBe("adw-mekkapi");
    expect(remoteNameForHost("mekkapi-ethernet")).toBe("adw-mekkapi-ethernet");
  });
});

describe("defaultRemoteRepoPath", () => {
  const prevPath = process.env.ADW_REMOTE_REPO_PATH;
  const prevPerHost = process.env.ADW_REMOTE_REPO_PATH_MEKKAPI;
  afterEach(() => {
    if (prevPath === undefined) delete process.env.ADW_REMOTE_REPO_PATH;
    else process.env.ADW_REMOTE_REPO_PATH = prevPath;
    if (prevPerHost === undefined) delete process.env.ADW_REMOTE_REPO_PATH_MEKKAPI;
    else process.env.ADW_REMOTE_REPO_PATH_MEKKAPI = prevPerHost;
  });

  test("falls back to ~/tmax", () => {
    delete process.env.ADW_REMOTE_REPO_PATH;
    delete process.env.ADW_REMOTE_REPO_PATH_MEKKAPI;
    expect(defaultRemoteRepoPath("mekkapi")).toMatch(/tmax$/);
  });

  test("respects ADW_REMOTE_REPO_PATH", () => {
    process.env.ADW_REMOTE_REPO_PATH = "/custom/path";
    expect(defaultRemoteRepoPath("anyhost")).toBe("/custom/path");
  });

  test("respects per-host override", () => {
    process.env.ADW_REMOTE_REPO_PATH = "/default";
    process.env.ADW_REMOTE_REPO_PATH_MEKKAPI = "/pi/path";
    expect(defaultRemoteRepoPath("mekkapi")).toBe("/pi/path");
    expect(defaultRemoteRepoPath("other")).toBe("/default");
  });
});

// ---------------------------------------------------------------------------
// ensureGitRemote — command construction
// ---------------------------------------------------------------------------

describe("ensureGitRemote", () => {
  test("creates the remote when it doesn't exist", async () => {
    const { deps, calls } = makeFakeRun((rec) => {
      // First call: `git remote` — return empty list (no adw-mekkapi).
      if (rec.args[0] === "remote" && rec.args.length === 1) {
        return Either.right("origin");
      }
      // Second call: `git remote add adw-mekkapi mekkapi:~/tmax`.
      if (rec.args[0] === "remote" && rec.args[1] === "add") {
        return Either.right("");
      }
      return Either.right("");
    });
    const r = await ensureGitRemote(deps, "mekkapi", "/home/pi/tmax", "/repo").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.remote).toBe("adw-mekkapi");
      expect(r.right.url).toBe("mekkapi:/home/pi/tmax");
      expect(r.right.created).toBe(true);
    }
    // Verify the add command was issued correctly.
    const addCall = calls.find((c) => c.args[0] === "remote" && c.args[1] === "add");
    expect(addCall).toBeDefined();
    expect(addCall!.args).toEqual(["remote", "add", "adw-mekkapi", "mekkapi:/home/pi/tmax"]);
    expect(addCall!.cwd).toBe("/repo");
  });

  test("no-op when remote exists with matching URL", async () => {
    const { deps, calls } = makeFakeRun((rec) => {
      if (rec.args[0] === "remote" && rec.args.length === 1) {
        return Either.right("origin\nadw-mekkapi");
      }
      if (rec.args[0] === "remote" && rec.args[1] === "get-url") {
        return Either.right("mekkapi:/home/pi/tmax");
      }
      return Either.right("");
    });
    const r = await ensureGitRemote(deps, "mekkapi", "/home/pi/tmax", "/repo").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.created).toBe(false);
    // No `add` call.
    expect(calls.find((c) => c.args[0] === "remote" && c.args[1] === "add")).toBeUndefined();
  });

  test("Left when remote exists with a different URL", async () => {
    const { deps } = makeFakeRun((rec) => {
      if (rec.args[0] === "remote" && rec.args.length === 1) {
        return Either.right("adw-mekkapi");
      }
      if (rec.args[0] === "remote" && rec.args[1] === "get-url") {
        return Either.right("mekkapi:/some/other/path");
      }
      return Either.right("");
    });
    const r = await ensureGitRemote(deps, "mekkapi", "/home/pi/tmax", "/repo").run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toContain("already exists");
      expect(r.left).toContain("adw-mekkapi");
    }
  });
});

// ---------------------------------------------------------------------------
// pushToRemote + fetchFromRemote — command construction
// ---------------------------------------------------------------------------

describe("pushToRemote", () => {
  test("issues git push <remoteName> <branch> with cwd=rootPath", async () => {
    const { deps, calls } = makeFakeRun(() => Either.right("pushed"));
    const r = await pushToRemote(deps, "adw-mekkapi", "adw/01KVE00001", "/repo").run();
    expect(Either.isRight(r)).toBe(true);
    expect(calls[0]).toEqual({ cmd: "git", args: ["push", "adw-mekkapi", "adw/01KVE00001"], cwd: "/repo" });
  });
});

describe("fetchFromRemote", () => {
  test("issues git fetch <remoteName> <branch> with cwd=rootPath", async () => {
    const { deps, calls } = makeFakeRun(() => Either.right("fetched"));
    const r = await fetchFromRemote(deps, "adw-mekkapi", "adw/01KVE00001", "/repo").run();
    expect(Either.isRight(r)).toBe(true);
    expect(calls[0]).toEqual({ cmd: "git", args: ["fetch", "adw-mekkapi", "adw/01KVE00001"], cwd: "/repo" });
  });
});

// ---------------------------------------------------------------------------
// dispatchToRemote + queryRemoteStatus — command construction
// ---------------------------------------------------------------------------

describe("dispatchToRemote", () => {
  test("issues ssh host 'cd <repoPath> && bun adws/adw-launch.ts --resume <id>'", async () => {
    const { deps, calls } = makeFakeRun(() => Either.right("ok"));
    const r = await dispatchToRemote(deps, "mekkapi", "01KVE00001", "/home/pi/tmax").run();
    expect(Either.isRight(r)).toBe(true);
    expect(calls[0]!.cmd).toBe("ssh");
    expect(calls[0]!.args[0]).toBe("mekkapi");
    expect(calls[0]!.args[1]).toContain("cd /home/pi/tmax");
    expect(calls[0]!.args[1]).toContain("bun adws/adw-launch.ts --resume 01KVE00001");
  });
});

describe("queryRemoteStatus", () => {
  test("issues ssh with cat state + tail event", async () => {
    const { deps, calls } = makeFakeRun(() =>
      Either.right(JSON.stringify({ adw_id: "01KVE00001" }) + "\n---EVENT---\n" + JSON.stringify({ event: "heartbeat" })),
    );
    const r = await queryRemoteStatus(deps, "mekkapi", "01KVE00001", "/home/pi/tmax").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.state).toContain("01KVE00001");
      expect(r.right.latestEvent).toContain("heartbeat");
    }
    expect(calls[0]!.cmd).toBe("ssh");
    expect(calls[0]!.args[0]).toBe("mekkapi");
    expect(calls[0]!.args[1]).toContain("cat /home/pi/tmax/agents/01KVE00001/adw-state.json");
    expect(calls[0]!.args[1]).toContain("tail -n 1 /home/pi/tmax/agents/01KVE00001/orchestrator/events.jsonl");
  });
});

// ---------------------------------------------------------------------------
// listRemoteStatuses — find + parallel fetch
// ---------------------------------------------------------------------------

describe("listRemoteStatuses", () => {
  test("uses ssh find then fetches each state in parallel", async () => {
    const findOutput = [
      "/home/pi/tmax/agents/01KVE00002/adw-state.json",
      "/home/pi/tmax/agents/01KVE00001/adw-state.json",
    ].join("\n");
    let callCount = 0;
    const { deps, calls } = makeFakeRun((rec) => {
      callCount++;
      if (rec.args[0] === "mekkapi" && rec.args[1]?.includes("find ")) {
        return Either.right(findOutput);
      }
      // Per-id query: return a state + event for each.
      return Either.right('{"adw_id":"x"}\n---EVENT---\n{"event":"heartbeat"}');
    });
    const r = await listRemoteStatuses(deps, "mekkapi", "/home/pi/tmax").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.length).toBe(2);
      expect(r.right.map((x) => x.id)).toEqual(expect.arrayContaining(["01KVE00001", "01KVE00002"]));
    }
    // 1 find + 2 queries.
    expect(callCount).toBe(3);
    // Find command shape.
    const findCall = calls.find((c) => c.args[1]?.includes("find "));
    expect(findCall).toBeDefined();
    expect(findCall!.args[1]).toContain("find /home/pi/tmax/agents -maxdepth 2 -name adw-state.json");
  });

  test("empty find output → empty list (not an error)", async () => {
    const { deps } = makeFakeRun(() => Either.right(""));
    const r = await listRemoteStatuses(deps, "mekkapi", "/home/pi/tmax").run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchBackInstruction
// ---------------------------------------------------------------------------

describe("fetchBackInstruction", () => {
  test("renders git fetch + worktree add FETCH_HEAD", () => {
    const s = fetchBackInstruction("adw-mekkapi", "adw/01KVE00001", "01KVE00001");
    expect(s).toBe("git fetch adw-mekkapi adw/01KVE00001 && git worktree add .worktrees/01KVE00001-result FETCH_HEAD");
  });
});

// ---------------------------------------------------------------------------
// dispatchCommand (pure)
// ---------------------------------------------------------------------------

describe("dispatchCommand", () => {
  test("renders the SSH-resume command", () => {
    expect(dispatchCommand("01KVE00001", "/home/pi/tmax")).toBe(
      "cd /home/pi/tmax && bun adws/adw-launch.ts --resume 01KVE00001",
    );
  });
});

// ---------------------------------------------------------------------------
// parseSetupResult — ADW_SETUP_RESULT JSON contract
// ---------------------------------------------------------------------------

describe("parseSetupResult", () => {
  const validResult = {
    id: "01KVE00001",
    spec_path: "docs/specs/SPEC-065.md",
    branch: "adw/01KVE00001",
    worktree_path: "/repo.01KVE00001",
    state_path: "/repo/agents/01KVE00001/adw-state.json",
  };

  test("parses the final ADW_SETUP_RESULT line, tolerating preceding logs", () => {
    const stdout = `[adw] plan running — 30s elapsed\n[adw] spec-review running — 12s elapsed\nADW_SETUP_RESULT ${JSON.stringify(validResult)}\n`;
    const r = parseSetupResult(stdout);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.id).toBe("01KVE00001");
      expect(r.right.branch).toBe("adw/01KVE00001");
      expect(r.right.worktree_path).toBe("/repo.01KVE00001");
    }
  });

  test("Left when no ADW_SETUP_RESULT line present", () => {
    const r = parseSetupResult("just human logs\nno contract\n");
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("did not print");
  });

  test("Left when JSON is malformed", () => {
    const r = parseSetupResult("ADW_SETUP_RESULT {bad json}\n");
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("parse failed");
  });

  test("Left when JSON is missing required fields", () => {
    const partial = { id: "01KVE00001", spec_path: "x.md" }; // no branch, no worktree_path
    const r = parseSetupResult(`ADW_SETUP_RESULT ${JSON.stringify(partial)}\n`);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("missing required fields");
  });
});

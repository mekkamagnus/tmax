import { describe, expect, test, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

// #298 — the fikra thread root must resolve against the CLIENT'S working
// context (buffer file dir → client launch dir), never the daemon cwd. A
// daemon whose process cwd is dir A serving a client editing in dir B must
// put every thread artifact under B's .tmax — and legacy records (no
// context-dir) keep the daemon-cwd resolution, flagged legacy.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

const originalCwd = process.cwd();
const dirs: string[] = [];

function makeDir(prefix: string, git = false): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  if (git) execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);
const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("#298 client-context thread roots", () => {
  afterAll(() => {
    process.chdir(originalCwd);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  test("shell-command takes an optional cwd argument (the :cwd capability)", async () => {
    const a = makeDir("fikra-ctx-a");
    const b = makeDir("fikra-ctx-b");
    process.chdir(a);
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    expect(String(e(editor, `(shell-command "pwd" "${b}")`).value).trim()).toBe(realpathSync(b));
    // Without the argument: the process cwd (unchanged behavior).
    expect(String(e(editor, `(shell-command "pwd")`).value).trim()).toBe(realpathSync(a));
    // git resolves against the cwd dir, not the inherited one.
    const repo = makeDir("fikra-ctx-repo", true);
    expect(String(e(editor, `(shell-command "git rev-parse --show-toplevel 2>/dev/null" "${repo}")`).value).trim())
      .toBe(realpathSync(repo));
  });

  test("client-launch-dir primitive: nil without a client, the dir after the handshake records it", async () => {
    const a = makeDir("fikra-ctx-a");
    process.chdir(a);
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    expect(e(editor, "(client-launch-dir)").type).toBe("nil");
    // The daemon's connect-frame path calls exactly this (production seam).
    editor.setClientLaunchDir(a);
    expect(String(e(editor, "(client-launch-dir)").value)).toBe(a);
  });

  test("REPRO: daemon cwd = A, client context = B → root, log, and diff artifacts land under B; nothing in A", async () => {
    const a = makeDir("fikra-ctx-a", true); // daemon cwd — a git repo to catch misrouted refs
    const b = makeDir("fikra-ctx-b", true); // client context — the real project
    // Checkpointing waits for the first commit (unborn HEAD disables it).
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: b });
    process.chdir(a);
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(require-module fikra/checkpoint)");
    editor.setClientLaunchDir(b);

    expect(String(e(editor, "(fikra/thread/fikra-thread-init)").value)).toBe("main");
    const root = String(e(editor, '(fikra/thread/fikra-thread-field "root")').value);
    expect(root).toBe(realpathSync(b));
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    expect(log).toBe(join(realpathSync(b), ".tmax/fikra/threads/main/events.jsonl"));

    // A full turn: checkpoint refs (the diff artifacts) must land in B's
    // repo, and A's ref namespace must stay untouched.
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const capture = e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(capture.type).toBe("string"); // a sha, not nil
    const refsB = String(e(editor, `(shell-command "git for-each-ref refs/fikra/" "${realpathSync(b)}")`).value).trim();
    // turn-begin bumped the count to 1 before the completion capture.
    expect(refsB).toContain("refs/fikra/main/1");
    const refsA = String(e(editor, `(shell-command "git for-each-ref refs/fikra/" "${realpathSync(a)}")`).value).trim();
    expect(refsA).toBe("");
    // Nothing written into A's .tmax.
    expect(existsSync(join(a, ".tmax"))).toBe(false);
    // The persisted record carries the client context (single source).
    const state = JSON.parse(readFileSync(join(realpathSync(b), ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(state["context-dir"]).toBe(b);
    // codex r1 fix 1: the skills dir (a late-landing consumer) reads the
    // persisted root too — not the legacy daemon-cwd resolver.
    e(editor, "(require-module fikra/skills)");
    expect(String(e(editor, "(fikra/skills/fikra-skills-dir)").value))
      .toBe(join(realpathSync(b), ".fikra/skills"));

    // A restart re-attaches via the persisted context when the client
    // reconnects from B (the daemon cwd is STILL A).
    const editor2 = await createStartedEditor("");
    e(editor2, "(require-module fikra/thread)");
    editor2.setClientLaunchDir(b);
    e(editor2, "(fikra/thread/fikra-thread-init)");
    const root2 = String(e(editor2, '(fikra/thread/fikra-thread-field "root")').value);
    expect(root2).toBe(realpathSync(b));
    expect(existsSync(join(a, ".tmax"))).toBe(false);
  });

  test("LEGACY: a record without context-dir resolves via the daemon cwd and is labeled legacy in the list", async () => {
    const a = makeDir("fikra-ctx-a", true);
    process.chdir(a);
    // Hand-write a pre-#298 record (no context-dir field).
    mkdirSync(join(a, ".tmax/fikra/threads/main"), { recursive: true });
    writeFileSync(
      join(a, ".tmax/fikra/threads/main/state.json"),
      JSON.stringify({ id: "main", backend: "claude", "turn-count": 4, status: "idle" }),
    );
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(require-module fikra/threads)");
    expect(String(e(editor, "(fikra/thread/fikra-thread-init)").value)).toBe("main");
    // Legacy resolution: daemon cwd's git toplevel — NOT re-targeted.
    const root = String(e(editor, '(fikra/thread/fikra-thread-field "root")').value);
    expect(root).toBe(realpathSync(a));
    expect(String(e(editor, '(fikra/thread/fikra-thread-field "legacy")').value)).toBe("true");
    // The thread list marks it legacy (location column).
    e(editor, "(fikra/threads/fikra-threads-list-open)");
    const text = stripAnsi(bufferText(editor));
    expect(text).toContain("legacy");
    // Rows carry the flag for programmatic consumers too.
    expect(String(e(editor, '(hashmap-get (car (fikra/thread/fikra-thread-rows)) "location")').value)).toBe("legacy");
    expect(String(e(editor, '(hashmap-get (car (fikra/thread/fikra-thread-rows)) "legacy")').value)).toBe("true");
  });

  test("LEGACY disk row: a restarted editor lists another project's legacy record without throwing", async () => {
    const a = makeDir("fikra-ctx-a", true);
    process.chdir(a);
    // A non-current legacy thread on disk (fix-1) + the current main.
    mkdirSync(join(a, ".tmax/fikra/threads/fix-1"), { recursive: true });
    writeFileSync(
      join(a, ".tmax/fikra/threads/fix-1/state.json"),
      JSON.stringify({ id: "fix-1", backend: "codex", "turn-count": 2 }),
    );
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(require-module fikra/threads)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    // The DISK row path (load-row → row-for) reads the record as a hashmap
    // and derives the legacy flag from context-dir absence.
    expect(String(e(editor, '(hashmap-get (car (cdr (fikra/thread/fikra-thread-rows))) "id")').value)).toBe("fix-1");
    expect(String(e(editor, '(hashmap-get (car (cdr (fikra/thread/fikra-thread-rows))) "legacy")').value)).toBe("true");
    e(editor, "(fikra/threads/fikra-threads-list-open)");
    expect(stripAnsi(bufferText(editor))).toContain("fix-1");
  });

  test("BUFFER-FILE context: a file open in dir C threads against C (no client launch dir needed)", async () => {
    const a = makeDir("fikra-ctx-a", true);
    const c = makeDir("fikra-ctx-c", true);
    process.chdir(a);
    // A file buffer attached from dir C (find-file sets buffer-filename).
    const fileC = join(c, "note.md");
    writeFileSync(fileC, "hello\n");
    const editor = await createStartedEditor("");
    e(editor, `(find-file-open "${fileC}")`);
    expect(String(e(editor, "(buffer-filename)").value)).toBe(fileC);

    e(editor, "(require-module fikra/thread)");
    expect(String(e(editor, "(fikra/thread/fikra-thread-init)").value)).toBe("main");
    const root = String(e(editor, '(fikra/thread/fikra-thread-field "root")').value);
    expect(root).toBe(realpathSync(c));
    const log = String(e(editor, "(fikra/thread/fikra-thread-log-path)").value);
    expect(log).toBe(join(realpathSync(c), ".tmax/fikra/threads/main/events.jsonl"));
    expect(existsSync(join(a, ".tmax"))).toBe(false);
  });

  test("embedded (no client, no file): daemon-cwd resolution, NOT flagged legacy", async () => {
    const a = makeDir("fikra-ctx-a", true);
    process.chdir(a);
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(fikra/thread/fikra-thread-init)");
    const root = String(e(editor, '(fikra/thread/fikra-thread-field "root")').value);
    expect(root).toBe(realpathSync(a));
    // nil is T-Lisp false — a fresh record is NOT legacy.
    expect(e(editor, '(fikra/thread/fikra-thread-field "legacy")').type).toBe("nil");
    // The fresh record persists the daemon-cwd context (post-fix records
    // always carry one — only PRE-fix records are legacy). init alone does
    // not save; a session-id write forces the persist path.
    e(editor, '(fikra/thread/fikra-thread-set-session-id "s-1")');
    const state = JSON.parse(readFileSync(join(a, ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(typeof state["context-dir"]).toBe("string");
  });

  test("LEGACY IMMUTABILITY: saving a legacy thread never stamps the current context (no silent re-targeting)", async () => {
    const a = makeDir("fikra-ctx-a", true);
    const b = makeDir("fikra-ctx-b", true);
    process.chdir(a);
    // A pre-#298 record under the daemon-cwd root.
    mkdirSync(join(a, ".tmax/fikra/threads/main"), { recursive: true });
    writeFileSync(
      join(a, ".tmax/fikra/threads/main/state.json"),
      JSON.stringify({ id: "main", backend: "claude", "turn-count": 2, status: "idle" }),
    );
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    // The daemon loads the thread FIRST (startup/embedded init — no client
    // context, daemon-cwd discovery finds the legacy record).
    e(editor, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor, '(fikra/thread/fikra-thread-field "legacy")').value)).toBe("true");
    // ...THEN a client from a DIFFERENT project attaches mid-session.
    editor.setClientLaunchDir(b);
    // A save through the normal lifecycle (session-id write)...
    e(editor, '(fikra/thread/fikra-thread-set-session-id "legacy-sess")');
    // ...persists NO context-dir (null), keeping the record legacy — the
    // attached client's context can never migrate it.
    const state = JSON.parse(readFileSync(join(a, ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(state["context-dir"] ?? null).toBeNull();
    // And a reload STILL resolves via the daemon cwd with the legacy flag.
    const editor2 = await createStartedEditor("");
    e(editor2, "(require-module fikra/thread)");
    e(editor2, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor2, '(fikra/thread/fikra-thread-field "root")').value)).toBe(realpathSync(a));
    expect(String(e(editor2, '(fikra/thread/fikra-thread-field "legacy")').value)).toBe("true");
    expect(existsSync(join(b, ".tmax"))).toBe(false);
  });

  test("a child of a LEGACY parent stays legacy on the parent's root (codex r1 fix 3)", async () => {
    const a = makeDir("fikra-ctx-a", true);
    const b = makeDir("fikra-ctx-b", true);
    process.chdir(a);
    mkdirSync(join(a, ".tmax/fikra/threads/main"), { recursive: true });
    writeFileSync(
      join(a, ".tmax/fikra/threads/main/state.json"),
      JSON.stringify({ id: "main", backend: "claude", "turn-count": 1, status: "idle" }),
    );
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(require-module fikra/threads)");
    e(editor, "(fikra/thread/fikra-thread-init)"); // legacy main (no client)
    editor.setClientLaunchDir(b); // a different context attaches MID-session
    const child = String(e(editor, "(fikra/thread/fikra-thread-new)").value);
    expect(child).toBe("fix-1");
    // The child inherited the LEGACY parent's semantics: parent root, no
    // context stamped, legacy flag set (not the attached client's project).
    expect(String(e(editor, '(fikra/thread/fikra-thread-field "root")').value)).toBe(realpathSync(a));
    expect(e(editor, '(fikra/thread/fikra-thread-field "context-dir")').type).toBe("nil");
    expect(String(e(editor, '(fikra/thread/fikra-thread-field "legacy")').value)).toBe("true");
    // And the list shows the legacy label for the child.
    e(editor, '(fikra/thread/fikra-thread-switch "fix-1")');
    e(editor, "(fikra/threads/fikra-threads-list-open)");
    expect(stripAnsi(bufferText(editor))).toContain("legacy");
    expect(existsSync(join(b, ".tmax"))).toBe(false);
  });

  test("a file directly under / yields context-dir / (codex r1 fix 4)", async () => {
    const a = makeDir("fikra-ctx-a");
    process.chdir(a);
    const editor = await createStartedEditor("");
    e(editor, '(find-file-open "/x-edge-test.txt")'); // new-file buffer
    expect(String(e(editor, "(buffer-filename)").value)).toBe("/x-edge-test.txt");
    e(editor, "(require-module fikra/thread)");
    expect(String(e(editor, "(fikra/thread/fikra-thread-context-dir)").value)).toBe("/");
  });

  test("mcp dir creation + config path are SPACES-safe (codex r2 fix 1)", async () => {
    const a = makeDir("fikra-ctx-a", true);
    // A client context whose project path contains SPACES.
    const b = mkdtempSync(join(tmpdir(), "fikra ctx spaced "));
    dirs.push(b);
    execFileSync("git", ["init", "-q"], { cwd: b });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: b });
    process.chdir(a);
    const editor = await createStartedEditor("");
    e(editor, "(require-module fikra/thread)");
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, "(require-module fikra/checkpoint)");
    editor.setClientLaunchDir(b);
    e(editor, "(fikra/thread/fikra-thread-init)");
    // The config path targets the spaced root...
    const cfg = String(e(editor, "(fikra/backend-claude/fikra-claude-mcp-config-path)").value);
    expect(cfg).toBe(join(realpathSync(b), ".tmax/fikra/mcp/main-0.json"));
    // ...and the mkdir lands THERE (shell-quoted), not split on the space.
    e(editor, "(fikra/backend-claude/fikra-claude-mcp-ensure-dir)");
    expect(existsSync(join(realpathSync(b), ".tmax/fikra/mcp"))).toBe(true);
    expect(existsSync(join(a, ".tmax"))).toBe(false);
    // No stray split dir like "<tmp>/fikra ctx spaced" sibling artifacts:
    expect(existsSync(join(realpathSync(b), "ctx"))).toBe(false);
    // codex r3 fix 1: checkpoint capture (cd + tmp-index, quoted) creates
    // refs under the SPACED root (requires a first commit).
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const sha = e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(sha.type).toBe("string");
    const refs = String(e(editor, `(shell-command "git for-each-ref refs/fikra/" "${realpathSync(b)}")`).value).trim();
    expect(refs).toContain("refs/fikra/main/1");
    // An APOSTROPHE in the project path survives the quoting too (the
    // hex-built close/escape/reopen join).
    const q = mkdtempSync(join(tmpdir(), "fikra ctx 'quoted' "));
    dirs.push(q);
    execFileSync("git", ["init", "-q"], { cwd: q });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: q });
    editor.setClientLaunchDir(q);
    e(editor, '(fikra/thread/fikra-thread-focus "main")');
    // Re-init discovers via the NEW context (record found under q).
    e(editor, "(fikra/thread/fikra-thread-init)");
    e(editor, "(fikra/thread/fikra-thread-turn-begin)");
    const shaQ = e(editor, '(fikra/checkpoint/fikra-checkpoint-capture "completion")');
    expect(shaQ.type).toBe("string");
    const refsQ = String(e(editor, `(shell-command "git for-each-ref refs/fikra/" "${realpathSync(q)}")`).value).trim();
    expect(refsQ).toContain("refs/fikra/main/1");
  });
});

describe("#298 connect-frame handshake (production wiring)", () => {
  test("a real RemoteEditor handshake stores its cwd on the serving editor; disconnect clears it", async () => {
    const { TmaxServer } = await import("../../src/server/server.ts");
    const { RemoteEditor } = await import("../../src/editor/remote-editor.ts");
    const { testSocketPath, forceShutdown, sweepTestSockets, connectWithTimeout } = await import("../fixtures/server-test-helpers.ts");
    sweepTestSockets();
    const socketPath = testSocketPath("ctx-handshake");
    // An INJECTED editor (the server's constructor seam) so the assertion
    // reads the same instance the daemon serves through.
    const { Editor } = await import("../../src/editor/editor.ts");
    const { MockTerminal } = await import("../mocks/terminal.ts");
    const { MockFileSystem } = await import("../mocks/filesystem.ts");
    const editor = new Editor(new MockTerminal(), new MockFileSystem());
    const server = new TmaxServer(socketPath, true, editor);
    await server.start();
    const request = (id: number, method: string, params: Record<string, unknown>) =>
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    // Poll instead of fixed sleeps (verify-gate r4 flake note): the close
    // handler runs async after socket.destroy().
    const until = async (pred: () => boolean, what: string): Promise<void> => {
      for (let i = 0; i < 200; i++) {
        if (pred()) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`timeout waiting for ${what}`);
    };
    try {
      const remote = new RemoteEditor(socketPath);
      await remote.start(); // connect-frame with clientCwd: process.cwd()
      expect(editor.getClientLaunchDir()).toBe(process.cwd());
      // The primitive's read of the same value is covered by the unit test
      // above (setClientLaunchDir → client-launch-dir) — this test proves
      // the WIRE: RemoteEditor handshake → daemon → serving editor.

      // #298 verify-gate r2: a client's launch dir must NOT outlive it.
      // A second client from another dir connects (last-connect-wins)...
      const otherDir = makeDir("fikra-ctx-other");
      const sock2 = await connectWithTimeout(socketPath);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect-frame timeout")), 10_000);
        sock2.on("data", (d) => { clearTimeout(timer); sock2.destroy(); resolve(); });
        sock2.write(request(1, "connect-frame", { clientType: "tui", clientName: "t2", clientCwd: otherDir }));
      });
      expect(editor.getClientLaunchDir()).toBe(otherDir);
      // ...then disconnects: the dir clears (nothing stale survives)...
      await until(() => editor.getClientLaunchDir() === undefined, "disconnect clear");
      // ...while a value ANOTHER client overwrote stays (guard check): the
      // first remote is still connected with process.cwd() — reconnect a
      // fresh client and confirm set/clear symmetry.
      const sock3 = await connectWithTimeout(socketPath);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect-frame timeout 2")), 10_000);
        sock3.on("data", (d) => { clearTimeout(timer); resolve(); });
        sock3.write(request(2, "connect-frame", { clientType: "tui", clientName: "t3", clientCwd: otherDir }));
      });
      expect(editor.getClientLaunchDir()).toBe(otherDir);
      sock3.destroy();
      await until(() => editor.getClientLaunchDir() === undefined, "sock3 disconnect clear");

      // codex r1 fix 2: two clients sharing the SAME cwd — one leaving
      // must NOT clear the other's context (value-refcounted release).
      const shared = makeDir("fikra-ctx-shared");
      const clientsOf = (srv: unknown) => (srv as unknown as { clients: Map<string, unknown> }).clients;
      const sockA = await connectWithTimeout(socketPath);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect-frame timeout A")), 10_000);
        sockA.on("data", (d) => { clearTimeout(timer); resolve(); });
        sockA.write(request(3, "connect-frame", { clientType: "tui", clientName: "a", clientCwd: shared }));
      });
      const sockB = await connectWithTimeout(socketPath);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect-frame timeout B")), 10_000);
        sockB.on("data", (d) => { clearTimeout(timer); resolve(); });
        sockB.write(request(4, "connect-frame", { clientType: "tui", clientName: "b", clientCwd: shared }));
      });
      expect(editor.getClientLaunchDir()).toBe(shared);
      sockA.destroy(); // first sharer leaves — the value SURVIVES
      // SYNCHRONIZED on the server actually processing the disconnect
      // (clients map drops A) — no fixed sleep (codex r2 fix 2).
      const countBefore = clientsOf(server).size;
      await until(() => clientsOf(server).size < countBefore, "server processed sockA close");
      expect(editor.getClientLaunchDir()).toBe(shared);
      sockB.destroy(); // last sharer leaves — now it clears
      await until(() => editor.getClientLaunchDir() === undefined, "last sharer clear");

      // codex r2 fix 2: a degenerate SAME-CONNECTION re-handshake (raw
      // JSON-RPC surface) — release-then-set keeps the refcount exact, so
      // the value still clears after ONE disconnect.
      const reSock = await connectWithTimeout(socketPath);
      const reHandshake = (id: number, cwd: string) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`re-handshake timeout ${id}`)), 10_000);
          reSock.on("data", (d) => { clearTimeout(timer); resolve(); });
          reSock.write(request(id, "connect-frame", { clientType: "tui", clientName: "re", clientCwd: cwd }));
        });
      await reHandshake(5, shared);
      await reHandshake(6, shared); // same dir, twice, ONE connection
      expect(editor.getClientLaunchDir()).toBe(shared);
      reSock.destroy();
      await until(() => editor.getClientLaunchDir() === undefined, "re-handshake single release");
      // And a dir CHANGE mid-connection orphans no count: first dir's
      // refcount must not trap a future single client's release.
      const reSock2 = await connectWithTimeout(socketPath);
      const reHandshake2 = (id: number, cwd: string) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`re-handshake timeout ${id}`)), 10_000);
          reSock2.on("data", (d) => { clearTimeout(timer); resolve(); });
          reSock2.write(request(id, "connect-frame", { clientType: "tui", clientName: "re2", clientCwd: cwd }));
        });
      const otherDir2 = makeDir("fikra-ctx-other2");
      await reHandshake2(7, shared);
      await reHandshake2(8, otherDir2); // dir CHANGE on one connection
      expect(editor.getClientLaunchDir()).toBe(otherDir2);
      reSock2.destroy();
      await until(() => editor.getClientLaunchDir() === undefined, "changed-dir release");
      // The orphaned first dir (shared) must clear for a future client:
      const sockC = await connectWithTimeout(socketPath);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect-frame timeout C")), 10_000);
        sockC.on("data", (d) => { clearTimeout(timer); resolve(); });
        sockC.write(request(9, "connect-frame", { clientType: "tui", clientName: "c", clientCwd: shared }));
      });
      expect(editor.getClientLaunchDir()).toBe(shared);
      sockC.destroy();
      await until(() => editor.getClientLaunchDir() === undefined, "orphan-free future release");
    } finally {
      await forceShutdown(server);
    }
  }, 30000);
});

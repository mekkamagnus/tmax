import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file stagehand-remote.test.ts
 * @description #293 — Stagehand T1: push/pull over a PTY. The
 * primitives (:pty t — TTY visibility, bidirectional IO, process-signal
 * INT/TERM/KILL via a signal-logging fixture, the three-press
 * escalation ladder) and the flows against a LOCAL BARE remote
 * (streaming, exit handling, refresh, cancellation, post-mortem q).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const git = (...args: string[]) => execFileSync("git", args, { cwd: process.cwd() }).toString().trim();

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i293-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
  e(editor, "(require-module stagehand/status)");
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const commit = (msg: string) => {
  execFileSync("git", ["add", "."], { cwd: process.cwd() });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg], { cwd: process.cwd() });
};
/** A local BARE remote + origin wiring; returns the remote path. */
const bareRemote = () => {
  const remote = mkdtempSync(join(tmpdir(), "i293r-"));
  dirs.push(remote);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  writeFileSync(join(process.cwd(), "seed.txt"), "seed\n");
  commit("seed"); // an upstream needs a commit to push
  git("remote", "add", "origin", remote);
  git("push", "-q", "-u", "origin", "main");
  return remote;
};
const statusOf = () => {
  e(editor, "(stagehand/status/stagehand-status)");
  return strip(bufferText(editor));
};
const waitRemote = async (ed: Editor, ms = 8000) => {
  for (let i = 0; i < ms / 25; i++) {
    if (!ed ? false : String(e(ed, "(stagehand/remote/stagehand-remote-alive-p)").value) === "false") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("remote op never finished");
};
const popupText = (ed: Editor) => {
  const cur = String(e(ed, "(buffer-current)").value);
  e(ed, '(buffer-switch "*Stagehand-Remote*")');
  const t = strip(bufferText(ed));
  e(ed, `(buffer-switch "${cur}")`);
  return t;
};

describe("#293 — the :pty primitive", () => {
  test(":pty t gives the child a REAL TTY ([ -t 0 ] sees one); pipes do not", async () => {
    e(editor, `(make-process :command '("/bin/sh" "-c" "if [ -t 0 ]; then echo IS_TTY; else echo NOT_TTY; fi > /tmp/i293-tty-$$.out; sleep 0.1") :pty t :cwd "${process.cwd()}")`);
    await new Promise((r) => setTimeout(r, 600));
    // Under script(1) the CHILD sees a tty — verify via a pipe run too.
    const out = execFileSync("/bin/sh", ["-c", "ls /tmp/i293-tty-*.out 2>/dev/null | head -1 | xargs cat 2>/dev/null"]).toString().trim();
    expect(out).toBe("IS_TTY");
    execFileSync("/bin/sh", ["-c", "rm -f /tmp/i293-tty-*.out"]);
  });

  test("INPUT flows to the PTY child verbatim (read + echo)", async () => {
    const pid = Number(String(e(editor, `(make-process :command '("/bin/sh" "-c" "read v; echo GOT:$v") :pty t :cwd "${process.cwd()}" :filter "i293-input-filter" :sentinel "i293-input-sentinel")`).value));
    e(editor, "(defvar *i293-out* nil)");
    e(editor, '(defun i293-input-filter (pid text) (setq *i293-out* (concat (if *i293-out* *i293-out* "") text)))');
    e(editor, '(defun i293-input-sentinel (pid code) nil)');
    await new Promise((r) => setTimeout(r, 400));
    e(editor, `(process-write ${pid} "hello\\n")`);
    for (let i = 0; i < 40; i++) {
      if (String(e(editor, "*i293-out*").value).includes("GOT:hello")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(String(e(editor, "*i293-out*").value)).toContain("GOT:hello");
  });

  test("process-signal INT/TERM observed by a signal-logging fixture; KILL kills", async () => {
    // A fixture that TRAPS INT + TERM and logs them (ignoring), so
    // only SIGKILL can end it.
    writeFileSync(join(tmpdir(), "i293-trap.sh"), "#!/bin/sh\ntrap 'echo GOT-INT' INT\ntrap 'echo GOT-TERM' TERM\nwhile true; do sleep 0.05; done\n");
    execFileSync("chmod", ["+x", join(tmpdir(), "i293-trap.sh")]);
    const pid = Number(String(e(editor, `(make-process :command '("/bin/sh" "${join(tmpdir(), "i293-trap.sh")}") :cwd "${process.cwd()}" :filter "i293-trap-filter" :sentinel "i293-trap-sentinel")`).value));
    e(editor, "(defvar *i293-trap-out* nil)");
    e(editor, '(defun i293-trap-filter (pid text) (setq *i293-trap-out* (concat (if *i293-trap-out* *i293-trap-out* "") text)))');
    e(editor, '(defun i293-trap-sentinel (pid code) (setq *i293-trap-out* (concat (if *i293-trap-out* *i293-trap-out* "") (concat "[EXIT:" (number-to-string code) "]"))))');
    await new Promise((r) => setTimeout(r, 500));
    e(editor, `(signal ${pid} "SIGINT")`);
    await new Promise((r) => setTimeout(r, 600));
    expect(String(e(editor, "*i293-trap-out*").value)).toContain("GOT-INT");
    e(editor, `(signal ${pid} "SIGTERM")`);
    await new Promise((r) => setTimeout(r, 600));
    expect(String(e(editor, "*i293-trap-out*").value)).toContain("GOT-TERM");
    // Still alive (both trapped). KILL ends it (the sentinel fires).
    expect(String(e(editor, "*i293-trap-out*").value)).not.toContain("[EXIT:");
    e(editor, `(signal ${pid} "SIGKILL")`);
    for (let i = 0; i < 40; i++) {
      if (String(e(editor, "*i293-trap-out*").value).includes("[EXIT:")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(String(e(editor, "*i293-trap-out*").value)).toContain("[EXIT:");
  });
});

describe("#293 — push/pull flows (local bare remote)", () => {
  test("P pushes: streams into the popup, exit 0, status 'pushed', the status buffer refreshes", async () => {
    const remote = bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    expect(String(e(editor, "(buffer-current)").value)).toBe("*Stagehand-Remote*");
    await waitRemote(editor);
    expect(String(e(editor, "(editor-status)").value)).toContain("pushed");
    // Success CLOSES the popup in place.
    expect(String(e(editor, '(if (member "*Stagehand-Remote*" (buffer-list)) 1 0)').value)).toBe("0");
    expect(String(e(editor, "(buffer-current)").value)).not.toBe("*Stagehand-Remote*");
    // The remote actually has the commit.
    expect(execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%s"]).toString().trim()).toBe("feat");
  });

  test("p pulls: a new commit from the remote lands in the worktree", async () => {
    const remote = bareRemote();
    // A commit made IN the remote (simulating a collaborator).
    const tree = execFileSync("git", ["--git-dir", remote, "rev-parse", "HEAD^{tree}"]).toString().trim();
    const parent = execFileSync("git", ["--git-dir", remote, "rev-parse", "HEAD"]).toString().trim();
    const newC = execFileSync("git", ["--git-dir", remote, "commit-tree", tree, "-p", parent, "-m", "from-remote"],
      { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString().trim();
    execFileSync("git", ["--git-dir", remote, "update-ref", "refs/heads/main", newC]);
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-pull)");
    await waitRemote(editor);
    expect(String(e(editor, "(editor-status)").value)).toContain("pulled");
    expect(git("log", "-1", "--format=%s")).toBe("from-remote");
  });

  test("exit ≠ 0 → post-mortem: the output RETAINS with the exit status; q then closes", async () => {
    const remote = bareRemote();
    // Make the push fail: a diverged remote (non-FF).
    {
      const tree = execFileSync("git", ["--git-dir", remote, "rev-parse", "HEAD^{tree}"]).toString().trim();
      const parent = execFileSync("git", ["--git-dir", remote, "rev-parse", "HEAD"]).toString().trim();
      const newC = execFileSync("git", ["--git-dir", remote, "commit-tree", tree, "-p", parent, "-m", "divergence"],
        { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString().trim();
      execFileSync("git", ["--git-dir", remote, "update-ref", "refs/heads/main", newC]);
    }
    writeFileSync(join(process.cwd(), "g.txt"), "x\n");
    commit("local");
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await waitRemote(editor);
    expect(String(e(editor, "(editor-status)").value)).toContain("failed");
    expect(popupText(editor)).toMatch(/\[push exit \d+\]/);
    // q closes post-mortem.
    e(editor, "(stagehand/remote/stagehand-remote-quit)");
    expect(String(e(editor, '(if (member "*Stagehand-Remote*" (buffer-list)) 1 0)').value)).toBe("0");
  });

  test("C-c ladder: 1st SIGINT (a clean git aborts), 'interrupted' observable, the popup RETAINED post-mortem", async () => {
    const remote = bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    statusOf();
    // A slow push: a pre-push hook that sleeps, so we can interrupt.
    writeFileSync(join(process.cwd(), ".git", "hooks", "pre-push"), "#!/bin/sh\nsleep 5\n");
    execFileSync("chmod", ["+x", join(process.cwd(), ".git", "hooks", "pre-push")]);
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await new Promise((r) => setTimeout(r, 500));
    expect(String(e(editor, "(stagehand/remote/stagehand-remote-alive-p)").value)).toBe("true");
    // 1st press = SIGINT.
    e(editor, "(stagehand/remote/stagehand-remote-cancel)");
    expect(String(e(editor, "(editor-status)").value)).toContain("SIGINT sent");
    await waitRemote(editor);
    // Process dead + the remote got nothing (the semantic contract).
    expect(String(e(editor, "(stagehand/remote/stagehand-remote-alive-p)").value)).toBe("false");
    // The REAL semantic: the interrupted push never reached the
    // remote (the remote's main is still the seed commit).
    expect(execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%s"]).toString().trim()).toBe("seed");
  });

  test("q DURING a run is PTY INPUT (the popup does NOT close)", async () => {
    bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    writeFileSync(join(process.cwd(), ".git", "hooks", "pre-push"), "#!/bin/sh\nsleep 3\n");
    execFileSync("chmod", ["+x", join(process.cwd(), ".git", "hooks", "pre-push")]);
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await new Promise((r) => setTimeout(r, 400));
    e(editor, "(stagehand/remote/stagehand-remote-quit)"); // q during the run
    expect(String(e(editor, '(if (member "*Stagehand-Remote*" (buffer-list)) 1 0)').value)).toBe("1"); // still open
    expect(String(e(editor, "(stagehand/remote/stagehand-remote-alive-p)").value)).toBe("true"); // still running
    // The q was WRITTEN to the pty — observable: alive + open is the
    // contract (the input is verbatim; the remote owns its meaning).
    e(editor, "(stagehand/remote/stagehand-remote-cancel)");
    await waitRemote(editor);
  });

  test("a second P while running → 'a remote operation is running'", async () => {
    bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    writeFileSync(join(process.cwd(), ".git", "hooks", "pre-push"), "#!/bin/sh\nsleep 2\n");
    execFileSync("chmod", ["+x", join(process.cwd(), ".git", "hooks", "pre-push")]);
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await new Promise((r) => setTimeout(r, 400));
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    expect(String(e(editor, "(editor-status)").value)).toContain("a remote operation is running");
    e(editor, "(stagehand/remote/stagehand-remote-cancel)");
    await waitRemote(editor);
  });

  test("gate r1: an INTERRUPTED push reports HONESTLY (no false 'pushed'; exit >= 128)", async () => {
    const remote = bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    writeFileSync(join(process.cwd(), ".git", "hooks", "pre-push"), "#!/bin/sh\nsleep 5\n");
    execFileSync("chmod", ["+x", join(process.cwd(), ".git", "hooks", "pre-push")]);
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await new Promise((r) => setTimeout(r, 500));
    e(editor, "(stagehand/remote/stagehand-remote-cancel)"); // SIGINT
    await waitRemote(editor);
    // NOT 'pushed' — the old exitCode??0 bug reported success here.
    expect(String(e(editor, "(editor-status)").value)).not.toContain("pushed");
    const exitCode = String(e(editor, "(stagehand/remote/stagehand-remote-last-exit)").value);
    expect(Number(exitCode)).toBeGreaterThanOrEqual(128);
    // The remote got nothing.
    expect(execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%s"]).toString().trim()).toBe("seed");
  });

  test("gate r1: the POPUP KEYMAP binds every printable char to the verbatim dispatcher", async () => {
    bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    writeFileSync(join(process.cwd(), ".git", "hooks", "pre-push"), "#!/bin/sh\nsleep 4\n");
    execFileSync("chmod", ["+x", join(process.cwd(), ".git", "hooks", "pre-push")]);
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await new Promise((r) => setTimeout(r, 400));
    // The popup keymap routes printable chars + Enter to the input
    // dispatchers (the gate's catch: only q/Enter/C-c were bound).
    const ref = (k: string) => String(e(editor, `(keymap-ref (editor/keymaps/buffer-keymap "*Stagehand-Remote*") "${k}")`).value);
    expect(ref("h")).toContain("stagehand-remote-input-key");
    expect(ref("Z")).toContain("stagehand-remote-input-key");
    // gate r2: q KEEPS quit (the dolist clobbered it) — and EVERY
    // printable char resolves (the full 94-domain, not a sample: the
    // raw " and \ codegen made 2 of them unparsable).
    expect(ref("q")).toContain("stagehand-remote-quit");
    // ROUTE-level assertion: every non-q binding's SOURCE carries
    // hex-decode (a raw-char codegen regression would fail here).
    const tableStr = String(e(editor, "(string-join \"\" (stagehand/remote/stagehand-printable-keys-get))").value);
    // gate r4: the Enter + C-c BINDINGS asserted (not just the fns),
    // and the table-length pin (the route guard below derives its
    // domain from the same table — a truncation passes silently).
    expect(ref("Enter")).toContain("stagehand-remote-input-enter");
    expect(ref("C-c")).toContain("stagehand-remote-cancel");
    // codex r1: SPACE + Backspace route verbatim (passphrases have
    // spaces; typos need DEL).
    expect(ref("Space")).toContain("stagehand-remote-input-space");
    expect(ref("Backspace")).toContain("stagehand-remote-input-backspace");
    expect(tableStr.length).toBe(94);
    for (const ch of tableStr) {
      if (ch === "q") continue;
      const r = String(e(editor, `(keymap-ref (editor/keymaps/buffer-keymap "*Stagehand-Remote*") "${ch === '"' ? '\\"' : ch === "\\" ? "\\\\" : ch}")`).value);
      expect(`${ch}:${r}`).toContain("hex-decode");
    }
    // And typing a printable key during the run writes VERBATIM (the
    // echo fixture proves the PTY write; here the binding is the proof).
    e(editor, "(stagehand/remote/stagehand-remote-cancel)");
    await waitRemote(editor);
  });

  test("gate r2: the 1s HOLD-OFF arithmetic (the ms clock) + the ladder signals", async () => {
    // script(1) itself dies on group signals, so a live multi-press
    // run is unreachable — the hold-off GUARD and the signal LADDER
    // are pure functions; assert them directly.
    const held = (gap: number) => Number(String(e(editor, `(if (stagehand/remote/stagehand-press-held-off-p ${gap}) 1 0)`).value));
    expect(held(300)).toBe(1); // 300ms gap: HELD (the r2 catch: 1 never engaged)
    expect(held(1100)).toBe(0); // past 1s: escalates
    const sig = (n: number) => String(e(editor, `(stagehand/remote/stagehand-ladder-signal ${n})`).value);
    expect(sig(1)).toBe("SIGINT");
    expect(sig(2)).toBe("SIGTERM");
    expect(sig(3)).toBe("SIGKILL");
    expect(sig(9)).toBe("SIGKILL");
  });

  test("codex r1: SPACE reaches the PTY child verbatim (a two-word value)", async () => {
    const script = join(tmpdir(), "i293-space.sh");
    writeFileSync(script, "#!/bin/sh\nread v\necho GOT:$v\n");
    execFileSync("chmod", ["+x", script]);
    const spid = Number(String(e(editor, `(make-process :command '("/bin/sh" "${script}") :pty t :cwd "${process.cwd()}" :filter "i293-spc-filter" :sentinel "i293-spc-sentinel")`).value));
    e(editor, "(defvar *spc* nil)");
    e(editor, '(defun i293-spc-filter (pid text) (setq *spc* (concat (if *spc* *spc* "") text)))');
    e(editor, '(defun i293-spc-sentinel (pid code) nil)');
    await new Promise((r) => setTimeout(r, 400));
    e(editor, `(process-write ${spid} " ")`);
    e(editor, `(process-write ${spid} "w")`);
    e(editor, `(process-write ${spid} "\n")`);
    for (let i = 0; i < 40; i++) {
      if (String(e(editor, "*spc*").value).includes("GOT:")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // The PTY ECHO carries the typed space; the shell's `read`
    // trims it (IFS) — the SPACE ARRIVED is proven by the echo.
    expect(String(e(editor, "*spc*").value)).toContain(" w");
    expect(String(e(editor, "*spc*").value)).toContain("GOT:w");
  });

  test("codex r1: repeated runs do NOT accumulate windows (the split closes)", async () => {
    bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    const before = Number(String(e(editor, "(length (window-list))").value));
    for (let i = 0; i < 3; i++) {
      statusOf();
      e(editor, "(stagehand/remote/stagehand-remote-push)");
      await waitRemote(editor);
    }
    const after = Number(String(e(editor, "(length (window-list))").value));
    expect(after).toBe(before); // each run's split closed on success
  });

  test("codex r2: a SIGNAL-RESISTANT PTY child is reaped at the interrupt (the live ladder end)", async () => {
    const remote = bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    // A pre-push hook that TRAPS INT/TERM (the grader's repro shape):
    // C-c kills script; the group reap must take the resistant child.
    const beat = join(process.cwd(), "beat.tmp");
    writeFileSync(join(process.cwd(), ".git", "hooks", "pre-push"),
      `#!/bin/sh\ntrap '' INT TERM HUP\nwhile true; do touch ${beat}; sleep 0.1; done\n`);
    execFileSync("chmod", ["+x", join(process.cwd(), ".git", "hooks", "pre-push")]);
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    await new Promise((r) => setTimeout(r, 600));
    expect(String(e(editor, "(stagehand/remote/stagehand-remote-alive-p)").value)).toBe("true");
    e(editor, "(stagehand/remote/stagehand-remote-cancel)"); // 1st: SIGINT
    expect(String(e(editor, "(editor-status)").value)).toContain("SIGINT sent");
    await new Promise((r) => setTimeout(r, 400));
    // The wrapper died but the TRAP-RESISTANT child lives — the
    // operation stays controllable (the deferred sentinel).
    expect(String(e(editor, "(stagehand/remote/stagehand-remote-alive-p)").value)).toBe("true");
    await new Promise((r) => setTimeout(r, 800)); // past the 1s hold-off
    e(editor, "(stagehand/remote/stagehand-remote-cancel)"); // 2nd: SIGTERM
    expect(String(e(editor, "(editor-status)").value)).toContain("SIGTERM sent");
    await new Promise((r) => setTimeout(r, 1100)); // past the hold-off
    e(editor, "(stagehand/remote/stagehand-remote-cancel)"); // 3rd: SIGKILL
    await waitRemote(editor);
    await new Promise((r) => setTimeout(r, 500));
    // HEARTBEAT assertion (ps|grep self-matches the tooling's own
    // command lines on this host): the beat file's mtime must STOP
    // advancing after the KILL — two samples, 700ms apart, equal.
    const mtime = () => execFileSync("stat", ["-f", "%m", beat]).toString().trim();
    const s1 = mtime();
    await new Promise((r) => setTimeout(r, 700));
    const s2 = mtime();
    expect(s2).toBe(s1);
    // r4: the sentinel reports the signal that ENDED the operation —
    // SIGKILL (137), not the wrapper's initial SIGINT (130).
    expect(String(e(editor, "(stagehand/remote/stagehand-remote-last-exit)").value)).toBe("137");
    // The remote got nothing.
    expect(execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%s"]).toString().trim()).toBe("seed");
  });

  test("codex r2: focus moves mid-run — the popup window still closes on success", async () => {
    bareRemote();
    writeFileSync(join(process.cwd(), "f.txt"), "v1\n");
    commit("feat");
    statusOf();
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    // Focus moves AWAY while the push runs (the realistic form:
    // other-window focuses the other pane; the popup window keeps
    // showing the popup).
    e(editor, "(editor/commands/windows/other-window)");
    await waitRemote(editor);
    expect(String(e(editor, "(editor-status)").value)).toContain("pushed");
    // The window count is back to baseline (the split closed despite
    // the focus move).
    expect(Number(String(e(editor, "(length (window-list))").value))).toBe(1);
  });

  test("no repository → the refusal status", () => {
    const dir = mkdtempSync(join(tmpdir(), "i293nr-"));
    dirs.push(dir);
    process.chdir(dir);
    editor.setClientLaunchDir(dir);
    e(editor, "(stagehand/status/stagehand-status)");
    e(editor, "(stagehand/remote/stagehand-remote-push)");
    expect(String(e(editor, "(editor-status)").value)).toContain("no repository");
  });
});

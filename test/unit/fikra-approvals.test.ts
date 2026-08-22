import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { confirmationService } from "../../src/editor/api/confirmation-service.ts";
import { createConfirmationHandlers } from "../../src/server/rpc/handlers/confirmation.ts";

// #219 (RFC-027 §D5 L1) — runtime modes: four presets, strictness-ordered
// degradation, per-backend fallback fixtures, trust state, mode-aware
// modeline. All keyless (replay backend + checked-in fixtures).
// #220 (§D5 L2) — interactive approvals: the MCP bridge is exercised in
// mcp-confirmation-shim.test.ts; here the FIKRA policy rides the generic
// daemon primitive (confirmation/mediate) end-to-end.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-l1-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  // .tmax/ gitignored per the #218 fixture rule.
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of repoDirs) rmSync(d, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

async function setup(backend = "replay"): Promise<Editor> {
  const editor = await createStartedEditor("");
  e(editor, "(require-module fikra/modes)");
  e(editor, "(require-module fikra/adapter)");
  e(editor, "(require-module fikra/thread)");
  e(editor, "(fikra/thread/fikra-thread-init)");
  // Forced (no availability probe): keyless fixture tests must not
  // depend on the runner having the CLI installed.
  e(editor, `(fikra/adapter/fikra-set-backend-forced "${backend}")`);
  return editor;
}

describe("#219 L1 — runtime mode defaults + lifecycle", () => {
  test("default is approval-required (the deliberate t3code divergence)", async () => {
    const editor = await setup();
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("approval-required");
    // Persisted in thread state and reloads after a fresh editor on the same repo.
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    const state = JSON.parse(readFileSync(join(repoDir, ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(state["runtime-mode"]).toBe("full-access");
  });

  test("SPC a m (set-runtime-mode) changes mid-thread; unknown mode refused", async () => {
    const editor = await setup();
    expect(String(e(editor, '(fikra/modes/fikra-set-runtime-mode "auto")').value)).toBe("auto");
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("auto");
    expect(String(e(editor, '(fikra/modes/fikra-set-runtime-mode "banana")').value)).toBe("null");
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("auto");
  });

  test("SPC a m prompt surface: table offers exactly the four modes; accept sets it", async () => {
    const editor = await setup();
    // The completion table (non-metadata action → candidates). Extract the
    // "value" field in T-Lisp (hashmap entries don't cross the bridge).
    const cands = (e(editor, '(mapcar (lambda (c) (hashmap-get c "value")) (fikra/modes/fikra-runtime-mode-table "" ""))').value as { value: string }[]).map((v) => String(v.value));
    expect(cands).toEqual(["approval-required", "auto-accept-edits", "auto", "full-access"]);
    // The accept handler is what the minibuffer invokes on RET.
    expect(String(e(editor, '(fikra/modes/fikra-runtime-mode-accept "full-access")').value)).toBe("full-access");
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("full-access");
  });
});

describe("#219 L1 — fixture-driven fallback matrices", () => {
  // Fixtures derived from the RECORDED CLI surfaces (checked in modes.tlisp:
  // claude 2.1.195, codex-cli 0.147.0, recorded 2026-08-22). Rows cover ALL
  // FOUR modes for both backends. NOTE the recorded-surface discovery: the
  // original issue fixture assumed codex could not express `auto`
  // (--ask-for-approval era) and claude approximated it — the CURRENT
  // surfaces give claude a native `auto` choice and codex `--approve-for-me`,
  // so all four modes are expressible on BOTH backends and nothing degrades.
  // The issue's governing rule still applies: semantics the surface cannot
  // verify DEGRADE (pinned below via synthetic + unknown-backend cases).
  const CLAUDE_FIXTURE: Array<{ requested: string; flags: string[]; effective: string }> = [
    { requested: "approval-required", flags: ["--permission-mode", "default"], effective: "approval-required" },
    { requested: "auto-accept-edits", flags: ["--permission-mode", "acceptEdits"], effective: "auto-accept-edits" },
    { requested: "auto", flags: ["--permission-mode", "auto"], effective: "auto" },
    { requested: "full-access", flags: ["--permission-mode", "bypassPermissions"], effective: "full-access" },
  ];
  const CODEX_FIXTURE: Array<{ requested: string; flags: string[]; effective: string }> = [
    { requested: "approval-required", flags: ["--sandbox", "read-only"], effective: "approval-required" },
    { requested: "auto-accept-edits", flags: ["--sandbox", "workspace-write"], effective: "auto-accept-edits" },
    { requested: "auto", flags: ["--sandbox", "workspace-write", "--approve-for-me"], effective: "auto" },
    { requested: "full-access", flags: ["--dangerously-bypass-approvals-and-sandbox"], effective: "full-access" },
  ];

  test("claude expresses all four; adapter flags match the fixture for every mode", async () => {
    const editor = await setup("claude");
    for (const row of CLAUDE_FIXTURE) {
      e(editor, `(fikra/modes/fikra-set-runtime-mode "${row.requested}")`);
      // Adapters consume the EFFECTIVE mode (post-degradation) — that is
      // the mode actually handed to the CLI.
      const gotFlags = (e(editor, "(fikra/modes/fikra-claude-flags (fikra/modes/fikra-effective-mode))").value as { value: string }[]).map((v) => String(v.value));
      expect(gotFlags).toEqual(row.flags);
      const gotEffective = String(e(editor, "(fikra/modes/fikra-effective-mode)").value);
      expect(gotEffective).toBe(row.effective);
    }
  });

  test("codex (0.147 surface): all four expressible — --approve-for-me IS auto", async () => {
    const editor = await setup("codex");
    for (const row of CODEX_FIXTURE) {
      e(editor, `(fikra/modes/fikra-set-runtime-mode "${row.requested}")`);
      const gotFlags = (e(editor, "(fikra/modes/fikra-codex-flags (fikra/modes/fikra-effective-mode))").value as { value: string }[]).map((v) => String(v.value));
      expect(gotFlags).toEqual(row.flags);
      expect(String(e(editor, "(fikra/modes/fikra-effective-mode)").value)).toBe(row.effective);
    }
  });

  test("unmapped modes return nil from translators — never a silent default", async () => {
    const editor = await setup("codex");
    expect(String(e(editor, '(fikra/modes/fikra-codex-flags "banana")').value)).toBe("null");
    expect(String(e(editor, '(fikra/modes/fikra-claude-flags "banana")').value)).toBe("null");
    // The defensive mode-arg helper still yields the conservative value.
    expect(String(e(editor, '(fikra/modes/fikra-claude-mode-arg "banana")').value)).toBe("default");
  });

  test("degradation always picks the NEAREST STRICTER expressible mode, never looser", async () => {
    const editor = await setup();
    // Synthetic expressible list (what a future surface gap produces):
    // auto missing → nearest stricter is auto-accept-edits — NOT
    // full-access (looser) and NOT approval-required (two steps away).
    expect(String(e(editor, '(fikra/modes/fikra-runtime-mode-degrade "auto" (list "approval-required" "auto-accept-edits" "full-access"))').value)).toBe("auto-accept-edits");
    // auto-accept-edits missing → approval-required (the only stricter one).
    expect(String(e(editor, '(fikra/modes/fikra-runtime-mode-degrade "auto-accept-edits" (list "approval-required" "full-access"))').value)).toBe("approval-required");
    // Nothing expressible at all → the conservative base.
    expect(String(e(editor, '(fikra/modes/fikra-runtime-mode-degrade "full-access" (list))').value)).toBe("approval-required");
  });

  test("unknown backend: no surface record → everything degrades to approval-required", async () => {
    const editor = await setup("nonexistent");
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    expect(String(e(editor, "(fikra/modes/fikra-effective-mode)").value)).toBe("approval-required");
  });

  test("escape hatch: set-default-runtime-mode changes the default for unset threads", async () => {
    const editor = await setup();
    // Module defvars aren't setq-able cross-module — the setter IS the
    // escape hatch (init.tlisp calls it).
    e(editor, '(fikra/modes/fikra-set-default-runtime-mode "full-access")');
    expect(String(e(editor, "(fikra/modes/fikra-runtime-mode)").value)).toBe("full-access");
  });
});

describe("#219 L1 — thread trust state (L2 groundwork)", () => {
  test("trust-add records a class once (idempotent); trust-has-p queries; PERSISTS", async () => {
    const editor = await setup();
    expect(String(e(editor, '(fikra/modes/fikra-trust-add "Edit")').type)).toBe("boolean");
    e(editor, '(fikra/modes/fikra-trust-add "Edit")'); // idempotent
    const trust = e(editor, '(fikra/thread/fikra-thread-field "trust")');
    const entries = (trust.value as { value: string }[]).map((v) => String(v.value));
    expect(entries.filter((t) => t === "Edit")).toHaveLength(1);
    expect(String(e(editor, '(fikra/modes/fikra-trust-has-p "Edit")').value)).toBe("true");
    expect(String(e(editor, '(fikra/modes/fikra-trust-has-p "Bash")').value)).toBe("null");
    // Gate catch: trust was in-memory only — the writer didn't persist the
    // field, so trust died on restart. Now state.json carries it.
    const state = JSON.parse(readFileSync(join(repoDir, ".tmax/fikra/threads/main/state.json"), "utf8"));
    expect(state.trust).toContain("Edit");
    // And a FRESH editor on the same repo reads it back (codex-review
    // catch: persisted ≠ reloaded).
    const editor2 = await createStartedEditor("");
    e(editor2, "(require-module fikra/modes)");
    e(editor2, "(require-module fikra/thread)");
    e(editor2, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor2, '(fikra/modes/fikra-trust-has-p "Edit")').value)).toBe("true");
  });
});

describe("#219 L1 — degradation explain message + persistence chain", () => {
  test("a degrading set emits the ONE-TIME explain message; lighter refresh does not repeat it", async () => {
    const editor = await setup("nonexistent");
    const msgsBefore = editor.getMessageLog().getEntries().length;
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    const after = editor.getMessageLog().getEntries().slice(msgsBefore);
    const explain = after.filter((m) => m.text.includes("cannot express"));
    expect(explain).toHaveLength(1); // fires exactly once, at set time
    expect(explain[0]!.text).toContain("full-access");
    expect(explain[0]!.text).toContain("approval-required"); // names both
    // Not repeated per-render (the star persists the signal).
    e(editor, "(fikra/modes/fikra-refresh-mode-lighter)");
    expect(editor.getMessageLog().getEntries().slice(msgsBefore).filter((m) => m.text.includes("cannot express"))).toHaveLength(1);
  });

  test("an expressible set emits NO explain message", async () => {
    const editor = await setup("claude");
    const msgsBefore = editor.getMessageLog().getEntries().length;
    e(editor, '(fikra/modes/fikra-set-runtime-mode "auto")');
    expect(editor.getMessageLog().getEntries().slice(msgsBefore).filter((m) => m.text.includes("cannot express"))).toHaveLength(0);
  });

  test("set-mode persists across editors (state.json reload)", async () => {
    const editor = await setup("claude");
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    // A FRESH editor on the same repo reloads state.json.
    const editor2 = await createStartedEditor("");
    e(editor2, "(require-module fikra/modes)");
    e(editor2, "(require-module fikra/thread)");
    e(editor2, "(fikra/thread/fikra-thread-init)");
    expect(String(e(editor2, "(fikra/modes/fikra-runtime-mode)").value)).toBe("full-access");
  });

  test("SPC a m is registered in the normal-mode keymap", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/mode)");
    // key-binding returns the parsed command (segment list) — flatten it.
    const binding = JSON.stringify(e(editor, '(key-binding "SPC a m" "normal")').value);
    expect(binding).toContain("fikra-runtime-mode-prompt");
  });

  test("the LIVE claude adapter consumes the effective mode (codex-review catch)", async () => {
    const editor = await setup("claude");
    e(editor, "(require-module fikra/backend-claude)");
    // Default: approval-required → --permission-mode default.
    let args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "hi" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).toContain("default");
    // Changing the mode CHANGES the spawned turn's flags — before the fix
    // this was hard-coded "default" and the mode was decorative.
    e(editor, '(fikra/modes/fikra-set-runtime-mode "auto")');
    args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "hi" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).toContain("auto");
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "hi" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).toContain("bypassPermissions");
    // Degradation reaches the CLI too: unknown backend degrades auto →
    // approval-required → the args stay conservative.
    e(editor, '(fikra/adapter/fikra-set-backend-forced "nonexistent")');
    e(editor, '(fikra/modes/fikra-set-runtime-mode "auto")');
    args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "hi" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).toContain("default");
  });
});

describe("#219 L1 — mode-aware modeline", () => {
  test("effective mode always shown; degradation renders the star", async () => {
    const editor = await setup("nonexistent");
    e(editor, '(fikra/modes/fikra-set-runtime-mode "full-access")');
    e(editor, "(require-module fikra/chat)");
    e(editor, "(fikra/chat/fikra-refresh-lighter)");
    const lighter = String(e(editor, '(minor-mode-lighter "fikra")').value);
    expect(lighter).toContain("approval-required"); // EFFECTIVE mode shown
    expect(lighter).toContain("*"); // degradation star
    // Expressible mode → effective == requested → no star (codex's
    // recorded 0.147 surface expresses auto via --approve-for-me).
    e(editor, '(fikra/adapter/fikra-set-backend-forced "codex")');
    e(editor, '(fikra/modes/fikra-set-runtime-mode "auto")');
    e(editor, "(fikra/chat/fikra-refresh-lighter)");
    const lighter2 = String(e(editor, '(minor-mode-lighter "fikra")').value);
    expect(lighter2).toContain("auto");
    expect(lighter2).not.toContain("*");
  });

  test("PRE-CHAT fallback lighter: same format without fikra/chat loaded", async () => {
    // Gate round-2 catch: the condition-case fallback (funcall-on-string
    // of the chat refresh fails → modes' own renderer) was never pinned.
    // No fikra/chat here — mode (define-minor-mode registers the mode) +
    // modes + thread. Activate directly (chat-open normally does this).
    const editor = await setup("codex");
    e(editor, "(require-module fikra/mode)");
    e(editor, '(minor-mode-set "fikra" t)');
    e(editor, '(fikra/modes/fikra-set-runtime-mode "auto")');
    const lighter = String(e(editor, '(minor-mode-lighter "fikra")').value);
    // codex expresses auto → no star; state idle → ●.
    expect(lighter).toBe("fikra:codex●:auto");
    // Degraded (unknown backend) → star, same shape as chat's renderer.
    e(editor, '(fikra/adapter/fikra-set-backend-forced "nonexistent")');
    e(editor, '(fikra/modes/fikra-refresh-mode-lighter)');
    expect(String(e(editor, '(minor-mode-lighter "fikra")').value)).toBe("fikra:nonexistent●:approval-required*");
  });
});

// ══════════════════════════════════════════════════════════════════════
// #220 (RFC-027 §D5 L2) — interactive approvals on the generic primitive
// ══════════════════════════════════════════════════════════════════════

/** Drive the REAL daemon-side handler (the same object server.ts routes
 * to) — the mediate parks, the fikra handler runs, resolution is T-Lisp. */
async function mediate(token: string, kind: string, detail: string): Promise<{ decision: string; scope: string }> {
  const handlers = createConfirmationHandlers({} as never);
  return handlers["confirmation/mediate"]({ source: "fikra", token, kind, detail, timeoutMs: 60_000 });
}

async function l2setup(): Promise<Editor> {
  const editor = await createStartedEditor("");
  e(editor, "(require-module fikra/approvals)");
  e(editor, "(require-module fikra/thread)");
  e(editor, "(require-module fikra/adapter)");
  e(editor, "(fikra/thread/fikra-thread-init)");
  e(editor, "(fikra/adapter/fikra-set-backend-forced \"replay\")");
  e(editor, "(fikra/thread/fikra-thread-turn-begin)");
  confirmationService.resolverHint = "interactive"; // default: no headless stamp
  return editor;
}

describe("#220 L2 — live enqueue drives the prompt UI headlessly", () => {
  beforeEach(() => { confirmationService.reset(); });

  test("mediate parks → permission-request renders → confirming state; y resolves the parked RPC", async () => {
    const editor = await l2setup();
    const token = String(e(editor, '(confirmation-token-mint "fikra" "main/1")').value);
    const parked = mediate(token, "write-file", "write to src/x.ts");
    // The fikra handler ran at park time: pending + confirming + prompt line.
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    const replayed = String(e(editor, "(fikra/event/fikra-event-replay)").value);
    expect(replayed).toContain("? write-file: write to src/x.ts");
    expect(replayed).toContain("[y] Allow");
    // Answer allow → the parked daemon RPC settles allow.
    expect(String(e(editor, "(fikra/approvals/fikra-approval-answer-allow)").value)).toBe("true");
    expect((await parked).decision).toBe("allow");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("null");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    // The decision is in the FAEP log (auditable).
    expect(String(e(editor, "(fikra/event/fikra-event-replay)").value)).toContain("= allow");
  });
});

describe("#220 L2 — THE GATE TEST: headless clients cannot resolve", () => {
  beforeEach(() => { confirmationService.reset(); });

  test("agent-spawned eval resolve DENIED + prompt stays pending; attached client then resolves", async () => {
    const editor = await l2setup();
    const token = String(e(editor, '(confirmation-token-mint "fikra" "main/1")').value);
    const parked = mediate(token, "bash", "rm -rf /tmp/thing");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    // THE THREAT: the agent (Bash access) spawns `tmaxclient --eval
    // "(fikra-approval-answer-allow)"`. The daemon stamps eval dispatches
    // headless (server.ts) — here we stamp the same fact directly.
    confirmationService.resolverHint = "headless";
    expect(String(e(editor, "(fikra/approvals/fikra-approval-answer-allow)").value)).toBe("null");
    // Denied: the prompt STAYS pending, the RPC stays parked.
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("true");
    expect((confirmationService.pendingList())).toHaveLength(1);
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("confirming");
    // A second ATTACHED client (keypress dispatch → interactive) resolves.
    confirmationService.resolverHint = "interactive";
    expect(String(e(editor, "(fikra/approvals/fikra-approval-answer-allow)").value)).toBe("true");
    expect((await parked).decision).toBe("allow");
    expect(confirmationService.pendingList()).toHaveLength(0);
  });

  test("guard override (deliberate init.tlisp act) permits headless resolution", async () => {
    const editor = await l2setup();
    e(editor, "(defun my-permissive-guard () t)");
    e(editor, '(fikra/approvals/fikra-set-approval-guard "my-permissive-guard")');
    const token = String(e(editor, '(confirmation-token-mint "fikra" "main/1")').value);
    const parked = mediate(token, "write-file", "x");
    confirmationService.resolverHint = "headless";
    expect(String(e(editor, "(fikra/approvals/fikra-approval-answer-reject)").value)).toBe("true");
    expect((await parked).decision).toBe("reject");
  });
});

describe("#220 L2 — token gates: forged / stale / cross-turn reject pre-prompt", () => {
  beforeEach(() => { confirmationService.reset(); });

  test("forged token → immediate reject, NO prompt (no permission-request event)", async () => {
    const editor = await l2setup();
    const eventsBefore = String(e(editor, "(fikra/event/fikra-event-replay)").value);
    const result = await mediate("forged-token-not-minted", "bash", "evil");
    expect(result.decision).toBe("reject");
    expect(confirmationService.pendingList()).toHaveLength(0);
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("null");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("running");
    expect(String(e(editor, "(fikra/event/fikra-event-replay)").value)).toBe(eventsBefore); // no prompt event
  });

  test("stale (single-use) token → reject on reuse", async () => {
    const editor = await l2setup();
    const token = String(e(editor, '(confirmation-token-mint "fikra" "main/1")').value);
    const first = mediate(token, "write-file", "one");
    e(editor, "(fikra/approvals/fikra-approval-answer-allow)");
    expect((await first).decision).toBe("allow");
    const second = await mediate(token, "write-file", "two");
    expect(second.decision).toBe("reject"); // used token — no second prompt
    expect(confirmationService.pendingList()).toHaveLength(0);
  });

  test("cross-turn token (scope names an old turn) → handler rejects before any prompt", async () => {
    const editor = await l2setup(); // turn-count is now 1
    const stale = String(e(editor, '(confirmation-token-mint "fikra" "main/0")').value);
    const result = await mediate(stale, "bash", "late arrival from a dead turn");
    expect(result.decision).toBe("reject");
    expect(confirmationService.pendingList()).toHaveLength(0); // never parked for prompting
    expect(String(e(editor, "(fikra/approvals/fikra-approval-pending-p)").value)).toBe("null");
    expect(String(e(editor, "(fikra/thread/fikra-thread-status)").value)).toBe("running"); // never entered confirming
  });
});

describe("#220 L2 — always-allow promotes to trust + --allowedTools", () => {
  beforeEach(() => { confirmationService.reset(); });

  test("'always' writes thread trust; the next turn's claude args carry --allowedTools", async () => {
    const editor = await l2setup();
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, '(fikra/backend-claude/fikra-claude-set-approvals-override "off")'); // pin: no L2 flags noise
    // Before trust: no --allowedTools.
    let args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "q" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).not.toContain("--allowedTools");
    // Answer always on an Edit-class request.
    const token = String(e(editor, '(confirmation-token-mint "fikra" "main/1")').value);
    const parked = mediate(token, "Edit", "edit src/x.ts");
    expect(String(e(editor, "(fikra/approvals/fikra-approval-answer-always)").value)).toBe("true");
    expect((await parked).decision).toBe("always");
    expect(String(e(editor, '(fikra/modes/fikra-trust-has-p "Edit")').value) === "true").toBe(true);
    // The promotion: the next turn's args silence the same class.
    args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "q" nil)').value as { value: string }[]).map((v) => String(v.value));
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("Edit");
  });
});

describe("#220 L2 — capability gating (claude-first, probe-driven)", () => {
  beforeEach(() => { confirmationService.reset(); });

  test("hook ABSENT (\"off\"): args omit --mcp-config/--permission-prompt-tool; write-mcp-config no-ops", async () => {
    const editor = await l2setup();
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, '(fikra/backend-claude/fikra-claude-set-approvals-override "off")');
    expect(String(e(editor, "(fikra/backend-claude/fikra-claude-write-mcp-config)").value)).toBe("null");
    const args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "q" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--permission-prompt-tool");
    // The recorded 2.1.195 surface lacks the hook — the REAL probe (no
    // override) also reports absent on this machine. (Not asserted as a
    // test: a future CLI gaining the hook must flip it, by design.)
  });

  test("hook PRESENT (\"on\"): adapter mints the token, writes --mcp-config, args wire the prompt tool", async () => {
    const editor = await l2setup();
    e(editor, "(require-module fikra/backend-claude)");
    e(editor, '(fikra/backend-claude/fikra-claude-set-approvals-override "on")');
    const token = String(e(editor, "(fikra/backend-claude/fikra-claude-write-mcp-config)").value);
    expect(token).toMatch(/^[0-9a-f]{48}$/); // the minted one-time token
    // The config file exists, parses, and plants source+token in argv —
    // the token never transits model-controlled space.
    const configPath = join(repoDir, ".tmax/fikra/mcp/main-1.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers: { "tmax-confirmation": { command: string; args: string[] } } };
    expect(config.mcpServers["tmax-confirmation"].command).toBe("bun");
    expect(config.mcpServers["tmax-confirmation"].args).toEqual(["bin/tmax-mcp-confirmation.ts", "fikra", token]);
    // The turn's args reference the config + claude's MCP tool name.
    const args = (e(editor, '(fikra/backend-claude/fikra-backend-claude-args "q" nil)').value as { value: string }[]).map((v) => String(v.value));
    expect(args).toContain("--mcp-config");
    expect(args).toContain("mcp__tmax-confirmation__permission");
    e(editor, '(fikra/backend-claude/fikra-claude-set-approvals-override "off")');
  });
});

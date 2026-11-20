import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// RFC-029 §8.7 (codex round 25) — .fikra/skills discovery: frontmatter-
// scoped visibility, defworkflow rows in the picker, the model-visible
// roster, and the accept dispatch (skill turn vs defworkflow run).

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;

let repoDir = "";
const repoDirs: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "fikra-sk-"));
  repoDirs.push(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repoDir });
  writeFileSync(join(repoDir, ".gitignore"), ".tmax/\n");
  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const d of repoDirs) rmSync(d, { recursive: true, force: true });
});

const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

function writeSkill(name: string, body: string): void {
  mkdirSync(join(repoDir, ".fikra", "skills", name), { recursive: true });
  writeFileSync(join(repoDir, ".fikra", "skills", name, "SKILL.md"), body);
}

async function setup(): Promise<Editor> {
  const editor = await createStartedEditor("");
  e(editor, '(require-module "fikra/skills")');
  e(editor, "(require-module fikra/adapter)");
  e(editor, "(require-module fikra/backend-replay)");
  writeFileSync(join(repoDir, "f.jsonl"), '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n');
  e(editor, '(fikra/backend-replay/fikra-backend-replay-load "f.jsonl")');
  e(editor, '(fikra/adapter/fikra-set-backend "replay")');
  return editor;
}

const row = (editor: Editor, i: number, key: string) =>
  e(editor, `(hashmap-get (nth ${i} (fikra/skills/fikra-skill-table "" "rows")) "${key}")`);

const rowMeta = (editor: Editor, i: number, key: string) =>
  e(editor, `(hashmap-get (hashmap-get (nth ${i} (fikra/skills/fikra-skill-table "" "rows")) "metadata") "${key}")`);

describe("#8.7 skills — frontmatter visibility", () => {
  test("visibility: user in the leading frontmatter block is user-only", async () => {
    writeSkill("secret", "---\nname: secret\nvisibility: user\n---\nbody\n");
    const editor = await setup();
    expect(String(e(editor, "(fikra/skills/fikra-skills-refresh)").value)).toBe("1");
    expect(String(row(editor, 0, "display").value)).toContain("secret");
    expect(String(rowMeta(editor, 0, "visibility").value)).toBe("user-only");
  });

  test("a visibility: user phrase in the BODY does not mislabel (codex r25 fix 3)", async () => {
    writeSkill("leaky", "---\nname: leaky\n---\nif the text says visibility: user it is still model-visible\n");
    const editor = await setup();
    e(editor, "(fikra/skills/fikra-skills-refresh)");
    expect(String(rowMeta(editor, 0, "visibility").value)).toBe("model-visible");
  });

  test("no frontmatter at all defaults to model-visible", async () => {
    writeSkill("bare", "just instructions\n");
    const editor = await setup();
    e(editor, "(fikra/skills/fikra-skills-refresh)");
    expect(String(rowMeta(editor, 0, "visibility").value)).toBe("model-visible");
  });
});

describe("#8.7 skills — defworkflow rows (codex r25 fix 2)", () => {
  test("registered workflows appear with the init.tlisp annotation", async () => {
    writeSkill("one", "---\nname: one\n---\nbody\n");
    const editor = await setup();
    e(editor, "(require-module fikra/workflow)");
    e(editor, '(fikra/workflow/fikra-register-workflow "nightly-triage" "do the triage")');
    e(editor, "(fikra/skills/fikra-skills-refresh)");
    const n = Number(e(editor, '(length (fikra/skills/fikra-skill-table "" "rows"))').value);
    expect(n).toBe(2);
    const wf = e(editor, '(car (fikra/skills/fikra-skill-table "" "rows"))');
    // The workflow row sorts after skills only by construction (skills first).
    // Find it explicitly:
    const found = e(editor, `
      (let ((rows (fikra/skills/fikra-skill-table "" "rows")) (hit nil))
        (dolist (r rows)
          (if (string= (hashmap-get r "display") "defworkflow nightly-triage")
            (setq hit r)))
        (hashmap-get (hashmap-get hit "metadata") "visibility"))`);
    expect(String(found.value)).toBe("T-Lisp program");
    expect(String(wf.value)).toBeTruthy();
  });
});

describe("#8.7 skills — codex r26 fixes", () => {
  test("anchored visibility: a frontmatter line 'notes: ... visibility: user ...' does not mislabel", async () => {
    writeSkill("tricky", "---\nname: tricky\nnotes: see docs on visibility: user handling\n---\nbody\n");
    const editor = await setup();
    e(editor, "(fikra/skills/fikra-skills-refresh)");
    // Assert the SCAN classification (fix 2's unit) and the anchored parser
    // directly — both deterministic regardless of the rows pipeline state.
    expect(String(e(editor, '(hashmap-get (car (fikra/skills/fikra-skills-list)) "visibility")').value)).toBe("model-visible");
    expect(String(e(editor, '(if (fikra/skills/fikra-skill-fm-value "notes: see docs on visibility: user handling" "visibility") "NOT-NIL" "NIL")').value)).toBe("NIL");
  });

  test("the picker opens with workflows only (no .fikra/skills present)", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/workflow)");
    e(editor, '(fikra/workflow/fikra-register-workflow "solo-flow" "just a workflow")');
    // No skill files in this repo — rows must still expose the workflow.
    const n = Number(e(editor, '(length (fikra/skills/fikra-skill-table "" "rows"))').value);
    expect(n).toBe(1);
  });

  test("the cache rescans when the thread root changes", async () => {
    writeSkill("here", "---\nname: here\n---\nbody\n");
    const editor = await setup();
    expect(Number(e(editor, "(fikra/skills/fikra-skills-refresh)").value)).toBe(1);
    // Fresh temp root with a different skill count; switch the thread root.
    const other = mkdtempSync(join(tmpdir(), "fikra-sk2-"));
    mkdirSync(join(other, ".fikra", "skills", "a"), { recursive: true });
    mkdirSync(join(other, ".fikra", "skills", "b"), { recursive: true });
    writeFileSync(join(other, ".fikra", "skills", "a", "SKILL.md"), "---\nname: a\n---\nx\n");
    writeFileSync(join(other, ".fikra", "skills", "b", "SKILL.md"), "---\nname: b\n---\nx\n");
    e(editor, `(fikra/thread/fikra-thread-set-field "root" "${other}")`);
    expect(Number(e(editor, "(length (fikra/skills/fikra-skills-list))").value)).toBe(2); // stale root -> rescan
    const rows = Number(e(editor, '(length (fikra/skills/fikra-skill-table "" "rows"))').value);
    expect(rows).toBe(2);
  });
});

describe("#8.7 skills — codex r27 fixes", () => {
  test("fm-value parses 'visibility:user' (no space) as user, not 'ser'", async () => {
    const editor = await setup();
    expect(String(e(editor, '(fikra/skills/fikra-skill-fm-value "visibility:user" "visibility")').value)).toBe("user");
    expect(String(e(editor, '(fikra/skills/fikra-skill-fm-value "visibility:   user " "visibility")').value)).toBe("user");
    expect(String(e(editor, '(if (fikra/skills/fikra-skill-fm-value "visibility:" "visibility") "X" "NIL")').value)).toBe("NIL");
  });

  test("a skill edit invalidates the cache (modtime stamp)", async () => {
    writeSkill("mut", "---\nname: mut\n---\noriginal\n");
    const editor = await setup();
    expect(Number(e(editor, "(fikra/skills/fikra-skills-refresh)").value)).toBe(1);
    expect(String(e(editor, '(hashmap-get (car (fikra/skills/fikra-skills-list)) "description")').value)).toBe("original");
    // Edit the SKILL.md on disk (same root) — the cache must not serve stale.
    writeFileSync(join(repoDir, ".fikra", "skills", "mut", "SKILL.md"), "---\nname: mut\ndescription: edited\n---\nchanged\n");
    const { utimesSync } = await import("node:fs");
    const later = new Date(Date.now() + 3000);
    utimesSync(join(repoDir, ".fikra", "skills", "mut", "SKILL.md"), later, later);
    expect(String(e(editor, '(hashmap-get (car (fikra/skills/fikra-skills-list)) "description")').value)).toBe("edited");
  });

  test("a skill added after the first scan is picked up (add-path invalidation)", async () => {
    const editor = await setup();
    expect(Number(e(editor, "(fikra/skills/fikra-skills-refresh)").value)).toBe(0);
    writeSkill("late", "---\nname: late\n---\nadded after the first scan\n");
    expect(Number(e(editor, "(length (fikra/skills/fikra-skills-list))").value)).toBe(1);
  });

  test("an apostrophe root does not break the scan or stamp (quoting regression)", async () => {
    // A root whose path contains a single quote — the old literal-quote ls
    // broke (and could inject); shq must survive it.
    const quoted = mkdtempSync(join(tmpdir(), "fikra-sk'quote-"));
    execFileSync("git", ["init", "-q"], { cwd: quoted });
    writeFileSync(join(quoted, ".gitignore"), ".tmax/\n");
    mkdirSync(join(quoted, ".fikra", "skills", "q"), { recursive: true });
    writeFileSync(join(quoted, ".fikra", "skills", "q", "SKILL.md"), "---\nname: q\n---\nquoted root\n");
    const editor = await setup();
    e(editor, `(fikra/thread/fikra-thread-set-field "root" "${quoted}")`);
    expect(Number(e(editor, "(fikra/skills/fikra-skills-refresh)").value)).toBe(1);
    expect(String(e(editor, '(hashmap-get (car (fikra/skills/fikra-skills-list)) "id")').value)).toBe("fikra-skill q");
    // The stamp path runs the same quoted ls — a second list call exercises it.
    expect(Number(e(editor, "(length (fikra/skills/fikra-skills-list))").value)).toBe(1);
  });

  test("the picker gate is testable: workflows-only passes", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/workflow)");
    e(editor, '(fikra/workflow/fikra-register-workflow "solo" "x")');
    expect(String(e(editor, "(fikra/skills/fikra-skills-any-rows-p)").value)).toBe("true");
  });
});

describe("#8.7 skills — model roster (codex r25 fix 1)", () => {
  test("model-visible only; user-only excluded", async () => {
    writeSkill("pub", "---\nname: pub\ndescription: Public skill\n---\nbody\n");
    writeSkill("priv", "---\nname: priv\ndescription: Private skill\nvisibility: user\n---\nbody\n");
    const editor = await setup();
    e(editor, "(fikra/skills/fikra-skills-refresh)");
    const roster = String(e(editor, "(fikra/skills/fikra-skills-model-roster)").value);
    expect(roster).toContain("fikra-skill pub");
    expect(roster).toContain("Public skill");
    expect(roster).not.toContain("priv");
  });

  test("empty when no skills exist", async () => {
    const editor = await setup();
    expect(String(e(editor, "(fikra/skills/fikra-skills-model-roster)").value)).toBe("");
  });
});

describe("#8.7 skills — accept dispatch", () => {
  test("a defworkflow row runs the named workflow, not a skill turn", async () => {
    const editor = await setup();
    e(editor, "(require-module fikra/thread)");
    e(editor, "(require-module fikra/workflow)");
    e(editor, '(fikra/workflow/fikra-register-workflow "nightly-triage" "triage prompt")');
    // Accept dispatches on the choice string; the workflow path creates a
    // labeled thread rather than sending a skill-body turn to the CURRENT
    // thread (the skill branch would bump its turn count).
    e(editor, '(fikra/skills/fikra-skill-accept "defworkflow nightly-triage")');
    const label = e(editor, '(fikra/workflow/fikra-workflow-thread-for "nightly-triage")');
    expect(String(label.value)).not.toBe("");
    // The workflow path FOCUSES its own labeled thread for the run (a skill
    // accept would have stayed on the current thread).
    const current = e(editor, "(fikra/thread/fikra-thread-current)");
    expect(String(current.value)).toBe(String(label.value));
  });

  test("a skill row sends the SKILL.md body as a chat turn", async () => {
    writeSkill("greeter", "---\nname: greeter\n---\nsay hi politely\n");
    const editor = await setup();
    e(editor, "(fikra/skills/fikra-skills-refresh)");
    e(editor, '(fikra/skills/fikra-skill-accept "fikra-skill greeter")');
    const turns = e(editor, "(fikra/thread/fikra-thread-turn-count)");
    expect(Number(turns.value)).toBeGreaterThan(0);
  });
});

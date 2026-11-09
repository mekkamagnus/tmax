/**
 * @file minibuffer-exact-selection-and-annotate-memo.test.ts
 * @description #236 (SPEC-236) — locks the two per-keystroke cuts:
 *   1. The bulk `minibuffer-exact-selection-index` (dispatching to the
 *      `minibuffer-exact-index-bulk` builtin) is identical to the recursive
 *      T-Lisp reference `minibuffer-exact-selection-index-recursive`, which
 *      stays the semantic spec (BUG-79 recipe).
 *   2. The single-entry memo inside `marginalia-annotate-builtin-candidates`
 *      (keyed on category + level + candidate-list identity) never serves a
 *      stale annotation: level changes re-annotate, fresh lists (buffer/file
 *      tables build one per call) re-annotate, and identity-stable repeats
 *      return the same snapshot.
 */
import { describe, expect, test } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { Editor } from "../../src/editor/editor.ts";
import { Either } from "../../src/utils/task-either.ts";

const evaluate = (editor: Editor, source: string) => {
  const result = editor.getInterpreter().execute(source);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right;
};

/** Command-category candidates with metadata the annotator reads. */
const CMDS = `(list
  (hashmap "value" "alpha" "display" "alpha"
    "metadata" (hashmap "bindings" (list "SPC a") "documentation" "do alpha"))
  (hashmap "value" "beta" "display" "beta"
    "metadata" (hashmap "bindings" (list "SPC b") "documentation" "do beta"))
  (hashmap "value" "gamma" "display" "gamma"
    "metadata" (hashmap "bindings" (list "SPC c") "documentation" "do gamma")))`;

describe("minibuffer-exact-selection-index bulk parity (#236)", () => {
  const cases: Array<[string, string]> = [
    ["alpha", "match at first"],
    ["beta", "match in the middle"],
    ["gamma", "match at last"],
    ["delta", "no match"],
    ["", "empty input matches nothing"],
  ];
  for (const [input, label] of cases) {
    test(`bulk ≡ recursive — ${label}`, async () => {
      const fixture = await createEditorFixture();
      try {
        const bulk = evaluate(fixture.editor,
          `(editor/completion/minibuffer/minibuffer-exact-selection-index ${JSON.stringify(input)} ${CMDS})`).value;
        const reference = evaluate(fixture.editor,
          `(editor/completion/minibuffer/minibuffer-exact-selection-index-recursive ${JSON.stringify(input)} ${CMDS} 0)`).value;
        expect(bulk).toBe(reference);
      } finally {
        fixture.dispose();
      }
    });
  }

  test("bulk ≡ recursive — empty matches list", async () => {
    const fixture = await createEditorFixture();
    try {
      expect(evaluate(fixture.editor,
        '(editor/completion/minibuffer/minibuffer-exact-selection-index "alpha" (list))').value).toBe(-1);
      expect(evaluate(fixture.editor,
        '(editor/completion/minibuffer/minibuffer-exact-selection-index-recursive "alpha" (list) 0)').value).toBe(-1);
    } finally {
      fixture.dispose();
    }
  });
});

describe("marginalia annotate memo (#236)", () => {
  /** Run both annotate calls in ONE execute so reference identity survives to TS. */
  const annotatePair = (editor: Editor, source: string) =>
    evaluate(editor, `(let ((cmds ${CMDS})) (list ${source}))`)
      .value as unknown[];

  const annotationsOf = (candidateList: unknown) =>
    (candidateList as { value: { value: Map<string, { value: unknown }> }[] })
      .value.map((c) => c.value.get("annotation")?.value);

  test("same candidate list twice → memo hit (identical object, correct annotations)", async () => {
    const fixture = await createEditorFixture();
    try {
      const [first, second] = annotatePair(fixture.editor, `
        (marginalia-annotate-builtin-candidates "command" cmds 0)
        (marginalia-annotate-builtin-candidates "command" cmds 0)`);
      expect(annotationsOf(second)).toEqual(["  [SPC a] do alpha", "  [SPC b] do beta", "  [SPC c] do gamma"]);
      // The M-x hot path: one list object, every keystroke — the second call
      // must return the memoized snapshot (=== in TS), not a rebuild.
      expect(second).toBe(first);
    } finally {
      fixture.dispose();
    }
  });

  test("level change re-annotates — no stale level-0 snapshot", async () => {
    const fixture = await createEditorFixture();
    try {
      // Warm the memo at level 0 (key binding + doc), then cycle the level:
      // the memo key includes the level, so level 1 must re-annotate with the
      // shorter form rather than replaying the level-0 snapshot.
      const [at0, at1, at0again] = annotatePair(fixture.editor, `
        (marginalia-annotate-builtin-candidates "command" cmds 0)
        (marginalia-annotate-builtin-candidates "command" cmds 1)
        (marginalia-annotate-builtin-candidates "command" cmds 0)`);
      expect(annotationsOf(at0)).toEqual(["  [SPC a] do alpha", "  [SPC b] do beta", "  [SPC c] do gamma"]);
      expect(annotationsOf(at1)).toEqual(["  [SPC a] ", "  [SPC b] ", "  [SPC c] "]);
      expect(at1).not.toBe(at0);
      // Returning to a previously-seen (category, level, list) after an
      // intervening call re-annotates — single-entry memo, still correct.
      expect(annotationsOf(at0again)).toEqual(annotationsOf(at0));
    } finally {
      fixture.dispose();
    }
  });

  test("fresh candidate lists never hit the memo — annotations follow the list", async () => {
    const fixture = await createEditorFixture();
    try {
      const OTHER = `(list
        (hashmap "value" "omega" "display" "omega"
          "metadata" (hashmap "bindings" (list "SPC z") "documentation" "do omega")))`;
      // Warm with cmds, then a fresh list with different content: an
      // identity-blind memo (category+level only) would replay the cmds
      // annotations onto omega.
      const [warm, fresh] = evaluate(fixture.editor,
        `(let ((cmds ${CMDS}) (other ${OTHER}))
           (list
             (marginalia-annotate-builtin-candidates "command" cmds 0)
             (marginalia-annotate-builtin-candidates "command" other 0)))`)
        .value as unknown[];
      expect(annotationsOf(fresh)).toEqual(["  [SPC z] do omega"]);
      expect(fresh).not.toBe(warm);
    } finally {
      fixture.dispose();
    }
  });

  test("per-keystroke refresh keeps exact-selection + annotation correct end-to-end", async () => {
    const fixture = await createEditorFixture();
    try {
      const editor = fixture.editor;
      evaluate(editor, `
        (progn
          (defun spec-cmd-table (input action)
            (if (string= action "metadata")
              (hashmap "category" "command")
              ${CMDS}))
          (defun spec-accept (value) value)
          (editor/completion/minibuffer/completing-read "Cmd: " "spec-cmd-table" nil nil "" "spec-cmd-history" "spec-accept"))`);
      evaluate(editor, '(editor/completion/minibuffer/minibuffer-set-input "bet")');
      const scan = () => evaluate(editor, `
        (let ((session (minibuffer-state-get)))
          (let ((matches (hashmap-get session "matches")))
            (list
              (mapcar (lambda (c) (hashmap-get c "value")) matches)
              (mapcar (lambda (c) (hashmap-get c "annotation")) matches)
              (editor/completion/minibuffer/minibuffer-exact-selection-index
                (hashmap-get session "input") matches)
              (editor/completion/minibuffer/minibuffer-exact-selection-index-recursive
                (hashmap-get session "input") matches 0))))`)
        .value as { value: unknown }[];

      // Prefix input: one filtered match, but no candidate EQUALS "bet".
      let result = scan();
      expect((result[0]!.value as { value: unknown }[]).map((v) => v.value)).toEqual(["beta"]);
      expect((result[1]!.value as { value: unknown }[]).map((v) => v.value)).toEqual(["  [SPC b] do beta"]);
      expect(result[2]!.value).toBe(-1);
      expect(result[3]!.value).toBe(-1);

      // Typed to the exact value: the scan selects it.
      evaluate(editor, '(editor/completion/minibuffer/minibuffer-set-input "beta")');
      result = scan();
      expect((result[0]!.value as { value: unknown }[]).map((v) => v.value)).toEqual(["beta"]);
      expect(result[2]!.value).toBe(0);
      expect(result[3]!.value).toBe(0);
    } finally {
      fixture.dispose();
    }
  });
});

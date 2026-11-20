import { describe, test, expect, beforeEach } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

/**
 * @file callback-context-state.test.ts
 * @description #306 — the PERMANENT regression at the evalTlisp callback
 * boundary, pinning the VERIFIED (narrowed) model. The 2026-11-20
 * incident HYPOTHESIS was two-state within one interpreter (setq
 * invisible to filters, mutations shared). The fixture DISPROVED the
 * setq half: within ONE editor session, the callback context shares the
 * FULL environment — a main-session setq IS visible to the filter, and
 * hashmap mutations are shared. The incident's actual mechanism was the
 * daemon's SEPARATE-SESSION split (the filter's evalTlisp bound to a
 * different editor than the TUI's — the round-27/28 root cause); the
 * incident fix (explicit-path emitters) addressed that split. This test
 * pins the same-session contract so any runtime change to it turns CI
 * red here; the cross-session behavior is architecture (documented in
 * src/tlisp/CLAUDE.md + docs/learnings.md), not pinning-able with a
 * single-editor fixture.
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

// The probe module: a defvar (setter provided — module defvars are not
// setq-able from outside), a hashmap carrier, and a filter that records
// what IT sees of both when the make-process callback fires.
const PROBE_MODULE = `
(defmodule callback-probe
  (export cb-probe-set-var cb-probe-map-set cb-probe-obs
          cb-probe-reset cb-probe-filter)
  ;; Exported defvars read as functions — a getter is the accessor.
  (defun cb-probe-obs (k)
    (hashmap-get cb-probe-observations k))
  (defvar cb-probe-var "initial")
  (defvar cb-probe-map (hashmap))
  (defvar cb-probe-observations (hashmap))
  (defun cb-probe-set-var (v) (setq cb-probe-var v) v)
  (defun cb-probe-map-set (k v)
    (editor/keymaps/keymap-mutable-set! cb-probe-map k v) v)
  (defun cb-probe-reset ()
    (setq cb-probe-var "initial")
    (setq cb-probe-map (hashmap))
    (setq cb-probe-observations (hashmap))
    t)
  ;; The FILTER + SENTINEL — both run in the make-process callback's
  ;; evalTlisp context; each records WHICH fired plus its view of BOTH
  ;; carriers into the observations map.
  (defun cb-probe-record (which)
    (editor/keymaps/keymap-mutable-set! cb-probe-observations
      "var-as-seen-by-filter" (if (stringp cb-probe-var) cb-probe-var "NON-STRING"))
    (editor/keymaps/keymap-mutable-set! cb-probe-observations
      "map-as-seen-by-filter"
      (if (hashmap-get cb-probe-map "main-key") "shared" "NOT-SHARED"))
    (editor/keymaps/keymap-mutable-set! cb-probe-observations which "t"))
  (defun cb-probe-filter (pid output) (cb-probe-record "filter-ran"))
  (defun cb-probe-sentinel (pid code) (cb-probe-record "sentinel-ran"))
(provide "callback-probe")
)
`;

describe("#306 — the evalTlisp callback-context state model (regression)", () => {
  let editor: Editor;
  beforeEach(async () => {
    editor = await createStartedEditor("");
    e(editor, PROBE_MODULE);
    e(editor, "(callback-probe/cb-probe-reset)");
  });

  test("verified model (narrowed): same-session callbacks see setq AND mutations — the incident split was cross-session", async () => {
    // (a) setq a module defvar in the MAIN env...
    e(editor, '(callback-probe/cb-probe-set-var "main-session-value")');
    // ...and (b) mutate the hashmap carrier.
    e(editor, '(callback-probe/cb-probe-map-set "main-key" "main-value")');

    // Spawn a real make-process whose filter runs in the callback context.
    const pid = Number(e(editor, `(make-process
       :command (list "sh" "-c" "echo probe-output")
       :filter "callback-probe/cb-probe-filter"
       :sentinel "callback-probe/cb-probe-sentinel")`).value);
    expect(pid).toBeGreaterThan(0);

    // Wait for the callback to have run (process exit fires the sentinel).
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const ran = String(e(editor, '(callback-probe/cb-probe-obs "filter-ran")').value);
      const sent = String(e(editor, '(callback-probe/cb-probe-obs "sentinel-ran")').value);
      if (ran === "t" && sent === "t") break;
    }

    const obs = (k: string) => String(e(editor, `(callback-probe/cb-probe-obs "${k}")`).value);
    expect(obs("filter-ran")).toBe("t");

    // DIRECTION 1 — the NARROWED finding: within one session the filter
    // sees the main session's setq (the incident's invisibility was the
    // daemon's separate-editor-session split, NOT interpreter scoping).
    expect(obs("var-as-seen-by-filter")).toBe("main-session-value");

    // DIRECTION 2 — mutation-shared: the filter SEES the main session's
    // hashmap write.
    expect(obs("map-as-seen-by-filter")).toBe("shared");

    // BOTH callback kinds fired (filter for the output chunk, sentinel
    // for process exit) — and the main session reads the callback's own
    // writes through the shared observations map (callback→main sharing).
    expect(obs("filter-ran")).toBe("t");
    expect(obs("sentinel-ran")).toBe("t");
  });
});

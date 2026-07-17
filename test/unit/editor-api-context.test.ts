/**
 * @file editor-api-context.test.ts
 * @description CHORE-44 Change 2 — proves the typed `EditorAPIContext` is the
 * single editor API state path: context construction, model commits through
 * `access`/`applyUpdate`, runtime service callbacks are invoked, the
 * previously underscored escape hatches are gone (replaced by camelCase
 * members), and NO mutable deterministic bridge properties remain.
 *
 * AC2.6: `EditorAPIContext` exposes `access` plus runtime-only services; it
 * does NOT duplicate deterministic `EditorModel` fields as mutable bridge
 * properties.
 *
 * AC2.7: `src/editor/tlisp-api.ts` contains no direct assignment to
 * deterministic context state. A static scan fails if any `ctx.<bridgeField> =`
 * pattern reappears, and behavioral tests prove model updates still occur.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEditorAPI } from "../../src/editor/tlisp-api.ts";
import { createTestAPIContext, expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createString } from "../../src/tlisp/values.ts";
import { ModuleRegistry } from "../../src/tlisp/module-registry.ts";
import { Either } from "../../src/utils/task-either.ts";

// The full set of mutable bridge-property names AC2.6 removes. Any direct
// assignment to one of these names inside tlisp-api.ts is a regression (AC2.7).
const REMOVED_BRIDGE_FIELDS = [
  "currentBuffer",
  "buffers",
  "cursorLine",
  "cursorColumn",
  "mode",
  "lastCommand",
  "statusMessage",
  "viewportTop",
  "viewportLeft",
  "commandLine",
  "mxCommand",
  "cursorFocus",
  "currentFilename",
  "config",
  "lspDiagnostics",
  "foldRanges",
  "searchMatches",
] as const;

describe("CHORE-44 Change 2 — EditorAPIContext", () => {
  test("constructs with required access/session/caches and registers the API", () => {
    const ctx = createTestAPIContext();
    // The previously underscored hooks are now camelCase members (AC2.2).
    expect(typeof ctx.access.getModel).toBe("function");
    expect(typeof ctx.access.applyModel).toBe("function");
    expect(typeof ctx.applyUpdate).toBe("function");
    expect(ctx.session).toBeDefined();
    expect(ctx.caches).toBeDefined();

    const api = createEditorAPI(ctx);
    // AC2.5: the public API inventory is unchanged (sample of names merged by
    // createEditorAPI; macro-* and a few others are added by editor.ts).
    for (const name of ["buffer-current", "cursor-position", "set-register", "get-register", "kill-ring-list", "visual-get-selection", "undo", "buffer-create"]) {
      expect(api.has(name)).toBe(true);
    }
  });

  test("access commits a fresh model and reads it back (the only state path)", () => {
    const ctx = createTestAPIContext();
    const next = { ...ctx.access.getModel(), statusMessage: "committed-via-access" };
    ctx.access.applyModel(next);
    expect(ctx.access.getModel().statusMessage).toBe("committed-via-access");
    // An API primitive that runs through the model (set-register) succeeds and
    // lands in the per-editor session.
    const api = createEditorAPI(ctx);
    const setReg = expectDefined(api.get("set-register"));
    expect(expectRight(setReg([createString("a"), createString("AAA")])).type).toBe("nil");
    const getReg = expectDefined(api.get("get-register"));
    expect(expectRight(getReg([createString("a")])).value).toBe("AAA");
  });

  test("runtime service callbacks (formerly underscored) are invoked", () => {
    const ctx = createTestAPIContext();
    let majorMode = "fundamental";
    ctx.getCurrentMajorMode = () => majorMode;
    ctx.setCurrentMajorMode = (m: string) => { majorMode = m; };
    ctx.getModuleRegistry = () => new ModuleRegistry();

    const api = createEditorAPI(ctx);
    // module-list reaches the typed getModuleRegistry callback (no underscore).
    const moduleList = expectRight((expectDefined(api.get("module-list")))([]));
    expect(moduleList.type).toBe("list");
  });

  test("per-editor session + caches are independent per constructed context", () => {
    const a = createTestAPIContext();
    const b = createTestAPIContext();
    const apiA = createEditorAPI(a);
    const apiB = createEditorAPI(b);
    // Set a register on A; B's register stays empty (sessions are distinct).
    expectRight((expectDefined(apiA.get("set-register")))([createString("a"), createString("AAA")]));
    const getReg = expectDefined(apiB.get("get-register"));
    expect(expectRight(getReg([createString("a")])).value).toBe("");
    // Caches are distinct objects.
    expect(a.caches).not.toBe(b.caches);
    expect(a.caches.ast).not.toBe(b.caches.ast);
  });

  // ── AC2.6: no mutable bridge properties on EditorAPIContext ──────────
  test("AC2.6: the seeded currentBuffer is observable through the model path", () => {
    const buf = FunctionalTextBufferImpl.create("hello");
    const ctx = createTestAPIContext({ currentBuffer: buf });
    // The currentBuffer override seeds model.currentBuffer; reads go through
    // access.getModel() (no bridge property).
    expect(ctx.access.getModel().currentBuffer).toBe(buf);
    const api = createEditorAPI(ctx);
    const current = expectDefined(api.get("buffer-current"));
    expect(Either.isRight(current([]))).toBe(true);
  });

  // ── AC2.7: a write through applyUpdate lands on the model (behavioral) ──
  test("AC2.6/AC2.7: applyUpdate(SetStatusMessage) lands on access.getModel().statusMessage", () => {
    const ctx = createTestAPIContext();
    expect(ctx.access.getModel().statusMessage).toBe("Welcome to tmax");
    ctx.applyUpdate({ type: "SetStatusMessage", message: "routed-through-msg" });
    // The write is observable through the model — no bridge property needed.
    expect(ctx.access.getModel().statusMessage).toBe("routed-through-msg");
  });

  test("AC2.6/AC2.7: setCurrentBuffer routes through the model (SetCurrentBuffer)", () => {
    const ctx = createTestAPIContext();
    const buf = FunctionalTextBufferImpl.create("switched");
    expect(ctx.access.getModel().currentBuffer).toBeUndefined();
    ctx.setCurrentBuffer(buf);
    expect(ctx.access.getModel().currentBuffer).toBe(buf);
    // And a Null return is also wired through the model.
    ctx.setCurrentBuffer(null);
    expect(ctx.access.getModel().currentBuffer).toBeUndefined();
  });

  test("AC2.6/AC2.7: a primitive write (message) commits through applyUpdate, observable on the model", () => {
    const ctx = createTestAPIContext();
    const api = createEditorAPI(ctx);
    const message = expectDefined(api.get("message"));
    expectRight(message([createString("from-primitive")]));
    expect(ctx.access.getModel().statusMessage).toBe("from-primitive");
  });

  // ── AC2.7: static scan — no ctx.<bridgeField> = assignment in tlisp-api.ts ──
  test("AC2.7: tlisp-api.ts contains no direct assignment to a removed bridge field", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "src", "editor", "tlisp-api.ts"),
      "utf8",
    );
    // Build one regex that catches `ctx.<bridgeField> =` for ANY removed field
    // name. Zero matches required — every write must go through applyUpdate /
    // ctx.setCurrentBuffer / ctx.setCursorLine / ctx.setCursorColumn /
    // ctx.setCurrentFilename.
    const pattern = new RegExp(
      `ctx\\.(?:${REMOVED_BRIDGE_FIELDS.join("|")})\\s*=`,
    );
    const offenders = src.match(new RegExp(pattern, "g"));
    expect(offenders).toBeNull();
  });

  // ── AC2.7: static scan — no reads of removed bridge fields in tlisp-api.ts ──
  test("AC2.7: tlisp-api.ts contains no read of a removed bridge field (only access/applyUpdate/methods)", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "src", "editor", "tlisp-api.ts"),
      "utf8",
    );
    // A read is `ctx.<bridgeField>` NOT followed by `=` (that would be an
    // assignment, covered above) and NOT part of the method names
    // (setCurrentBuffer / setCursorLine / setCursorColumn / setCurrentFilename
    // / setSpacePressed / getSpacePressed — note these all START with set/get
    // so the trailing-word check below excludes them).
    // We approximate by looking for `ctx.<field>` where <field> is one of the
    // removed names and is not followed by an alphabetic character (so
    // `ctx.mode` matches but `ctx.setCurrentBuffer` does not match "set...").
    const lines = src.split("\n");
    const offenders: string[] = [];
    for (const line of lines) {
      for (const field of REMOVED_BRIDGE_FIELDS) {
        // Match `ctx.field` not followed by another identifier char and not
        // preceded by `.` (so `ctx.setCurrentBuffer` — which contains
        // `set...` — does not trip on the `set` substring; we anchor on the
        // exact field name).
        const re = new RegExp(`ctx\\.${field}(?![A-Za-z0-9_])`);
        if (re.test(line)) {
          offenders.push(`${field}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // ── AC2.6: EditorAPIContext no longer DECLARES the bridge fields ──────
  test("AC2.6: editor-api-context.ts does not declare the removed bridge fields as interface members", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "src", "editor", "runtime", "editor-api-context.ts"),
      "utf8",
    );
    // Each removed field, declared as an interface member, would appear as a
    // line like `  currentBuffer: ...;` or `  currentBuffer?: ...;`. Scan for
    // any such declaration.
    const offenders: string[] = [];
    for (const field of REMOVED_BRIDGE_FIELDS) {
      const re = new RegExp(`^\\s*${field}\\??:\\s`);
      for (const line of src.split("\n")) {
        if (re.test(line)) offenders.push(`${field}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // ── AC2.6: the context shape rejects unknown bridge properties ────────
  test("AC2.6: constructing a context with a removed bridge property is a type error (compile-time guard)", () => {
    // This is a compile-time guarantee. The runtime assertion below confirms
    // the production context built by `createTestAPIContext` does not carry
    // any of the removed bridge-field keys (except `buffers`, which the
    // test-only {@link TestAPIContext} layer legitimately re-exposes so tests
    // can seed the live buffer registry — it is NOT on the production
    // `EditorAPIContext`, as the separate static scan of editor-api-context.ts
    // proves).
    const ctx = createTestAPIContext();
    for (const field of REMOVED_BRIDGE_FIELDS) {
      if (field === "buffers") continue; // legitimate TestAPIContext test extra
      expect((ctx as unknown as Record<string, unknown>)[field]).toBeUndefined();
    }
    // The expected write surface is present:
    expect(typeof ctx.applyUpdate).toBe("function");
    expect(typeof ctx.setCurrentBuffer).toBe("function");
    expect(typeof ctx.setCursorLine).toBe("function");
    expect(typeof ctx.setCursorColumn).toBe("function");
    expect(typeof ctx.setCurrentFilename).toBe("function");
    expect(typeof ctx.getSpacePressed).toBe("function");
    expect(typeof ctx.setSpacePressed).toBe("function");
    // A compile-time guard: the following line would be a type error if
    // uncommented, because `statusMessage` is no longer on EditorAPIContext:
    // const _bad: EditorAPIContext = { ...ctx, statusMessage: "x" };
  });
});

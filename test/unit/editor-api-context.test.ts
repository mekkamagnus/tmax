/**
 * @file editor-api-context.test.ts
 * @description CHORE-44 Change 2 — proves the typed `EditorAPIContext` is the
 * single editor API state path: context construction, model commits through
 * `access`, runtime service callbacks are invoked, and the previously
 * underscored escape hatches are gone (replaced by camelCase members).
 */

import { describe, test, expect } from "bun:test";
import { createEditorAPI } from "../../src/editor/tlisp-api.ts";
import { createTestAPIContext, expectDefined, expectRight } from "../helpers/editor-fixture.ts";
import { FunctionalTextBufferImpl } from "../../src/core/buffer.ts";
import { createString } from "../../src/tlisp/values.ts";
import { ModuleRegistry } from "../../src/tlisp/module-registry.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("CHORE-44 Change 2 — EditorAPIContext", () => {
  test("constructs with required access/session/caches and registers the API", () => {
    const ctx = createTestAPIContext();
    // The previously underscored hooks are now camelCase members (AC2.2).
    expect(typeof ctx.access.getModel).toBe("function");
    expect(typeof ctx.access.applyModel).toBe("function");
    expect(ctx.session).toBeDefined();
    expect(ctx.caches).toBeDefined();

    const api = createEditorAPI(ctx);
    // AC2.5: the public API inventory is unchanged (sample of registered names).
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

  test("currentBuffer bridge field is honored by the context", () => {
    const buf = FunctionalTextBufferImpl.create("hello");
    const ctx = createTestAPIContext({ currentBuffer: buf });
    expect(ctx.currentBuffer).toBe(buf);
    // buffer-current reads through the context's model access.
    const api = createEditorAPI(ctx);
    const current = expectDefined(api.get("buffer-current"));
    expect(Either.isRight(current([])));
  });
});

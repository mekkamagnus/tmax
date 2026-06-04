/**
 * @file minor-mode-ops.test.ts
 * @description Unit tests for the minor-mode T-Lisp API
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createMinorModeOps } from "../../src/editor/api/minor-mode-ops.ts";
import type { MinorModeConfig, BufferModeState } from "../../src/editor/mode-state.ts";
import { getOrCreateModeState, activateMinorMode } from "../../src/editor/mode-state.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { createString, createBoolean, createNil } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Minor Mode Operations", () => {
  let registry: Map<string, MinorModeConfig>;
  let bufferStates: Map<string, BufferModeState>;
  let globalModes: Set<string>;
  let hooksRun: string[];
  let api: Map<string, any>;
  let activeKey: string;

  beforeEach(() => {
    registry = new Map();
    bufferStates = new Map();
    globalModes = new Set();
    hooksRun = [];
    activeKey = "test-buffer";

    const currentKey = () => activeKey;
    const evalTlisp = (expr: string) => {
      // Track hook invocations
      const match = expr.match(/run-hooks "([^"]+)"/);
      if (match?.[1]) hooksRun.push(match[1]);
      return Either.right(createNil());
    };

    api = createMinorModeOps(
      () => registry,
      () => bufferStates,
      currentKey,
      () => globalModes,
      evalTlisp,
    );
  });

  const call = (name: string, ...args: TLispValue[]) => {
    const fn = api.get(name);
    if (!fn) throw new Error(`Function not found: ${name}`);
    return fn(args);
  };

  test("minor-mode-register creates a mode in the registry", () => {
    const result = call("minor-mode-register", createString("test"), createString("A test mode"), createString("Test"));
    expect(Either.isRight(result)).toBe(true);
    expect(registry.has("test")).toBe(true);
    expect(registry.get("test")!.description).toBe("A test mode");
    expect(registry.get("test")!.lighter).toBe("Test");
  });

  test("minor-mode-register without lighter uses name as lighter", () => {
    const result = call("minor-mode-register", createString("fill"), createString("Auto fill"));
    expect(Either.isRight(result)).toBe(true);
    expect(registry.get("fill")!.lighter).toBe("fill");
  });

  test("minor-mode-toggle activates and deactivates", () => {
    call("minor-mode-register", createString("test"), createString("Test"), createString("T"));

    const state = getOrCreateModeState(bufferStates, "test-buffer");
    expect(state.activeMinorModes).toEqual([]);

    call("minor-mode-toggle", createString("test"));
    expect(state.activeMinorModes).toEqual(["test"]);

    call("minor-mode-toggle", createString("test"));
    expect(state.activeMinorModes).toEqual([]);
  });

  test("minor-mode-set with explicit state", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    call("minor-mode-set", createString("test"), createBoolean(true));
    const state = getOrCreateModeState(bufferStates, "test-buffer");
    expect(state.activeMinorModes).toEqual(["test"]);

    call("minor-mode-set", createString("test"), createBoolean(false));
    expect(state.activeMinorModes).toEqual([]);
  });

  test("minor-mode-active-p returns correct state", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    let result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(false);

    call("minor-mode-toggle", createString("test"));
    result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(true);
  });

  test("minor-mode-list-active returns only active modes", () => {
    call("minor-mode-register", createString("a"), createString("A"));
    call("minor-mode-register", createString("b"), createString("B"));

    call("minor-mode-set", createString("a"), createBoolean(true));
    const result = call("minor-mode-list-active");
    const names = result.right.value.map((v: TLispValue) => v.value);
    expect(names).toEqual(["a"]);
  });

  test("minor-mode-list-all returns all registered modes", () => {
    call("minor-mode-register", createString("a"), createString("A"));
    call("minor-mode-register", createString("b"), createString("B"));

    const result = call("minor-mode-list-all");
    const names = result.right.value.map((v: TLispValue) => v.value);
    expect(names.sort()).toEqual(["a", "b"]);
  });

  test("toggling an unregistered mode returns an error", () => {
    const result = call("minor-mode-toggle", createString("nonexistent"));
    expect(Either.isLeft(result)).toBe(true);
  });

  test("activate/deactivate hooks run during toggle", () => {
    call("minor-mode-register", createString("test"), createString("Test"));
    hooksRun = [];

    call("minor-mode-toggle", createString("test"));
    expect(hooksRun).toContain("minor-mode-test-activate-hook");

    call("minor-mode-toggle", createString("test"));
    expect(hooksRun).toContain("minor-mode-test-deactivate-hook");
  });

  test("minor-mode-lighter returns the lighter", () => {
    call("minor-mode-register", createString("test"), createString("Test"), createString("T"));
    const result = call("minor-mode-lighter", createString("test"));
    expect(result.right.value).toBe("T");
  });

  test("minor-mode-list-lighters returns active lighters", () => {
    call("minor-mode-register", createString("a"), createString("A"), createString("La"));
    call("minor-mode-register", createString("b"), createString("B"), createString("Lb"));
    call("minor-mode-set", createString("a"), createBoolean(true));

    const result = call("minor-mode-list-lighters");
    const lighters = result.right.value.map((v: TLispValue) => v.value);
    expect(lighters).toEqual(["La"]);
  });

  test("global-minor-mode-set applies to all buffers", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    // Create two buffer states
    getOrCreateModeState(bufferStates, "buf-a");
    getOrCreateModeState(bufferStates, "buf-b");

    call("global-minor-mode-set", createString("test"), createBoolean(true));

    expect(globalModes.has("test")).toBe(true);
    expect(bufferStates.get("buf-a")!.activeMinorModes).toContain("test");
    expect(bufferStates.get("buf-b")!.activeMinorModes).toContain("test");
  });

  test("global-minor-mode-set applies to future buffers", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    call("global-minor-mode-set", createString("test"), createBoolean(true));
    activeKey = "future-buffer";

    const result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(true);
    expect(bufferStates.get("future-buffer")!.minorModeSources.test).toBe("global");
  });

  test("local disable overrides an active global minor mode", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    activeKey = "buf-a";
    getOrCreateModeState(bufferStates, "buf-a");
    call("global-minor-mode-set", createString("test"), createBoolean(true));

    call("minor-mode-set", createString("test"), createBoolean(false));
    let result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(false);

    activeKey = "buf-b";
    result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(true);

    activeKey = "buf-a";
    result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(false);
  });

  test("global disable preserves explicit local re-enable", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    getOrCreateModeState(bufferStates, "buf-a");
    getOrCreateModeState(bufferStates, "buf-b");
    call("global-minor-mode-set", createString("test"), createBoolean(true));

    activeKey = "buf-b";
    call("minor-mode-set", createString("test"), createBoolean(true));
    call("global-minor-mode-set", createString("test"), createBoolean(false));

    activeKey = "buf-a";
    let result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(false);

    activeKey = "buf-b";
    result = call("minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(true);
    expect(bufferStates.get("buf-b")!.minorModeSources.test).toBe("local");
  });

  test("global-minor-mode-active-p returns correct state", () => {
    call("minor-mode-register", createString("test"), createString("Test"));

    let result = call("global-minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(false);

    call("global-minor-mode-set", createString("test"), createBoolean(true));
    result = call("global-minor-mode-active-p", createString("test"));
    expect(result.right.value).toBe(true);
  });

  test("registering same mode twice updates registration", () => {
    call("minor-mode-register", createString("test"), createString("V1"), createString("T1"));
    call("minor-mode-register", createString("test"), createString("V2"), createString("T2"));

    expect(registry.get("test")!.description).toBe("V2");
    expect(registry.get("test")!.lighter).toBe("T2");
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { createKeymapOps } from "../../src/editor/api/keymap-ops.ts";
import { KeymapSync } from "../../src/editor/keymap-sync.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerStdlibFunctions } from "../../src/tlisp/stdlib.ts";
import { createNil, createString } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";
import { expectDefined, expectRight, expectTlispList } from "../helpers/editor-fixture.ts";

describe("keymap-ops API", () => {
  let interpreter: TLispInterpreterImpl;
  let keymapSync: KeymapSync;

  beforeEach(() => {
    interpreter = new TLispInterpreterImpl();
    registerStdlibFunctions(interpreter);
    keymapSync = new KeymapSync(interpreter);
  });

  function operation(name: string) {
    return expectDefined(createKeymapOps(interpreter, keymapSync).get(name));
  }

  function defineKeymap(name: string) {
    expectRight(interpreter.execute(`(defkeymap "${name}")`));
    return expectDefined(interpreter.globalEnv.lookup(name));
  }

  test("keymap-set registers a keymap for a mode", () => {
    const keymap = defineKeymap("*my-keymap*");

    const result = expectRight(operation("keymap-set")([createString("normal"), keymap]));

    expect(result.type).toBe("string");
    expect(keymapSync.hasKeymap("normal")).toBe(true);
  });

  test("keymap-set rejects an invalid mode", () => {
    const result = operation("keymap-set")([createString("invalid-mode"), createNil()]);

    expect(Either.isLeft(result)).toBe(true);
  });

  test("keymap-set rejects a non-keymap value", () => {
    const result = operation("keymap-set")([createString("normal"), createString("not a keymap")]);

    expect(Either.isLeft(result)).toBe(true);
  });

  test("keymap-keys returns registered keys", () => {
    defineKeymap("*keys-test-keymap*");
    const first = expectRight(interpreter.execute('(keymap-define-key *keys-test-keymap* "j" "cursor-down")'));
    interpreter.globalEnv.define("*keys-test-keymap*", first);
    const second = expectRight(interpreter.execute('(keymap-define-key *keys-test-keymap* "k" "cursor-up")'));
    interpreter.globalEnv.define("*keys-test-keymap*", second);
    keymapSync.registerTlispKeymap("normal", second);

    const keys = expectTlispList(expectRight(operation("keymap-keys")([createString("normal")])));

    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.type === "string")).toBe(true);
  });

  test("keymap-keys rejects a mode without a keymap", () => {
    expect(Either.isLeft(operation("keymap-keys")([createString("insert")]))).toBe(true);
  });

  test("keymap-keys returns an empty list for a keymap without bindings", () => {
    const keymap = defineKeymap("*empty-keymap*");
    keymapSync.registerTlispKeymap("normal", keymap);

    const keys = expectTlispList(expectRight(operation("keymap-keys")([createString("normal")])));

    expect(keys).toEqual([]);
  });

  test("keymap-active returns the active keymap", () => {
    const keymap = defineKeymap("*active-keymap*");
    keymapSync.registerTlispKeymap("normal", keymap);

    expect(expectRight(operation("keymap-active")([createString("normal")]))).toEqual(keymap);
  });

  test("keymap-active returns nil for a mode without a keymap", () => {
    expect(expectRight(operation("keymap-active")([createString("visual")])).type).toBe("nil");
  });
});

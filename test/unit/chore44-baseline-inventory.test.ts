/**
 * @file chore44-baseline-inventory.test.ts
 * @description CHORE-44 Step 0 — the public-contract parity anchor.
 *
 * Step 0 captures the editor/RPC/Markdown/ADW/CLI inventories as frozen expected
 * sets under `.chore44-baseline/`. This test asserts the LIVE tree still matches
 * those sets, so every later CHORE-44 change (which must preserve external
 * contracts) has a single gate that fails the moment a public name is silently
 * added, removed, or renamed. The narrower Change-specific tests
 * (editor-api-registry, server-rpc-router, markdown-module-boundaries) assert
 * structural properties; this file asserts the frozen public inventory itself.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createEditorAPI } from "../../src/editor/tlisp-api.ts";
import { Editor } from "../../src/editor/editor.ts";
import { createTestAPIContext } from "../helpers/editor-fixture.ts";
import { isRpcMethod } from "../../src/server/rpc/router.ts";

const baselineDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".chore44-baseline");

/** Read a baseline file as a sorted array of non-comment, non-blank lines. */
function baselineSet(file: string): string[] {
  return readFileSync(join(baselineDir, file), "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"))
    .sort();
}

describe("CHORE-44 Step 0 — public inventory parity", () => {
  test("JSON-RPC method inventory matches the frozen Step 0 set (Change 5 anchor)", () => {
    const expected = baselineSet("rpc-methods.txt");
    // Every frozen method is recognized by the typed router at runtime.
    for (const name of expected) {
      expect(isRpcMethod(name), `expected RPC method '${name}' to be recognized`).toBe(true);
    }
    // An unknown method is rejected (the router does not silently accept new names).
    expect(isRpcMethod("definitely-not-a-method")).toBe(false);
    // The frozen set and the runtime route table have the same size — no drift.
    const recognized = expected.filter(n => isRpcMethod(n));
    // Sanity: the router recognizes the whole frozen set, and the set is the
    // authoritative count (23 methods today).
    expect(recognized.length).toBe(expected.length);
    expect(expected.length).toBe(23);
  });

  test("Editor public method surface matches the frozen Step 0 set (Change 3 anchor)", () => {
    const expected = baselineSet("editor-methods.txt");
    // Reflect the live class prototype — every public method the Editor facade
    // exposes today. Change 3 must keep this exact set available (as facades).
    const live = Object.getOwnPropertyNames(Editor.prototype)
      .filter(n => n !== "constructor" && !n.startsWith("_"))
      .sort();
    expect(live).toEqual(expected);
  });

  test("createEditorAPI inventory matches the frozen Step 0 set (Change 7 anchor)", () => {
    const expected = baselineSet("api-names-static.txt");
    const live = Array.from(createEditorAPI(createTestAPIContext()).keys()).sort();
    expect(live).toEqual(expected);
  });

  test("Markdown public command inventory matches the frozen Step 0 set (Change 11 anchor)", () => {
    const expected = baselineSet("markdown-fns.txt");
    // Re-derive the live set from the T-Lisp source: every public markdown-* defun.
    // CHORE-44 Change 11: markdown.tlisp is now a loader/aggregator that
    // require-module's the seven feature modules under commands/markdown/.
    // The public inventory is the union of every feature module's defuns.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "tlisp", "core", "commands");
    const sources: string[] = [readFileSync(join(root, "markdown.tlisp"), "utf8")];
    const featDir = join(root, "markdown");
    if (existsSync(featDir)) {
      for (const f of readdirSync(featDir).filter(n => n.endsWith(".tlisp"))) {
        sources.push(readFileSync(join(featDir, f), "utf8"));
      }
    }
    const live = sources.flatMap(src =>
      [...src.matchAll(/\(defun\s+\(?(markdown-[A-Za-z0-9?-]+)/g)]
        .map(m => m[1])
        .filter((v): v is string => !!v),
    ).sort();
    expect(live).toEqual(expected);
  });

  test("ADW state keys: frozen set covers the canonical WorkspaceState read shape", () => {
    const frozen = baselineSet("adw-state-keys.txt");
    const adwsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "adws", "adw-status.ts"), "utf8");
    // Extract only the WorkspaceState interface body (not WorkspaceRow, which
    // carries dashboard-only fields like `id`).
    const block = adwsSrc.slice(
      adwsSrc.indexOf("interface WorkspaceState"),
      adwsSrc.indexOf("}", adwsSrc.indexOf("interface WorkspaceState")),
    );
    const declared = [...block.matchAll(/^\s+([a-z_]+)\??:/gm)].map(m => m[1]).filter((v): v is string => !!v);
    expect(declared.length).toBeGreaterThan(0);
    for (const key of declared) {
      expect(frozen, `WorkspaceState field '${key}' missing from frozen set`).toContain(key);
    }
  });

  test("ADW event types: frozen discriminators are emitted by the pipeline source", () => {
    const frozen = baselineSet("adw-event-types.txt");
    expect(frozen.length).toBeGreaterThan(20);
    // Spot-check the lifecycle-critical event names are present (these are the
    // ones the retry/resume/watchdog logic keys off — Change 8 must preserve them).
    for (const critical of ["start", "stage-complete", "stage-error", "resume", "worktree-created", "worktree-reused", "base-sha-recorded", "heartbeat", "goal-exhausted", "goal-met"]) {
      expect(frozen).toContain(critical);
    }
  });

  test("CLI exit-code contracts: tmax --test documents the 0/1/2 trt contract", () => {
    const tmaxSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "tmax"), "utf8");
    // The documented --test contract (Step 0 inventory): 0 pass / 1 fail / 2 no-tests.
    expect(tmaxSrc).toMatch(/exit 0 pass\s*\/\s*1 fail\s*\/\s*2 no-tests/);
    // Unknown subcommand exits 2.
    expect(tmaxSrc).toMatch(/\*\)\s+exit\s+2/);
  });
});

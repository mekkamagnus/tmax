import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocsTmaxDir } from "../../src/editor/editor.ts";

/**
 * @file docs-dir-332.test.ts
 * @description #332 — the docs-corpus directory resolution: the dev
 * checkout layout (../../docs/tmax with tmax.texinfo) and the COMPILED
 * binary layout (the --asset files at the BASENAME level of the virtual
 * root — $bunfs never normalizes '..', ADR-0271).
 */

describe("#332 — resolveDocsTmaxDir", () => {
  const dirs: string[] = [];
  test("the DEV layout: ../../docs/tmax with the texinfo corpus", () => {
    const root = mkdtempSync(join(tmpdir(), "d332-"));
    dirs.push(root);
    mkdirSync(join(root, "src/editor"), { recursive: true });
    mkdirSync(join(root, "docs/tmax"), { recursive: true });
    writeFileSync(join(root, "docs/tmax/tmax.texinfo"), "x");
    const from = join(root, "src/editor");
    expect(resolveDocsTmaxDir(from)).toBe(join(root, "docs/tmax"));
  });

  test("the BINARY layout: the assets at the basename level of the root", () => {
    const root = mkdtempSync(join(tmpdir(), "d332b-"));
    dirs.push(root);
    // The compiled layout: tmax.texinfo/tmax.info sit BESIDE the virtual
    // root (no ../.. walk exists).
    writeFileSync(join(root, "tmax.texinfo"), "x");
    writeFileSync(join(root, "tmax.info"), "x");
    expect(resolveDocsTmaxDir(root)).toBe(root);
  });

  test("an empty dir falls back to itself (the old behavior)", () => {
    const root = mkdtempSync(join(tmpdir(), "d332c-"));
    dirs.push(root);
    expect(resolveDocsTmaxDir(root)).toBe(root);
  });

  test("DOCS_TMAX_DIR in THIS test run resolves a real corpus", async () => {
    // From source, the dev layout holds.
    const { DOCS_TMAX_DIR } = await import("../../src/editor/editor.ts");
    expect(DOCS_TMAX_DIR).toContain("docs/tmax");
  });
});

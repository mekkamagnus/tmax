import { describe, test, expect, afterAll } from "bun:test";
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
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  test("the DEV layout: ../../docs/tmax with the texinfo corpus", () => {
    const root = mkdtempSync(join(tmpdir(), "d332-"));
    dirs.push(root);
    mkdirSync(join(root, "src/editor"), { recursive: true });
    mkdirSync(join(root, "docs/tmax"), { recursive: true });
    writeFileSync(join(root, "docs/tmax/tmax.texinfo"), "x");
    const from = join(root, "src/editor");
    expect(resolveDocsTmaxDir(from)).toBe(join(root, "docs/tmax"));
  });

  test("the FALLBACK layout: no corpus anywhere resolves to fromDir", () => {
    const root = mkdtempSync(join(tmpdir(), "d332b-"));
    dirs.push(root);
    // The compiled layout: tmax.texinfo/tmax.info sit BESIDE the virtual
    // root (no ../.. walk exists).
    writeFileSync(join(root, "tmax.texinfo"), "x");
    writeFileSync(join(root, "tmax.info"), "x");
    expect(resolveDocsTmaxDir(root)).toBe(root);
  });

  test("a $bunfs virtual root short-circuits (NO host-filesystem walk)", () => {
    // The gate's escape: a normalize()d ../../ walk from /$bunfs
    // collapses to a literal HOST /docs/tmax — the resolver must
    // never probe the host from the virtual root.
    expect(resolveDocsTmaxDir("/$bunfs/root")).toBe("/$bunfs/root");
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

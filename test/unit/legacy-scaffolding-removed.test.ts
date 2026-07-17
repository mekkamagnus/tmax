/**
 * @file legacy-scaffolding-removed.test.ts
 * @description CHORE-44 Change 10 — gates that the dead Ink/React/tsx scaffolding
 * is gone, Bun is the direct runtime, and package.json is the single version
 * source.
 *
 * This test is the Change 10 anchor. It reads the manifests (package.json,
 * tsconfig.json) and the source tree directly, so any regression — a stray
 * `ink` dependency re-added, a `.tsx` file re-introduced, the hard-coded
 * `0.2.0` version literal coming back — fails this gate immediately.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read a repo-relative file as UTF-8 text. */
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** True if `rel` exists in the repo. */
function pathExists(rel: string): boolean {
  return existsSync(join(root, rel));
}

describe("CHORE-44 Change 10 — legacy scaffolding removed (AC10.1)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    version: string;
  };

  test("no ink/react/tsx runtime dependencies remain", () => {
    const runtimeDeps = Object.keys(pkg.dependencies ?? {});
    // AC10.1: zero production Ink/React/tsx deps. The runtime dependency
    // object should be empty unless a live runtime import proves otherwise.
    for (const banned of ["ink", "react", "tsx"]) {
      expect(runtimeDeps, `runtime dependency '${banned}' must be removed`).not.toContain(banned);
    }
  });

  test("no @types/react devDependency remains", () => {
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    expect(devDeps, "@types/react must be removed from devDependencies").not.toContain("@types/react");
  });

  test("typescript is a devDependency (not a runtime dependency)", () => {
    // AC10.1: tsc is a build-time tool; runtime dependencies must be empty.
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("typescript");
    expect(Object.keys(pkg.devDependencies ?? {})).toContain("typescript");
  });

  test("no React JSX compiler settings remain in tsconfig.json", () => {
    const tsconfig = read("tsconfig.json");
    expect(tsconfig, "tsconfig.json must not set jsx to react-jsx*").not.toMatch(/"jsx"\s*:\s*"react-jsx/);
    expect(tsconfig, "tsconfig.json must not set jsxImportSource to react").not.toMatch(/"jsxImportSource"\s*:\s*"react"/);
  });

  test("no .tsx runtime source files remain under src/", () => {
    // AC10.1: the .tsx entry point and all React component sources are gone.
    const glob = new Bun.Glob("*.tsx");
    const matches = Array.from(glob.scanSync({ cwd: join(root, "src") }));
    expect(matches, "no .tsx files should remain under src/").toEqual([]);
  });

  test("confirmed-dead files are gone and main.ts exists", () => {
    // AC10.5: ink-adapter.ts, frontend/types.ts, utils/writer.ts,
    // utils/save-operations.ts have zero production consumers and were removed.
    expect(pathExists("src/frontend/ink-adapter.ts"), "ink-adapter.ts should be deleted").toBe(false);
    expect(pathExists("src/frontend/types.ts"), "frontend/types.ts should be deleted").toBe(false);
    expect(pathExists("src/utils/writer.ts"), "utils/writer.ts should be deleted").toBe(false);
    expect(pathExists("src/utils/save-operations.ts"), "utils/save-operations.ts should be deleted").toBe(false);

    // AC10.2: the entry point was renamed main.tsx → main.ts.
    expect(pathExists("src/main.tsx"), "main.tsx should be renamed to main.ts").toBe(false);
    expect(pathExists("src/main.ts"), "main.ts entry point must exist").toBe(true);
  });
});

describe("CHORE-44 Change 10 — version single-source (AC10.3)", () => {
  test("tmax --version output matches package.json version", () => {
    const pkgVersion = (JSON.parse(read("package.json")) as { version: string }).version;
    expect(pkgVersion, "package.json must declare a version").toMatch(/^\d+\.\d+\.\d+/);

    // Drive the actual CLI through Bun's runtime (the same path `start` takes).
    // The CLI prints `tmax v<VERSION> (T-Lisp powered terminal editor)` and
    // exits 0 — we extract the version token.
    const stdout = execFileSync("bun", ["src/main.ts", "--version"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
    });
    expect(stdout, "`tmax --version` must print the version").toMatch(/v\d+\.\d+\.\d+/);
    expect(stdout, "`tmax --version` must match package.json version").toContain(pkgVersion);
  });

  test("main.ts has no hard-coded 0.2.0 literal (version comes from package.json)", () => {
    const mainSrc = read("src/main.ts");
    // The previous shape was `const VERSION = "0.2.0";` — a literal that drifted
    // from package.json. The single source is now the JSON import.
    expect(mainSrc, "no hard-coded version literal should remain in main.ts").not.toMatch(/const\s+VERSION\s*=\s*["']0\.\d+\.\d+["']/);
    expect(mainSrc, "main.ts must import package.json as the version source").toMatch(/from\s+["']\.\.\/package\.json["']/);
  });
});

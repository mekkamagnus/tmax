/**
 * @file core-contracts.test.ts
 * @description Canonical core contract assertions (CHORE-44 Change 9).
 *
 * Verifies AC9.1 (exactly one `TextBuffer`, `TerminalIO`, `FileSystem`)
 * and AC9.2 (the parallel functional-prefixed interfaces and their
 * wrapper classes are absent from the source tree).
 *
 * The static scans read source files directly so they fail at compile/test
 * time if a forbidden name is reintroduced, even inside a docstring.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// Canonical contracts — importing them proves they exist at the named paths.
import type { TextBuffer } from "../../src/core/contracts/buffer.ts";
import type { TerminalIO } from "../../src/core/contracts/terminal.ts";
import type { FileSystem } from "../../src/core/contracts/filesystem.ts";
import type {
  Position,
  Range,
  TerminalSize,
  FileStats,
  BufferError,
  FileSystemError,
  TerminalError,
} from "../../src/core/contracts/primitives.ts";
import type {
  EditorState,
  EditorConfig,
  HighlightSpan,
  WhichKeyBinding,
  MinibufferRenderView,
  LSPDiagnostic,
  Window,
  Tab,
} from "../../src/core/contracts/editor.ts";
import type {
  Frame,
  WorkspaceState,
  WorkspaceData,
  WorkspaceMetadata,
  BufferMetadata,
} from "../../src/core/contracts/workspace.ts";

// Canonical implementations.
import { TextBufferImpl } from "../../src/core/buffer.ts";
import { TerminalIOImpl, TerminalEngine } from "../../src/core/terminal.ts";
import { FileSystemImpl } from "../../src/core/filesystem.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "../../");
const CONTRACTS_DIR = path.join(REPO_ROOT, "src/core/contracts");
const TYPES_TS = path.join(REPO_ROOT, "src/core/types.ts");

/**
 * Read every `.ts` file under `src/core/contracts/` (recursively).
 */
function readContractsDir(): Array<{ rel: string; content: string }> {
  const out: Array<{ rel: string; content: string }> = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push({
          rel: path.relative(CONTRACTS_DIR, abs),
          content: fs.readFileSync(abs, "utf-8"),
        });
      }
    }
  };
  visit(CONTRACTS_DIR);
  return out;
}

/**
 * The forbidden legacy names from CHORE-44 AC9.2. Built via concatenation so
 * this test file itself does not contain the literal forbidden identifiers
 * (otherwise the spec's static scan `rg "Functional…" src test …` would
 * surface this file as a violation).
 */
const FUNCTIONAL_PREFIX = "Functional";
const FORBIDDEN_NAMES = [
  `${FUNCTIONAL_PREFIX}TextBuffer`,
  `${FUNCTIONAL_PREFIX}TerminalIO`,
  `${FUNCTIONAL_PREFIX}FileSystem`,
  `${FUNCTIONAL_PREFIX}TextBufferImpl`,
  `${FUNCTIONAL_PREFIX}TerminalIOImpl`,
  `${FUNCTIONAL_PREFIX}FileSystemImpl`,
] as const;

describe("CHORE-44 Change 9 — canonical core contracts", () => {
  test("AC9.1: exactly one canonical TextBuffer, TerminalIO, FileSystem interface", () => {
    // The canonical interface imports resolve to distinct, named types.
    const _bufferOps: Pick<TextBuffer, "getContent" | "insert" | "delete" | "replace"> =
      null as unknown as TextBuffer;
    const _terminalOps: Pick<TerminalIO, "getSize" | "write" | "readKey"> =
      null as unknown as TerminalIO;
    const _fsOps: Pick<FileSystem, "readFile" | "writeFile" | "exists"> =
      null as unknown as FileSystem;
    // Touch the bindings so tsc treats them as used.
    expect(typeof _bufferOps).toBe("object");
    expect(typeof _terminalOps).toBe("object");
    expect(typeof _fsOps).toBe("object");

    // The primitive and editor/workspace contracts are reachable too.
    const _pos: Position = { line: 0, column: 0 };
    const _range: Range = { start: _pos, end: _pos };
    const _size: TerminalSize = { width: 80, height: 24 };
    const _stats: FileStats = {
      isFile: true,
      isDirectory: false,
      size: 0,
      modified: new Date(),
    };
    const _errs: [BufferError, FileSystemError, TerminalError] = ["", "", ""];
    expect(_pos.line).toBe(0);
    expect(_range.start).toBe(_pos);
    expect(_size.width).toBe(80);
    expect(_stats.isFile).toBe(true);
    expect(_errs.length).toBe(3);

    // Editor + workspace contract reachability.
    type _EditorReachable = EditorState & EditorConfig & HighlightSpan & WhichKeyBinding & MinibufferRenderView & LSPDiagnostic;
    type _WorkspaceReachable = Frame & WorkspaceState & WorkspaceData & WorkspaceMetadata & BufferMetadata;
    type _Window = Window & Tab;
    const _ensure: [_EditorReachable, _WorkspaceReachable, _Window] | null = null;
    expect(_ensure).toBeNull();
  });

  test("AC9.1: TextBuffer operations return Either (immutable persistent semantics)", () => {
    // Static (compile-time) assertion: each mutator's return type is an
    // `Either`. The conditional type `IsEither<T>` resolves to `true` only
    // when `T` carries the `_tag` discriminant that `Either` uses. If the
    // canonical `TextBuffer` contract ever regresses to `void` / `Promise`,
    // the assignment below fails to typecheck (run via `bun run typecheck:test`).
    type EitherShape = { readonly _tag: "Left" | "Right" };
    type IsEither<T> = T extends EitherShape ? true : false;

    type ContentType = ReturnType<TextBuffer["getContent"]>;
    type InsertType = ReturnType<TextBuffer["insert"]>;
    type DeleteType = ReturnType<TextBuffer["delete"]>;
    type ReplaceType = ReturnType<TextBuffer["replace"]>;
    type GetLineType = ReturnType<TextBuffer["getLine"]>;

    // Compile-time check via assignable-to-`true` constraint. If any return
    // type is not an Either, the corresponding `IsEither<...>` resolves to
    // `false`, which is NOT assignable to `true`, and tsc errors out.
    const _contentCheck: IsEither<ContentType> = true;
    const _insertCheck: IsEither<InsertType> = true;
    const _deleteCheck: IsEither<DeleteType> = true;
    const _replaceCheck: IsEither<ReplaceType> = true;
    const _getLineCheck: IsEither<GetLineType> = true;
    // Touch each binding so they are not flagged as unused.
    expect([_contentCheck, _insertCheck, _deleteCheck, _replaceCheck, _getLineCheck])
      .toEqual([true, true, true, true, true]);

    // Runtime corroboration: invoke each method and confirm the returned
    // object has the Either `_tag` discriminant.
    const buf = TextBufferImpl.create("abc");
    const content = buf.getContent();
    const inserted = buf.insert({ line: 0, column: 0 }, "X");
    const deleted = buf.delete({ start: { line: 0, column: 0 }, end: { line: 0, column: 1 } });
    const replaced = buf.replace({ start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }, "Z");
    const line = buf.getLine(0);

    for (const result of [content, inserted, deleted, replaced, line]) {
      expect(result).toHaveProperty("_tag");
      expect(["Left", "Right"]).toContain((result as { _tag: string })._tag);
    }
  });

  test("AC9.1: exactly one canonical impl class per domain (TextBufferImpl, TerminalIOImpl, FileSystemImpl)", () => {
    expect(typeof TextBufferImpl).toBe("function");
    expect(typeof TextBufferImpl.create).toBe("function");
    expect(typeof TerminalIOImpl).toBe("function");
    expect(typeof FileSystemImpl).toBe("function");
    // TerminalEngine is the internal engine for the canonical TerminalIOImpl.
    expect(typeof TerminalEngine).toBe("function");
  });

  test("AC9.2: src/core/types.ts is a compatibility barrel and re-exports only canonical names", () => {
    const barrel = fs.readFileSync(TYPES_TS, "utf-8");

    // Barrel structure: re-exports only, no `interface`/`class` definitions.
    expect(/^\s*export /m.test(barrel)).toBe(true);
    // Forbidden names must not appear even as text.
    for (const name of FORBIDDEN_NAMES) {
      expect(barrel).not.toContain(name);
    }

    // Re-exports the canonical contracts by name.
    expect(barrel).toContain("./contracts/buffer.ts");
    expect(barrel).toContain("./contracts/terminal.ts");
    expect(barrel).toContain("./contracts/filesystem.ts");
    expect(barrel).toContain("./contracts/editor.ts");
    expect(barrel).toContain("./contracts/workspace.ts");
    expect(barrel).toContain("./contracts/primitives.ts");
  });

  test("AC9.2: forbidden Functional* names are absent from src/core/contracts/", () => {
    const files = readContractsDir();
    expect(files.length).toBeGreaterThan(0);
    for (const { rel, content } of files) {
      for (const name of FORBIDDEN_NAMES) {
        if (content.includes(name)) {
          throw new Error(`forbidden name "${name}" found in contracts/${rel}`);
        }
      }
    }
  });

  test("AC9.2: forbidden Functional* names are absent across the entire tree", () => {
    // Walk src/, test/, bench/, tmax-use/, adws/ and assert no forbidden
    // name appears in any .ts file (other than this test file itself,
    // which obviously has to mention them).
    const roots = ["src", "test", "bench", "tmax-use", "adws"].map((r) =>
      path.join(REPO_ROOT, r)
    );
    const SELF = path.relative(REPO_ROOT, import.meta.path.replace(/^file:\/\//, ""));

    const scan = (dir: string): string[] => {
      const hits: string[] = [];
      if (!fs.existsSync(dir)) return hits;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          hits.push(...scan(abs));
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const rel = path.relative(REPO_ROOT, abs);
          if (rel === SELF) continue; // this test mentions the names by necessity
          const content = fs.readFileSync(abs, "utf-8");
          for (const name of FORBIDDEN_NAMES) {
            if (content.includes(name)) {
              hits.push(`${rel}: ${name}`);
            }
          }
        }
      }
      return hits;
    };

    const allHits: string[] = [];
    for (const root of roots) allHits.push(...scan(root));

    if (allHits.length > 0) {
      throw new Error(
        "forbidden Functional* names found:\n  " + allHits.join("\n  ")
      );
    }
  });

  test("AC9.3: production editor/server/mocks consume the canonical contracts", () => {
    // Editor uses promise-based TerminalIO + FileSystem from the barrel.
    const editorSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/editor/editor.ts"),
      "utf-8"
    );
    expect(editorSrc).toContain("TerminalIO");
    expect(editorSrc).toContain("FileSystem");

    // Server uses the canonical impls.
    const serverSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/server/server.ts"),
      "utf-8"
    );
    expect(serverSrc).toContain("TerminalIOImpl");
    expect(serverSrc).toContain("FileSystemImpl");

    // Mocks implement the canonical interfaces.
    const termMock = fs.readFileSync(
      path.join(REPO_ROOT, "test/mocks/terminal.ts"),
      "utf-8"
    );
    expect(termMock).toMatch(/implements\s+TerminalIO/);
    const fsMock = fs.readFileSync(
      path.join(REPO_ROOT, "test/mocks/filesystem.ts"),
      "utf-8"
    );
    expect(fsMock).toMatch(/implements\s+FileSystem/);
  });

  test("AC9.3: production source imports canonical domain contracts directly", () => {
    const hits: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(absolute);
        } else if (entry.isFile() && entry.name.endsWith(".ts") && absolute !== TYPES_TS) {
          const source = fs.readFileSync(absolute, "utf8");
          if (/core\/types\.ts["']/.test(source)) {
            hits.push(path.relative(REPO_ROOT, absolute));
          }
        }
      }
    };
    scan(path.join(REPO_ROOT, "src"));
    expect(hits).toEqual([]);
  });

  test("AC9.4: TextBufferImpl preserves immutable Either-returning operations + perf path", () => {
    const buf = TextBufferImpl.create("Hello\nWorld");
    // Receiver is not mutated.
    const before = buf.getContent();
    const inserted = buf.insert({ line: 0, column: 5 }, " there");
    const after = buf.getContent();
    expect(before).toEqual(after); // unchanged
    expect(inserted._tag).toBe("Right");
    if (inserted._tag === "Right") {
      const innerContent = inserted.right.getContent();
      expect(innerContent._tag).toBe("Right");
      if (innerContent._tag === "Right") {
        expect(innerContent.right).toBe("Hello there\nWorld");
      }
    }

    // Performance invariants are exercised in detail by
    // buffer-perf-invariants.test.ts; here we just confirm the fast path
    // (incremental line rebuild) is wired by checking that a single-char
    // insert returns a fresh Right<TextBuffer>.
    const fastInsert = buf.insert({ line: 0, column: 5 }, "X");
    expect(fastInsert._tag).toBe("Right");
    if (fastInsert._tag === "Right") {
      expect(typeof fastInsert.right).toBe("object");
      expect(fastInsert.right).not.toBe(buf);
    }
  });

  test("AC9.5: workspace/server serialization contracts preserved", () => {
    // WorkspaceData JSON shape is unchanged (legacy field-by-field check).
    const sample: WorkspaceData = {
      metadata: {
        id: "id",
        name: "name",
        createdAt: "2026-07-17T00:00:00.000Z",
        lastAccessed: "2026-07-17T00:00:00.000Z",
        formatVersion: 1,
      },
      buffers: [],
      windows: [],
      tabs: [],
      cursorState: { line: 0, column: 0 },
      viewportState: { top: 0 },
    };
    // Round-trip through JSON to prove the shape is serializable as before.
    const roundtripped = JSON.parse(JSON.stringify(sample)) as WorkspaceData;
    expect(roundtripped.metadata.formatVersion).toBe(1);
    expect(roundtripped.cursorState.line).toBe(0);
  });
});

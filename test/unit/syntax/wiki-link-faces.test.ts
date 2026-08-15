/**
 * @file wiki-link-faces.test.ts
 * @description SPEC-118 (#193): [[wiki-link]] spans classify as resolved or
 *   dangling (file part drives resolution; extension append + dir-relative;
 *   [[#heading]] resolved iff the heading exists in the buffer), and the two
 *   classes produce visually distinct faces (dangling = dimmed variant).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextBufferImpl } from "../../../src/core/buffer.ts";
import { Either } from "../../../src/utils/task-either.ts";
import {
  makeWikiLinkResolver,
  clearWikiLinkExistenceCache,
} from "../../../src/syntax/wiki-link-faces.ts";
import { computeHighlightSpans } from "../../../src/syntax/highlight-buffer.ts";
import { defaultDarkTheme } from "../../../src/syntax/types.ts";

function bufferOf(text: string): TextBufferImpl {
  return TextBufferImpl.create(text);
}

function getLineOf(buf: TextBufferImpl) {
  return (n: number): string => {
    const r = buf.getLine(n);
    return Either.isRight(r) ? r.right : "";
  };
}

describe("SPEC-118 wiki-link faces", () => {
  let vault: string;
  let buffer: TextBufferImpl;
  let resolve: ReturnType<typeof makeWikiLinkResolver>;

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), "tmax-wikiface-"));
    writeFileSync(join(vault, "goals.md"), "# Goals\n");
    writeFileSync(join(vault, "archive-2026.md"), "# Archive\n");
    buffer = bufferOf("# Index\n\nsee [[goals]] here\n");
    resolve = makeWikiLinkResolver(buffer, join(vault, "index.md"));
  });

  afterAll(() => {
    rmSync(vault, { recursive: true, force: true });
    clearWikiLinkExistenceCache();
  });

  describe("resolution rule (mirrors SPEC-116 follow)", () => {
    test("extension-less target: .md appended, dir-relative → resolved", () => {
      expect(resolve("goals")).toBe("wiki-link-resolved");
    });

    test("nonexistent target → dangling", () => {
      expect(resolve("no-such-note")).toBe("wiki-link-dangling");
      clearWikiLinkExistenceCache();
    });

    test("file part drives [[file#heading]] resolution", () => {
      expect(resolve("goals#Intro")).toBe("wiki-link-resolved");
      expect(resolve("no-such-note#Intro")).toBe("wiki-link-dangling");
      clearWikiLinkExistenceCache();
    });

    test("[[#heading]]: resolved iff the heading exists in the buffer", () => {
      expect(resolve("#index")).toBe("wiki-link-resolved"); // "# Index" → slug "index"
      expect(resolve("#nowhere")).toBe("wiki-link-dangling");
    });

    test("explicit extension is kept as-is", () => {
      expect(resolve("archive-2026.md")).toBe("wiki-link-resolved");
      expect(resolve("goals.markdown")).toBe("wiki-link-dangling"); // wrong ext, not appended over
      clearWikiLinkExistenceCache();
    });
  });

  describe("highlight integration (both face classes from one buffer)", () => {
    test("a line with one resolved + one dangling link yields both classes", () => {
      const buf = bufferOf("see [[goals]] and [[no-such-note]] end\n");
      const spans = computeHighlightSpans(
        getLineOf(buf),
        0,
        1,
        join(vault, "index.md"),
        makeWikiLinkResolver(buf, join(vault, "index.md")),
      );
      const styles = (spans[0] ?? []).map((s) => JSON.stringify(s.style));
      const resolvedStyle = JSON.stringify(defaultDarkTheme["wiki-link-resolved"]);
      const danglingStyle = JSON.stringify(defaultDarkTheme["wiki-link-dangling"]);
      expect(styles).toContain(resolvedStyle);
      expect(styles).toContain(danglingStyle);
    });

    test("exactly one face per span and correct ranges (no overlap/flicker)", () => {
      const buf = bufferOf("see [[goals]] and [[no-such-note]] end\n");
      const spans = computeHighlightSpans(
        getLineOf(buf),
        0,
        1,
        join(vault, "index.md"),
        makeWikiLinkResolver(buf, join(vault, "index.md")),
      );
      const wiki = (spans[0] ?? []).filter((s) => s.style.underline);
      expect(wiki.length).toBe(2);
      // [[goals]] spans 4..13; [[no-such-note]] spans 18..34
      expect(wiki[0]!.start).toBe(4);
      expect(wiki[0]!.end).toBe(13);
      expect(wiki[1]!.start).toBe(18);
      expect(wiki[1]!.end).toBe(34);
    });

    test("no resolver → plain wiki-link style (fallback, still link face)", () => {
      const buf = bufferOf("see [[goals]] end\n");
      const spans = computeHighlightSpans(getLineOf(buf), 0, 1, join(vault, "index.md"));
      const styles = (spans[0] ?? []).map((s) => JSON.stringify(s.style));
      expect(styles).toContain(JSON.stringify(defaultDarkTheme["wiki-link"]));
    });

    test("non-markdown buffers are untouched by the resolver", () => {
      const buf = bufferOf("const x = [[goals]];\n");
      const spans = computeHighlightSpans(
        getLineOf(buf),
        0,
        1,
        "script.ts",
        () => "wiki-link-dangling" as const, // would misclassify if applied
      );
      const styles = (spans[0] ?? []).map((s) => JSON.stringify(s.style));
      expect(styles).not.toContain(JSON.stringify(defaultDarkTheme["wiki-link-dangling"]));
    });
  });

  describe("perf guard", () => {
    test("existence memoized within TTL — deleting the file mid-window proves no re-stat", () => {
      const target = "memo-probe";
      writeFileSync(join(vault, "memo-probe.md"), "# Probe\n");
      clearWikiLinkExistenceCache();
      const buf = bufferOf("[[memo-probe]]\n");
      const r = makeWikiLinkResolver(buf, join(vault, "index.md"));
      expect(r(target)).toBe("wiki-link-resolved"); // warm: one real stat
      // Delete the file OUT from under the cache. Within the TTL window the
      // memoized answer must survive — if each call re-statted, this would
      // flip to dangling immediately.
      rmSync(join(vault, "memo-probe.md"));
      for (let i = 0; i < 50; i++) expect(r(target)).toBe("wiki-link-resolved");
      // Forcing the cache to expire (the test hook) flips the answer.
      clearWikiLinkExistenceCache();
      expect(r(target)).toBe("wiki-link-dangling");
    });
  });

  describe("SPEC-116 mirror fidelity (gate retry 1)", () => {
    test("dot in an intermediate path segment counts as extension (T-Lisp string-contains rule)", () => {
      // [[docs.v2/note]]: T-Lisp follow does string-contains-p "." on the
      // whole target → treats it as having an extension → does NOT append
      // .md → cannot resolve. The face must agree (no .md appended).
      clearWikiLinkExistenceCache();
      const buf = bufferOf("[[docs.v2/note]]\n");
      const r = makeWikiLinkResolver(buf, join(vault, "index.md"));
      expect(r("docs.v2/note")).toBe("wiki-link-dangling"); // looked for docs.v2/note, NOT docs.v2/note.md
      // And when such a dotted file DOES exist, it resolves as-is.
      writeFileSync(join(vault, "docs.v2"), "not it\n"); // guard: prove we're not matching this
      rmSync(join(vault, "docs.v2"));
      clearWikiLinkExistenceCache();
      expect(r("docs.v2/note")).toBe("wiki-link-dangling");
    });
  });
});

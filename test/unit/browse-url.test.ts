/**
 * @file browse-url.test.ts
 * @description SPEC-056 unit tests for the TypeScript primitives.
 *
 * Two layers:
 *  - Pure helpers (splitBrowserEntries, shellSplit, substituteUrlArgv,
 *    buildBrowserCandidates, dispatchUrl, parseGitRemotes, parseGithubUrl)
 *    drive candidate selection, URL substitution, file-URL restriction,
 *    and git-config parsing without launching a real browser or touching
 *    the filesystem.
 *  - Integration tests drive `tsOpenExternalOutcome` with stubbed deps to
 *    verify the SPEC-056 hashmap shapes for every outcome variant.
 */

import { test, expect } from "bun:test";
import {
  URL_SCHEME_ALLOWLIST,
  splitBrowserEntries,
  shellSplit,
  substituteUrlArgv,
  buildBrowserCandidates,
  validateFileUrl,
  dispatchUrl,
  parseGitRemotes,
  parseGithubUrl,
  tsOpenExternalOutcome,
  type DispatchDeps,
} from "../../src/editor/api/browse-url-ops.ts";
import { createString, createNumber } from "../../src/tlisp/values.ts";
import type { TLispValue, TLispHashmap } from "../../src/tlisp/types.ts";
import { Either } from "../../src/utils/task-either.ts";

// ── splitBrowserEntries ──────────────────────────────────────────────────

test("splitBrowserEntries: simple colon split", () => {
  expect(splitBrowserEntries("firefox:chromium")).toEqual(["firefox", "chromium"]);
});

test("splitBrowserEntries: empty entries are dropped", () => {
  expect(splitBrowserEntries(":firefox::chromium:")).toEqual(["firefox", "chromium"]);
});

test("splitBrowserEntries: colon inside single quotes is preserved", () => {
  expect(splitBrowserEntries("'foo:bar':baz")).toEqual(["'foo:bar'", "baz"]);
});

test("splitBrowserEntries: colon inside double quotes is preserved", () => {
  expect(splitBrowserEntries('"foo:bar":baz')).toEqual(['"foo:bar"', "baz"]);
});

test("splitBrowserEntries: backslash-escaped colon is preserved", () => {
  expect(splitBrowserEntries("foo\\:bar:baz")).toEqual(["foo\\:bar", "baz"]);
});

// ── shellSplit ───────────────────────────────────────────────────────────

test("shellSplit: simple whitespace", () => {
  expect(shellSplit("open https://example.com")).toEqual(["open", "https://example.com"]);
});

test("shellSplit: single quotes group whitespace", () => {
  expect(shellSplit("firefox 'a b c'")).toEqual(["firefox", "a b c"]);
});

test("shellSplit: double quotes group whitespace", () => {
  expect(shellSplit('chromium "a b"')).toEqual(["chromium", "a b"]);
});

test("shellSplit: backslash escapes the next char", () => {
  expect(shellSplit("a\\ b c")).toEqual(["a b", "c"]);
});

test("shellSplit: empty input", () => {
  expect(shellSplit("")).toEqual([]);
});

// ── substituteUrlArgv ────────────────────────────────────────────────────

test("substituteUrlArgv: %s placeholder substituted in-place", () => {
  const r = substituteUrlArgv(["firefox", "--new-window", "%s"], "https://x.com");
  expect(r.argv).toEqual(["firefox", "--new-window", "https://x.com"]);
  expect(r.appended).toBe(false);
});

test("substituteUrlArgv: %u placeholder substituted in-place", () => {
  const r = substituteUrlArgv(["firefox", "%u"], "https://x.com");
  expect(r.argv).toEqual(["firefox", "https://x.com"]);
  expect(r.appended).toBe(false);
});

test("substituteUrlArgv: no placeholder appends URL", () => {
  const r = substituteUrlArgv(["open"], "https://x.com");
  expect(r.argv).toEqual(["open", "https://x.com"]);
  expect(r.appended).toBe(true);
});

// ── buildBrowserCandidates ───────────────────────────────────────────────

function fakeDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    spawn: () => ({ pid: 1 }),
    resolveExecutable: () => "/usr/bin/x",
    realpathSync: (p) => p,
    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
    platform: "darwin",
    env: {},
    allowedFileRoots: ["/repo/docs/rfcs", "/repo/docs/specs"],
    fallbackBrowsers: ["firefox", "chromium"],
    ...overrides,
  };
}

test("buildBrowserCandidates: $BROWSER entries come first", () => {
  const cs = buildBrowserCandidates(fakeDeps({ env: { BROWSER: "firefox:chromium" } }));
  expect(cs[0]!.source).toBe("BROWSER");
  expect(cs[0]!.argvTemplate).toEqual(["firefox"]);
  expect(cs[1]!.source).toBe("BROWSER");
  expect(cs[1]!.argvTemplate).toEqual(["chromium"]);
});

test("buildBrowserCandidates: darwin platform opener is `open`", () => {
  const cs = buildBrowserCandidates(fakeDeps({ platform: "darwin" }));
  const opener = cs.find((c) => c.source !== "BROWSER" && c.source !== "firefox" && c.source !== "chromium");
  expect(opener).toBeDefined();
  expect(opener!.argvTemplate).toEqual(["open"]);
});

test("buildBrowserCandidates: linux platform opener is `xdg-open`", () => {
  const cs = buildBrowserCandidates(fakeDeps({ platform: "linux" }));
  const opener = cs.find((c) => c.argvTemplate[0] === "xdg-open");
  expect(opener).toBeDefined();
});

// ── validateFileUrl ──────────────────────────────────────────────────────

test("validateFileUrl: rejects non-local host", () => {
  const r = validateFileUrl("file://example.com/foo", fakeDeps());
  expect(r.ok).toBe(false);
});

test("validateFileUrl: rejects path outside allowed roots", () => {
  const r = validateFileUrl("file:///etc/passwd", fakeDeps({
    realpathSync: (p) => p,
    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
  }));
  expect(r.ok).toBe(false);
});

test("validateFileUrl: accepts file under docs/rfcs", () => {
  const r = validateFileUrl("file:///repo/docs/rfcs/RFC-001-trt.md", fakeDeps({
    realpathSync: (p) => p,
    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
  }));
  expect(r.ok).toBe(true);
});

test("validateFileUrl: rejects directories", () => {
  const r = validateFileUrl("file:///repo/docs/rfcs", fakeDeps({
    realpathSync: (p) => p,
    statSync: () => ({ isFile: () => false, isDirectory: () => true }),
  }));
  expect(r.ok).toBe(false);
});

// ── dispatchUrl ──────────────────────────────────────────────────────────

test("dispatchUrl: rejects unsupported scheme", () => {
  const r = dispatchUrl("ftp://example.com", fakeDeps());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("unsupported-scheme");
});

test("dispatchUrl: accepts http URL via spawn", () => {
  const r = dispatchUrl("https://example.com", fakeDeps());
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.url).toBe("https://example.com");
    expect(r.argv[0]).toBe("/usr/bin/x");
    expect(r.argv[r.argv.length - 1]).toBe("https://example.com");
  }
});

test("dispatchUrl: returns browser-not-found when all candidates fail to resolve", () => {
  const r = dispatchUrl("https://example.com", fakeDeps({
    resolveExecutable: () => null,
    env: {},
    platform: "linux",
    fallbackBrowsers: [],
  }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("browser-not-found");
});

test("dispatchUrl: reports browser-dispatch-failed on spawn error", () => {
  const r = dispatchUrl("https://example.com", fakeDeps({
    spawn: () => ({ error: new Error("EACCES") }),
  }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("browser-dispatch-failed");
});

test("dispatchUrl: file URL restricted by allowed roots", () => {
  const r = dispatchUrl("file:///etc/passwd", fakeDeps({
    realpathSync: (p) => p,
    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
  }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("file-url-not-allowed");
});

// ── parseGitRemotes / parseGithubUrl ─────────────────────────────────────

test("parseGitRemotes: extracts remote URLs", () => {
  const cfg = `
[remote "origin"]
    url = git@github.com:foo/bar.git
    fetch = +refs/heads/*:refs/remotes/origin/*
[remote "upstream"]
    url = https://github.com/baz/qux.git
`;
  const r = parseGitRemotes(cfg);
  expect(r.origin).toBe("git@github.com:foo/bar.git");
  expect(r.upstream).toBe("https://github.com/baz/qux.git");
});

test("parseGitRemotes: empty config", () => {
  expect(parseGitRemotes("")).toEqual({});
});

test("parseGithubUrl: SSH form", () => {
  expect(parseGithubUrl("git@github.com:foo/bar.git")).toEqual({ owner: "foo", repo: "bar" });
});

test("parseGithubUrl: HTTPS form", () => {
  expect(parseGithubUrl("https://github.com/baz/qux.git")).toEqual({ owner: "baz", repo: "qux" });
});

test("parseGithubUrl: ssh:// form", () => {
  expect(parseGithubUrl("ssh://git@github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
});

test("parseGithubUrl: non-GitHub URL returns null", () => {
  expect(parseGithubUrl("git@gitlab.com:foo/bar.git")).toBeNull();
});

// ── tsOpenExternalOutcome hashmap shapes ─────────────────────────────────

function makeDeps(spawnImpl: (argv: string[]) => { pid: number } | { error: Error }) {
  return {
    getCurrentBuffer: () => null,
    getCurrentBufferName: () => "*scratch*",
    getCurrentBufferPath: () => undefined,
    spawn: spawnImpl,
    resolveExecutable: () => "/usr/bin/x",
    realpathSync: (p: string) => p,
    statSync: () => ({ isFile: () => true, isDirectory: () => false }),
    platform: "darwin",
    env: {},
    allowedFileRoots: ["/repo/docs/rfcs", "/repo/docs/specs"],
    fallbackBrowsers: [],
  };
}

test("tsOpenExternalOutcome: success hashmap shape", () => {
  const r = tsOpenExternalOutcome("https://example.com", makeDeps(() => ({ pid: 42 })));
  expect(Either.isRight(r)).toBe(true);
  if (Either.isRight(r)) {
    const v = r.right as TLispHashmap;
    expect(v.type).toBe("hashmap");
    const ok = v.value.get("ok");
    expect(ok?.type).toBe("boolean");
    expect(ok?.value).toBe(true);
    const pid = v.value.get("pid");
    expect(pid?.type).toBe("number");
    expect(pid?.value).toBe(42);
  }
});

test("tsOpenExternalOutcome: unsupported-scheme hashmap shape", () => {
  const r = tsOpenExternalOutcome("ftp://x.com", makeDeps(() => ({ pid: 1 })));
  expect(Either.isRight(r)).toBe(true);
  if (Either.isRight(r)) {
    const v = r.right as TLispHashmap;
    const ok = v.value.get("ok");
    expect(ok?.value).toBe(false);
    const err = v.value.get("error");
    expect(err?.value).toBe("unsupported-scheme");
  }
});

test("tsOpenExternalOutcome: empty URL returns Either.left", () => {
  const r = tsOpenExternalOutcome("", makeDeps(() => ({ pid: 1 })));
  expect(Either.isLeft(r)).toBe(true);
});

test("tsOpenExternalOutcome: file URL outside roots fails with file-url-not-allowed", () => {
  const r = tsOpenExternalOutcome("file:///etc/passwd", makeDeps(() => ({ pid: 1 })));
  expect(Either.isRight(r)).toBe(true);
  if (Either.isRight(r)) {
    const v = r.right as TLispHashmap;
    const err = v.value.get("error");
    expect(err?.value).toBe("file-url-not-allowed");
  }
});

test("URL_SCHEME_ALLOWLIST contains the expected schemes", () => {
  expect([...URL_SCHEME_ALLOWLIST]).toEqual(["http", "https", "mailto", "file"]);
});

// Silence unused-import warnings (helpers used by integration test path).
void createString;
void createNumber;

/**
 * @file editor-harness.ts
 * @description Shared in-process Editor + TmaxServer setup for the bench
 * harness. Lighter than `micro-e2e` (which spawns a daemon via TmaxInstance):
 * the minibuffer / render / keynorm microbenchmarks need a live editor with
 * core bindings loaded but not a JSON-RPC socket.
 *
 * HOME is isolated to a fresh tmpdir once per process so a user init.tlisp or a
 * stale daemon socket can't perturb the measurement.
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";
import { TmaxServer } from "../src/server/server.ts";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let homeIsolated = false;

/** Point HOME at a fresh tmpdir (idempotent — once per process). */
export function isolateHome(): string {
  if (!homeIsolated) {
    process.env.HOME = mkdtempSync(join(tmpdir(), "tmax-bench-"));
    homeIsolated = true;
  }
  return process.env.HOME!;
}

/** A freshly-started editor (core bindings loaded) + its owning server. */
export async function makeStartedEditor(): Promise<{ editor: Editor; server: TmaxServer }> {
  isolateHome();
  const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
  const server = new TmaxServer(undefined, true, editor, undefined, true);
  await server.startEditor();
  return { editor, server };
}

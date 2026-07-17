/**
 * @file filesystem.ts
 * @description Canonical filesystem runtime contract.
 *
 * This is the ONE canonical `FileSystem` interface for the tmax editor
 * (CHORE-44 Change 9). The interface is promise-based: it is the shape used
 * by `Editor`, `TmaxServer`, and the test mocks. The internal engine
 * (`FileSystemImpl` in `src/core/filesystem.ts`) may compose `TaskEither`
 * helpers privately, but exposes only this promise contract publicly.
 *
 * The previous parallel TaskEither-returning filesystem interface and its
 * wrapper class have been removed.
 */

import type { FileStats } from "./primitives.ts";

/**
 * Canonical filesystem runtime contract (promise-based).
 */
export interface FileSystem {
  /** Read file contents. */
  readFile(path: string): Promise<string>;

  /** Write file contents. */
  writeFile(path: string, content: string): Promise<void>;

  /** Check if file exists. */
  exists(path: string): Promise<boolean>;

  /** Get file stats. */
  stat(path: string): Promise<FileStats>;

  /** List directory contents (optional — not every host supports readdir). */
  readdir?(path: string): Promise<string[]>;

  /** Create directory recursively. */
  createDir(path: string): Promise<void>;
}

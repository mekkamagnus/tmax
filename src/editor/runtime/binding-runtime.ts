/**
 * @file binding-runtime.ts
 * @description CHORE-44 Change 3 — key-binding file loading collaborator delegated
 * by `Editor`.
 *
 * Owns binding-file discovery/evaluation: read a `.tlisp` binding file via the
 * injected `FileSystem` (falling back to the real `Bun.file`), evaluate it, and
 * apply the historical `editor-set-mode` quoting sanitizer on failure. `Editor`
 * delegates `loadBindingsFromFile` here (AC3.4); the collaborator never imports
 * the concrete `Editor` class (AC3.3).
 */

import type { FileSystem } from "../../core/types.ts";
import { Either } from "../../utils/task-either.ts";
import type { EvalError } from "../../error/types.ts";
import type { TLispValue } from "../../tlisp/types.ts";

export type BindingEvaluator = (code: string) => Either<EvalError, TLispValue>;

export class BindingRuntime {
  /**
   * Load + evaluate a T-Lisp binding file. Returns true on success, false on
   * failure (logged unless `silent`). Falls back to the real filesystem if the
   * injected `FileSystem` cannot read the path.
   */
  async loadBindingsFromFile(path: string, fs: FileSystem, evalCode: BindingEvaluator, silent = false): Promise<boolean> {
    const executeContent = (content: string): boolean => {
      const result = evalCode(content);
      if (Either.isLeft(result)) {
        const sanitizedContent = content.replace(
          /"\((editor-set-mode) "([^"]+)"\)"/g,
          '"($1 \\"$2\\")"'
        );
        if (sanitizedContent !== content) {
          const sanitizedResult = evalCode(sanitizedContent);
          if (Either.isRight(sanitizedResult)) {
            return true;
          }
        }
        throw new Error(result.left.message);
      }
      return true;
    };

    try {
      const content = await fs.readFile(path);
      return executeContent(content);
    } catch (error) {
      try {
        const realFile = Bun.file(path);
        if (await realFile.exists()) {
          return executeContent(await realFile.text());
        }
      } catch (realError) {
        const realMessage = realError instanceof Error ? realError.message : String(realError);
        if (!silent) {
          console.warn(`Failed to load bindings from ${path}: ${realMessage}`);
        }
        return false;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!silent) {
        console.warn(`Failed to load bindings from ${path}: ${errorMessage}`);
      }
      return false;
    }
  }
}

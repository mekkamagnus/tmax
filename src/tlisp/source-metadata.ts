/**
 * @file source-metadata.ts
 * @description WeakMap-based source span metadata for T-Lisp values
 */

import type { TLispValue } from "./types.ts";
import type { SourceSpan } from "./source.ts";

const sourceMetadata = new WeakMap<TLispValue, SourceSpan>();

export function setSourceSpan(value: TLispValue, span: SourceSpan): void {
  sourceMetadata.set(value, span);
}

export function getSourceSpan(value: TLispValue): SourceSpan | undefined {
  return sourceMetadata.get(value);
}

export function copySourceSpan(from: TLispValue, to: TLispValue): void {
  const span = sourceMetadata.get(from);
  if (span) sourceMetadata.set(to, span);
}

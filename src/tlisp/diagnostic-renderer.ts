/**
 * @file diagnostic-renderer.ts
 * @description Renders TLispDiagnostic to human-readable terminal output
 */

import type { TLispDiagnostic } from "./diagnostics.ts";

/**
 * Render a diagnostic to a human-readable string for terminal/CLI output.
 */
export function renderDiagnostic(d: TLispDiagnostic): string {
  const parts: string[] = [];
  const sev = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : d.severity === "info" ? "info" : "hint";

  parts.push(`${sev}[${d.code}]: ${d.message}`);

  if (d.primarySpan) {
    const s = d.primarySpan.start;
    const loc = d.source ? `${d.source.name}:${s.line + 1}:${s.column + 1}` : `${s.line + 1}:${s.column + 1}`;
    parts.push(`  --> ${loc}`);
  }

  if (d.labels) {
    for (const label of d.labels) {
      const s = label.span.start;
      const style = label.style === "primary" ? ">>>" : "---";
      parts.push(`  ${style} ${label.message} (line ${s.line + 1}:${s.column + 1})`);
    }
  }

  if (d.expected || d.actual) {
    const exp = d.expected ? `expected: ${d.expected}` : "";
    const act = d.actual ? `actual: ${d.actual}` : "";
    if (exp && act) parts.push(`  ${exp}, ${act}`);
    else if (exp) parts.push(`  ${exp}`);
    else if (act) parts.push(`  ${act}`);
  }

  if (d.help) {
    parts.push(`  help: ${d.help}`);
  }

  if (d.notes) {
    for (const note of d.notes) {
      parts.push(`  note: ${note}`);
    }
  }

  if (d.stack && d.stack.length > 0) {
    parts.push("  stack:");
    for (let i = 0; i < d.stack.length; i++) {
      const frame = d.stack[i]!;
      const loc = frame.callSpan
        ? `:${frame.callSpan.start.line + 1}:${frame.callSpan.start.column + 1}`
        : "";
      const mod = frame.module ? ` at ${frame.module}` : "";
      parts.push(`    ${i}: ${frame.function}${mod}${loc}`);
    }
  }

  return parts.join("\n");
}

/**
 * Render a diagnostic to a single-line summary.
 */
export function renderDiagnosticSummary(d: TLispDiagnostic): string {
  const loc = d.primarySpan
    ? `:${d.primarySpan.start.line + 1}:${d.primarySpan.start.column + 1}`
    : "";
  const src = d.source ? d.source.name : "";
  return `[${d.code}] ${d.message} (${src}${loc})`;
}

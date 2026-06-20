/**
 * @file baseline.ts
 * @description Visual baseline comparison.
 *
 * Compares captured HTML against a stored baseline file. Uses a zero-dependency
 * HTML tokenizer for tag/text/style/class comparison (no DOMParser — Bun does
 * not provide one reliably in this project environment). If tokenization fails,
 * falls back to a normalized line-by-line HTML text diff and reports the
 * fallback in the diff.
 *
 * Baseline lifecycle:
 *   - Local first run (CI unset, no `--update-baselines`): write the captured
 *     HTML as the new baseline, return `{ created: true }`.
 *   - CI first run (CI set, no `--update-baselines`): fail with BaselineMissing.
 *   - `--update-baselines`: overwrite the baseline file unconditionally and
 *     return `{ updated: true }`. Intended for explicit refresh runs whose
 *     resulting files are reviewed and committed.
 *   - Subsequent runs: compare and return mismatch with a readable diff.
 */

import { promises as fs, existsSync } from 'fs';
import { TaskEither, Either } from '../../src/utils/task-either.ts';
import { TmaxUseError, rightT, leftT, rightE, leftE } from '../src/errors.ts';

export interface BaselineResult {
  readonly passed: boolean;
  readonly created: boolean;
  readonly updated: boolean;
  readonly baselinePath: string;
  readonly diff: string;
}

export interface BaselineOptions {
  /** Treat missing baseline as a failure rather than auto-create (auto-set when CI env is set). */
  readonly failOnMissing?: boolean;
  /** Force overwrite of the baseline with the captured HTML. */
  readonly update?: boolean;
}

function isCi(): boolean {
  return Boolean(process.env.CI) && process.env.CI !== '0' && process.env.CI !== 'false';
}

/**
 * Compare captured HTML against the baseline file at `baselinePath`.
 *
 * Resolution order:
 *   1. If `update`, write captured HTML and return `{ updated: true }`.
 *   2. If baseline does not exist:
 *      - If `failOnMissing` (or CI), fail with BaselineMissing.
 *      - Else write captured HTML and return `{ created: true }`.
 *   3. Otherwise compare; on mismatch return BaselineMismatch with the diff.
 */
export function matchBaseline(
  html: string,
  baselinePath: string,
  opts: BaselineOptions = {},
): TaskEither<TmaxUseError, BaselineResult> {
  const failOnMissing = opts.failOnMissing ?? isCi();

  // 1. Update mode: overwrite unconditionally.
  if (opts.update) {
    return writeBaseline(baselinePath, html).map(() => ({
      passed: true,
      created: false,
      updated: true,
      baselinePath,
      diff: '(baseline overwritten via --update-baselines)',
    }));
  }

  // 2. Missing baseline: create locally or fail in CI.
  if (!existsSync(baselinePath)) {
    if (failOnMissing) {
      return leftT<BaselineResult>(TmaxUseError.baselineMissing(baselinePath));
    }
    return writeBaseline(baselinePath, html).map(() => ({
      passed: true,
      created: true,
      updated: false,
      baselinePath,
      diff: '(baseline created on first run)',
    }));
  }

  // 3. Compare.
  return TaskEither.from(async () => {
    const baselineHtml = await fs.readFile(baselinePath, 'utf-8');
    const cmp = compareHtml(baselineHtml, html);
    if (cmp.match) {
      return rightE<BaselineResult>({ passed: true, created: false, updated: false, baselinePath, diff: '' });
    }
    return rightE<BaselineResult>({
      passed: false,
      created: false,
      updated: false,
      baselinePath,
      diff: cmp.diff,
    });
  });
}

/** Write `html` to `baselinePath`, creating parent dirs. */
export function writeBaseline(baselinePath: string, html: string): TaskEither<TmaxUseError, void> {
  return TaskEither.tryCatch(
    async () => {
      const path = await import('path');
      await fs.mkdir(path.dirname(baselinePath), { recursive: true });
      await fs.writeFile(baselinePath, html, 'utf-8');
    },
    (err): TmaxUseError => TmaxUseError.subprocessFailed(
      `failed to write baseline ${baselinePath}: ${err instanceof Error ? err.message : String(err)}`,
    ),
  );
}

/** Write a new baseline file unconditionally (public API for the CLI's `--update-baselines` flag). */
export function updateBaseline(baselinePath: string, html: string): TaskEither<TmaxUseError, void> {
  return writeBaseline(baselinePath, html);
}

// ---------------------------------------------------------------------------
// Zero-dependency HTML comparison
// ---------------------------------------------------------------------------

interface HtmlToken {
  readonly kind: 'tag' | 'text';
  /** Tag name for tag tokens, raw text for text tokens. */
  readonly value: string;
  /** Stable serialization of attributes the diff cares about (style + class). */
  readonly attrs?: string;
}

interface CompareResult {
  readonly match: boolean;
  readonly diff: string;
}

/**
 * Tokenize a string of HTML into a stable sequence of tag/text/style/class
 * records. The tokenizer is intentionally narrow: it handles only the markup
 * the project's `ansiToHtml` produces (escaped entities + simple tags), but
 * that is exactly what every baseline in this project will contain.
 */
function tokenizeHtml(html: string): Either<string, HtmlToken[]> {
  const tokens: HtmlToken[] = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === '<') {
      // Skip DOCTYPE / comments / CDATA — they don't affect visual diff.
      if (html.startsWith('<!', i)) {
        const end = html.indexOf('>', i);
        if (end === -1) return Either.left('unterminated declaration');
        i = end + 1;
        continue;
      }
      const end = html.indexOf('>', i);
      if (end === -1) return Either.left('unterminated tag');
      const inside = html.substring(i + 1, end).trim();
      // Self-closing tags end with `/` — strip it.
      const selfClosing = inside.endsWith('/');
      const body = (selfClosing ? inside.slice(0, -1) : inside).trim();
      // Closing tag?
      if (body.startsWith('/')) {
        tokens.push({ kind: 'tag', value: body.toLowerCase() });
        i = end + 1;
        continue;
      }
      // Opening tag with optional attributes: split name from attrs.
      const nameMatch = /^([a-zA-Z0-9-]+)/.exec(body);
      if (!nameMatch) return Either.left(`unparseable tag: ${body}`);
      const name = nameMatch[1]!.toLowerCase();
      // For diff stability we keep only style + class — other attrs (id, href,
      // etc.) are noise the renderer doesn't emit.
      const attrsToKeep: string[] = [];
      const attrRe = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(body)) !== null) {
        const k = m[1]!.toLowerCase();
        if (k === 'style' || k === 'class') {
          attrsToKeep.push(`${k}=${normalizeAttr(m[2]!)}`);
        }
      }
      tokens.push({ kind: 'tag', value: name, attrs: attrsToKeep.join(';') });
      i = end + 1;
      continue;
    }
    // Text node — read until next '<'.
    const next = html.indexOf('<', i);
    const stop = next === -1 ? html.length : next;
    const raw = html.slice(i, stop);
    const text = decodeEntities(raw).trim();
    if (text.length > 0) tokens.push({ kind: 'text', value: text });
    i = stop;
  }
  return Either.right(tokens);
}

function normalizeAttr(value: string): string {
  // Collapse runs of whitespace, trim — same attr values should match.
  return value.replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

/**
 * Compare two HTML strings. Tokenizer path is preferred; if either side fails
 * to tokenize, fall back to normalized line-by-line text diff and mark the
 * diff header so consumers can see the fallback happened.
 */
export function compareHtml(baseline: string, captured: string): CompareResult {
  const a = tokenizeHtml(baseline);
  const b = tokenizeHtml(captured);
  if (Either.isLeft(a) || Either.isLeft(b)) {
    return {
      match: baseline === captured,
      diff: renderLineDiff(splitLines(normalizeForLineDiff(baseline)), splitLines(normalizeForLineDiff(captured)), ' (fallback: tokenizer failed — using normalized line diff)'),
    };
  }
  const ta = a.right;
  const tb = b.right;
  if (tokensEqual(ta, tb)) {
    return { match: true, diff: '' };
  }
  // Token-level diff: render side-by-side summary.
  return { match: false, diff: renderTokenDiff(ta, tb) };
}

function tokensEqual(a: readonly HtmlToken[], b: readonly HtmlToken[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind !== y.kind) return false;
    if (x.value !== y.value) return false;
    if ((x.attrs ?? '') !== (y.attrs ?? '')) return false;
  }
  return true;
}

function renderTokenDiff(a: readonly HtmlToken[], b: readonly HtmlToken[]): string {
  const max = Math.max(a.length, b.length);
  const lines: string[] = ['token diff (baseline vs captured):'];
  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    const xs = x ? serializeToken(x) : '(missing)';
    const ys = y ? serializeToken(y) : '(missing)';
    if (xs === ys) {
      lines.push(`  ${i}: ${xs}`);
    } else {
      lines.push(`- ${i}: ${xs}`);
      lines.push(`+ ${i}: ${ys}`);
    }
  }
  return lines.join('\n');
}

function serializeToken(t: HtmlToken): string {
  return t.kind === 'tag' ? `<${t.value}>${t.attrs ? ' [' + t.attrs + ']' : ''}` : `text ${JSON.stringify(t.value)}`;
}

// ---------------------------------------------------------------------------
// Fallback: line-by-line diff
// ---------------------------------------------------------------------------

function normalizeForLineDiff(s: string): string {
  // Collapse whitespace runs within a line; trim; keep line breaks.
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function splitLines(s: string): string[] {
  return s.length === 0 ? [] : s.split('\n');
}

function renderLineDiff(a: readonly string[], b: readonly string[], headerSuffix = ''): string {
  const lines: string[] = [`line diff${headerSuffix}:`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const x = a[i] ?? '(missing)';
    const y = b[i] ?? '(missing)';
    if (x === y) {
      lines.push(`  ${i}: ${x.slice(0, 120)}`);
    } else {
      lines.push(`- ${i}: ${x.slice(0, 120)}`);
      lines.push(`+ ${i}: ${y.slice(0, 120)}`);
    }
  }
  return lines.join('\n');
}

// Re-exports for unit tests.
export const __baselineInternals = {
  tokenizeHtml,
  compareHtml,
  isCi,
  rightE,
  leftE,
};

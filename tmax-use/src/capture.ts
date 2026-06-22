/**
 * @file capture.ts
 * @description Capture primitives for the tmax daemon.
 *
 * Calls the daemon's `capture` JSON-RPC method directly (not via the
 * `bin/tmaxclient` CLI) so the metadata-bearing result is preserved. The CLI's
 * `--capture` / `--capture-html` flags print only the rendered artifact (ANSI
 * lines or HTML doc), discarding `width` and `height` — useless for assertions
 * that need stable dimensions.
 *
 * Dimension plumbing (SPEC-061 Step 4):
 *   - explicit `frame.capture({ width, height })` args
 *   - then runner/playbook/CLI options
 *   - then server fallback (active-frame terminalSize → 80x24)
 *
 * The runner must pass configured dimensions on every headless capture,
 * including assertion captures and failure artifacts.
 */

import { TaskEither, Either } from '../../src/utils/task-either.ts';
import { TmaxUseError } from './errors.ts';
import { leftT, rightT, leftE, rightE } from './errors.ts';

/** Capture result with ANSI-encoded lines plus dimensions. */
export interface CaptureResult {
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
}

/** Capture result as a standalone HTML document plus dimensions. */
export interface HtmlResult {
  readonly html: string;
  readonly width: number;
  readonly height: number;
}

/** Optional dimensions passed through to the daemon's `capture` RPC. */
export interface CaptureOptions {
  readonly width?: number;
  readonly height?: number;
}

/**
 * Minimal interface the capture helpers need from a JSON-RPC client. Real
 * callers pass the daemon socket directly via `TmaxClient`; unit tests pass a
 * stub that returns canned responses.
 */
export interface CaptureClient {
  request(method: string, params: Record<string, unknown>): TaskEither<TmaxUseError, unknown>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asNumber(name: string, v: unknown): Either<TmaxUseError, number> {
  return typeof v === 'number' && Number.isFinite(v)
    ? rightE(v)
    : leftE(TmaxUseError.captureFailed(`capture result field "${name}" is not a finite number: ${JSON.stringify(v)}`));
}

function asStringArray(name: string, v: unknown): Either<TmaxUseError, readonly string[]> {
  if (!Array.isArray(v)) {
    return leftE(TmaxUseError.captureFailed(`capture result field "${name}" is not an array`));
  }
  for (const item of v) {
    if (typeof item !== 'string') {
      return leftE(TmaxUseError.captureFailed(`capture result field "${name}" contains a non-string entry: ${JSON.stringify(item)}`));
    }
  }
  return rightE(v as readonly string[]);
}

function asString(name: string, v: unknown): Either<TmaxUseError, string> {
  return typeof v === 'string'
    ? rightE(v)
    : leftE(TmaxUseError.captureFailed(`capture result field "${name}" is not a string: ${JSON.stringify(v)}`));
}

function decodeCapture(raw: unknown): Either<TmaxUseError, CaptureResult> {
  if (!isObject(raw)) {
    return leftE(TmaxUseError.captureFailed(`capture result is not an object: ${JSON.stringify(raw)}`));
  }
  const lines = asStringArray('lines', raw.lines);
  if (Either.isLeft(lines)) return Either.left(lines.left);
  const width = asNumber('width', raw.width);
  if (Either.isLeft(width)) return Either.left(width.left);
  const height = asNumber('height', raw.height);
  if (Either.isLeft(height)) return Either.left(height.left);
  return rightE({ lines: lines.right, width: width.right, height: height.right });
}

function decodeHtml(raw: unknown): Either<TmaxUseError, HtmlResult> {
  if (!isObject(raw)) {
    return leftE(TmaxUseError.captureFailed(`capture result is not an object: ${JSON.stringify(raw)}`));
  }
  const html = asString('html', raw.html);
  if (Either.isLeft(html)) return Either.left(html.left);
  const width = asNumber('width', raw.width);
  if (Either.isLeft(width)) return Either.left(width.left);
  const height = asNumber('height', raw.height);
  if (Either.isLeft(height)) return Either.left(height.left);
  return rightE({ html: html.right, width: width.right, height: height.right });
}

/** Build the params object for a `capture` JSON-RPC call, including dimensions when provided. */
function captureParams(format: 'ansi' | 'html', opts?: CaptureOptions): Record<string, unknown> {
  const params: Record<string, unknown> = { format };
  if (opts?.width !== undefined) params.width = opts.width;
  if (opts?.height !== undefined) params.height = opts.height;
  return params;
}

/**
 * Call the daemon's `capture` method with `{ format: 'ansi' }`. When `opts`
 * provides positive `width` and `height`, they are forwarded to the daemon so
 * it renders at exactly those dimensions instead of falling back to the
 * active-frame size or 80x24.
 */
export function captureFrame(client: CaptureClient, opts?: CaptureOptions): TaskEither<TmaxUseError, CaptureResult> {
  return client.request('capture', captureParams('ansi', opts)).flatMap((raw) => {
    const decoded = decodeCapture(raw);
    return Either.isLeft(decoded) ? leftT<CaptureResult>(decoded.left) : rightT(decoded.right);
  });
}

/** Call the daemon's `capture` method with `{ format: 'html' }`. Dimensions forwarded when provided. */
export function captureHtml(client: CaptureClient, opts?: CaptureOptions): TaskEither<TmaxUseError, HtmlResult> {
  return client.request('capture', captureParams('html', opts)).flatMap((raw) => {
    const decoded = decodeHtml(raw);
    return Either.isLeft(decoded) ? leftT<HtmlResult>(decoded.left) : rightT(decoded.right);
  });
}

/** Strip ANSI escape sequences (CSI SGR + cursor movement) from each line. */
export function capturePlain(lines: readonly string[]): string[] {
  // Matches: CSI sequences (\x1b[ ... letter), OSC sequences (\x1b] ... BEL/ST),
  // and single-character ESC + X forms the renderer emits.
  const RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]|\x1b./g;
  return lines.map((l) => l.replace(RE, ''));
}

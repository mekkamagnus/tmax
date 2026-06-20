/**
 * @file assert-text.test.ts
 * @description Unit tests for the text assertion helpers. Uses a stubbed
 *   Frame to inject canned state — no daemon.
 */
import { describe, test, expect } from 'bun:test';
import { Frame } from '../../../tmax-use/src/frame.ts';
import { createStubClient, type TmaxClientDeps } from '../../../tmax-use/src/client.ts';
import { TaskEither, Either } from '../../../src/utils/task-either.ts';
import { TmaxUseError, rightT } from '../../../tmax-use/src/errors.ts';
import {
  assertMode, assertCursorAt, assertBufferTextContains, assertStatusLineContains,
} from '../../../tmax-use/assert/text.ts';

function frameWithState(state: {
  mode?: string;
  cursor?: { line: number; col: number };
  bufferText?: string;
  statusLine?: string;
}): Frame {
  const deps: TmaxClientDeps = {
    runClient: (args) => {
      if (args[0] === '--eval') {
        const expr = args[1] ?? '';
        if (expr.includes('editor-mode') && state.mode !== undefined) return rightT(state.mode);
        if (expr.includes('cursor-line')) return rightT(String(state.cursor?.line ?? 0));
        if (expr.includes('cursor-column')) return rightT(String(state.cursor?.col ?? 0));
        if (expr.includes('buffer-text')) return rightT(state.bufferText ?? '');
        if (expr.includes('editor-status') || expr.includes('status-message')) return rightT(state.statusLine ?? '');
      }
      return rightT('');
    },
    request: () => rightT({}),
  };
  return new Frame(createStubClient(deps), 'test');
}

describe('assertMode', () => {
  test('passes when mode matches', async () => {
    const frame = frameWithState({ mode: 'normal' });
    const r = await assertMode(frame, 'normal').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(true);
  });

  test('fails when mode differs', async () => {
    const frame = frameWithState({ mode: 'insert' });
    const r = await assertMode(frame, 'normal').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(false);
  });
});

describe('assertCursorAt', () => {
  test('passes when cursor at expected position', async () => {
    const frame = frameWithState({ cursor: { line: 3, col: 5 } });
    const r = await assertCursorAt(frame, 3, 5).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(true);
  });

  test('fails when line differs', async () => {
    const frame = frameWithState({ cursor: { line: 3, col: 5 } });
    const r = await assertCursorAt(frame, 4, 5).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(false);
  });

  test('fails when col differs', async () => {
    const frame = frameWithState({ cursor: { line: 3, col: 5 } });
    const r = await assertCursorAt(frame, 3, 6).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(false);
  });
});

describe('assertBufferTextContains', () => {
  test('passes when substring present', async () => {
    const frame = frameWithState({ bufferText: 'hello world' });
    const r = await assertBufferTextContains(frame, 'world').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(true);
  });

  test('fails when substring absent', async () => {
    const frame = frameWithState({ bufferText: 'hello' });
    const r = await assertBufferTextContains(frame, 'world').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(false);
  });
});

describe('assertStatusLineContains', () => {
  test('passes when substring in status line', async () => {
    const frame = frameWithState({ statusLine: 'Saved /tmp/foo.txt' });
    const r = await assertStatusLineContains(frame, 'Saved').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(true);
  });

  test('fails when substring absent', async () => {
    const frame = frameWithState({ statusLine: 'Saved' });
    const r = await assertStatusLineContains(frame, 'Error').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.passed).toBe(false);
  });
});

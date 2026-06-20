/**
 * @file expect.test.ts
 * @description Unit tests for the fluent expect(frame) builder.
 */
import { describe, test, expect } from 'bun:test';
import { Frame } from '../../../tmax-use/src/frame.ts';
import { createStubClient, type TmaxClientDeps } from '../../../tmax-use/src/client.ts';
import { TmaxUseError, rightT } from '../../../tmax-use/src/errors.ts';
import { expect as tmaxExpect } from '../../../tmax-use/assert/index.ts';
import { Either } from '../../../src/utils/task-either.ts';

function frameWithState(state: {
  mode?: string;
  cursor?: { line: number; col: number };
  bufferText?: string;
}): Frame {
  const deps: TmaxClientDeps = {
    runClient: (args) => {
      if (args[0] === '--eval') {
        const expr = args[1] ?? '';
        if (expr.includes('editor-mode') && state.mode !== undefined) return rightT(state.mode);
        if (expr.includes('cursor-line')) return rightT(String(state.cursor?.line ?? 0));
        if (expr.includes('cursor-column')) return rightT(String(state.cursor?.col ?? 0));
        if (expr.includes('buffer-text')) return rightT(state.bufferText ?? '');
      }
      return rightT('');
    },
    request: () => rightT({}),
  };
  return new Frame(createStubClient(deps), 'test');
}

describe('expect(frame) — chaining', () => {
  test('chains multiple assertions; all pass', async () => {
    const frame = frameWithState({ mode: 'normal', cursor: { line: 0, col: 0 } });
    const r = await tmaxExpect(frame)
      .toHaveMode('normal')
      .toHaveCursorAt(0, 0)
      .run().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.length).toBe(2);
  });

  test('short-circuits on first failure', async () => {
    const frame = frameWithState({ mode: 'insert', cursor: { line: 0, col: 0 } });
    const r = await tmaxExpect(frame)
      .toHaveMode('normal')
      .toHaveCursorAt(99, 99)
      .run().run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('length returns queued assertion count', () => {
    const frame = frameWithState({});
    const builder = tmaxExpect(frame)
      .toHaveMode('normal')
      .toHaveCursorAt(0, 0)
      .toHaveBufferTextContaining('hi');
    expect(builder.length).toBe(3);
  });
});

describe('expect(frame) — buffer text', () => {
  test('toHaveBufferTextContaining passes on match', async () => {
    const frame = frameWithState({ bufferText: 'hello world' });
    const r = await tmaxExpect(frame).toHaveBufferTextContaining('world').run().run();
    expect(Either.isRight(r)).toBe(true);
  });

  test('toHaveBufferTextContaining fails on miss', async () => {
    const frame = frameWithState({ bufferText: 'hello' });
    const r = await tmaxExpect(frame).toHaveBufferTextContaining('world').run().run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('expect(frame) — screen assertions', () => {
  function frameWithScreen(lines: string[]): Frame {
    const deps: TmaxClientDeps = {
      runClient: () => rightT(''),
      request: (method) => method === 'capture' ? rightT({ lines, width: 80, height: 24 }) : rightT({}),
    };
    return new Frame(createStubClient(deps), 'test');
  }

  test('screenContains chains', async () => {
    const frame = frameWithScreen(['hello']);
    const r = await tmaxExpect(frame).screenContains('hello').run().run();
    expect(Either.isRight(r)).toBe(true);
  });

  test('screenNotContains chains', async () => {
    const frame = frameWithScreen(['hello']);
    const r = await tmaxExpect(frame).screenNotContains('missing').run().run();
    expect(Either.isRight(r)).toBe(true);
  });
});

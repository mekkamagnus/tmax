/**
 * @file assert-screen.test.ts
 * @description Unit tests for headless screen substring assertions.
 */
import { describe, test, expect } from 'bun:test';
import { Frame } from '../../../tmax-use/src/frame.ts';
import { createStubClient, type TmaxClientDeps } from '../../../tmax-use/src/client.ts';
import { TmaxUseError, rightT } from '../../../tmax-use/src/errors.ts';
import { assertScreenContains, assertScreenNotContains } from '../../../tmax-use/assert/screen.ts';

function frameWithScreen(lines: string[]): Frame {
  const deps: TmaxClientDeps = {
    runClient: () => rightT(''),
    request: (method) => {
      if (method === 'capture') return rightT({ lines, width: 80, height: 24 });
      return rightT({});
    },
  };
  return new Frame(createStubClient(deps), 'test');
}

describe('assertScreenContains', () => {
  test('passes when substring appears in any line', async () => {
    const frame = frameWithScreen(['hello world', 'foo']);
    const r = await assertScreenContains(frame, 'world').run();
    if ('right' in r) expect(r.right.passed).toBe(true);
  });

  test('passes on substring spanning lines (joined with \\n)', async () => {
    const frame = frameWithScreen(['foo', 'bar']);
    const r = await assertScreenContains(frame, 'foo\nbar').run();
    if ('right' in r) expect(r.right.passed).toBe(true);
  });

  test('fails when substring absent', async () => {
    const frame = frameWithScreen(['foo']);
    const r = await assertScreenContains(frame, 'missing').run();
    if ('right' in r) expect(r.right.passed).toBe(false);
  });

  test('strips ANSI sequences before matching', async () => {
    const frame = frameWithScreen(['\x1b[31mhello\x1b[0m']);
    const r = await assertScreenContains(frame, 'hello').run();
    if ('right' in r) expect(r.right.passed).toBe(true);
  });
});

describe('assertScreenNotContains', () => {
  test('passes when substring absent', async () => {
    const frame = frameWithScreen(['foo']);
    const r = await assertScreenNotContains(frame, 'missing').run();
    if ('right' in r) expect(r.right.passed).toBe(true);
  });

  test('fails when substring present', async () => {
    const frame = frameWithScreen(['foo', 'bar']);
    const r = await assertScreenNotContains(frame, 'bar').run();
    if ('right' in r) expect(r.right.passed).toBe(false);
  });
});

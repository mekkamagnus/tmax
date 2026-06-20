/**
 * @file errors.test.ts
 * @description Unit tests for the TmaxUseError tagged union + helpers.
 */
import { describe, test, expect } from 'bun:test';
import {
  TmaxUseError, matchTmaxUseError, describeTmaxUseError,
  rightT, leftT, rightE, leftE,
} from '../../../tmax-use/src/errors.ts';
import { Either } from '../../../src/utils/task-either.ts';

describe('TmaxUseError — constructors', () => {
  test('daemonNotResponsive carries socket + message', () => {
    const e = TmaxUseError.daemonNotResponsive('/tmp/sock', 'timeout');
    expect(e._tag).toBe('DaemonNotResponsive');
    if (e._tag === 'DaemonNotResponsive') {
      expect(e.socketPath).toBe('/tmp/sock');
      expect(e.message).toContain('timeout');
    }
  });

  test('captureFailed carries message', () => {
    const e = TmaxUseError.captureFailed('decode error');
    expect(e._tag).toBe('CaptureFailed');
    if (e._tag === 'CaptureFailed') expect(e.message).toBe('decode error');
  });

  test('keySendFailed carries sequence + message', () => {
    const e = TmaxUseError.keySendFailed('bad', '<Esc>');
    expect(e._tag).toBe('KeySendFailed');
    if (e._tag === 'KeySendFailed') expect(e.sequence).toBe('<Esc>');
  });

  test('assertionFailed carries message', () => {
    const e = TmaxUseError.assertionFailed('mismatch');
    expect(e._tag).toBe('AssertionFailed');
    if (e._tag === 'AssertionFailed') expect(e.message).toBe('mismatch');
  });

  test('baselineMismatch carries path + diff', () => {
    const e = TmaxUseError.baselineMismatch('/path', 'diff');
    expect(e._tag).toBe('BaselineMismatch');
    if (e._tag === 'BaselineMismatch') {
      expect(e.baselinePath).toBe('/path');
      expect(e.diff).toBe('diff');
    }
  });

  test('baselineMissing carries path', () => {
    const e = TmaxUseError.baselineMissing('/path');
    expect(e._tag).toBe('BaselineMissing');
    if (e._tag === 'BaselineMissing') expect(e.baselinePath).toBe('/path');
  });

  test('playbookParseFailed carries path + issues', () => {
    const e = TmaxUseError.playbookParseFailed('/p.yaml', ['err1', 'err2']);
    expect(e._tag).toBe('PlaybookParseFailed');
    if (e._tag === 'PlaybookParseFailed') {
      expect(e.path).toBe('/p.yaml');
      expect(e.issues).toEqual(['err1', 'err2']);
    }
  });
});

describe('matchTmaxUseError — exhaustive', () => {
  test('returns the right arm for each variant', () => {
    const cases: TmaxUseError[] = [
      TmaxUseError.daemonNotResponsive('/s', 'x'),
      TmaxUseError.captureFailed('x'),
      TmaxUseError.keySendFailed('x', 'y'),
      TmaxUseError.evalError('x', 'trace'),
      TmaxUseError.assertionFailed('x'),
      TmaxUseError.baselineMismatch('/p', 'd'),
      TmaxUseError.baselineMissing('/p'),
      TmaxUseError.playbookParseFailed('/p', ['i']),
      TmaxUseError.subprocessFailed('x'),
      TmaxUseError.timeout(1000, 'x'),
    ];
    const arms = {
      DaemonNotResponsive: () => 'd1',
      CaptureFailed: () => 'd2',
      KeySendFailed: () => 'd3',
      EvalError: () => 'd4',
      AssertionFailed: () => 'd5',
      BaselineMismatch: () => 'd6',
      BaselineMissing: () => 'd7',
      PlaybookParseFailed: () => 'd8',
      SubprocessFailed: () => 'd9',
      Timeout: () => 'd10',
    };
    for (const e of cases) {
      const result = matchTmaxUseError(e, arms);
      expect(typeof result).toBe('string');
    }
  });
});

describe('describeTmaxUseError', () => {
  test('produces non-empty message for each variant', () => {
    const cases: TmaxUseError[] = [
      TmaxUseError.daemonNotResponsive('/s', 'x'),
      TmaxUseError.captureFailed('x'),
      TmaxUseError.keySendFailed('x', 'y'),
      TmaxUseError.evalError('x', 'trace'),
      TmaxUseError.assertionFailed('x'),
      TmaxUseError.baselineMismatch('/p', 'd'),
      TmaxUseError.baselineMissing('/p'),
      TmaxUseError.playbookParseFailed('/p', ['i']),
      TmaxUseError.subprocessFailed('x'),
      TmaxUseError.timeout(1000, 'x'),
    ];
    for (const e of cases) {
      expect(describeTmaxUseError(e).length).toBeGreaterThan(0);
    }
  });
});

describe('rightT / leftT / rightE / leftE — L/R ordering', () => {
  test('rightT returns TaskEither with value on right', async () => {
    const r = await rightT(42).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe(42);
  });

  test('leftT returns TaskEither with error on left', async () => {
    const r = await leftT(TmaxUseError.captureFailed('x')).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left._tag).toBe('CaptureFailed');
  });

  test('rightE returns Either with value on right', () => {
    const r = rightE('hello');
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe('hello');
  });

  test('leftE returns Either left', () => {
    const r = leftE(TmaxUseError.assertionFailed('x'));
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left._tag).toBe('AssertionFailed');
  });
});

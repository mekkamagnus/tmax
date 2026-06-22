/**
 * @file frame.test.ts
 * @description Unit tests for the Frame API. Uses a stubbed TmaxClient to
 *   inject canned responses — no real daemon.
 */
import { describe, test, expect } from 'bun:test';
import { Frame } from '../../../tmax-use/src/frame.ts';
import { createStubClient, type TmaxClientDeps } from '../../../tmax-use/src/client.ts';
import { TaskEither, Either } from '../../../src/utils/task-either.ts';
import { TmaxUseError, rightT, leftT } from '../../../tmax-use/src/errors.ts';

function frameWithResponses(opts: {
  evalResponse?: (expr: string) => string;
  requestResponse?: (method: string, params: Record<string, unknown>) => unknown;
}): Frame {
  const deps: TmaxClientDeps = {
    runClient: (args) => {
      // Treat first arg as the command shape; we only care about --eval here.
      if (args[0] === '--eval' && opts.evalResponse) {
        return rightT(opts.evalResponse(args[1] ?? ''));
      }
      return rightT('');
    },
    request: (method, params) => rightT(opts.requestResponse ? opts.requestResponse(method, params) : {}),
  };
  return new Frame(createStubClient(deps), 'test-frame');
}

describe('Frame — file operations', () => {
  test('openFile delegates to client.open', async () => {
    let opened = '';
    const deps: TmaxClientDeps = {
      runClient: (args) => {
        opened = args[0] ?? '';
        return rightT('');
      },
      request: () => rightT({}),
    };
    const frame = new Frame(createStubClient(deps), 'f');
    await frame.openFile('/tmp/x.txt').run();
    expect(opened).toBe('/tmp/x.txt');
  });

  test('closeBuffer sends (kill-buffer)', async () => {
    let killed = false;
    const deps: TmaxClientDeps = {
      runClient: (args) => {
        if (args[0] === '--eval' && args[1]?.includes('kill-buffer')) killed = true;
        return rightT('');
      },
      request: () => rightT({}),
    };
    const frame = new Frame(createStubClient(deps), 'f');
    await frame.closeBuffer().run();
    expect(killed).toBe(true);
  });
});

describe('Frame — keys', () => {
  test('keys parses <Esc> into a JSON-RPC keypress call with the ESC byte', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const deps: TmaxClientDeps = {
      runClient: () => rightT(''),
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({});
      },
    };
    const frame = new Frame(createStubClient(deps), 'f');
    await frame.keys('<Esc>').run();
    expect(calls).toEqual([{ method: 'keypress', params: { key: '\x1b' } }]);
  });

  test('keys parses <Up> into a JSON-RPC keypress call with the semantic "Up" name', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const deps: TmaxClientDeps = {
      runClient: () => rightT(''),
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({});
      },
    };
    const frame = new Frame(createStubClient(deps), 'f');
    await frame.keys('<Up>').run();
    expect(calls).toEqual([{ method: 'keypress', params: { key: 'Up' } }]);
  });

  test('keys sends one keypress per parsed token', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const deps: TmaxClientDeps = {
      runClient: () => rightT(''),
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({});
      },
    };
    const frame = new Frame(createStubClient(deps), 'f');
    await frame.keys('ihello<Esc>').run();
    expect(calls.length).toBe(7);
    expect(calls[0]).toEqual({ method: 'keypress', params: { key: 'i' } });
    expect(calls.at(-1)).toEqual({ method: 'keypress', params: { key: '\x1b' } });
  });

  test('keys with invalid sequence fails', async () => {
    const deps: TmaxClientDeps = {
      runClient: () => rightT(''),
      request: () => rightT({}),
    };
    const frame = new Frame(createStubClient(deps), 'f');
    const r = await frame.keys('<C-a').run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('Frame — state queries', () => {
  test('mode returns editor-mode result', async () => {
    const frame = frameWithResponses({ evalResponse: () => 'normal' });
    const r = await frame.mode().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe('normal');
  });

  test('cursor parses line + column into {line, col}', async () => {
    let n = 0;
    const frame = frameWithResponses({
      evalResponse: () => {
        n++;
        return n === 1 ? '5' : '10';
      },
    });
    const r = await frame.cursor().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right).toEqual({ line: 5, col: 10 });
    }
  });

  test('cursor handles invalid number response', async () => {
    const frame = frameWithResponses({ evalResponse: () => 'not-a-number' });
    const r = await frame.cursor().run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('bufferText returns (buffer-text) result', async () => {
    const frame = frameWithResponses({ evalResponse: () => 'hello world' });
    const r = await frame.bufferText().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe('hello world');
  });
});

describe('Frame — capture', () => {
  test('capture returns decoded CaptureResult', async () => {
    const frame = frameWithResponses({
      requestResponse: () => ({ lines: ['hi'], width: 80, height: 24 }),
    });
    const r = await frame.capture().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.lines).toEqual(['hi']);
      expect(r.right.width).toBe(80);
    }
  });

  test('captureHtml returns decoded HtmlResult', async () => {
    const frame = frameWithResponses({
      requestResponse: () => ({ html: '<html></html>', width: 80, height: 24 }),
    });
    const r = await frame.captureHtml().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.html).toBe('<html></html>');
  });

  test('capturePlain strips ANSI sequences', async () => {
    const frame = frameWithResponses({
      requestResponse: () => ({ lines: ['\x1b[31mhi\x1b[0m'], width: 80, height: 24 }),
    });
    const r = await frame.capturePlain().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toEqual(['hi']);
  });
});

describe('Frame — waitForMode', () => {
  test('succeeds immediately when mode matches', async () => {
    const frame = frameWithResponses({ evalResponse: () => 'normal' });
    const r = await frame.waitForMode('normal', 3).run();
    expect(Either.isRight(r)).toBe(true);
  });

  test('fails after iterations when mode never matches', async () => {
    const frame = frameWithResponses({ evalResponse: () => 'insert' });
    const r = await frame.waitForMode('normal', 2).run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

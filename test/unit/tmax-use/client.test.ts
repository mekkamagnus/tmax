/**
 * @file client.test.ts
 * @description Unit tests for the TmaxClient. Uses createStubClient with
 *   canned responses for runClient/request — no real daemon, no IPC.
 */
import { describe, test, expect } from 'bun:test';
import {
  TmaxClient, createStubClient, type TmaxClientDeps,
} from '../../../tmax-use/src/client.ts';
import { TaskEither, Either } from '../../../src/utils/task-either.ts';
import { TmaxUseError, rightT, leftT } from '../../../tmax-use/src/errors.ts';

function makeStub(opts: {
  runClient?: (args: readonly string[]) => TaskEither<TmaxUseError, string>;
  request?: (method: string, params: Record<string, unknown>) => TaskEither<TmaxUseError, unknown>;
} = {}): TmaxClient {
  const deps: TmaxClientDeps = {
    runClient: opts.runClient ?? (() => rightT('')),
    request: opts.request ?? (() => rightT({})),
  };
  return createStubClient(deps);
}

describe('TmaxClient — eval', () => {
  test('eval sends --eval flag and trims result', async () => {
    const calls: string[][] = [];
    const client = makeStub({
      runClient: (args) => {
        calls.push([...args]);
        return rightT('  42  ');
      },
    });
    const r = await client.eval('(+ 1 2)').run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe('42');
    expect(calls[0]).toEqual(['--eval', '(+ 1 2)']);
  });

  test('eval error propagates', async () => {
    const client = makeStub({
      runClient: () => leftT(TmaxUseError.evalError('bad', 'trace')),
    });
    const r = await client.eval('(broken').run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('TmaxClient — keys', () => {
  test('keys sends each value as its own JSON-RPC keypress call', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = makeStub({
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({});
      },
    });
    const r = await client.keys(['i', 'h', 'i', '\x1b']).run();
    expect(Either.isRight(r)).toBe(true);
    expect(calls).toEqual([
      { method: 'keypress', params: { key: 'i' } },
      { method: 'keypress', params: { key: 'h' } },
      { method: 'keypress', params: { key: 'i' } },
      { method: 'keypress', params: { key: '\x1b' } },
    ]);
  });

  test('keys sends semantic Up name (NOT ANSI sequence)', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = makeStub({
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({});
      },
    });
    await client.keys(['Up']).run();
    expect(calls).toEqual([{ method: 'keypress', params: { key: 'Up' } }]);
  });

  test('keys short-circuits on first error', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = makeStub({
      request: (method, params) => {
        calls.push({ method, params });
        return params.key === 'boom'
          ? leftT(TmaxUseError.keySendFailed('rejected'))
          : rightT({});
      },
    });
    const r = await client.keys(['i', 'boom', 'x']).run();
    expect(Either.isLeft(r)).toBe(true);
    expect(calls.length).toBe(2);
  });

  test('keys empty list is a no-op Right', async () => {
    const client = makeStub({
      request: () => {
        throw new Error('should not be called');
      },
    });
    const r = await client.keys([]).run();
    expect(Either.isRight(r)).toBe(true);
  });
});

describe('TmaxClient — open', () => {
  test('open passes file as positional arg', async () => {
    const calls: string[][] = [];
    const client = makeStub({
      runClient: (args) => {
        calls.push([...args]);
        return rightT('');
      },
    });
    await client.open('/tmp/foo.txt').run();
    expect(calls[0]).toEqual(['/tmp/foo.txt']);
  });
});

describe('TmaxClient — status', () => {
  test('status sends --status --json', async () => {
    const calls: string[][] = [];
    const client = makeStub({
      runClient: (args) => {
        calls.push([...args]);
        return rightT('{"ok":true}');
      },
    });
    const r = await client.status().run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toBe('{"ok":true}');
    expect(calls[0]).toEqual(['--status', '--json']);
  });
});

describe('TmaxClient — request (JSON-RPC)', () => {
  test('request passes through to deps.request', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = makeStub({
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({ ok: true });
      },
    });
    const r = await client.request('capture', { format: 'ansi' }).run();
    expect(Either.isRight(r)).toBe(true);
    expect(calls[0]).toEqual({ method: 'capture', params: { format: 'ansi' } });
  });
});

describe('TmaxClient — ping', () => {
  test('ping calls request("ping", {})', async () => {
    const calls: string[] = [];
    const client = makeStub({
      request: (method) => {
        calls.push(method);
        return rightT({});
      },
    });
    await client.ping().run();
    expect(calls).toEqual(['ping']);
  });
});

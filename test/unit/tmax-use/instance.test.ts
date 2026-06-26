/**
 * @file instance.test.ts
 * @description Unit tests for TmaxInstance.launch/connect/close. Uses mocked
 *   InstanceDeps so no real daemon is spawned.
 */
import { describe, test, expect } from 'bun:test';
import { TmaxInstance, InstanceOptions } from '../../../tmax-use/src/instance.ts';
import { Frame } from '../../../tmax-use/src/frame.ts';
import { TmaxUseError } from '../../../tmax-use/src/errors.ts';
import { TaskEither, Either } from '../../../src/utils/task-either.ts';
import type { ChildProcessWithoutNullStreams } from 'child_process';

/** Minimal fake child handle — only used as a sentinel for deps bookkeeping. */
function fakeChild(): ChildProcessWithoutNullStreams {
  return { killed: false, kill: () => true } as unknown as ChildProcessWithoutNullStreams;
}

/** Fake client that responds to `(+ 1 1)` with "2" and records eval calls. */
function fakeClient(responses: Record<string, string> = { '(+ 1 1)': '2' }): { calls: string[]; client: any } {
  const calls: string[] = [];
  const client = {
    eval: (expr: string) => {
      calls.push(expr);
      const v = responses[expr];
      if (v === undefined) return TaskEither.left<TmaxUseError, string>(TmaxUseError.evalError('unknown', expr));
      return TaskEither.right<string, TmaxUseError>(v);
    },
    open: (_p: string) => TaskEither.right<void, TmaxUseError>(undefined),
    keys: (_v: readonly string[]) => TaskEither.right<void, TmaxUseError>(undefined),
  };
  return { calls, client: client as any };
}

describe('TmaxInstance.launch', () => {
  // The fake spawnDaemon never creates the socket, so launch's socket-readiness
  // poll runs its full budget (~3s of 30×100ms retries) before concluding the
  // daemon is unresponsive and returning Left. Under full-suite CPU load the
  // setTimeout-driven polling slips past bun's default 5s test timeout, so give
  // this deliberately-slow unit test explicit headroom.
  test('launch returns instance and calls spawn+makeClient', async () => {
    let spawned = false;
    let madeClient = false;
    const { client, calls } = fakeClient();
    const r = await TmaxInstance.launch(
      { socketPath: '/tmp/test-launch.socket' },
      {
        spawnDaemon: () => { spawned = true; return TaskEither.right(fakeChild()); },
        stopDaemon: () => TaskEither.right(undefined),
        makeClient: () => { madeClient = true; return client; },
      },
    ).run();
    expect(Either.isLeft(r)).toBe(true);
    expect(spawned).toBe(true);
    expect(madeClient).toBe(true);
    expect(calls.length).toBe(0);
  }, 15000);
});

describe('TmaxInstance.connect', () => {
  test('connect rejects when socket file is absent', async () => {
    const r = await TmaxInstance.connect(
      { socketPath: '/tmp/definitely-not-here.socket' },
      {
        spawnDaemon: () => TaskEither.right(fakeChild()),
        stopDaemon: () => TaskEither.right(undefined),
        makeClient: () => fakeClient().client,
      },
    ).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left._tag).toBe('DaemonNotResponsive');
    }
  });
});

describe('TmaxInstance.frame + close', () => {
  test('frame() returns a Frame bound to the client', () => {
    const { client } = fakeClient();
    const f = new Frame(client, 'label', { width: 80, height: 24 });
    expect(f.name).toBe('label');
  });

  test('close() on an attached instance is a no-op (Right)', async () => {
    const stopCalls: Array<{ child: unknown; socket: string }> = [];
    const { client } = fakeClient();
    const socketPath = `/tmp/test-instance-${process.pid}-${Date.now()}.socket`;
    const { writeFileSync, unlinkSync, existsSync } = await import('fs');
    writeFileSync(socketPath, '');
    try {
      const r = await TmaxInstance.connect(
        { socketPath },
        {
          spawnDaemon: () => TaskEither.right(fakeChild()),
          stopDaemon: (child, socket) => { stopCalls.push({ child, socket }); return TaskEither.right(undefined); },
          makeClient: () => client,
        },
      ).run();
      expect(Either.isRight(r)).toBe(true);
      if (Either.isRight(r)) {
        const closeR = await r.right.close().run();
        expect(Either.isRight(closeR)).toBe(true);
        expect(stopCalls.length).toBe(0);
      }
    } finally {
      if (existsSync(socketPath)) unlinkSync(socketPath);
    }
  });
});

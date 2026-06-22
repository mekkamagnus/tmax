/**
 * @file capture.test.ts
 * @description Unit tests for capture primitives — ANSI stripping and
 *   decode validation. No daemon; uses a stub CaptureClient.
 */
import { describe, test, expect } from 'bun:test';
import {
  captureFrame, captureHtml, capturePlain, type CaptureClient,
} from '../../../tmax-use/src/capture.ts';
import { TaskEither, Either } from '../../../src/utils/task-either.ts';
import { TmaxUseError, rightT, leftT } from '../../../tmax-use/src/errors.ts';

function stubClient(response: unknown): CaptureClient {
  return {
    request: () => rightT(response),
  };
}

function failingClient(error: TmaxUseError): CaptureClient {
  return {
    request: () => leftT(error),
  };
}

describe('capturePlain — ANSI stripping', () => {
  test('plain text passes through unchanged', () => {
    expect(capturePlain(['hello', 'world'])).toEqual(['hello', 'world']);
  });

  test('SGR color codes stripped', () => {
    expect(capturePlain(['\x1b[31mred\x1b[0m'])).toEqual(['red']);
  });

  test('multiple SGR codes stripped', () => {
    expect(capturePlain(['\x1b[1;32mbold green\x1b[0m normal'])).toEqual(['bold green normal']);
  });

  test('cursor movement codes stripped', () => {
    expect(capturePlain(['\x1b[2Jhello'])).toEqual(['hello']);
  });

  test('OSC sequences (title set) stripped', () => {
    expect(capturePlain(['\x1b]0;title\x07text'])).toEqual(['text']);
  });

  test('OSC with ST terminator stripped', () => {
    expect(capturePlain(['\x1b]0;title\x1b\\text'])).toEqual(['text']);
  });

  test('empty lines preserved', () => {
    expect(capturePlain(['', ''])).toEqual(['', '']);
  });

  test('no escapes returns same array content', () => {
    expect(capturePlain(['abc'])).toEqual(['abc']);
  });
});

describe('captureFrame — decode', () => {
  test('valid response decodes to CaptureResult', async () => {
    const client = stubClient({ lines: ['hello'], width: 80, height: 24 });
    const r = await captureFrame(client).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.lines).toEqual(['hello']);
      expect(r.right.width).toBe(80);
      expect(r.right.height).toBe(24);
    }
  });

  test('non-object response fails', async () => {
    const client = stubClient('not an object');
    const r = await captureFrame(client).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('missing lines fails', async () => {
    const client = stubClient({ width: 80, height: 24 });
    const r = await captureFrame(client).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('non-string in lines fails', async () => {
    const client = stubClient({ lines: [1, 2, 3], width: 80, height: 24 });
    const r = await captureFrame(client).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('non-number width fails', async () => {
    const client = stubClient({ lines: ['x'], width: 'wide', height: 24 });
    const r = await captureFrame(client).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('client error propagates', async () => {
    const client = failingClient(TmaxUseError.daemonNotResponsive('socket', 'oops'));
    const r = await captureFrame(client).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left._tag).toBe('DaemonNotResponsive');
    }
  });
});

describe('captureHtml — decode', () => {
  test('valid response decodes to HtmlResult', async () => {
    const client = stubClient({ html: '<html></html>', width: 80, height: 24 });
    const r = await captureHtml(client).run();
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.html).toBe('<html></html>');
      expect(r.right.width).toBe(80);
    }
  });

  test('missing html fails', async () => {
    const client = stubClient({ width: 80, height: 24 });
    const r = await captureHtml(client).run();
    expect(Either.isLeft(r)).toBe(true);
  });

  test('non-string html fails', async () => {
    const client = stubClient({ html: 42, width: 80, height: 24 });
    const r = await captureHtml(client).run();
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('capture dimension forwarding', () => {
  test('captureFrame forwards opts.width/height to the request params', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client: CaptureClient = {
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({ lines: ['x'], width: params.width ?? 80, height: params.height ?? 24 });
      },
    };
    await captureFrame(client, { width: 100, height: 40 }).run();
    expect(calls[0]).toEqual({ method: 'capture', params: { format: 'ansi', width: 100, height: 40 } });
  });

  test('captureHtml forwards opts.width/height to the request params', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client: CaptureClient = {
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({ html: '<html></html>', width: params.width ?? 80, height: params.height ?? 24 });
      },
    };
    await captureHtml(client, { width: 120, height: 50 }).run();
    expect(calls[0]).toEqual({ method: 'capture', params: { format: 'html', width: 120, height: 50 } });
  });

  test('captureFrame without opts sends only format (lets server fall back)', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client: CaptureClient = {
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({ lines: ['x'], width: 80, height: 24 });
      },
    };
    await captureFrame(client).run();
    expect(calls[0]).toEqual({ method: 'capture', params: { format: 'ansi' } });
  });

  test('captureFrame forwards only one dimension when only one is set', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client: CaptureClient = {
      request: (method, params) => {
        calls.push({ method, params });
        return rightT({ lines: ['x'], width: params.width ?? 80, height: 24 });
      },
    };
    await captureFrame(client, { width: 100 }).run();
    expect(calls[0]).toEqual({ method: 'capture', params: { format: 'ansi', width: 100 } });
  });
});

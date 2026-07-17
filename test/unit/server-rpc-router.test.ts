/**
 * @file server-rpc-router.test.ts
 * @description CHORE-44 Change 5 — direct unit coverage for the typed JSON-RPC
 * router (AC5.8). One success fixture per method group + every error code:
 *
 *   - invalid JSON-RPC version      → -32600
 *   - unknown method                → -32601
 *   - invalid params (per field)    → -32602 with `{ field, expected }` data
 *   - thrown handler error          → -32010
 *   - T-Lisp diagnostic-aware error → -32010 with `{ kind, diagnostic }` data
 *   - request-ID preservation on every response
 *
 * The test builds a fake `RpcHandlers` record (one handler per method) and
 * drives `routeRequest` directly — no socket, no Editor. This is the
 * router-boundary contract test; behavioral end-to-end coverage lives in
 * server-client.test.ts / workspace-lifecycle.test.ts.
 */
import { describe, test, expect } from 'bun:test';
import {
  routeRequest,
  RpcError,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type RpcHandlers,
} from '../../src/server/rpc/router.ts';
import type { RpcMethodName } from '../../src/server/rpc/types.ts';

// ── Helpers ──────────────────────────────────────────────────────────────

/** A handlers record where every method is the supplied handler. */
function uniformHandlers(handler: () => Promise<unknown> | unknown): RpcHandlers {
  const table: Record<string, (_p: unknown) => unknown> = {};
  const methods: RpcMethodName[] = [
    "open", "eval", "command", "query", "insert", "keypress", "render-state",
    "client-event", "save-file", "capture", "ping", "status", "clients", "frames",
    "shutdown", "workspace-list", "workspace-new", "workspace-switch", "workspace-save",
    "workspace-kill", "workspace-rename", "workspace-load", "workspace-move-window",
  ];
  for (const m of methods) table[m] = (_p: unknown) => handler();
  return table as unknown as RpcHandlers;
}

function req(method: string, params?: unknown, id: string | number | null = 1): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, params };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('CHORE-44 Change 5 — typed JSON-RPC router (AC5.8)', () => {
  describe('JSON-RPC version validation (-32600)', () => {
    test('rejects a non-2.0 jsonrpc version with -32600 and preserves the id', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, {
        jsonrpc: '1.0',
        id: 42,
        method: 'ping',
        params: {},
      } as unknown as JSONRPCRequest);
      expect(response.error?.code).toBe(-32600);
      expect(response.error?.message).toMatch(/JSON-RPC version must be 2\.0/);
      expect(response.id).toBe(42);
      expect(response.result).toBeUndefined();
    });

    test('preserves a null request id on version rejection', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, {
        jsonrpc: 'bad',
        id: null,
        method: 'ping',
      } as unknown as JSONRPCRequest);
      expect(response.error?.code).toBe(-32600);
      expect(response.id).toBe(null);
    });
  });

  describe('unknown method (-32601)', () => {
    test('rejects an unrecognized method with -32601 and the method name in data', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('definitely-not-a-method'));
      expect(response.error?.code).toBe(-32601);
      expect(response.error?.message).toMatch(/Method not found/);
      expect(response.error?.data).toEqual({ method: 'definitely-not-a-method' });
      expect(response.id).toBe(1);
    });
  });

  describe('parameter validation (-32602)', () => {
    test('open: missing filepath → -32602 with field=filepath', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('open', { /* no filepath */ }));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.message).toMatch(/filepath/);
      expect(response.error?.data).toEqual({ field: 'filepath', expected: 'string' });
    });

    test('open: non-string params → -32602 with field=params', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('open', 'not-an-object'));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'params', expected: 'object' });
    });

    test('eval: missing code → -32602 with field=code', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('eval', {}));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'code', expected: 'string' });
    });

    test('keypress: missing key → -32602 with field=key', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('keypress', {}));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'key', expected: 'string' });
    });

    test('command: missing command → -32602 with field=command', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('command', { bufferName: 'x' }));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'command', expected: 'string' });
    });

    test('query: missing query → -32602 with field=query', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('query', {}));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'query', expected: 'string' });
    });

    test('insert: missing text → -32602 with field=text', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('insert', { line: 1 }));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'text', expected: 'string' });
    });

    test('client-event: missing event → -32602 with field=event', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('client-event', { message: 'x' }));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'event', expected: 'string' });
    });

    test('capture: invalid format → -32602 with field=format', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('capture', { format: 'pdf' }));
      expect(response.error?.code).toBe(-32602);
      expect((response.error?.data as { field: string } | undefined)?.field).toBe('format');
    });

    test('workspace-kill: wrong-type confirm → -32602 with field=confirm', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      const response = await routeRequest(handlers, req('workspace-kill', { name: 'x', confirm: 'yes' }));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'confirm', expected: 'boolean' });
    });

    test('render-state accepts undefined params (stateless read)', async () => {
      const handlers = uniformHandlers(() => ({ rendered: true }));
      const response = await routeRequest(handlers, req('render-state'));
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({ rendered: true });
    });

    test('render-state rejects a non-string frameId → -32602 with field=frameId', async () => {
      const handlers = uniformHandlers(() => ({ rendered: true }));
      const response = await routeRequest(handlers, req('render-state', { frameId: 123 }));
      expect(response.error?.code).toBe(-32602);
      expect(response.error?.data).toEqual({ field: 'frameId', expected: 'string' });
    });
  });

  describe('success: one fixture per method group', () => {
    test('ping → result, request id preserved', async () => {
      const handlers = uniformHandlers(() => ({ status: 'running', server: 'tmax', frames: 0 }));
      const response = await routeRequest(handlers, req('ping'));
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({ status: 'running', server: 'tmax', frames: 0 });
      expect(response.id).toBe(1);
    });

    test('open with valid params → result', async () => {
      const handlers = uniformHandlers(() => ({ buffer: '/x', line: 1, column: 1, opened: true }));
      const response = await routeRequest(handlers, req('open', { filepath: '/x' }));
      expect(response.error).toBeUndefined();
      expect((response.result as { buffer: string }).buffer).toBe('/x');
    });

    test('eval with code → result', async () => {
      const handlers = uniformHandlers(() => 42);
      const response = await routeRequest(handlers, req('eval', { code: '(+ 1 2)' }));
      expect(response.error).toBeUndefined();
      expect(response.result).toBe(42);
    });

    test('status (no params) → result', async () => {
      const handlers = uniformHandlers(() => ({ daemonReady: true }));
      const response = await routeRequest(handlers, req('status'));
      expect(response.error).toBeUndefined();
      expect((response.result as { daemonReady: boolean }).daemonReady).toBe(true);
    });

    test('workspace-list (no params) → result', async () => {
      const handlers = uniformHandlers(() => []);
      const response = await routeRequest(handlers, req('workspace-list'));
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual([]);
    });

    test('capture with optional params → result', async () => {
      const handlers = uniformHandlers(() => ({ lines: [], width: 80, height: 24 }));
      const response = await routeRequest(handlers, req('capture', { format: 'ansi' }));
      expect(response.error).toBeUndefined();
    });
  });

  describe('thrown-error mapping (-32010)', () => {
    test('a plain thrown Error maps to -32010 with the message and no diagnostic data', async () => {
      const handlers = uniformHandlers(() => { throw new Error('boom'); });
      const response = await routeRequest(handlers, req('ping'));
      expect(response.error?.code).toBe(-32010);
      expect(response.error?.message).toBe('boom');
      expect(response.error?.data).toBeUndefined();
      expect(response.id).toBe(1);
    });

    test('a thrown non-Error value maps to -32010 with "Unknown error" (preserving the legacy message)', async () => {
      // The original TmaxServer catch used `error instanceof Error ? message : 'Unknown error'`.
      // The router preserves that behavior for non-Error throws.
      const handlers = uniformHandlers(() => { throw 'string-error'; });
      const response = await routeRequest(handlers, req('ping'));
      expect(response.error?.code).toBe(-32010);
      expect(response.error?.message).toBe('Unknown error');
    });

    test('a T-Lisp diagnostic-aware Error maps to -32010 with { kind, diagnostic } data', async () => {
      const diagnostic = { severity: 'error', code: 'ParseError', message: 'unexpected token' };
      const handlers = uniformHandlers(() => {
        const e = new Error('T-Lisp evaluation error');
        (e as Error & { diagnostic?: unknown }).diagnostic = diagnostic;
        throw e;
      });
      const response = await routeRequest(handlers, req('eval', { code: '(bad' }));
      expect(response.error?.code).toBe(-32010);
      expect(response.error?.message).toBe('T-Lisp evaluation error');
      expect(response.error?.data).toEqual({ kind: 'tlisp-diagnostic', diagnostic });
    });

    test('a thrown RpcError passes its own code through unchanged', async () => {
      const handlers = uniformHandlers(() => {
        throw new RpcError(-32011, 'application error', { extra: true });
      });
      const response = await routeRequest(handlers, req('ping'));
      expect(response.error?.code).toBe(-32011);
      expect(response.error?.message).toBe('application error');
      expect(response.error?.data).toEqual({ extra: true });
    });

    test('onError hook fires for thrown errors with clientId/frameId/requestId extracted', async () => {
      const seen: Array<Record<string, unknown>> = [];
      const handlers = uniformHandlers(() => { throw new Error('x'); });
      await routeRequest(handlers, req('ping', { clientId: 'c1', frameId: 'f1' }, 99), (info) => {
        seen.push({
          method: info.method,
          clientId: info.clientId,
          frameId: info.frameId,
          requestId: info.requestId,
        });
      });
      expect(seen).toEqual([{ method: 'ping', clientId: 'c1', frameId: 'f1', requestId: 99 }]);
    });

    test('onError hook fires with the diagnostic for diagnostic-aware errors', async () => {
      let captured: Record<string, unknown> | undefined;
      const diagnostic = { severity: 'error', code: 'X', message: 'm' };
      const handlers = uniformHandlers(() => {
        const e = new Error('diag-err');
        (e as Error & { diagnostic?: unknown }).diagnostic = diagnostic;
        throw e;
      });
      await routeRequest(handlers, req('eval', { code: 'x' }), (info) => {
        captured = { diagnostic: info.diagnostic };
      });
      expect(captured).toEqual({ diagnostic });
    });
  });

  describe('request-ID preservation', () => {
    test('string, numeric, and null ids all round-trip on success and error', async () => {
      const handlers = uniformHandlers(() => ({ ok: true }));
      for (const id of ['abc', 7, null] as Array<string | number | null>) {
        const ok = await routeRequest(handlers, req('ping', {}, id));
        expect(ok.id).toBe(id);
        const err = await routeRequest(handlers, req('nope', {}, id));
        expect(err.id).toBe(id);
      }
    });
  });
});

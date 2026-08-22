#!/usr/bin/env bun
/**
 * @file tmax-mcp-confirmation
 * @description #220 (RFC-027 §D5 L2) — GENERIC MCP-stdio→daemon confirmation
 * bridge. An MCP-capable subprocess (e.g. claude via --mcp-config) spawns
 * this shim and calls its `permission` tool; the shim forwards the call to
 * the tmax daemon's deferred `confirmation/mediate` JSON-RPC and returns
 * the eventual decision as the tool result.
 *
 * ZERO Fikra logic: the daemon socket path, the request source, and the
 * one-time token all arrive via argv (the adapter writes the --mcp-config
 * file that plants them there). The token never transits model-controlled
 * space. The shim listens on nothing — it dials the daemon's existing
 * socket and exits with the turn.
 *
 * Usage: tmax-mcp-confirmation <socket-path> <source> <token>
 */

import { connect, Socket } from 'net';
import { EOL } from 'os';
// Default daemon socket (same computation the client uses) — the adapter's
// --mcp-config only needs to plant source+token; an explicit third argv
// overrides (tests point the shim at a fake daemon).
import { defaultSocketPath } from '../src/core/socket-path.ts';

interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface MediateResult {
  decision: 'allow' | 'reject' | 'always';
  scope: string;
}

const TOOL_NAME = 'permission';

/** Forward one confirmation/mediate request to the daemon; resolve with the
 * deferred decision (a parked request can take minutes — MCP tolerates a
 * slow tool call; the daemon's timeout rejects eventually). */
function mediate(socketPath: string, source: string, token: string, kind: string, detail: string): Promise<MediateResult> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(socketPath);
    const lines: Buffer[] = [];
    let buffer = '';
    const fail = (err: Error): void => {
      sock.destroy();
      reject(err);
    };
    sock.on('error', fail);
    sock.on('connect', () => {
      sock.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'confirmation/mediate',
        params: { source, token, kind, detail },
      }) + EOL);
    });
    sock.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf(EOL);
      if (idx === -1) return;
      lines.push(Buffer.from(buffer.slice(0, idx)));
      sock.destroy();
      try {
        const response = JSON.parse(lines[0]!.toString('utf8')) as
          | { result?: MediateResult; error?: { message?: string } };
        if (response.result) resolve(response.result);
        else fail(new Error(response.error?.message ?? 'daemon rejected the mediate request'));
      } catch {
        fail(new Error('unparseable daemon response'));
      }
    });
  });
}

function toolResult(text: string, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

async function main(): Promise<void> {
  const [source, token, socketOverride] = process.argv.slice(2);
  if (!source || !token) {
    process.stderr.write('usage: tmax-mcp-confirmation <source> <token> [socket-path]\n');
    process.exit(2);
  }
  const socketPath = socketOverride ?? defaultSocketPath();

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let eol: number;
    while ((eol = buffer.indexOf(EOL)) !== -1) {
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + EOL.length);
      if (line.trim() === '') continue;
      void handleMessage(line);
    }
  });
  // MCP clients keep the server alive via stdin; exit when it closes.
  process.stdin.on('end', () => process.exit(0));

  async function handleMessage(line: string): Promise<void> {
    let msg: JSONRPCMessage;
    try {
      msg = JSON.parse(line) as JSONRPCMessage;
    } catch {
      return; // Not JSON — ignore (MCP framing is line-delimited JSON-RPC).
    }
    if (msg.id === undefined || msg.id === null) return; // notification
    const id = msg.id;
    const send = (result: Record<string, unknown>): void => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + EOL);
    };
    const sendError = (message: string): void => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } }) + EOL);
    };
    switch (msg.method) {
      case 'initialize':
        send({
          protocolVersion: (msg.params?.protocolVersion as string) ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'tmax-confirmation', version: '1.0.0' },
        });
        return;
      case 'tools/list':
        send({
          tools: [{
            name: TOOL_NAME,
            description: 'Ask the tmax user to approve an action. Resolves when the user answers.',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: { type: 'string', description: 'The action class being requested.' },
                input: { type: 'object', description: 'The action payload, shown verbatim to the user.' },
              },
              required: ['tool_name', 'input'],
            },
          }],
        });
        return;
      case 'tools/call': {
        const args = (msg.params?.arguments ?? {}) as { tool_name?: string; input?: unknown };
        try {
          const result = await mediate(
            socketPath,
            source,
            token,
            args.tool_name ?? 'unknown',
            JSON.stringify(args.input ?? {}),
          );
          send(toolResult(result.decision, result.decision === 'reject'));
        } catch (err) {
          // Bridge/daemon failure reads as a REJECTED tool call — the agent
          // proceeds on the safe side; it must never hang on a dead bridge.
          send(toolResult(`confirmation bridge error: ${err instanceof Error ? err.message : String(err)}`, true));
        }
        return;
      }
      default:
        sendError(`Method not found: ${msg.method ?? '(none)'}`);
    }
  }
}

void main();

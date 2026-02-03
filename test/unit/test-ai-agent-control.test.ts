/**
 * @file test-ai-agent-control.test.ts
 * @description Tests for AI Agent Control functionality (US-0.8.3)
 *
 * Tests the JSON-RPC protocol for AI agents to query editor state,
 * execute T-Lisp code, and get help system responses.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TmaxServer } from '../../src/server/server.ts';
import { connect } from 'net';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

// Helper to create a JSON-RPC request
function createRequest(method: string, params?: any, id?: string | number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: id || 1,
    method,
    params
  }) + '\n';
}

// Helper to send a request and get a response
async function sendRequest(socketPath: string, request: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);

    socket.on('connect', () => {
      socket.write(request);
    });

    socket.on('data', (data) => {
      const response = JSON.parse(data.toString().trim());
      socket.destroy();
      resolve(response);
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      socket.destroy();
      reject(new Error('Request timeout'));
    }, 5000);
  });
}

describe('AI Agent Control', () => {
  let server: TmaxServer | null = null;
  let testSocketPath: string;

  beforeEach(async () => {
    // Create a unique socket path for each test
    testSocketPath = `/tmp/tmax-test-${Date.now()}.sock`;

    // Clean up any existing socket
    try {
      await execAsync(`rm -f "${testSocketPath}"`);
    } catch (err) {
      // Ignore error
    }
  });

  describe('query:full-state', () => {
    test('should return full editor state', async () => {
      server = new TmaxServer(testSocketPath, true); // test mode = true
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('query', {
        query: 'full-state'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Verify full-state structure
      expect(response.result).toHaveProperty('buffers');
      expect(response.result).toHaveProperty('currentBuffer');
      expect(response.result).toHaveProperty('mode');
      expect(response.result).toHaveProperty('variables');
      expect(response.result).toHaveProperty('keybindings');
      expect(response.result).toHaveProperty('cursorPosition');
      expect(response.result).toHaveProperty('viewportTop');
      expect(response.result).toHaveProperty('config');

      // Verify buffers is an array
      expect(Array.isArray(response.result.buffers)).toBe(true);

      // Verify mode is valid
      expect(['normal', 'insert', 'visual', 'command', 'mx']).toContain(response.result.mode);

      // Verify variables object
      expect(typeof response.result.variables).toBe('object');

      // Verify cursor position
      expect(typeof response.result.cursorPosition).toBe('object');
      expect(typeof response.result.cursorPosition.line).toBe('number');
      expect(typeof response.result.cursorPosition.column).toBe('number');

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should include buffer information in full-state', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Open a file first
      const openRequest = createRequest('open', {
        filepath: '/tmp/test-file.txt',
        wait: false
      }, 1);

      await sendRequest(testSocketPath, openRequest);

      // Now query full state
      const stateRequest = createRequest('query', {
        query: 'full-state'
      }, 2);

      const response: any = await sendRequest(testSocketPath, stateRequest);

      expect(response.result.buffers.length).toBeGreaterThan(0);
      expect(response.result.buffers[0]).toHaveProperty('name');
      expect(response.result.buffers[0]).toHaveProperty('modified');

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });

  describe('describe-function', () => {
    test('should return function documentation', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'describe-function',
        functionName: 'buffer-insert'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Verify function documentation structure
      expect(response.result).toHaveProperty('name');
      expect(response.result).toHaveProperty('signature');
      expect(response.result).toHaveProperty('documentation');
      expect(response.result).toHaveProperty('file');
      expect(response.result).toHaveProperty('line');
      expect(response.result).toHaveProperty('examples');
      expect(response.result).toHaveProperty('relatedFunctions');

      expect(response.result.name).toBe('buffer-insert');
      expect(typeof response.result.signature).toBe('string');
      expect(Array.isArray(response.result.examples)).toBe(true);
      expect(Array.isArray(response.result.relatedFunctions)).toBe(true);

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should handle unknown function gracefully', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'describe-function',
        functionName: 'non-existent-function'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Should return default documentation for unknown function
      expect(response.result.name).toBe('non-existent-function');
      expect(response.result.file).toBe('unknown');
      expect(response.result.line).toBe(0);

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });

  describe('find-usages', () => {
    test('should return function usage locations', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'find-usages',
        functionName: 'buffer-insert'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Verify usages structure
      expect(response.result).toHaveProperty('function');
      expect(response.result).toHaveProperty('usages');
      expect(Array.isArray(response.result.usages)).toBe(true);

      // Each usage should have file, line, and code
      if (response.result.usages.length > 0) {
        const usage = response.result.usages[0];
        expect(usage).toHaveProperty('file');
        expect(usage).toHaveProperty('line');
        expect(usage).toHaveProperty('code');
      }

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });

  describe('apropos-command', () => {
    test('should find commands matching pattern', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'apropos-command',
        pattern: 'buffer'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Verify matches structure
      expect(response.result).toHaveProperty('matches');
      expect(Array.isArray(response.result.matches)).toBe(true);

      // Each match should have name and binding
      if (response.result.matches.length > 0) {
        const match = response.result.matches[0];
        expect(match).toHaveProperty('name');
        expect(match).toHaveProperty('binding');
        expect(match).toHaveProperty('documentation');
      }

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should handle regex patterns correctly', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'apropos-command',
        pattern: 'buffer.*save'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Should return matches (even if empty array)
      expect(Array.isArray(response.result.matches)).toBe(true);

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });

  describe('describe-variable', () => {
    test('should return variable information', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Use a simple test - query the 'hashmap' function which exists
      const request = createRequest('command', {
        command: 'describe-variable',
        variableName: 'hashmap'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);

      // Verify variable documentation structure
      expect(response.result).toHaveProperty('name');
      expect(response.result).toHaveProperty('value');
      expect(response.result).toHaveProperty('type');
      expect(response.result).toHaveProperty('documentation');
      expect(response.result).toHaveProperty('file');
      expect(response.result).toHaveProperty('line');
      expect(response.result).toHaveProperty('customizable');
      expect(response.result).toHaveProperty('defaultValue');

      expect(response.result.name).toBe('hashmap');
      expect(response.result.value).toBeDefined();
      expect(typeof response.result.type).toBe('string');

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should handle unknown variable gracefully', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'describe-variable',
        variableName: '*unknown-variable*'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      // Should return default information for unknown variable
      expect(response.result.name).toBe('*unknown-variable*');
      expect(response.result.type).toBe('unknown');

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });

  describe('Performance', () => {
    test('should execute T-Lisp code and test verification in under 100ms', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const startTime = Date.now();

      // Execute T-Lisp code
      const evalRequest = createRequest('eval', {
        code: '(buffer-list)'
      }, 1);

      const evalResponse: any = await sendRequest(testSocketPath, evalRequest);

      expect(evalResponse.jsonrpc).toBe('2.0');
      expect(evalResponse.error).toBeUndefined();

      const duration = Date.now() - startTime;

      // Should complete in under 100ms (with some margin for test overhead)
      expect(duration).toBeLessThan(150);

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should handle multiple rapid requests efficiently', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const startTime = Date.now();

      // Send multiple requests
      const requests = [
        createRequest('query', { query: 'buffers' }, 1),
        createRequest('query', { query: 'variables' }, 2),
        createRequest('query', { query: 'keybindings' }, 3),
      ];

      const responses = await Promise.all(
        requests.map(req => sendRequest(testSocketPath, req))
      );

      const duration = Date.now() - startTime;

      // All requests should succeed
      responses.forEach((response, i) => {
        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(i + 1);
        expect(response.error).toBeUndefined();
      });

      // Should complete all requests quickly
      expect(duration).toBeLessThan(300);

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });

  describe('Error Handling', () => {
    test('should return error for invalid query type', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('query', {
        query: 'invalid-query-type'
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeDefined();
      expect(response.error.code).not.toBe(-32600); // Not an invalid request error

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should return error for missing function name in describe-function', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'describe-function'
        // Missing functionName
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeDefined();

      // Cleanup
      await server.shutdown();
      server = null;
    });

    test('should return error for missing pattern in apropos-command', async () => {
      server = new TmaxServer(testSocketPath, true);
      await server.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 500));

      const request = createRequest('command', {
        command: 'apropos-command'
        // Missing pattern
      }, 1);

      const response: any = await sendRequest(testSocketPath, request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeDefined();

      // Cleanup
      await server.shutdown();
      server = null;
    });
  });
});

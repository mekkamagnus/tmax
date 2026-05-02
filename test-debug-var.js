import { TmaxServer } from './src/server/server.ts';

const server = new TmaxServer('/tmp/test-debug.sock', true);
await server.start();
await new Promise(r => setTimeout(r, 1000));

const net = require('net');
const socket = net.connect('/tmp/test-debug.sock');

socket.on('data', (data) => {
  console.log('Response:', data.toString());
  socket.destroy();
});

socket.on('connect', () => {
  // Define variable
  socket.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eval',
    params: { code: '(defvar *test-describe-var* 42)' }
  }) + '\n');
});

setTimeout(() => {
  socket.destroy();
  server.shutdown();
}, 2000);

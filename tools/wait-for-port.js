#!/usr/bin/env node
// Wait until a TCP port on localhost is accepting connections.
// Usage: node tools/wait-for-port.js <port> [host]

const net = require('net');

const port = Number(process.argv[2] || 9877);
const host = process.argv[3] || '127.0.0.1';
const timeoutMs = Number(process.env.WAIT_FOR_PORT_TIMEOUT_MS || 10000);
const start = Date.now();

function tryOnce() {
  const socket = net.createConnection({ host, port }, () => {
    socket.destroy();
    process.exit(0);
  });

  socket.on('error', () => {
    socket.destroy();
    if (Date.now() - start >= timeoutMs) {
      console.error(`Port ${host}:${port} not ready after ${timeoutMs}ms`);
      process.exit(1);
    }
    setTimeout(tryOnce, 100);
  });
}

tryOnce();

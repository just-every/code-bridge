#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const net = require('net');

// Parse command-line arguments
const args = process.argv.slice(2);
const workspacePathArg = args.find(arg => !arg.startsWith('--'));
const portArg = args.find(arg => arg.startsWith('--port='));

const workspacePath = workspacePathArg ? path.resolve(workspacePathArg) : process.cwd();
const preferredPort = portArg ? parseInt(portArg.split('=')[1], 10) : 9876;

const codeDir = path.join(workspacePath, '.code');
const lockFile = path.join(codeDir, 'code-bridge.lock');
const metaFile = path.join(codeDir, 'code-bridge.json');

// Ensure .code directory exists
if (!fs.existsSync(codeDir)) {
  fs.mkdirSync(codeDir, { recursive: true });
}

// Try to acquire workspace lock
function tryAcquireLock() {
  try {
    // Check if lock file exists and if process is still running
    if (fs.existsSync(lockFile)) {
      const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));

      // Check if the process is still alive
      try {
        process.kill(lockData.pid, 0); // Signal 0 checks if process exists
        console.error(`code-bridge-host is already running for this workspace (PID ${lockData.pid})`);
        console.error(`Lock file: ${lockFile}`);
        process.exit(1);
      } catch (err) {
        // Process is dead, we can take over the lock
        console.log(`Stale lock detected (PID ${lockData.pid}), acquiring lock...`);
      }
    }

    // Write our lock
    const lockData = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      workspacePath
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
    return true;
  } catch (err) {
    console.error(`Failed to acquire lock: ${err.message}`);
    process.exit(1);
  }
}

// Release lock and clean up
function releaseLock() {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    if (fs.existsSync(metaFile)) {
      fs.unlinkSync(metaFile);
    }
  } catch (err) {
    console.error(`Error releasing lock: ${err.message}`);
  }
}

// Find an available port
async function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port is taken, try next one
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

// Generate random secret
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Write metadata file
function writeMetadata(port, secret) {
  const metadata = {
    url: `ws://127.0.0.1:${port}`,
    port,
    secret,
    workspacePath,
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
  return metadata;
}

// Main server logic
async function startServer() {
  // Acquire lock
  tryAcquireLock();

  // Find available port
  const port = await findAvailablePort(preferredPort);

  // Generate secret
  const secret = generateSecret();

  // Write metadata
  const metadata = writeMetadata(port, secret);

  console.log(`code-bridge-host started`);
  console.log(`  Workspace: ${workspacePath}`);
  console.log(`  Port: ${port}`);
  console.log(`  Secret: ${secret.slice(0, 8)}...`);
  console.log(`  Metadata: ${metaFile}`);

  // Track connected clients
  const bridges = new Set(); // bridge role clients
  const consumers = new Set(); // consumer role clients

  // Track per-bridge capabilities: Map<WebSocket, {capabilities: string[], route?: string, url?: string}>
  const bridgeCapabilities = new Map();

  // Track per-consumer subscriptions: Map<WebSocket, {levels: string[], capabilities: string[], llm_filter: string}>
  const consumerSubscriptions = new Map();

  // Screenshot rate limiting: minimum 10 seconds between screenshots per bridge
  const SCREENSHOT_RATE_LIMIT_MS = 10000;
  const bridgeLastScreenshot = new Map(); // Map<WebSocket, timestamp>

  // LLM filter / overload guard
  const FILTER_LEVELS = ['off', 'minimal', 'aggressive'];
  let windowStart = Date.now();
  let windowCount = 0;
  const WINDOW_MS = 10_000;
  const WINDOW_LIMIT = 500;

  function filterEventForConsumer(message, consumerMeta) {
    const filter = (consumerMeta.llm_filter || 'off').toLowerCase();

    // windowed overload fallback: if too many events recently and filter not off, only allow errors
    const now = Date.now();
    if (now - windowStart > WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > WINDOW_LIMIT && filter !== 'off') {
      return message.level === 'error';
    }

    if (filter === 'off') return true;
    const lvl = (message.level || '').toString().toLowerCase();
    if (filter === 'minimal') {
      if (lvl === 'debug' || lvl === 'log') return false;
      return true;
    }
    if (filter === 'aggressive') {
      if (lvl === 'debug' || lvl === 'log' || lvl === 'info') return false;
      return true;
    }
    return true;
  }

  // Helper: Map log levels to subscription levels
  function getSubscriptionLevelForLogLevel(logLevel) {
    // Map LogLevel to SubscriptionLevel hierarchy
    // errors (most restrictive) < warn < info < trace (least restrictive)
    switch (logLevel) {
      case 'error':
        return 'errors';
      case 'warn':
        return 'warn';
      case 'info':
      case 'log':
        return 'info';
      case 'debug':
        return 'trace';
      default:
        return 'info';
    }
  }

  // Helper: Check if subscription level includes the event level
  function subscriptionIncludesLevel(subscribedLevels, eventLogLevel) {
    const eventLevel = getSubscriptionLevelForLogLevel(eventLogLevel);
    const hierarchy = ['errors', 'warn', 'info', 'trace'];
    const eventIndex = hierarchy.indexOf(eventLevel);

    // Check if any subscribed level is >= the event level
    return subscribedLevels.some(subLevel => {
      const subIndex = hierarchy.indexOf(subLevel);
      return subIndex >= eventIndex;
    });
  }

  // Helper: Check if consumer should receive event based on subscription
  function shouldRouteToConsumer(consumer, message, bridgeWs) {
    const subscription = consumerSubscriptions.get(consumer);

    // Default: errors only, no capabilities
    const levels = subscription?.levels || ['errors'];
    const requestedCapabilities = subscription?.capabilities || [];
    const consumerFilterOk = subscription ? filterEventForConsumer(message, subscription) : true;
    if (!consumerFilterOk) return false;

    // Check level filtering
    if (message.level && !subscriptionIncludesLevel(levels, message.level)) {
      return false;
    }

    // Check capability filtering (if consumer requested specific capabilities)
    const messageType = (message.type || '').toString().toLowerCase();
    if (messageType === 'pageview' || messageType === 'screenshot' || messageType === 'control') {
      const wants = requestedCapabilities.map((c) => c.toLowerCase());
      if (!wants.includes(messageType)) return false;
      const bridgeCaps = bridgeCapabilities.get(bridgeWs);
      if (!bridgeCaps || !bridgeCaps.capabilities.map((c) => c.toLowerCase()).includes(messageType)) {
        return false;
      }
    } else if (requestedCapabilities.length > 0) {
      // If consumer requested capabilities but this message has none, still allow
    }

    return true;
  }

  // Create WebSocket server
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws, req) => {
    let isAuthenticated = false;
    let role = null;
    let clientId = null;

    // Set up timeout for auth
    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) {
        ws.close(1008, 'Authentication timeout');
      }
    }, 5000);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle authentication
        if (!isAuthenticated) {
          if (message.type === 'auth') {
            if (message.secret === secret) {
              isAuthenticated = true;
              role = message.role || 'bridge'; // Default to bridge for backward compatibility
              clientId = message.clientId || `${role}-${Date.now()}`;
              clearTimeout(authTimeout);

              // Add to appropriate set
              if (role === 'bridge') {
                bridges.add(ws);
                console.log(`Bridge client connected: ${clientId} (${bridges.size} bridges, ${consumers.size} consumers)`);
              } else if (role === 'consumer') {
                consumers.add(ws);
                console.log(`Consumer client connected: ${clientId} (${bridges.size} bridges, ${consumers.size} consumers)`);
              } else {
                ws.close(1008, `Invalid role: ${role}`);
                return;
              }

              ws.send(JSON.stringify({ type: 'auth_success', role, clientId }));
            } else {
              ws.close(1008, 'Invalid secret');
            }
            return;
          } else {
            ws.close(1008, 'Authentication required');
            return;
          }
        }

        // Handle messages from authenticated clients
        if (role === 'bridge') {
          // Handle bridge hello frame
          if (message.type === 'hello') {
            const capabilities = message.capabilities || [];
            const route = message.route;
            const url = message.url;

            bridgeCapabilities.set(ws, { capabilities, route, url });
            console.log(`Bridge ${clientId} hello: capabilities=[${capabilities.join(', ')}] route=${route || 'none'} url=${url || 'none'}`);

            // Send acknowledgment
            ws.send(JSON.stringify({ type: 'hello_ack', clientId }));
            return;
          }

          // Handle screenshot events with rate limiting
          if (message.type === 'screenshot') {
            const bridgeCaps = bridgeCapabilities.get(ws);

            // Check if bridge has screenshot capability
            if (!bridgeCaps || !bridgeCaps.capabilities.includes('screenshot')) {
              console.log(`Bridge ${clientId} sent screenshot without capability, dropping`);
              ws.send(JSON.stringify({
                type: 'rate_limit_notice',
                reason: 'missing_capability',
                message: 'Screenshot capability not advertised in hello'
              }));
              return;
            }

            // Check rate limit
            const now = Date.now();
            const lastScreenshot = bridgeLastScreenshot.get(ws);
            if (lastScreenshot && (now - lastScreenshot) < SCREENSHOT_RATE_LIMIT_MS) {
              const waitMs = SCREENSHOT_RATE_LIMIT_MS - (now - lastScreenshot);
              console.log(`Bridge ${clientId} screenshot rate-limited, dropping (retry in ${Math.ceil(waitMs / 1000)}s)`);
              ws.send(JSON.stringify({
                type: 'rate_limit_notice',
                reason: 'rate_limit',
                retryAfterMs: waitMs,
                message: `Screenshot rate limit: wait ${Math.ceil(waitMs / 1000)}s before next screenshot`
              }));
              return;
            }

            // Check if any consumer is subscribed to screenshots
            const interestedConsumers = [];
            consumers.forEach(consumer => {
              if (consumer.readyState === 1 && shouldRouteToConsumer(consumer, message, ws)) {
                interestedConsumers.push(consumer);
              }
            });

            if (interestedConsumers.length === 0) {
              console.log(`Bridge ${clientId} screenshot has no interested consumers, dropping`);
              ws.send(JSON.stringify({
                type: 'rate_limit_notice',
                reason: 'no_consumers',
                message: 'No consumers subscribed to screenshot capability'
              }));
              return;
            }

            // Update rate limit timestamp
            bridgeLastScreenshot.set(ws, now);

            // Validate screenshot event shape
            if (!message.mime || !message.data || !message.timestamp || !message.platform || !message.projectId) {
              console.log(`Bridge ${clientId} screenshot missing required fields, dropping`);
              ws.send(JSON.stringify({
                type: 'rate_limit_notice',
                reason: 'invalid_format',
                message: 'Screenshot missing required fields: mime, data, timestamp, platform, projectId'
              }));
              return;
            }

            // Forward to interested consumers
            const payload = JSON.stringify(message);
            interestedConsumers.forEach(consumer => {
              consumer.send(payload);
            });

            console.log(`Routed screenshot from bridge ${clientId} to ${interestedConsumers.length} consumer(s) (${message.mime}, ${Math.ceil(message.data.length / 1024)}KB)`);
            return;
          }

          // Broadcast other events to subscribed consumers (with filtering)
          const payload = JSON.stringify(message);
          let sentCount = 0;
          consumers.forEach(consumer => {
            if (consumer.readyState === 1 && shouldRouteToConsumer(consumer, message, ws)) {
              consumer.send(payload);
              sentCount++;
            }
          });

          if (sentCount > 0) {
            console.log(`Routed from bridge ${clientId} to ${sentCount} consumer(s): ${message.type || 'unknown'} level=${message.level || 'none'}`);
          }
        } else if (role === 'consumer') {
          // Handle consumer subscribe frame
          if (message.type === 'subscribe') {
            const levels = message.levels || ['errors'];
            const capabilities = message.capabilities || [];
            const llm_filter = FILTER_LEVELS.includes((message.llm_filter || 'off').toLowerCase())
              ? message.llm_filter.toLowerCase()
              : 'off';

            consumerSubscriptions.set(ws, { levels, capabilities, llm_filter });
            console.log(`Consumer ${clientId} subscribed: levels=[${levels.join(', ')}] capabilities=[${capabilities.join(', ')}] filter=${llm_filter}`);

            // Send acknowledgment
            ws.send(JSON.stringify({ type: 'subscribe_ack', clientId, levels, capabilities, llm_filter }));
            return;
          }

          // Handle control frames from consumers -> forward to control-capable bridges
          if (message.type === 'control') {
            const targets = [];
            bridges.forEach((meta, bridgeWs) => {
              if (
                bridgeWs.readyState === 1 &&
                meta.capabilities &&
                meta.capabilities.map((c) => c.toLowerCase()).includes('control')
              ) {
                targets.push(bridgeWs);
              }
            });

            if (targets.length === 0) {
              ws.send(
                JSON.stringify({
                  type: 'control_error',
                  reason: 'no_control_bridge',
                  message: 'No bridge with control capability is connected',
                })
              );
              return;
            }

            const payload = JSON.stringify(message);
            targets.forEach((bridgeWs) => bridgeWs.send(payload));
            ws.send(
              JSON.stringify({
                type: 'control_ack',
                delivered: targets.length,
              })
            );
            return;
          }

          // Other consumer messages (ignored for now, could add control commands)
          console.log(`Message from consumer ${clientId} (ignored): ${message.type || 'unknown'}`);
        }
      } catch (err) {
        console.error(`Error processing message: ${err.message}`);
        ws.close(1011, 'Internal error');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (role === 'bridge') {
        bridges.delete(ws);
        bridgeCapabilities.delete(ws);
        bridgeLastScreenshot.delete(ws);
        console.log(`Bridge client disconnected: ${clientId || 'unknown'} (${bridges.size} bridges, ${consumers.size} consumers)`);
      } else if (role === 'consumer') {
        consumers.delete(ws);
        consumerSubscriptions.delete(ws);
        console.log(`Consumer client disconnected: ${clientId || 'unknown'} (${bridges.size} bridges, ${consumers.size} consumers)`);
      }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error: ${err.message}`);
    });
  });

  wss.on('error', (err) => {
    console.error(`Server error: ${err.message}`);
  });

  // Handle shutdown
  function shutdown() {
    console.log('\nShutting down...');
    wss.close(() => {
      releaseLock();
      console.log('Server stopped');
      process.exit(0);
    });

    // Force exit after 5 seconds
    setTimeout(() => {
      console.log('Forcing exit...');
      releaseLock();
      process.exit(1);
    }, 5000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    releaseLock();
  });
}

// Start the server
startServer().catch(err => {
  console.error(`Failed to start server: ${err.message}`);
  releaseLock();
  process.exit(1);
});

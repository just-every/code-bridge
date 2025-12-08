#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const net = require('net');
const http = require('http');

// Parse command-line arguments
const args = process.argv.slice(2);
const workspacePathArg = args.find(arg => !arg.startsWith('--'));
const portArg = args.find(arg => arg.startsWith('--port='));

const workspacePath = workspacePathArg ? path.resolve(workspacePathArg) : process.cwd();
const preferredPort = portArg ? parseInt(portArg.split('=')[1], 10) : 9876;

const codeDir = path.join(workspacePath, '.code');
const lockFile = path.join(codeDir, 'code-bridge.lock');
const metaFile = path.join(codeDir, 'code-bridge.json');
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_STALE_MS = 15_000;

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

      const pid = lockData.pid;
      let alive = false;
      if (pid) {
        try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      }

      // If meta exists, also check heartbeat staleness
      let stale = false;
      if (fs.existsSync(metaFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          if (meta.heartbeatAt) {
            const age = Date.now() - new Date(meta.heartbeatAt).getTime();
            if (age > HEARTBEAT_STALE_MS) stale = true;
          }
        } catch (_) {}
      }

      if (alive && !stale) {
        console.error(`code-bridge-host is already running for this workspace (PID ${pid})`);
        console.error(`Lock file: ${lockFile}`);
        process.exit(1);
      }

      // Stale: cleanup and continue
      console.log(`Stale lock detected (PID ${pid || 'unknown'}), reclaiming...`);
      try { fs.unlinkSync(lockFile); } catch {}
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

// Reuse prior secret when available so restarts don't break existing bridges.
function loadExistingSecret() {
  if (!fs.existsSync(metaFile)) return null;
  try {
    const data = fs.readFileSync(metaFile, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.secret === 'string' && parsed.secret.length > 0) {
      return parsed.secret;
    }
  } catch (err) {
    console.warn(`Warning: failed to read existing metadata for secret reuse: ${err.message}`);
  }
  return null;
}

// Write metadata file
function writeMetadata(port, secret) {
  const metadata = {
    url: `ws://127.0.0.1:${port}`,
    port,
    secret,
    workspacePath,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    heartbeatAt: new Date().toISOString(),
  };
  fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
  return metadata;
}

function startHeartbeat(metadata) {
  return setInterval(() => {
    try {
      metadata.heartbeatAt = new Date().toISOString();
      fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
    } catch (err) {
      console.error(`Failed to write heartbeat: ${err.message}`);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// Main server logic
async function startServer() {
  // Acquire lock
  tryAcquireLock();

  // Find available port
  const port = await findAvailablePort(preferredPort);

  // Generate secret: prefer explicit env, otherwise reuse previous, otherwise random
  const envSecret = process.env.CODE_BRIDGE_SECRET || process.env.CODE_BRIDGE_HOST_SECRET;
  const reusedSecret = envSecret || loadExistingSecret();
  const secret = reusedSecret || generateSecret();

  // Write metadata
  const metadata = writeMetadata(port, secret);
  const heartbeatTimer = startHeartbeat(metadata);

  console.log(`code-bridge-host started`);
  console.log(`  Workspace: ${workspacePath}`);
  console.log(`  Port: ${port}`);
  if (envSecret) {
    console.log(`  Secret: ${secret.slice(0, 8)}... (from CODE_BRIDGE_SECRET)`);
  } else if (reusedSecret) {
    console.log(`  Secret: ${secret.slice(0, 8)}... (reused)`);
  } else {
    console.log(`  Secret: ${secret.slice(0, 8)}... (generated)`);
  }
  console.log(`  Metadata: ${metaFile}`);

  // Track connected clients
  const bridges = new Set(); // bridge role clients (WebSocket or HTTP sessions)
  const consumers = new Set(); // consumer role clients

  // HTTP bridge bookkeeping
  const httpBridgeSessions = new Map(); // sessionId -> session

  // Track per-bridge capabilities: Map<WebSocket, {capabilities: string[], route?: string, url?: string}>
  const bridgeCapabilities = new Map();

  // Track per-consumer subscriptions: Map<WebSocket, {levels: string[], capabilities: string[], llm_filter: string}>
  const consumerSubscriptions = new Map();

  // Track pending control requests: id -> {replyTo, origin}
  const pendingControl = new Map();

  // Screenshot rate limiting: minimum 10 seconds between screenshots per bridge
  // Dev convenience: keep rate-limit modest but not too strict
  // Rate-limit screenshots per bridge to reduce spam (dev-friendly)
  const SCREENSHOT_RATE_LIMIT_MS = 2000;
  const bridgeLastScreenshot = new Map(); // Map<WebSocket, timestamp>

  // LLM filter / overload guard
  const FILTER_LEVELS = ['off', 'minimal', 'aggressive'];
  let windowStart = Date.now();
  let windowCount = 0;
  const WINDOW_MS = 10_000;
  const WINDOW_LIMIT = 500;

  function filterEventForConsumer(message, consumerMeta) {
    const filter = lower(consumerMeta.llm_filter || 'off');

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
    const lvl = lower(message.level || '');
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

  function lower(val) {
    if (val === null || val === undefined) return '';
    try { return val.toString().toLowerCase(); } catch { return ''; }
  }

  const LEVEL_ORDER = ['errors', 'warn', 'info', 'trace'];

  function getSubscriptionLevelForLogLevel(logLevel = 'info') {
    const lvl = lower(logLevel);
    switch (lvl) {
      case 'error': return 'errors';
      case 'warn': return 'warn';
      case 'debug': return 'trace';
      case 'info':
      case 'log':
      default:
        return 'info';
    }
  }

  function subscriptionIncludesLevel(subscribedLevels, eventLogLevel) {
    const eventLevel = getSubscriptionLevelForLogLevel(eventLogLevel);
    const eventIndex = LEVEL_ORDER.indexOf(eventLevel);
    const levels = (subscribedLevels || ['errors']).map(lower);
    return levels.some((sub) => LEVEL_ORDER.indexOf(sub) >= eventIndex);
  }

  function bridgeHasCapability(bridgeCaps, capability) {
    const cap = lower(capability);
    if (!cap) return false;
    return (bridgeCaps || []).map(lower).includes(cap);
  }

  function consumerWantsCapability(consumerCaps, capability) {
    const requested = (consumerCaps || []).map(lower).filter(Boolean);
    if (!requested.length) return true; // no filter set
    return requested.includes(lower(capability));
  }

  // Helper: Check if consumer should receive event based on subscription
  function shouldRouteToConsumer(consumer, message, bridgeWs) {
    const subscription = consumerSubscriptions.get(consumer);

    // Default: errors only, no capabilities
    const levels = subscription?.levels || ['errors'];
    const requestedCapabilities = subscription?.capabilities || [];
    const consumerFilterOk = subscription ? filterEventForConsumer(message, subscription) : true;
    if (!consumerFilterOk) return false;

    const effectiveLevel = message.level || 'info';

    // Check level filtering
    if (!subscriptionIncludesLevel(levels, effectiveLevel)) {
      return false;
    }

    // Check capability filtering (if consumer requested specific capabilities)
    const messageType = lower(message.type || '');
    if (messageType === 'pageview' || messageType === 'screenshot' || messageType === 'control' || messageType === 'network' || messageType === 'navigation') {
      if (!consumerWantsCapability(requestedCapabilities, messageType)) return false;
      const bridgeCaps = bridgeCapabilities.get(bridgeWs);
      if (!bridgeHasCapability(bridgeCaps?.capabilities, messageType)) {
        return false;
      }
    } else if (requestedCapabilities.length > 0) {
      // If consumer requested capabilities but this message has none, still allow
    }

    return true;
  }

  // Simple HTTP body reader
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  function makeSessionId() {
    return crypto.randomBytes(12).toString('hex');
  }

  function getHttpSession(id) {
    return httpBridgeSessions.get(id);
  }

  function removeHttpSession(session) {
    httpBridgeSessions.delete(session.sessionId);
    bridges.delete(session);
    bridgeCapabilities.delete(session);
    bridgeLastScreenshot.delete(session);
  }

  function pruneHttpSessions() {
    const now = Date.now();
    httpBridgeSessions.forEach((session) => {
      if (now - session.lastSeen > HEARTBEAT_STALE_MS) {
        removeHttpSession(session);
      }
    });
  }

  function deliverToConsumers(message, bridgeRef) {
    const payload = JSON.stringify(message);
    let sentCount = 0;
    consumers.forEach(consumer => {
      if (consumer.readyState === 1 && shouldRouteToConsumer(consumer, message, bridgeRef)) {
        consumer.send(payload);
        sentCount++;
      }
    });
    if (sentCount > 0) {
      console.log(`Routed from bridge to ${sentCount} consumer(s): ${message.type || 'unknown'} level=${message.level || 'none'}`);
    }
  }

  // HTTP server (shares port with WebSocket upgrade)
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;

      // Basic auth check via secret header or body field
      const secretHeader = req.headers['x-code-bridge-secret'];

      if (req.method === 'POST' && path === '/bridge/connect') {
        const body = await readJson(req);
        if ((body.secret || secretHeader) !== secret) {
          res.writeHead(401); res.end('unauthorized'); return;
        }
        const sessionId = makeSessionId();
        const session = {
          kind: 'http',
          sessionId,
          queue: [], // control queue
          lastSeen: Date.now(),
          readyState: 1,
        };
        httpBridgeSessions.set(sessionId, session);
        bridges.add(session);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sessionId }));
        return;
      }

      if (req.method === 'POST' && path === '/bridge/hello') {
        const body = await readJson(req);
        const session = getHttpSession(body.sessionId);
        if (!session) { res.writeHead(404); res.end('session not found'); return; }
        session.lastSeen = Date.now();
        bridgeCapabilities.set(session, {
          capabilities: body.capabilities || [],
          route: body.route,
          url: body.url,
          protocol: body.protocol || 2,
          platform: body.platform || 'roblox',
          projectId: body.projectId,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clientId: session.sessionId }));
        return;
      }

      if (req.method === 'POST' && path === '/bridge/events') {
        const body = await readJson(req);
        const session = getHttpSession(body.sessionId);
        if (!session) { res.writeHead(404); res.end('session not found'); return; }
        session.lastSeen = Date.now();
        const events = Array.isArray(body.events) ? body.events : [];
        events.forEach((ev) => {
          const msg = { ...ev };
          if (!msg.timestamp) msg.timestamp = Date.now();
          if (!msg.level) msg.level = 'info';
          if (!msg.type) msg.type = 'log';
          deliverToConsumers(msg, session);
        });
        res.writeHead(204); res.end();
        return;
      }

      if (req.method === 'POST' && path === '/bridge/control/result') {
        const body = await readJson(req);
        const session = getHttpSession(body.sessionId);
        if (!session) { res.writeHead(404); res.end('session not found'); return; }
        session.lastSeen = Date.now();
        const pending = pendingControl.get(body.id);
        if (pending && pending.replyTo?.readyState === 1) {
          pending.replyTo.send(JSON.stringify({
            type: 'control_result',
            id: body.id,
            ok: body.ok,
            result: body.result,
            error: body.error,
          }));
          pendingControl.delete(body.id);
        }
        res.writeHead(204); res.end();
        return;
      }

      if (req.method === 'POST' && path === '/bridge/control/poll') {
        const body = await readJson(req);
        const session = getHttpSession(body.sessionId);
        if (!session) { res.writeHead(404); res.end('session not found'); return; }
        session.lastSeen = Date.now();
        const commands = session.queue.splice(0, session.queue.length);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ commands }));
        return;
      }

      if (req.method === 'POST' && path === '/bridge/heartbeat') {
        const body = await readJson(req);
        const session = getHttpSession(body.sessionId);
        if (!session) { res.writeHead(404); res.end('session not found'); return; }
        session.lastSeen = Date.now();
        res.writeHead(204); res.end();
        return;
      }

      if (req.method === 'POST' && path === '/bridge/disconnect') {
        const body = await readJson(req);
        const session = getHttpSession(body.sessionId);
        if (session) {
          removeHttpSession(session);
        }
        res.writeHead(204); res.end();
        return;
      }

      res.writeHead(404); res.end('not found');
    } catch (err) {
      console.error('HTTP bridge error', err);
      try { res.writeHead(500); res.end('error'); } catch (_) {}
    }
  });

  // Create WebSocket server and listen
  const wss = new WebSocketServer({ server });
  server.listen(port, () => {
    console.log(`HTTP+WS listening on ${port}`);
  });

  const httpPruneTimer = setInterval(pruneHttpSessions, HEARTBEAT_STALE_MS);

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
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (role === 'bridge') {
          // Handle bridge hello frame
          if (message.type === 'hello') {
            const capabilities = message.capabilities || [];
            const route = message.route;
            const url = message.url;
            const protocol = message.protocol || 1;
            const platform = message.platform;
            const projectId = message.projectId;

            bridgeCapabilities.set(ws, { capabilities, route, url, protocol, platform, projectId });
            console.log(`Bridge ${clientId} hello: capabilities=[${capabilities.join(', ')}] route=${route || 'none'} url=${url || 'none'} proto=v${protocol}`);

            // Send acknowledgment
            ws.send(JSON.stringify({ type: 'hello_ack', clientId, protocol }));
            return;
          }

          // Handle control responses from bridges back to consumers
          if (message.type === 'control_result') {
            const pending = pendingControl.get(message.id);
            if (pending && pending.replyTo?.readyState === 1) {
              pending.replyTo.send(JSON.stringify(message));
              pendingControl.delete(message.id);
            }
            return;
          }

          // Handle control requests originating from bridge -> forward to consumers
          if (message.type === 'control_request') {
            const serialized = JSON.stringify(message);
            let delivered = 0;
            consumers.forEach((consumer) => {
              if (consumer.readyState === 1 && shouldRouteToConsumer(consumer, { ...message, level: 'info' }, ws)) {
                consumer.send(serialized);
                delivered += 1;
              }
            });
            if (delivered > 0) {
              pendingControl.set(message.id, { replyTo: ws, origin: 'bridge' });
            }
            if (delivered === 0) {
              // No consumers; reply with error so bridge can surface
              ws.send(JSON.stringify({
                type: 'control_result',
                id: message.id,
                ok: false,
                error: { message: 'No consumers connected for control' },
              }));
            }
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

            // Validate screenshot event shape (tolerant for dev use)
            if (!message.mime || !message.data) {
              console.log(`Bridge ${clientId} screenshot missing mime/data, dropping`);
              ws.send(JSON.stringify({
                type: 'rate_limit_notice',
                reason: 'invalid_format',
                message: 'Screenshot missing required fields: mime, data'
              }));
              return;
            }

            // Ensure required metadata is present; fill when missing
            if (!message.timestamp) message.timestamp = Date.now();
            if (!message.platform) message.platform = 'web';
            if (!message.level) message.level = 'info';
            if (!message.message) message.message = `Screenshot: ${message.route || message.url || 'unknown'}`;

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
            const llm_filter_raw = lower(message.llm_filter || 'off');
            const llm_filter = FILTER_LEVELS.includes(llm_filter_raw)
              ? llm_filter_raw
              : 'off';

            consumerSubscriptions.set(ws, { levels, capabilities, llm_filter });
            console.log(`Consumer ${clientId} subscribed: levels=[${levels.join(', ')}] capabilities=[${capabilities.join(', ')}] filter=${llm_filter}`);

            // Send acknowledgment
            ws.send(JSON.stringify({ type: 'subscribe_ack', clientId, levels, capabilities, llm_filter }));
            return;
          }

          // Handle control frames from consumers -> forward to control-capable bridges
          if (message.type === 'control_request' || message.type === 'control') {
            const reqId = message.id || `${clientId}-${Date.now()}`;
            const payload = { ...message, type: 'control_request', id: reqId };

            const targets = [];
            bridges.forEach((bridgeWs) => {
              const meta = bridgeCapabilities.get(bridgeWs);
              if (
                bridgeWs.readyState === 1 &&
                bridgeHasCapability(meta?.capabilities, 'control')
              ) {
                targets.push(bridgeWs);
              }
            });

            if (targets.length === 0) {
              ws.send(
                JSON.stringify({
                  type: 'control_result',
                  id: reqId,
                  ok: false,
                  error: { message: 'No bridge with control capability is connected' },
                })
              );
              return;
            }

            pendingControl.set(reqId, { replyTo: ws, origin: 'consumer' });
            const serialized = JSON.stringify(payload);
            targets.forEach((bridgeWs) => {
              if (bridgeWs.kind === 'http') {
                // queue control for HTTP bridge to pick up via poll
                bridgeWs.queue.push(payload);
              } else {
                bridgeWs.send(serialized);
              }
            });
            ws.send(
              JSON.stringify({
                type: 'control_forwarded',
                id: reqId,
                delivered: targets.length,
              })
            );
            return;
          }

          if (message.type === 'control_result') {
            const pending = pendingControl.get(message.id);
            if (pending && pending.replyTo?.readyState === 1) {
              pending.replyTo.send(JSON.stringify(message));
              pendingControl.delete(message.id);
            }
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
      // Drop pending control requests targeting this socket
      pendingControl.forEach((entry, id) => {
        if (entry.replyTo === ws) {
          pendingControl.delete(id);
        }
      });
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
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (httpPruneTimer) clearInterval(httpPruneTimer);
    server.close(() => {
      wss.close(() => {
        releaseLock();
        console.log('Server stopped');
        process.exit(0);
      });
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
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (httpPruneTimer) clearInterval(httpPruneTimer);
    releaseLock();
  });
}

// Start the server
startServer().catch(err => {
  console.error(`Failed to start server: ${err.message}`);
  releaseLock();
  process.exit(1);
});

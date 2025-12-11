package com.jestevery.codebridge;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.lang.reflect.Type;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocket.Listener;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Parity-grade Java client for the Code Bridge protocol v2.
 */
public class CodeBridgeClient {

    public static final int PROTOCOL_VERSION = 2;
    public static final int HEARTBEAT_INTERVAL_MS = 15_000;
    public static final int HEARTBEAT_TIMEOUT_MS = 30_000;
    public static final int RECONNECT_INITIAL_MS = 1_000;
    public static final int RECONNECT_MAX_MS = 30_000;
    public static final int BUFFER_LIMIT = 200;

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final Gson gson = new Gson();
    private final Random random = new Random();

    private final String url;
    private final String secret;
    private final String projectId;
    private final List<String> capabilities;
    private final int heartbeatIntervalMs;
    private final int heartbeatTimeoutMs;
    private final int backoffInitialMs;
    private final int backoffMaxMs;
    private final int bufferLimit;

    private volatile WebSocket ws;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean connected = new AtomicBoolean(false);
    private final AtomicBoolean authed = new AtomicBoolean(false);
    private final AtomicBoolean helloSent = new AtomicBoolean(false);
    private final AtomicLong lastPongAt = new AtomicLong(0);
    private CompletableFuture<Void> authFuture;

    private final ArrayDeque<Map<String, Object>> buffer = new ArrayDeque<>();
    private int dropped = 0;

    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> timeoutTask;
    private java.util.function.Function<Map<String, Object>, Object> controlFn;

    public CodeBridgeClient(String url, String secret, String projectId, List<String> capabilities) {
        this(url, secret, projectId, capabilities,
            HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
            RECONNECT_INITIAL_MS, RECONNECT_MAX_MS,
            BUFFER_LIMIT);
    }

    public CodeBridgeClient(String url, String secret, String projectId, List<String> capabilities,
                            int heartbeatIntervalMs, int heartbeatTimeoutMs,
                            int backoffInitialMs, int backoffMaxMs,
                            int bufferLimit) {
        this.url = url;
        this.secret = secret;
        this.projectId = projectId;
        this.capabilities = capabilities != null ? capabilities : List.of("console", "error");
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.heartbeatTimeoutMs = heartbeatTimeoutMs;
        this.backoffInitialMs = backoffInitialMs;
        this.backoffMaxMs = backoffMaxMs;
        this.bufferLimit = bufferLimit;
    }

    public void onControl(java.util.function.Function<Map<String, Object>, Object> handler) {
        this.controlFn = handler;
    }

    public void sendConsole(String level, String message) {
        enqueue(Map.of(
            "type", "console",
            "level", level,
            "message", message,
            "timestamp", nowMs()
        ));
    }

    public void sendError(String message) {
        enqueue(Map.of(
            "type", "error",
            "message", message,
            "timestamp", nowMs()
        ));
    }

    /**
     * Start the client loop (non-blocking). Call stop() to end.
     */
    public void start() {
        if (running.getAndSet(true)) return;
        scheduler = Executors.newScheduledThreadPool(2, r -> {
            Thread t = new Thread(r, "code-bridge-java");
            t.setDaemon(true);
            return t;
        });

        scheduler.execute(() -> {
            int delay = backoffInitialMs;
            while (running.get()) {
                try {
                    connectOnce();
                    delay = backoffInitialMs;
                    runReadLoop();
                } catch (Exception e) {
                // keep loop running; errors are swallowed
            }
                cleanupSocket();
                if (!running.get()) break;
                int sleep = jitter(delay, backoffMaxMs);
                try { Thread.sleep(sleep); } catch (InterruptedException ignored) {}
                delay = Math.min(delay * 2, backoffMaxMs);
            }
        });
    }

    public void stop() {
        running.set(false);
        cleanupSocket();
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
    }

    private void connectOnce() throws Exception {
        CompletableFuture<Void> ready = new CompletableFuture<>();
        WebSocket.Builder builder = httpClient.newWebSocketBuilder();
        try {
            ws = builder.connectTimeout(Duration.ofSeconds(10))
                .buildAsync(URI.create(url), new Listener() {
                @Override
                public void onOpen(WebSocket webSocket) {
                    // send auth
                    sendRaw(webSocket, Map.of(
                        "type", "auth",
                        "secret", secret,
                        "role", "bridge"
                    ));
                    webSocket.request(1);
                }

                @Override
                public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                    handleIncoming(data.toString());
                    webSocket.request(1);
                    return null;
                }

                @Override
                public CompletionStage<?> onBinary(WebSocket webSocket, ByteBuffer data, boolean last) {
                    webSocket.request(1);
                    return null;
                }

                @Override
                public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
                    connected.set(false);
                    authed.set(false);
                    helloSent.set(false);
                    return Listener.super.onClose(webSocket, statusCode, reason);
                }

                @Override
                public void onError(WebSocket webSocket, Throwable error) {
                    connected.set(false);
                    error.printStackTrace(System.err);
                    if (authFuture != null && !authFuture.isDone()) {
                        authFuture.completeExceptionally(error);
                    }
                }
            }).join();
        } catch (Exception e) {
            throw new RuntimeException("ws connect failed: " + e.getMessage(), e);
        }

        // wait for auth_success
        authFuture = new CompletableFuture<>();
        boolean authed = false;
        try {
            authFuture.get(heartbeatTimeoutMs, TimeUnit.MILLISECONDS);
            authed = true;
        } catch (Exception ignored) {
        }
        if (!authed || !connected.get()) {
            throw new RuntimeException("auth_success timeout");
        }

        sendHelloAndFlush();
    }

    private void handleIncoming(String text) {
        Type type = new TypeToken<Map<String, Object>>() {}.getType();
        Map<String, Object> msg;
        try {
            msg = gson.fromJson(text, type);
        } catch (Exception e) {
            return;
        }
        if (msg == null) return;
        String mtype = (String) msg.get("type");
        switch (mtype) {
            case "auth_success":
                connected.set(true);
                authed.set(true);
                lastPongAt.set(nowMs());
                if (authFuture != null && !authFuture.isDone()) {
                    authFuture.complete(null);
                }
                sendHelloAndFlush();
                break;
            case "hello_ack":
                // ignore
                break;
            case "ping":
                sendRaw(Map.of("type", "pong"));
                break;
            case "pong":
                lastPongAt.set(nowMs());
                break;
            case "control_request":
                handleControl(msg);
                break;
            default:
                break;
        }
    }

    private void runReadLoop() throws Exception {
        while (running.get() && ws != null && !ws.isOutputClosed()) {
            try {
                Thread.sleep(25);
            } catch (InterruptedException ie) {
                break;
            }
        }
    }

    private void startHeartbeat() {
        lastPongAt.set(nowMs());
        cancelHeartbeat();
        heartbeatTask = scheduler.scheduleAtFixedRate(() -> sendRaw(Map.of("type", "ping")),
            heartbeatIntervalMs, heartbeatIntervalMs, TimeUnit.MILLISECONDS);

        timeoutTask = scheduler.scheduleAtFixedRate(() -> {
            long since = nowMs() - lastPongAt.get();
            if (since > heartbeatTimeoutMs) {
                try {
                    if (ws != null) ws.sendClose(WebSocket.NORMAL_CLOSURE, "timeout");
                } catch (Exception ignored) {}
            }
        }, heartbeatTimeoutMs, heartbeatIntervalMs, TimeUnit.MILLISECONDS);
    }

    private void cancelHeartbeat() {
        if (heartbeatTask != null) heartbeatTask.cancel(true);
        if (timeoutTask != null) timeoutTask.cancel(true);
    }

    private void handleControl(Map<String, Object> msg) {
        if (controlFn == null) return;
        Object id = msg.get("id");
        try {
            Object result = controlFn.apply(msg);
            enqueue(Map.of(
                "type", "control_result",
                "id", id,
                "ok", true,
                "result", result
            ));
        } catch (Exception e) {
            enqueue(Map.of(
                "type", "control_result",
                "id", id,
                "ok", false,
                "error", Map.of("message", e.getMessage())
            ));
        }
    }

    private void enqueue(Map<String, Object> payload) {
        if (connected.get() && ws != null && !ws.isOutputClosed()) {
            sendRaw(payload);
            return;
        }
        if (buffer.size() >= bufferLimit) {
            buffer.pollFirst();
            dropped++;
        }
        buffer.addLast(payload);
    }

    private void flushBuffer() {
        if (ws == null || ws.isOutputClosed()) return;
        while (!buffer.isEmpty()) {
            sendRaw(buffer.pollFirst());
        }
        if (dropped > 0) {
            sendRaw(Map.of(
                "type", "info",
                "level", "info",
                "message", "bridge buffered drop count=" + dropped
            ));
            dropped = 0;
        }
    }

    private synchronized void sendRaw(Map<String, Object> payload) {
        sendRaw(ws, payload);
    }

    private synchronized void sendRaw(WebSocket target, Map<String, Object> payload) {
        if (target == null || target.isOutputClosed()) return;
        String json = gson.toJson(payload);
        target.sendText(json, true);
    }

    private void sendHelloAndFlush() {
        if (helloSent.getAndSet(true)) return;
        var hello = new java.util.HashMap<String, Object>();
        hello.put("type", "hello");
        hello.put("capabilities", capabilities);
        hello.put("platform", "java");
        if (projectId != null) {
            hello.put("projectId", projectId);
        }
        hello.put("protocol", PROTOCOL_VERSION);
        sendRaw(hello);
        flushBuffer();
        startHeartbeat();
    }

    private void cleanupSocket() {
        cancelHeartbeat();
        if (ws != null) {
            try { ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye"); } catch (Exception ignored) {}
        }
        ws = null;
        connected.set(false);
        authed.set(false);
        helloSent.set(false);
    }

    private int jitter(int baseMs, int maxMs) {
        double factor = 1.0 + (random.nextDouble() * 0.5); // 1.0 - 1.5
        return Math.min((int) (baseMs * factor), maxMs);
    }

    private long nowMs() {
        return System.currentTimeMillis();
    }
}

package com.jestevery.codebridge;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocket.Builder;
import java.net.http.WebSocket.Listener;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public class CodeBridgeClient {
    public static final int PROTOCOL_VERSION = 2;
    private final String url;
    private final String secret;
    private final String projectId;
    private final List<String> capabilities;
    private WebSocket ws;

    public CodeBridgeClient(String url, String secret, String projectId, List<String> capabilities) {
        this.url = url;
        this.secret = secret;
        this.projectId = projectId;
        this.capabilities = capabilities == null || capabilities.isEmpty() ? List.of("console", "error") : capabilities;
    }

    public CompletableFuture<Void> start() {
        HttpClient client = HttpClient.newHttpClient();
        Builder builder = client.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .header("X-Bridge-Secret", secret);
        return builder.buildAsync(URI.create(url), new Listener() {})
                .thenCompose(ws -> {
                    this.ws = ws;
                    sendJson("{\"type\":\"auth\",\"secret\":\"" + secret + "\",\"role\":\"bridge\"}");
                    sendJson(String.format("{\"type\":\"hello\",\"capabilities\":[\"console\",\"error\"],\"platform\":\"java\",\"projectId\":\"%s\",\"protocol\":%d}", projectId == null ? "" : projectId, PROTOCOL_VERSION));
                    return CompletableFuture.completedFuture(null);
                });
    }

    public void stop() {
        if (ws != null) {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "bye");
        }
    }

    public void sendConsole(String level, String message) {
        sendJson(String.format("{\"type\":\"console\",\"level\":\"%s\",\"message\":\"%s\",\"timestamp\":%d}", level, escape(message), System.currentTimeMillis()));
    }

    public void sendError(String message) {
        sendJson(String.format("{\"type\":\"error\",\"message\":\"%s\",\"timestamp\":%d}", escape(message), System.currentTimeMillis()));
    }

    private void sendJson(String json) {
        if (ws != null) {
            ws.sendText(json, true);
        }
    }

    private String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}

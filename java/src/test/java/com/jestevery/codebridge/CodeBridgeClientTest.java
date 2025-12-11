package com.jestevery.codebridge;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

public class CodeBridgeClientTest {

    @Test
    public void handshakeBufferingAndDropNotice() throws Exception {
        int port = 9891;
        try (ProtocolHostProcess host = new ProtocolHostProcess(port, true, false, false)) {
            CodeBridgeClient client = new CodeBridgeClient(
                "ws://127.0.0.1:" + port,
                "dev-secret",
                null,
                List.of("console", "error"),
                15000, 30000, 1000, 30000,
                3);

            for (int i = 0; i < 5; i++) {
                client.sendConsole("info", "m" + i);
            }

            client.start();
            Thread.sleep(1500);
            client.stop();

            List<Map<String, Object>> events = host.readEvents(6000);
            var recv = events.stream().filter(e -> e.get("msg") != null).map(e -> (Map<String, Object>) e.get("msg")).toList();
            assertTrue(recv.size() >= 2, "no frames received");
            boolean authSeen = false;
            boolean helloSeen = false;
            for (Map<String,Object> m : recv) {
                if (!authSeen && "auth".equals(m.get("type"))) authSeen = true;
                if (authSeen && "hello".equals(m.get("type"))) { helloSeen = true; break; }
            }
            assertTrue(authSeen, () -> "auth not seen; events=" + events + " logs=" + host.logs());
            assertTrue(helloSeen, () -> "hello not seen after auth; events=" + events + " logs=" + host.logs());

            var consoles = recv.stream().filter(m -> "console".equals(m.get("type"))).map(m -> (String) m.get("message")).toList();
            assertEquals(List.of("m2", "m3", "m4"), consoles);

            boolean dropSeen = recv.stream().anyMatch(m -> "info".equals(m.get("type")) && ((String) m.get("message")).contains("drop count=2"));
            assertTrue(dropSeen);
        }
    }

    @Test
    public void controlRoundTrip() throws Exception {
        int port = 9892;
        try (ProtocolHostProcess host = new ProtocolHostProcess(port, true, true, false)) {
            CodeBridgeClient client = new CodeBridgeClient(
                "ws://127.0.0.1:" + port,
                "dev-secret",
                null,
                List.of("console", "error", "control"));

            client.onControl(msg -> {
                if ("echo".equals(msg.get("action"))) {
                    return Map.of("echo", msg.get("args"));
                }
                throw new RuntimeException("unknown action");
            });

            client.start();
            Thread.sleep(1500);
            client.stop();

            List<Map<String, Object>> events = host.readEvents(4000);
            boolean ok = events.stream().anyMatch(e -> {
                if (!"control_result".equals(e.get("event"))) return false;
                Map<?, ?> msg = (Map<?, ?>) e.get("msg");
                Object okVal = msg.get("ok");
                return okVal instanceof Boolean && (Boolean) okVal;
            });
            assertTrue(ok, "expected control_result ok");
        }
    }

    @Test
    public void heartbeatReconnectProducesMultipleHellos() throws Exception {
        int port = 9893;
        try (ProtocolHostProcess host = new ProtocolHostProcess(port, false, false, true)) {
            CodeBridgeClient client = new CodeBridgeClient(
                "ws://127.0.0.1:" + port,
                "dev-secret",
                null,
                List.of("console", "error"),
                50, 120, 50, 200,
                10);

            client.start();
            Thread.sleep(3000);
            client.stop();

            List<Map<String, Object>> events = host.readEvents(5000);
            var recv = events.stream().filter(e -> e.get("msg") != null).map(e -> (Map<String, Object>) e.get("msg")).toList();
            long hellos = recv.stream().filter(m -> "hello".equals(m.get("type"))).count();
            assertTrue(hellos >= 2, "expected reconnect to send multiple hellos");
        }
    }
}

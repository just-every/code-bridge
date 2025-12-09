package com.jestevery.codebridge;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;

public class ClientTest {
    @Test
    public void handshake() throws Exception {
        String url = System.getenv().getOrDefault("CODE_BRIDGE_URL", "ws://localhost:9877");
        String secret = System.getenv().getOrDefault("CODE_BRIDGE_SECRET", "dev-secret");
        CodeBridgeClient client = new CodeBridgeClient(url, secret, "java-test", List.of("console", "error"));
        client.start().get();
        client.sendConsole("info", "java smoke");
        client.stop();
        assertTrue(true);
    }
}

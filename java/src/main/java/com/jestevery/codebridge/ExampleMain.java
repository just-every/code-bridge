package com.jestevery.codebridge;

import java.util.List;

public class ExampleMain {
    public static void main(String[] args) throws Exception {
        String url = System.getenv().getOrDefault("CODE_BRIDGE_URL", "ws://localhost:9877");
        String secret = System.getenv().getOrDefault("CODE_BRIDGE_SECRET", "dev-secret");
        CodeBridgeClient client = new CodeBridgeClient(url, secret, "java-example", List.of("console", "error"));
        client.start();
        client.sendConsole("info", "hello from java");
        client.sendError("sample error");
        Thread.sleep(500);
        client.stop();
    }
}

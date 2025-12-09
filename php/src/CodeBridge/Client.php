<?php

namespace CodeBridge;

use WebSocket\Client as WSClient;

class BridgeConfig {
    public string $url;
    public string $secret;
    public ?string $projectId;
    public array $capabilities;

    public function __construct(string $url, string $secret, ?string $projectId = null, array $capabilities = ['console', 'error']) {
        $this->url = $url;
        $this->secret = $secret;
        $this->projectId = $projectId;
        $this->capabilities = $capabilities;
    }
}

class Client {
    private WSClient $ws;
    private BridgeConfig $config;
    private int $heartbeatIntervalMs = 15000;
    private int $heartbeatTimeoutMs = 30000;

    public function __construct(BridgeConfig $config) {
        $this->config = $config;
    }

    public function start(): void {
        $this->ws = new WSClient($this->config->url, ['headers' => ['X-Bridge-Secret: ' . $this->config->secret]]);
        $this->send(['type' => 'auth', 'secret' => $this->config->secret, 'role' => 'bridge']);
        $this->send([
            'type' => 'hello',
            'capabilities' => $this->config->capabilities,
            'platform' => 'php',
            'projectId' => $this->config->projectId,
            'protocol' => 2,
        ]);
    }

    public function stop(): void {
        if (isset($this->ws)) {
            $this->ws->close();
        }
    }

    public function sendConsole(string $message, string $level = 'info'): void {
        $this->send([
            'type' => 'console',
            'level' => $level,
            'message' => $message,
            'timestamp' => $this->nowMs(),
        ]);
    }

    public function sendError(string $message): void {
        $this->send([
            'type' => 'error',
            'message' => $message,
            'timestamp' => $this->nowMs(),
        ]);
    }

    private function send(array $payload): void {
        $this->ws->send(json_encode($payload));
    }

    private function nowMs(): int {
        return (int) round(microtime(true) * 1000);
    }
}

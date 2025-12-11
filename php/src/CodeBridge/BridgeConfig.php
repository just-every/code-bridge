<?php

namespace CodeBridge;

class BridgeConfig {
    public string $url;
    public string $secret;
    public ?string $projectId;
    public array $capabilities;
    public int $heartbeatIntervalMs;
    public int $heartbeatTimeoutMs;
    public int $backoffInitialMs;
    public int $backoffMaxMs;
    public int $bufferLimit;

    public function __construct(
        string $url,
        string $secret,
        ?string $projectId = null,
        array $capabilities = ['console', 'error', 'navigation', 'network'],
        int $heartbeatIntervalMs = 15000,
        int $heartbeatTimeoutMs = 30000,
        int $backoffInitialMs = 1000,
        int $backoffMaxMs = 30000,
        int $bufferLimit = 200
    ) {
        $this->url = $url;
        $this->secret = $secret;
        $this->projectId = $projectId;
        $this->capabilities = $capabilities;
        $this->heartbeatIntervalMs = $heartbeatIntervalMs;
        $this->heartbeatTimeoutMs = $heartbeatTimeoutMs;
        $this->backoffInitialMs = $backoffInitialMs;
        $this->backoffMaxMs = $backoffMaxMs;
        $this->bufferLimit = $bufferLimit;
    }
}

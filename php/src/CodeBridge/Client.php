<?php

namespace CodeBridge;

use WebSocket\Client as WSClient;
use WebSocket\ConnectionException;

class Client {
    private ?WSClient $ws = null;
    private BridgeConfig $config;
    private bool $running = false;
    private bool $connected = false;
    private bool $authed = false;
    private array $buffer = [];
    private int $dropped = 0;
    private $controlHandler = null;

    public function __construct(BridgeConfig $config) {
        $this->config = $config;
    }

    /**
     * Start the bridge loop (blocking).
     */
    public function start(): void {
        if ($this->running) {
            return;
        }
        $this->running = true;
        $delay = $this->config->backoffInitialMs;

        while ($this->running) {
            try {
                $this->connectOnce();
                $delay = $this->config->backoffInitialMs;
                $this->runLoop();
            } catch (\Throwable $e) {
                // swallow, drop to reconnect with backoff
            }

            $this->closeSocket();
            if (!$this->running) {
                break;
            }
            $sleepMs = $this->jitter($delay, $this->config->backoffMaxMs);
            usleep($sleepMs * 1000);
            $delay = min($delay * 2, $this->config->backoffMaxMs);
        }
    }

    public function stop(): void {
        $this->running = false;
        $this->closeSocket();
    }

    public function sendConsole(string $message, string $level = 'info'): void {
        $this->enqueue([
            'type' => 'console',
            'level' => $level,
            'message' => $message,
            'timestamp' => $this->nowMs(),
        ]);
    }

    public function sendError(string $message): void {
        $this->enqueue([
            'type' => 'error',
            'message' => $message,
            'timestamp' => $this->nowMs(),
        ]);
    }

    public function onControl(callable $handler): void {
        $this->controlHandler = $handler;
    }

    private function connectOnce(): void {
        $this->authed = false;
        $this->connected = false;
        $this->ws = new WSClient($this->config->url, [
            'headers' => ['X-Bridge-Secret: ' . $this->config->secret],
            // short timeout so heartbeat timeout can fire
            'timeout' => 0.5,
        ]);

        $this->sendRaw(['type' => 'auth', 'secret' => $this->config->secret, 'role' => 'bridge']);
        $this->waitForAuthSuccess();

        $this->sendRaw([
            'type' => 'hello',
            'capabilities' => $this->config->capabilities,
            'platform' => 'php',
            'projectId' => $this->config->projectId,
            'protocol' => 2,
        ]);

        $this->connected = true;
        $this->flushBuffer();
    }

    private function runLoop(): void {
        $nextPing = $this->nowMs() + $this->config->heartbeatIntervalMs;
        $pongDeadline = $this->nowMs() + $this->config->heartbeatTimeoutMs;

        while ($this->running && $this->ws) {
            $now = $this->nowMs();

            if ($now >= $nextPing) {
                $this->sendRaw(['type' => 'ping']);
                $nextPing = $now + $this->config->heartbeatIntervalMs;
            }

            if ($now >= $pongDeadline) {
                throw new \RuntimeException('heartbeat timeout');
            }

            $msg = $this->recvOnce();
            if ($msg === null) {
                continue;
            }

            $type = $msg['type'] ?? null;
            switch ($type) {
                case 'pong':
                    $pongDeadline = $this->nowMs() + $this->config->heartbeatTimeoutMs;
                    break;
                case 'ping':
                    $this->sendRaw(['type' => 'pong']);
                    break;
                case 'control_request':
                    $this->handleControl($msg);
                    break;
                case 'auth_success':
                    // ignore duplicate
                    break;
                default:
                    // ignore other messages for now
                    break;
            }
        }
    }

    private function recvOnce(): ?array {
        if (!$this->ws) {
            return null;
        }
        try {
            $data = $this->ws->receive();
            if ($data === null) {
                return null;
            }
            $decoded = json_decode($data, true);
            return is_array($decoded) ? $decoded : null;
        } catch (ConnectionException $e) {
            // timeout or closed
            return null;
        }
    }

    private function enqueue(array $payload): void {
        if ($this->connected && $this->ws) {
            $this->sendRaw($payload);
            return;
        }

        if (count($this->buffer) >= $this->config->bufferLimit) {
            array_shift($this->buffer);
            $this->dropped += 1;
        }
        $this->buffer[] = $payload;
    }

    private function flushBuffer(): void {
        if (!$this->ws) {
            return;
        }
        foreach ($this->buffer as $payload) {
            $this->sendRaw($payload);
        }
        $this->buffer = [];
        if ($this->dropped > 0) {
            $this->sendRaw([
                'type' => 'info',
                'level' => 'info',
                'message' => 'bridge buffered drop count=' . $this->dropped,
            ]);
            $this->dropped = 0;
        }
    }

    private function waitForAuthSuccess(): void {
        $deadline = $this->nowMs() + $this->config->heartbeatTimeoutMs;
        while ($this->nowMs() < $deadline) {
            $msg = $this->recvOnce();
            if (!$msg) {
                continue;
            }
            $type = $msg['type'] ?? null;
            if ($type === 'auth_success') {
                $this->authed = true;
                return;
            }
            if ($type === 'ping') {
                $this->sendRaw(['type' => 'pong']);
            }
            if ($type === 'control_request') {
                $this->handleControl($msg);
            }
        }
        throw new \RuntimeException('auth_success timeout');
    }

    private function handleControl(array $msg): void {
        if (!$this->controlHandler) {
            return;
        }
        $id = $msg['id'] ?? null;
        try {
            $result = call_user_func($this->controlHandler, $msg);
            $this->enqueue(['type' => 'control_result', 'id' => $id, 'ok' => true, 'result' => $result]);
        } catch (\Throwable $e) {
            $this->enqueue([
                'type' => 'control_result',
                'id' => $id,
                'ok' => false,
                'error' => ['message' => $e->getMessage()],
            ]);
        }
    }

    private function sendRaw(array $payload): void {
        if (!$this->ws) {
            return;
        }
        $this->ws->send(json_encode($payload));
    }

    private function nowMs(): int {
        return (int) round(microtime(true) * 1000);
    }

    private function jitter(int $baseMs, int $maxMs): int {
        $factor = mt_rand(1000, 1500) / 1000; // 1.0-1.5
        return min((int)($baseMs * $factor), $maxMs);
    }

    private function closeSocket(): void {
        if ($this->ws) {
            try {
                $this->ws->close();
            } catch (\Throwable $e) {
                // ignore
            }
        }
        $this->ws = null;
        $this->connected = false;
        $this->authed = false;
    }
}

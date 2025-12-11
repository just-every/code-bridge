<?php

use CodeBridge\BridgeConfig;
use CodeBridge\Client;
use PHPUnit\Framework\TestCase;

class ClientTest extends TestCase
{
    protected function setUp(): void
    {
        if (!function_exists('pcntl_fork')) {
            $this->markTestSkipped('pcntl extension is required for these tests');
        }
    }

    private function spawnHost(int $port, bool $autoPong = true, bool $sendControl = false): array
    {
        $script = __DIR__ . '/ProtocolHost.js';
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $env = getenv();
        $env['PORT'] = (string)$port;
        $env['SECRET'] = 'dev-secret';
        $env['AUTO_PONG'] = $autoPong ? 'true' : 'false';
        $env['SEND_CONTROL'] = $sendControl ? 'true' : 'false';

        $proc = proc_open("node {$script}", $descriptors, $pipes, dirname($script), $env);
        if (!is_resource($proc)) {
            $this->fail('failed to spawn protocol host');
        }
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        return [$proc, $pipes];
    }

    private function readEvents($pipe, float $timeout = 2.0): array
    {
        $events = [];
        $deadline = microtime(true) + $timeout;
        while (microtime(true) < $deadline) {
            $data = stream_get_contents($pipe);
            if ($data !== false && $data !== '') {
                foreach (explode("\n", $data) as $line) {
                    if (trim($line) === '') {
                        continue;
                    }
                    $obj = json_decode($line, true);
                    if (is_array($obj)) {
                        $events[] = $obj;
                    }
                }
            } else {
                usleep(50_000);
            }
        }
        return $events;
    }

    private function forkClient(Client $client, int $runSeconds): int
    {
        $pid = pcntl_fork();
        if ($pid === -1) {
            $this->fail('fork failed');
        }
        if ($pid === 0) {
            pcntl_async_signals(true);
            pcntl_signal(SIGALRM, function () use ($client) {
                $client->stop();
            });
            pcntl_alarm($runSeconds);
            $client->start();
            exit(0);
        }
        return $pid;
    }

    private function waitForChild(int $pid, int $timeoutSeconds = 5): void
    {
        $start = time();
        while (true) {
            $res = pcntl_waitpid($pid, $status, WNOHANG);
            if ($res === -1 || $res > 0) {
                return;
            }
            if ((time() - $start) >= $timeoutSeconds) {
                posix_kill($pid, SIGTERM);
                pcntl_waitpid($pid, $status);
                return;
            }
            usleep(100_000);
        }
    }

    public function testHandshakeBufferingAndDropNotice(): void
    {
        $port = 9891;
        [$proc, $pipes] = $this->spawnHost($port);
        sleep(1); // allow server to start

        $cfg = new BridgeConfig("ws://127.0.0.1:{$port}", 'dev-secret', null, ['console', 'error'], 15000, 30000, 1000, 30000, 3);
        $client = new Client($cfg);

        for ($i = 0; $i < 5; $i++) {
            $client->sendConsole("m{$i}");
        }

        $pid = $this->forkClient($client, 2);
        $this->waitForChild($pid, 5);

        $events = $this->readEvents($pipes[1]);
        proc_terminate($proc);

        $recv = array_values(array_filter(array_map(fn($e) => $e['msg'] ?? null, $events)));
        $this->assertEquals('auth', $recv[0]['type'] ?? null);
        $this->assertEquals('hello', $recv[1]['type'] ?? null);

        $consoles = array_values(array_filter($recv, fn($m) => ($m['type'] ?? null) === 'console'));
        $messages = array_map(fn($m) => $m['message'] ?? null, $consoles);
        $this->assertEquals(['m2', 'm3', 'm4'], $messages);

        $drop = null;
        foreach ($recv as $m) {
            if (($m['type'] ?? null) === 'info') {
                $drop = $m;
                break;
            }
        }
        $this->assertNotNull($drop);
        $this->assertStringContainsString('drop count=2', $drop['message'] ?? '');
    }

    public function testControlRoundTrip(): void
    {
        $port = 9892;
        [$proc, $pipes] = $this->spawnHost($port, true, true);
        sleep(1);

        $cfg = new BridgeConfig("ws://127.0.0.1:{$port}", 'dev-secret');
        $client = new Client($cfg);
        $client->onControl(function ($msg) {
            if (($msg['action'] ?? null) === 'echo') {
                return ['echo' => $msg['args'] ?? []];
            }
            throw new RuntimeException('unknown action');
        });

        $pid = $this->forkClient($client, 2);
        $this->waitForChild($pid, 5);

        $events = $this->readEvents($pipes[1], 3.0);
        proc_terminate($proc);

        $controlResult = null;
        foreach ($events as $e) {
            if (($e['event'] ?? null) === 'control_result') {
                $controlResult = $e['msg'] ?? null;
                break;
            }
        }
        $this->assertNotNull($controlResult);
        $this->assertTrue($controlResult['ok'] ?? false);
    }

    public function testHeartbeatReconnect(): void
    {
        $port = 9893;
        [$proc, $pipes] = $this->spawnHost($port, false, false);
        sleep(1);

        $cfg = new BridgeConfig("ws://127.0.0.1:{$port}", 'dev-secret', null, ['console', 'error'], 50, 120, 50, 200, 10);
        $client = new Client($cfg);

        $pid = $this->forkClient($client, 3);
        $this->waitForChild($pid, 6);

        $events = $this->readEvents($pipes[1], 3.0);
        proc_terminate($proc);

        $recv = array_values(array_filter(array_map(fn($e) => $e['msg'] ?? null, $events)));
        $hellos = array_values(array_filter($recv, fn($m) => ($m['type'] ?? null) === 'hello'));
        $this->assertGreaterThanOrEqual(2, count($hellos));
    }
}

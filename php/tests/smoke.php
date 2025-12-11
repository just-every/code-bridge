<?php
require __DIR__ . '/../vendor/autoload.php';

use CodeBridge\BridgeConfig;
use CodeBridge\Client;

$url = getenv('CODE_BRIDGE_URL') ?: 'ws://localhost:9877';
$secret = getenv('CODE_BRIDGE_SECRET') ?: 'dev-secret';

$client = new Client(new BridgeConfig($url, $secret, 'php-test'));
$client->sendConsole('smoke test console');
$client->sendError('smoke test error');

if (!function_exists('pcntl_fork')) {
  echo "pcntl not available; skipping php smoke\n";
  exit(0);
}

$pid = pcntl_fork();
if ($pid === -1) {
  fwrite(STDERR, "fork failed\n");
  exit(1);
}

if ($pid === 0) {
  pcntl_async_signals(true);
  pcntl_signal(SIGALRM, function () use ($client) {
    $client->stop();
  });
  pcntl_alarm(4);
  $client->start();
  exit(0);
}

pcntl_waitpid($pid, $status);
echo "php smoke ok\n";

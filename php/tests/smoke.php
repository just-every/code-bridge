<?php
require __DIR__ . '/../vendor/autoload.php';

use CodeBridge\BridgeConfig;
use CodeBridge\Client;

$url = getenv('CODE_BRIDGE_URL') ?: 'ws://localhost:9877';
$secret = getenv('CODE_BRIDGE_SECRET') ?: 'dev-secret';

$client = new Client(new BridgeConfig($url, $secret, 'php-test'));
$client->start();
$client->sendConsole('smoke test console');
$client->sendError('smoke test error');
$client->stop();
echo "php smoke ok\n";

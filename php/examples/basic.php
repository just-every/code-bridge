<?php

require __DIR__ . '/../vendor/autoload.php';

use CodeBridge\BridgeConfig;
use CodeBridge\Client;

$url = getenv('CODE_BRIDGE_URL') ?: 'ws://localhost:9877';
$secret = getenv('CODE_BRIDGE_SECRET') ?: 'dev-secret';

$client = new Client(new BridgeConfig($url, $secret, 'php-example'));
$client->start();
$client->sendConsole('hello from php');
$client->sendError('sample error');
$client->stop();

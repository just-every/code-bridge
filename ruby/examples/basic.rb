#!/usr/bin/env ruby
require_relative '../lib/code_bridge_client'

url = ENV.fetch('CODE_BRIDGE_URL', 'ws://localhost:9877')
secret = ENV.fetch('CODE_BRIDGE_SECRET', 'dev-secret')

client = CodeBridge::Client.new(url: url, secret: secret, project_id: 'ruby-example')
client.start
client.send_console('hello from ruby')
client.send_error('sample error')
sleep 0.5
client.stop

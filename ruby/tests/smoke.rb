require_relative '../lib/code_bridge_client'

url = ENV.fetch('CODE_BRIDGE_URL', 'ws://localhost:9877')
secret = ENV.fetch('CODE_BRIDGE_SECRET', 'dev-secret')

client = CodeBridge::Client.new(
  url: url,
  secret: secret,
  project_id: 'ruby-test',
  heartbeat_interval: 0.1,
  heartbeat_timeout: 0.2,
  backoff_initial: 0.05,
  backoff_max: 0.2
)
client.start
client.send_console('ruby smoke', level: 'info')
client.send_error('ruby error')
sleep 0.4
client.stop
puts 'ruby smoke ok'

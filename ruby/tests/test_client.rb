require 'minitest/autorun'
require 'open3'
require 'json'
require_relative '../lib/code_bridge_client'

HOST_JS = File.expand_path('protocol_host.js', __dir__)

def start_host(env = {})
  cmd_env = { 'PORT' => (env[:port] || 9888).to_s, 'SECRET' => env[:secret] || 'dev-secret' }
  cmd_env['AUTO_PONG'] = env.key?(:auto_pong) ? env[:auto_pong].to_s : 'true'
  cmd_env['SEND_CONTROL'] = env[:send_control] ? 'true' : 'false'
  r, w = IO.pipe
  pid = Process.spawn(cmd_env, 'node', HOST_JS, out: w, err: w)
  w.close
  return pid, r
end

def stop_host(pid)
  Process.kill('TERM', pid) rescue nil
  Process.wait(pid) rescue nil
end

def read_events(io, timeout: 2)
  deadline = Time.now + timeout
  lines = []
  while Time.now < deadline
    if IO.select([io], nil, nil, 0.05)
      line = io.gets
      break unless line
      lines << JSON.parse(line) rescue nil
    end
  end
  lines.compact
end

class RubyClientParityTest < Minitest::Test
  def test_handshake_and_buffering_with_drop_notice
    pid, io = start_host(port: 9889, auto_pong: true)
    url = 'ws://127.0.0.1:9889'
    client = CodeBridge::Client.new(url: url, secret: 'dev-secret', buffer_limit: 3)

    # enqueue before connection
    %w[m0 m1 m2 m3 m4].each { |m| client.send_console(m) }

    client.start
    sleep 0.5
    client.stop

    events = read_events(io)
    stop_host(pid)

    types = events.select { |e| e['event'] == 'recv' }.map { |e| e['msg']['type'] }
    assert_equal 'auth', events.find { |e| e['event'] == 'recv' }['msg']['type']
    assert_equal 'hello', events.select { |e| e['event'] == 'recv' }[1]['msg']['type']

    consoles = events.select { |e| e['event'] == 'recv' && e['msg']['type'] == 'console' }.map { |e| e['msg']['message'] }
    assert_equal %w[m2 m3 m4], consoles

    drop = events.find { |e| e['event'] == 'recv' && e['msg']['type'] == 'info' }
    refute_nil drop
    assert_includes drop['msg']['message'], 'drop count=2'
  end

  def test_heartbeat_timeout_triggers_reconnect
    pid, io = start_host(port: 9890, auto_pong: false)
    url = 'ws://127.0.0.1:9890'
    client = CodeBridge::Client.new(url: url, secret: 'dev-secret', heartbeat_interval: 0.05, heartbeat_timeout: 0.12, backoff_initial: 0.05, backoff_max: 0.2)

    client.start
    sleep 0.6
    client.stop

    events = read_events(io)
    stop_host(pid)

    opens = events.count { |e| e['event'] == 'open' }
    assert_operator opens, :>=, 2
  end

  def test_control_request_round_trip
    pid, io = start_host(port: 9891, auto_pong: true, send_control: true)
    url = 'ws://127.0.0.1:9891'
    client = CodeBridge::Client.new(url: url, secret: 'dev-secret')
    client.on_control do |msg|
      if msg['action'] == 'echo'
        { echo: msg['args'] }
      else
        raise 'boom'
      end
    end

    client.start
    sleep 0.6
    client.stop

    events = read_events(io)
    stop_host(pid)

    result = events.find { |e| e['event'] == 'control_result' && e['msg']['id'] == 'c1' }
    refute_nil result
    assert_equal true, result['msg']['ok']
    assert_equal({ 'echo' => { 'value' => 1 } }, result['msg']['result'])
  end
end


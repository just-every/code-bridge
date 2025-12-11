require 'websocket-client-simple'
require 'json'
require 'thread'
require 'securerandom'

module CodeBridge
  PROTOCOL_VERSION = 2
  HEARTBEAT_INTERVAL = 15
  HEARTBEAT_TIMEOUT = 30
  BACKOFF_INITIAL = 1
  BACKOFF_MAX = 30
  BUFFER_LIMIT = 200

  class Client
    def initialize(url:, secret:, project_id: nil, capabilities: ['console', 'error'],
                   heartbeat_interval: HEARTBEAT_INTERVAL, heartbeat_timeout: HEARTBEAT_TIMEOUT,
                   backoff_initial: BACKOFF_INITIAL, backoff_max: BACKOFF_MAX,
                   buffer_limit: BUFFER_LIMIT)
      @url = url
      @secret = secret
      @project_id = project_id
      @capabilities = capabilities
      @heartbeat_interval = heartbeat_interval
      @heartbeat_timeout = heartbeat_timeout
      @backoff_initial = backoff_initial
      @backoff_max = backoff_max
      @buffer_limit = buffer_limit
      @mutex = Mutex.new
      @connected_cv = ConditionVariable.new
      @connected = false
      @authed = false
      @auth_cv = ConditionVariable.new
      @buffer = []
      @dropped = 0
      @control_handler = nil
    end

    def start
      @stopped = false
      @connected = false
      @authed = false
      @backoff = @backoff_initial
      connect_with_retry
      wait_until_authed(timeout: @heartbeat_timeout)
    end

    def stop
      @heartbeat_thread&.kill
      @monitor_thread&.kill
      @ws&.close
      @mutex.synchronize do
        @connected = false
        @connected_cv.broadcast
      end
      @stopped = true
    end

    def send_console(message, level: 'info')
      enqueue(type: 'console', level: level, message: message, timestamp: now_ms)
    end

    def send_error(message)
      enqueue(type: 'error', message: message, timestamp: now_ms)
    end

    def on_control(&block)
      @control_handler = block
    end

    private

    def connect_with_retry
      Thread.new do
        until @stopped
          begin
            @mutex.synchronize { @authed = false }
            connect_once
            @backoff = @backoff_initial
            wait_until_disconnected
          rescue => e
            # swallow and retry with backoff
          end
          break if @stopped
          sleep jitter(@backoff)
          @backoff = [@backoff * 2, @backoff_max].min
        end
      end
    end

    def connect_once
      @ws = WebSocket::Client::Simple.connect(@url, headers: { 'X-Bridge-Secret' => @secret })
      client = self
      @ws.on(:open) { client.send(:mark_connected) }
      @ws.on(:message) { |msg| client.send(:handle_message, msg.data) }
      @ws.on(:close) { client.send(:handle_close) }
      wait_until_connected(timeout: @heartbeat_timeout)
      @last_pong = Time.now
      @mutex.synchronize { @authed = false }
      send_raw(type: 'auth', secret: @secret, role: 'bridge')
      wait_for_auth_success
      send_raw(type: 'hello', capabilities: @capabilities, platform: 'ruby', projectId: @project_id, protocol: PROTOCOL_VERSION)
      flush_buffer
      start_heartbeat
      start_monitor
    end

    def handle_message(data)
      begin
        parsed = JSON.parse(data)
      rescue
        return
      end
      case parsed['type']
      when 'ping'
        send_json(type: 'pong')
      when 'pong'
        @last_pong = Time.now
      when 'auth_success'
        mark_authed
      when 'control_request'
        handle_control_request(parsed)
      end
    end

    def handle_close
      @mutex.synchronize do
        @connected = false
        @authed = false
        @connected_cv.broadcast
      end
      @heartbeat_thread&.kill
      @monitor_thread&.kill
      # reconnect loop thread will notice disconnect and retry
    end

    def start_heartbeat
      @heartbeat_thread = Thread.new do
        loop do
          break if @stopped
          sleep @heartbeat_interval
          break if @stopped
          begin
            send_json(type: 'ping')
          rescue IOError
            break
          rescue StandardError
            break if @stopped
          end
        end
      end
    end

    def start_monitor
      @monitor_thread = Thread.new do
        loop do
          break if @stopped
          sleep 0.05
          if Time.now - @last_pong > @heartbeat_timeout
            @ws&.close
            break
          end
        end
      end
    end

    def send_json(hash)
      return unless wait_until_connected
      enqueue(hash)
    end

    def send_raw(hash)
      return unless @ws
      @ws.send(JSON.dump(hash))
    end

    def wait_until_connected(timeout: 5)
      deadline = Time.now + timeout
      @mutex.synchronize do
        until @connected
          remaining = deadline - Time.now
          return false if remaining <= 0
          @connected_cv.wait(@mutex, remaining)
        end
        true
      end
    end

    def mark_connected
      @mutex.synchronize do
        @connected = true
        @connected_cv.broadcast
      end
    end

    def mark_authed
      @mutex.synchronize do
        @authed = true
        @auth_cv.broadcast
      end
    end

    def wait_for_auth_success(timeout: nil)
      timeout ||= @heartbeat_timeout
      deadline = Time.now + timeout
      @mutex.synchronize do
        until @authed
          remaining = deadline - Time.now
          raise 'auth_success timeout' if remaining <= 0
          @auth_cv.wait(@mutex, remaining)
        end
      end
    end

    def wait_until_authed(timeout: 5)
      deadline = Time.now + timeout
      @mutex.synchronize do
        until @authed
          remaining = deadline - Time.now
          break if remaining <= 0
          @auth_cv.wait(@mutex, remaining)
        end
      end
    end

    def wait_until_disconnected
      @mutex.synchronize do
        @connected_cv.wait(@mutex, @heartbeat_timeout) if @connected
      end
    end

    def enqueue(hash)
      @mutex.synchronize do
        if @ws && @connected
          @ws.send(JSON.dump(hash))
          return
        end
        if @buffer.length >= @buffer_limit
          @buffer.shift
          @dropped += 1
        end
        @buffer << hash
      end
    end

    def flush_buffer
      pending = nil
      dropped = 0
      @mutex.synchronize do
        return unless @ws && @connected
        pending = @buffer.dup
        dropped = @dropped
        @buffer.clear
        @dropped = 0
      end
      pending.each { |ev| @ws.send(JSON.dump(ev)) }
      if dropped > 0
        @ws.send(JSON.dump(type: 'info', level: 'info', message: "bridge buffered drop count=#{dropped}"))
      end
    end

    def handle_control_request(msg)
      return unless @control_handler
      begin
        result = @control_handler.call(msg)
        resp = { type: 'control_result', id: msg['id'], ok: true, result: result }
      rescue => e
        resp = { type: 'control_result', id: msg['id'], ok: false, error: { message: e.message } }
      end
      enqueue(resp)
    end

    def jitter(base)
      base * (1.0 + rand * 0.5)
    end

    def now_ms
      (Time.now.to_f * 1000).to_i
    end
  end
end

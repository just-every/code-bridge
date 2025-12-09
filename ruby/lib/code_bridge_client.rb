require 'websocket-client-simple'
require 'json'
require 'thread'

module CodeBridge
  PROTOCOL_VERSION = 2
  HEARTBEAT_INTERVAL = 15
  HEARTBEAT_TIMEOUT = 30
  BACKOFF_INITIAL = 1
  BACKOFF_MAX = 30

  class Client
    def initialize(url:, secret:, project_id: nil, capabilities: ['console', 'error'],
                   heartbeat_interval: HEARTBEAT_INTERVAL, heartbeat_timeout: HEARTBEAT_TIMEOUT,
                   backoff_initial: BACKOFF_INITIAL, backoff_max: BACKOFF_MAX)
      @url = url
      @secret = secret
      @project_id = project_id
      @capabilities = capabilities
      @heartbeat_interval = heartbeat_interval
      @heartbeat_timeout = heartbeat_timeout
      @backoff_initial = backoff_initial
      @backoff_max = backoff_max
      @mutex = Mutex.new
      @connected_cv = ConditionVariable.new
      @connected = false
    end

    def start
      @stopped = false
      @connected = false
      @backoff = @backoff_initial
      connect_with_retry
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
      send_json(type: 'console', level: level, message: message, timestamp: now_ms)
    end

    def send_error(message)
      send_json(type: 'error', message: message, timestamp: now_ms)
    end

    private

    def connect_with_retry
      Thread.new do
        until @stopped
          begin
            connect_once
            @backoff = @backoff_initial
            break
          rescue => e
            sleep @backoff
            @backoff = [@backoff * 2, @backoff_max].min
          end
        end
      end
    end

    def connect_once
      @ws = WebSocket::Client::Simple.connect(@url, headers: { 'X-Bridge-Secret' => @secret })
      @ws.on(:open) { mark_connected }
      @ws.on(:message) { |msg| handle_message(msg.data) }
      @ws.on(:close) { handle_close }
      @last_pong = Time.now
      send_json(type: 'auth', secret: @secret, role: 'bridge')
      send_json(type: 'hello', capabilities: @capabilities, platform: 'ruby', projectId: @project_id, protocol: PROTOCOL_VERSION)
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
      end
    end

    def handle_close
      return if @stopped
      @mutex.synchronize { @connected = false }
      @heartbeat_thread&.kill
      @monitor_thread&.kill
      connect_with_retry
    end

    def start_heartbeat
      @heartbeat_thread = Thread.new do
        loop do
          sleep @heartbeat_interval
          send_json(type: 'ping')
        end
      end
    end

    def start_monitor
      @monitor_thread = Thread.new do
        loop do
          sleep 1
          if Time.now - @last_pong > @heartbeat_timeout
            @ws&.close
            break
          end
        end
      end
    end

    def send_json(hash)
      return unless wait_until_connected
      @ws&.send(JSON.dump(hash))
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

    def now_ms
      (Time.now.to_f * 1000).to_i
    end
  end
end

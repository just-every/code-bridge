local HttpService = game:GetService("HttpService")
local LogService = game:GetService("LogService")
local ScriptContext = game:GetService("ScriptContext")
local RunService = game:GetService("RunService")

local DEFAULTS = {
  baseUrl = "http://127.0.0.1:9876",
  secret = nil, -- must be provided to match host secret
  projectId = "roblox-app",
  route = "studio",
  flushInterval = 1.0,
  maxBatch = 50,
  queueLimit = 500,
  heartbeatInterval = 10,
  pollInterval = 5,
  controlWaitMs = 12000,
  enabled = nil, -- nil: auto-enable in Studio only
  forceEnable = false,
  capabilities = { "console", "error" },
}

local CodeBridge = {}
CodeBridge.__index = CodeBridge

local function nowMs()
  local ok, ts = pcall(function()
    return DateTime.now().UnixTimestampMillis
  end)
  if ok and typeof(ts) == "number" then
    return ts
  end
  return math.floor(os.clock() * 1000)
end

local function jsonEncode(data)
  return HttpService:JSONEncode(data)
end

local function jsonDecode(data)
  return HttpService:JSONDecode(data)
end

local function shallowCopy(list)
  local out = {}
  if list then
    for i, v in ipairs(list) do
      out[i] = v
    end
  end
  return out
end

local function mergeConfig(cfg)
  local out = {}
  for k, v in pairs(DEFAULTS) do
    out[k] = v
  end
  for k, v in pairs(cfg or {}) do
    out[k] = v
  end
  out.capabilities = shallowCopy(out.capabilities)
  return out
end

local function safeHttp(url, body)
  local ok, resp = pcall(function()
    return HttpService:RequestAsync({
      Url = url,
      Method = "POST",
      Headers = { ["Content-Type"] = "application/json" },
      Body = jsonEncode(body),
    })
  end)

  if not ok then
    warn("code-bridge http error", resp)
    return nil
  end

  if not resp.Success then
    warn("code-bridge http error", resp.StatusCode, resp.StatusMessage)
    return nil
  end

  local bodyStr = resp.Body or ""
  if bodyStr == "" then
    return {}
  end

  local okDecode, parsed = pcall(jsonDecode, bodyStr)
  if not okDecode then
    warn("code-bridge decode error", parsed)
    return nil
  end

  return parsed
end

function CodeBridge.new(cfg)
  local self = setmetatable({}, CodeBridge)
  self.cfg = mergeConfig(cfg)
  self.sessionId = nil
  self.running = false
  self.queue = {}
  self.onControlHandler = nil
  self._flushThread = nil
  self._pollThread = nil
  self._heartbeatThread = nil
  self._logConn = nil
  self._errConn = nil
  return self
end

function CodeBridge:isEnabled()
  if self.cfg.forceEnable then
    return true
  end
  if self.cfg.enabled ~= nil then
    return self.cfg.enabled
  end
  return RunService:IsStudio()
end

function CodeBridge:_connect()
  local url = string.format("%s/bridge/connect", self.cfg.baseUrl)
  local resp = safeHttp(url, { secret = self.cfg.secret })
  if not resp or not resp.sessionId then
    return false
  end
  self.sessionId = resp.sessionId
  return true
end

function CodeBridge:_hello()
  local url = string.format("%s/bridge/hello", self.cfg.baseUrl)
  return safeHttp(url, {
    sessionId = self.sessionId,
    capabilities = self.cfg.capabilities,
    platform = "roblox",
    projectId = self.cfg.projectId,
    route = self.cfg.route,
    protocol = 2,
  }) ~= nil
end

function CodeBridge:start()
  if self.running then
    return true
  end
  if not self:isEnabled() then
    return false
  end
  if not HttpService.HttpEnabled then
    warn("code-bridge: HttpService.HttpEnabled is false; bridge disabled")
    return false
  end
  if not self.cfg.secret or self.cfg.secret == "" then
    warn("code-bridge: secret is required; set cfg.secret to the host secret (see .code/code-bridge.json or CODE_BRIDGE_SECRET)")
    return false
  end
  if not self:_connect() then
    return false
  end
  if not self:_hello() then
    return false
  end
  self.running = true
  self:_attachLogs()
  self:_startFlushLoop()
  self:_startPollLoop()
  self:_startHeartbeat()
  return true
end

function CodeBridge:stop()
  self.running = false
  if self._flushThread then task.cancel(self._flushThread) end
  if self._pollThread then task.cancel(self._pollThread) end
  if self._heartbeatThread then task.cancel(self._heartbeatThread) end
  if self._logConn then self._logConn:Disconnect() end
  if self._errConn then self._errConn:Disconnect() end
end

function CodeBridge:onControl(handler)
  self.onControlHandler = handler
end

function CodeBridge:log(level, message, extra)
  self:_enqueue({
    type = "console",
    level = level or "info",
    message = message,
    timestamp = nowMs(),
    platform = "roblox",
    data = extra,
  })
end

function CodeBridge:error(message, stack)
  self:_enqueue({
    type = "error",
    level = "error",
    message = message,
    stack = stack,
    timestamp = nowMs(),
    platform = "roblox",
  })
end

function CodeBridge:event(name, payload)
  self:_enqueue({
    type = "log",
    level = "info",
    message = name,
    data = payload,
    timestamp = nowMs(),
    platform = "roblox",
  })
end

-- Server helper: ingest client-side batches that were forwarded via RemoteEvent.
function CodeBridge:ingestClientEvents(player, events)
  if not self.running or typeof(events) ~= "table" then
    return
  end
  for _, ev in ipairs(events) do
    if typeof(ev) == "table" then
      self:_enqueue({
        type = ev.type or "log",
        level = ev.level or "info",
        message = tostring(ev.message or ""),
        stack = ev.stack,
        data = ev.data,
        timestamp = ev.timestamp or nowMs(),
        platform = "roblox-client",
        player = player and player.Name or nil,
        userId = player and player.UserId or nil,
      })
    end
  end
end

function CodeBridge:_enqueue(ev)
  if not self.running then
    return
  end
  if #self.queue >= self.cfg.queueLimit then
    table.remove(self.queue, 1)
  end
  table.insert(self.queue, ev)
end

function CodeBridge:_attachLogs()
  self._logConn = LogService.MessageOut:Connect(function(message, messageType)
    self:log(tostring(messageType), message)
  end)
  self._errConn = ScriptContext.Error:Connect(function(message, stackTrace)
    self:error(message, stackTrace)
  end)
end

function CodeBridge:_flushOnce()
  if not self.running or not self.sessionId then
    return
  end
  if #self.queue == 0 then
    return
  end
  local batchSize = math.min(self.cfg.maxBatch, #self.queue)
  local batch = {}
  for i = 1, batchSize do
    batch[i] = self.queue[i]
  end
  for i = 1, batchSize do
    table.remove(self.queue, 1)
  end
  local url = string.format("%s/bridge/events", self.cfg.baseUrl)
  safeHttp(url, { sessionId = self.sessionId, events = batch })
end

function CodeBridge:_startFlushLoop()
  self._flushThread = task.spawn(function()
    while self.running do
      self:_flushOnce()
      task.wait(self.cfg.flushInterval)
    end
    self:_flushOnce()
  end)
end

function CodeBridge:_startHeartbeat()
  self._heartbeatThread = task.spawn(function()
    while self.running do
      local url = string.format("%s/bridge/heartbeat", self.cfg.baseUrl)
      safeHttp(url, { sessionId = self.sessionId })
      task.wait(self.cfg.heartbeatInterval)
    end
  end)
end

function CodeBridge:_handleControl(messages)
  if not messages or #messages == 0 then
    return
  end
  for _, msg in ipairs(messages) do
    if msg.type == 'control_request' and self.onControlHandler then
      local ok, result = pcall(self.onControlHandler, msg)
      local url = string.format("%s/bridge/control/result", self.cfg.baseUrl)
      safeHttp(url, {
        sessionId = self.sessionId,
        id = msg.id,
        ok = ok,
        result = ok and result or nil,
        error = ok and nil or { message = tostring(result) },
      })
    end
  end
end

function CodeBridge:_startPollLoop()
  self._pollThread = task.spawn(function()
    while self.running do
      local url = string.format("%s/bridge/control/poll", self.cfg.baseUrl)
      local resp = safeHttp(url, { sessionId = self.sessionId, waitMs = self.cfg.controlWaitMs })
      if resp then
        local commands = resp.commands or resp.messages
        if commands then
          self:_handleControl(commands)
        end
      end
      task.wait(self.cfg.pollInterval)
    end
  end)
end

return CodeBridge

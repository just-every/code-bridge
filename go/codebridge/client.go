package codebridge

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "math"
    "math/rand"
    "net/http"
    "sync"
    "time"

    "github.com/gorilla/websocket"
)

const (
    ProtocolVersion       = 2
    HeartbeatInterval     = 15 * time.Second
    HeartbeatTimeout      = 30 * time.Second
    backoffInitial        = time.Second
    backoffMax            = 30 * time.Second
    bufferLimitDefault    = 200
)

var jitterFn = jitter

type ClientConfig struct {
    URL         string
    Secret      string
    ProjectID   string
    Capabilities []string
    HeartbeatInterval time.Duration
    HeartbeatTimeout  time.Duration
    BackoffInitial    time.Duration
    BackoffMax        time.Duration
    BufferLimit       int
    Logger            func(string)
}

type Client struct {
    cfg   ClientConfig
    conn  *websocket.Conn
    cancel context.CancelFunc
    pongCh chan struct{}
    bufMu sync.Mutex
    buffer []map[string]any
    dropped int
    controlHandler func(map[string]any) (any, error)
}

func NewClient(cfg ClientConfig) *Client {
    if len(cfg.Capabilities) == 0 {
        cfg.Capabilities = []string{"console", "error"}
    }
    if cfg.HeartbeatInterval == 0 {
        cfg.HeartbeatInterval = HeartbeatInterval
    }
    if cfg.HeartbeatTimeout == 0 {
        cfg.HeartbeatTimeout = HeartbeatTimeout
    }
    if cfg.BackoffInitial == 0 {
        cfg.BackoffInitial = backoffInitial
    }
    if cfg.BackoffMax == 0 {
        cfg.BackoffMax = backoffMax
    }
    if cfg.BufferLimit == 0 {
        cfg.BufferLimit = bufferLimitDefault
    }
    return &Client{cfg: cfg, pongCh: make(chan struct{}, 1)}
}

func (c *Client) Start(ctx context.Context) error {
    return c.run(ctx)
}

func (c *Client) Close() error {
    if c.cancel != nil { c.cancel() }
    if c.conn != nil { return c.conn.Close() }
    return nil
}

func (c *Client) SendConsole(level, message string) error {
    payload := map[string]any{"type":"console","level":level,"message":message,"timestamp":time.Now().UnixMilli()}
    return c.enqueue(payload)
}

func (c *Client) OnControl(handler func(map[string]any) (any, error)) {
    c.controlHandler = handler
}

func (c *Client) send(obj map[string]any) error {
    data, _ := json.Marshal(obj)
    return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *Client) enqueue(ev map[string]any) error {
    c.bufMu.Lock()
    defer c.bufMu.Unlock()
    if c.conn != nil {
        if err := c.send(ev); err != nil {
            return err
        }
        return nil
    }
    if len(c.buffer) >= c.cfg.BufferLimit {
        c.buffer = c.buffer[1:]
        c.dropped++
    }
    c.buffer = append(c.buffer, ev)
    return nil
}

func (c *Client) flushBuffer() {
    c.bufMu.Lock()
    defer c.bufMu.Unlock()
    if c.conn == nil {
        return
    }
    for _, ev := range c.buffer {
        _ = c.send(ev)
    }
    c.buffer = nil
    if c.dropped > 0 {
        _ = c.send(map[string]any{
            "type": "info",
            "level": "info",
            "message": "bridge buffered drop count=" + itoa(c.dropped),
        })
        c.dropped = 0
    }
}

func itoa(v int) string {
    return fmt.Sprintf("%d", v)
}

func (c *Client) heartbeat(ctx context.Context) {
    ticker := time.NewTicker(c.cfg.HeartbeatInterval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            _ = c.send(map[string]any{"type":"ping"})
            c.conn.SetReadDeadline(time.Now().Add(c.cfg.HeartbeatTimeout))
        case <-c.pongCh:
            c.conn.SetReadDeadline(time.Now().Add(c.cfg.HeartbeatTimeout))
        }
    }
}

func (c *Client) reader(ctx context.Context, cancel context.CancelFunc) {
    defer cancel()
    for {
        _, data, err := c.conn.ReadMessage()
        if err != nil {
            return
        }
        var m map[string]any
        if err := json.Unmarshal(data, &m); err != nil {
            continue
        }
        if t, ok := m["type"].(string); ok {
            switch t {
            case "ping":
                _ = c.send(map[string]any{"type":"pong"})
            case "pong":
                select { case c.pongCh <- struct{}{}: default: }
            case "control_request":
                c.handleControl(m)
            }
        }
    }
}

func (c *Client) waitForAuth(ctx context.Context) error {
    deadline := time.Now().Add(c.cfg.HeartbeatTimeout)
    for {
        if time.Now().After(deadline) {
            return errors.New("auth_success timeout")
        }
        c.conn.SetReadDeadline(deadline)
        _, data, err := c.conn.ReadMessage()
        if err != nil {
            return err
        }
        var m map[string]any
        _ = json.Unmarshal(data, &m)
        t, _ := m["type"].(string)
        switch t {
        case "auth_success":
            return nil
        case "ping":
            _ = c.send(map[string]any{"type":"pong"})
        case "pong":
            // ignore
        }
    }
}

func (c *Client) handleControl(msg map[string]any) {
    if c.controlHandler == nil {
        return
    }
    var resp map[string]any
    result, err := c.controlHandler(msg)
    if err != nil {
        resp = map[string]any{
            "type": "control_result",
            "id": msg["id"],
            "ok": false,
            "error": map[string]any{"message": err.Error()},
        }
    } else {
        resp = map[string]any{
            "type": "control_result",
            "id": msg["id"],
            "ok": true,
            "result": result,
        }
    }
    _ = c.enqueue(resp)
}

func jitter(d time.Duration) time.Duration {
    f := rand.Float64()*0.5 + 1.0 // 1.0 - 1.5x
    return time.Duration(float64(d) * f)
}

func (c *Client) run(ctx context.Context) error {
    delay := c.cfg.BackoffInitial
    for {
        if ctx.Err() != nil { return ctx.Err() }
        d := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
        conn, _, err := d.DialContext(ctx, c.cfg.URL, http.Header{"X-Bridge-Secret": []string{c.cfg.Secret}})
        if err != nil {
            time.Sleep(jitterFn(delay))
            delay = time.Duration(math.Min(float64(c.cfg.BackoffMax), float64(delay)*2))
            continue
        }
        c.conn = conn
        delay = c.cfg.BackoffInitial

        c.conn.SetReadDeadline(time.Now().Add(c.cfg.HeartbeatTimeout))
        if err := c.send(map[string]any{"type":"auth","secret":c.cfg.Secret,"role":"bridge"}); err != nil { return err }
        if err := c.waitForAuth(ctx); err != nil { return err }
        if err := c.send(map[string]any{"type":"hello","capabilities":c.cfg.Capabilities,"platform":"go","projectId":c.cfg.ProjectID,"protocol":ProtocolVersion}); err != nil { return err }
        c.flushBuffer()

        hbCtx, cancel := context.WithCancel(ctx)
        c.cancel = cancel
        go c.reader(hbCtx, cancel)
        go c.heartbeat(hbCtx)

        // wait for reader or context cancellation
        <-hbCtx.Done()
        if c.conn != nil {
            _ = c.conn.Close()
        }
        c.conn = nil
        time.Sleep(delay)
        delay = time.Duration(math.Min(float64(c.cfg.BackoffMax), float64(delay)*2))
    }
}

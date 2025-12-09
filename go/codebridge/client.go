package codebridge

import (
    "context"
    "encoding/json"
    "errors"
    "math"
    "net/http"
    "time"

    "github.com/gorilla/websocket"
)

const (
    ProtocolVersion       = 2
    HeartbeatInterval     = 15 * time.Second
    HeartbeatTimeout      = 30 * time.Second
    backoffInitial        = time.Second
    backoffMax            = 30 * time.Second
)

type ClientConfig struct {
    URL         string
    Secret      string
    ProjectID   string
    Capabilities []string
}

type Client struct {
    cfg   ClientConfig
    conn  *websocket.Conn
    cancel context.CancelFunc
    pongCh chan struct{}
}

func NewClient(cfg ClientConfig) *Client {
    if len(cfg.Capabilities) == 0 {
        cfg.Capabilities = []string{"console", "error"}
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
    if c.conn == nil { return errors.New("not connected") }
    payload := map[string]any{"type":"console","level":level,"message":message,"timestamp":time.Now().UnixMilli()}
    return c.send(payload)
}

func (c *Client) send(obj map[string]any) error {
    data, _ := json.Marshal(obj)
    return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *Client) heartbeat(ctx context.Context) {
    ticker := time.NewTicker(HeartbeatInterval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            _ = c.send(map[string]any{"type":"ping"})
            c.conn.SetReadDeadline(time.Now().Add(HeartbeatTimeout))
        case <-c.pongCh:
            c.conn.SetReadDeadline(time.Now().Add(HeartbeatTimeout))
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
            }
        }
    }
}

func (c *Client) run(ctx context.Context) error {
    delay := backoffInitial
    for {
        if ctx.Err() != nil { return ctx.Err() }
        d := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
        conn, _, err := d.DialContext(ctx, c.cfg.URL, http.Header{"X-Bridge-Secret": []string{c.cfg.Secret}})
        if err != nil {
            time.Sleep(delay)
            delay = time.Duration(math.Min(float64(backoffMax), float64(delay)*2))
            continue
        }
        c.conn = conn
        delay = backoffInitial

        if err := c.send(map[string]any{"type":"auth","secret":c.cfg.Secret,"role":"bridge"}); err != nil { return err }
        if err := c.send(map[string]any{"type":"hello","capabilities":c.cfg.Capabilities,"platform":"go","projectId":c.cfg.ProjectID,"protocol":ProtocolVersion}); err != nil { return err }

        hbCtx, cancel := context.WithCancel(ctx)
        c.cancel = cancel
        go c.reader(hbCtx, cancel)
        c.heartbeat(hbCtx)
        time.Sleep(delay)
        delay = time.Duration(math.Min(float64(backoffMax), float64(delay)*2))
    }
}

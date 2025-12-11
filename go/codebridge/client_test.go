package codebridge

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"
    "net/http/httptest"
    "reflect"
    "strings"
    "sync"
    "testing"
    "time"

    "github.com/gorilla/websocket"
)

// test server that mirrors the minimal protocol behaviors we need
type harness struct {
    srv   *httptest.Server
    url   string
    mu    sync.Mutex
    conns int
    msgs  []map[string]any
    autoPong bool
    conn *websocket.Conn
}

func newHarness(t *testing.T, autoPong bool) *harness {
    h := &harness{autoPong: autoPong}
    up := websocket.Upgrader{}
    h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        conn, err := up.Upgrade(w, r, nil)
        if err != nil {
            t.Fatalf("upgrade: %v", err)
        }
        h.mu.Lock(); h.conns++; h.conn = conn; h.mu.Unlock()
        if !h.autoPong {
            go func(c *websocket.Conn) {
                time.Sleep(150 * time.Millisecond)
                _ = c.Close()
            }(conn)
        }
        go func(c *websocket.Conn) {
            defer c.Close()
            for {
                _, data, err := c.ReadMessage()
                if err != nil {
                    return
                }
                var m map[string]any
                _ = json.Unmarshal(data, &m)
                h.mu.Lock(); h.msgs = append(h.msgs, m); h.mu.Unlock()
                switch m["type"] {
                case "auth":
                    _ = c.WriteJSON(map[string]any{"type":"auth_success","role":"bridge"})
                case "ping":
                    if h.autoPong { _ = c.WriteJSON(map[string]any{"type":"pong"}) }
                }
            }
        }(conn)
    }))
    h.url = "ws" + h.srv.URL[4:]
    return h
}

func (h *harness) close() { h.srv.Close() }

func (h *harness) sendControlRequest(t *testing.T, id string, action string) {
    h.mu.Lock(); conn := h.conn; h.mu.Unlock()
    if conn == nil { t.Fatalf("no connection") }
    _ = conn.WriteJSON(map[string]any{"type":"control_request","id":id,"action":action})
}

func waitFor(t *testing.T, cond func() bool, timeout time.Duration) {
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() { return }
        time.Sleep(10 * time.Millisecond)
    }
    t.Fatalf("condition not met in %v", timeout)
}

func TestHandshakeAuthBeforeHello(t *testing.T) {
    h := newHarness(t, true)
    defer h.close()

    cfg := ClientConfig{URL: h.url, Secret: "dev-secret"}
    c := NewClient(cfg)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    go c.Start(ctx)

    // wait for auth and hello ordering
    waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return len(h.msgs) >= 1 }, time.Second)
    h.mu.Lock(); first := h.msgs[0]["type"]; h.mu.Unlock()
    if first != "auth" { t.Fatalf("first message %v", first) }

    waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return len(h.msgs) >= 2 }, time.Second)
    h.mu.Lock(); second := h.msgs[1]["type"]; h.mu.Unlock()
    if second != "hello" { t.Fatalf("second message %v", second) }
}

func TestBufferingDropNotice(t *testing.T) {
    h := newHarness(t, true)
    defer h.close()

    cfg := ClientConfig{URL: h.url, Secret: "dev-secret", BufferLimit: 3}
    c := NewClient(cfg)

    _ = c.SendConsole("info", "m0")
    _ = c.SendConsole("info", "m1")
    _ = c.SendConsole("info", "m2")
    _ = c.SendConsole("info", "m3")
    _ = c.SendConsole("info", "m4")

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go c.Start(ctx)

    waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return len(h.msgs) >= 4 }, time.Second)
    h.mu.Lock(); defer h.mu.Unlock()
    var consoles []string
    dropSeen := false
    for _, m := range h.msgs {
        if m["type"] == "console" {
            consoles = append(consoles, m["message"].(string))
        }
        if m["type"] == "info" {
            if msg, ok := m["message"].(string); ok && strings.Contains(msg, "drop count=2") {
                dropSeen = true
            }
        }
    }
    if !dropSeen { t.Fatalf("drop notice not sent") }
    expected := []string{"m2","m3","m4"}
    if !reflect.DeepEqual(expected, consoles) {
        t.Fatalf("consoles %v", consoles)
    }
}

func TestHeartbeatReconnect(t *testing.T) {
    h := newHarness(t, false)
    defer h.close()

    cfg := ClientConfig{URL: h.url, Secret: "dev-secret", HeartbeatInterval: 20 * time.Millisecond, HeartbeatTimeout: 80 * time.Millisecond, BackoffInitial: 20 * time.Millisecond, BackoffMax: 120 * time.Millisecond}
    c := NewClient(cfg)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go c.Start(ctx)

    waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.conns >= 2 }, 5*time.Second)
}

func TestControlRoundTrip(t *testing.T) {
    h := newHarness(t, true)
    defer h.close()

    cfg := ClientConfig{URL: h.url, Secret: "dev-secret"}
    c := NewClient(cfg)
    c.OnControl(func(msg map[string]any) (any, error) {
        if msg["action"] == "ok" {
            return map[string]any{"echo": true}, nil
        }
        return nil, errors.New("boom")
    })

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    go c.Start(ctx)

    waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.conn != nil }, time.Second)

    h.sendControlRequest(t, "c1", "ok")
    h.sendControlRequest(t, "c2", "fail")

    waitFor(t, func() bool {
        h.mu.Lock(); defer h.mu.Unlock()
        ok, err := false, false
        for _, m := range h.msgs {
            if m["type"] == "control_result" && m["id"] == "c1" {
                ok = m["ok"].(bool)
            }
            if m["type"] == "control_result" && m["id"] == "c2" {
                if m["ok"].(bool) == false { err = true }
            }
        }
        return ok && err
    }, 2*time.Second)
}

func TestJitterBackoffUsed(t *testing.T) {
    called := false
    jitterFn = func(d time.Duration) time.Duration { called = true; return d }
    defer func() { jitterFn = jitter }()

    cfg := ClientConfig{URL: "ws://0.0.0.0:1", Secret: "dev-secret", BackoffInitial: 10 * time.Millisecond, BackoffMax: 20 * time.Millisecond}
    c := NewClient(cfg)
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        time.Sleep(50 * time.Millisecond)
        cancel()
    }()
    _ = c.Start(ctx)
    if !called {
        t.Fatalf("jitter function not invoked")
    }
}

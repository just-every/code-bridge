package codebridge

import (
    "context"
    "net"
    "os/exec"
    "testing"
    "time"
)

const testPort = "9881"

func startTestServer(t *testing.T) func() {
    cmd := exec.Command("node", "tools/protocol-test-server.js", "--port="+testPort, "--secret=dev-secret")
    if err := cmd.Start(); err != nil {
        t.Fatalf("failed to start test server: %v", err)
    }
    deadline := time.Now().Add(5 * time.Second)
    for time.Now().Before(deadline) {
        conn, err := net.DialTimeout("tcp", "127.0.0.1:"+testPort, 100*time.Millisecond)
        if err == nil {
            conn.Close()
            break
        }
        time.Sleep(50 * time.Millisecond)
    }
    return func() {
        _ = cmd.Process.Kill()
        _ = cmd.Wait()
    }
}

func TestHappyPath(t *testing.T) {
  stop := startTestServer(t)
  defer stop()

  cfg := ClientConfig{URL: "ws://localhost:" + testPort, Secret: "dev-secret"}
  client := NewClient(cfg)
  ctx, cancel := context.WithCancel(context.Background())
  defer cancel()

  // run in background to exercise reconnect loop semantics
  go func() {
    _ = client.Start(ctx)
  }()
  for i := 0; i < 30; i++ {
    if client.conn != nil {
      break
    }
    time.Sleep(100 * time.Millisecond)
  }
  if client.conn == nil {
    t.Fatalf("client never connected")
  }
  if err := client.SendConsole("info", "hello"); err != nil {
    t.Fatalf("send failed: %v", err)
  }
  _ = client.Close()
}

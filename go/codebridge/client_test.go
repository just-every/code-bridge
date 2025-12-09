package codebridge

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

const defaultTestPort = "9881"

func repoRoot(t *testing.T) string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))
	return root
}

func startTestServer(t *testing.T, port string, secret string) func() {
	root := repoRoot(t)
	serverPath := filepath.Join(root, "tools", "protocol-test-server.js")
	cmd := exec.Command("node", serverPath, "--port="+port, "--secret="+secret)
	cmd.Dir = root
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start test server: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, 100*time.Millisecond)
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
	secret := os.Getenv("CODE_BRIDGE_SECRET")
	if secret == "" {
		secret = "dev-secret"
	}

	url := os.Getenv("CODE_BRIDGE_URL")
	stop := func() {}
	if url == "" {
		stop = startTestServer(t, defaultTestPort, secret)
		url = "ws://localhost:" + defaultTestPort
	}
	defer stop()

	cfg := ClientConfig{URL: url, Secret: secret}
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

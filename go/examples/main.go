package main

import (
    "context"
    "log"
    "os"
    "time"

    cb "github.com/just-every/code-bridge/go/codebridge"
)

func main() {
    url := getenv("CODE_BRIDGE_URL", "ws://localhost:9877")
    secret := getenv("CODE_BRIDGE_SECRET", "dev-secret")

    cfg := cb.ClientConfig{URL: url, Secret: secret, Capabilities: []string{"console", "error"}}
    client := cb.NewClient(cfg)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    if err := client.Start(ctx); err != nil {
        log.Fatalf("start failed: %v", err)
    }

    _ = client.SendConsole("info", "hello from go example")
    time.Sleep(500 * time.Millisecond)
    _ = client.Close()
}

func getenv(k, def string) string {
    if v := os.Getenv(k); v != "" {
        return v
    }
    return def
}

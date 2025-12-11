use code_bridge_client::{BridgeClient, BridgeConfig};

#[tokio::test]
async fn heartbeat_and_reconnect() {
    let cfg = BridgeConfig {
        url: "ws://localhost:9876".into(),
        secret: "dev-secret".into(),
        project_id: Some("rust-test".into()),
        capabilities: vec!["console".into(), "error".into()],
        heartbeat_interval_ms: 100,
        heartbeat_timeout_ms: 200,
        backoff_initial_ms: 50,
        backoff_max_ms: 200,
        buffer_limit: 200,
    };
    let client = BridgeClient::new(cfg);
    // Run briefly to cover heartbeat/reconnect loop; abort after short duration
    let handle = tokio::spawn(async move {
        tokio::select! {
            _ = client.run_with_reconnect() => {},
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {},
        }
    });
    handle.await.unwrap();
}

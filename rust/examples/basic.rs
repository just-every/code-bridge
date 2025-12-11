use code_bridge_client::{BridgeClient, BridgeConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = BridgeConfig {
        url: "ws://localhost:9876".into(),
        secret: "dev-secret".into(),
        project_id: Some("rust-example".into()),
        capabilities: vec!["console".into(), "error".into()],
        ..BridgeConfig::default()
    };
    let client = BridgeClient::new(cfg);
    client.send_console("info", "hello from rust").await;
    client.send_error("sample error").await;
    // run loop (will reconnect) for a short time then exit
    let handle = tokio::spawn(async move { client.run_with_reconnect().await.ok(); });
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    handle.abort();
    Ok(())
}

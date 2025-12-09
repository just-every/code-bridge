use code_bridge_client::{BridgeClient, BridgeConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = BridgeConfig { url: "ws://localhost:9877".into(), secret: "dev-secret".into(), project_id: Some("rust-example".into()), capabilities: vec!["console".into(), "error".into()] };
    let client = BridgeClient::new(cfg);
    let mut ws = client.connect().await?;
    client.send_console(&mut ws, "info", "hello from rust").await?;
    client.send_error(&mut ws, "sample error").await?;
    Ok(())
}

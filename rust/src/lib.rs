use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::time::Duration;
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::time;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

pub const PROTOCOL_VERSION: u64 = 2;
pub const HEARTBEAT_INTERVAL_MS: u64 = 15_000;
pub const HEARTBEAT_TIMEOUT_MS: u64 = 30_000;
pub const BACKOFF_INITIAL_MS: u64 = 1_000;
pub const BACKOFF_MAX_MS: u64 = 30_000;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("websocket: {0}")]
    Ws(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("url: {0}")]
    Url(#[from] url::ParseError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug)]
pub struct BridgeConfig {
    pub url: String,
    pub secret: String,
    pub project_id: Option<String>,
    pub capabilities: Vec<String>,
    pub heartbeat_interval_ms: u64,
    pub heartbeat_timeout_ms: u64,
    pub backoff_initial_ms: u64,
    pub backoff_max_ms: u64,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            url: "ws://localhost:9877".into(),
            secret: "dev-secret".into(),
            project_id: None,
            capabilities: vec!["console".into(), "error".into()],
            heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
            heartbeat_timeout_ms: HEARTBEAT_TIMEOUT_MS,
            backoff_initial_ms: BACKOFF_INITIAL_MS,
            backoff_max_ms: BACKOFF_MAX_MS,
        }
    }
}

#[derive(Clone)]
pub struct BridgeClient {
    cfg: BridgeConfig,
}

impl BridgeClient {
    pub fn new(cfg: BridgeConfig) -> Self {
        Self { cfg }
    }

    pub async fn connect(
        &self,
    ) -> Result<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>, BridgeError> {
        let (mut ws, _) = connect_async(Url::parse(&self.cfg.url)?).await?;
        ws.send(Message::Text(
            json!({"type":"auth","secret":self.cfg.secret,"role":"bridge"}).to_string(),
        ))
        .await?;
        ws.send(Message::Text(
            json!({"type":"hello","capabilities":self.cfg.capabilities,"platform":"rust","projectId":self.cfg.project_id,"protocol":PROTOCOL_VERSION}).to_string(),
        ))
        .await?;
        Ok(ws)
    }

    pub async fn run_with_reconnect(&self) -> Result<(), BridgeError> {
        let mut delay = Duration::from_millis(self.cfg.backoff_initial_ms);
        loop {
            match self.connect().await {
                Ok(mut ws) => {
                    delay = Duration::from_millis(self.cfg.backoff_initial_ms);
                    let hb_interval = self.cfg.heartbeat_interval_ms;
                    let hb_timeout = self.cfg.heartbeat_timeout_ms;
                    let hb = tokio::spawn(async move {
                        let mut interval = time::interval(Duration::from_millis(hb_interval));
                        loop {
                            interval.tick().await;
                            if ws.send(Message::Text(json!({"type":"ping"}).to_string())).await.is_err() {
                                return;
                            }
                        }
                    });
                    let reader = tokio::spawn(async move {
                        loop {
                            match time::timeout(Duration::from_millis(hb_timeout), ws.next()).await {
                                Ok(Some(Ok(msg))) => {
                                    if let Message::Text(t) = msg {
                                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                                            if v.get("type").and_then(|t| t.as_str()) == Some("ping") {
                                                let _ = ws.send(Message::Text(json!({"type":"pong"}).to_string())).await;
                                            }
                                        }
                                    }
                                }
                                _ => {
                                    let _ = ws.close(None).await;
                                    return;
                                }
                            }
                        }
                    });
                    let _ = tokio::join!(hb, reader);
                }
                Err(_) => {}
            }
            delay = std::cmp::min(delay * 2, Duration::from_millis(self.cfg.backoff_max_ms));
            time::sleep(delay).await;
        }
    }

    pub async fn send_console(
        &self,
        ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        level: &str,
        message: &str,
    ) -> Result<(), BridgeError> {
        ws.send(Message::Text(
            json!({"type":"console","level":level,"message":message,"timestamp":now_ms()}).to_string(),
        ))
        .await?;
        Ok(())
    }

    pub async fn send_error(
        &self,
        ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        message: &str,
    ) -> Result<(), BridgeError> {
        ws.send(Message::Text(
            json!({"type":"error","message":message,"timestamp":now_ms()}).to_string(),
        ))
        .await?;
        Ok(())
    }

    pub async fn run_heartbeat(
        &self,
        ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
    ) -> Result<(), BridgeError> {
        let mut interval = time::interval(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
        loop {
            interval.tick().await;
            ws.send(Message::Text(json!({"type":"ping"}).to_string())).await?;
        }
    }
}

fn now_ms() -> u64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    now.as_millis() as u64
}

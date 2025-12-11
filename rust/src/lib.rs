use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

pub const PROTOCOL_VERSION: u64 = 2;
pub const HEARTBEAT_INTERVAL_MS: u64 = 15_000;
pub const HEARTBEAT_TIMEOUT_MS: u64 = 30_000;
pub const BACKOFF_INITIAL_MS: u64 = 1_000;
pub const BACKOFF_MAX_MS: u64 = 30_000;
pub const BUFFER_LIMIT: usize = 200;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("websocket: {0}")]
    Ws(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("url: {0}")]
    Url(#[from] url::ParseError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("auth_success timeout")]
    AuthTimeout,
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
    pub buffer_limit: usize,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            url: "ws://localhost:9876".into(),
            secret: "dev-secret".into(),
            project_id: None,
            capabilities: vec!["console".into(), "error".into()],
            heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
            heartbeat_timeout_ms: HEARTBEAT_TIMEOUT_MS,
            backoff_initial_ms: BACKOFF_INITIAL_MS,
            backoff_max_ms: BACKOFF_MAX_MS,
            buffer_limit: BUFFER_LIMIT,
        }
    }
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct BridgeClient {
    cfg: BridgeConfig,
    buffer: Arc<Mutex<VecDeque<Value>>>,
    dropped: Arc<Mutex<usize>>,
    control_handler: Arc<Mutex<Option<Arc<dyn Fn(Value) -> Result<Value, String> + Send + Sync>>>>,
}

impl Clone for BridgeClient {
    fn clone(&self) -> Self {
        Self {
            cfg: self.cfg.clone(),
            buffer: self.buffer.clone(),
            dropped: self.dropped.clone(),
            control_handler: self.control_handler.clone(),
        }
    }
}

impl BridgeClient {
    pub fn new(cfg: BridgeConfig) -> Self {
        Self {
            cfg,
            buffer: Arc::new(Mutex::new(VecDeque::new())),
            dropped: Arc::new(Mutex::new(0)),
            control_handler: Arc::new(Mutex::new(None)),
        }
    }

    pub fn on_control<F>(&self, handler: F)
    where
        F: Fn(Value) -> Result<Value, String> + Send + Sync + 'static,
    {
        *self.control_handler.lock().unwrap() = Some(Arc::new(handler));
    }

    pub async fn send_console(&self, level: &str, message: &str) {
        let ev = json!({"type":"console","level":level,"message":message,"timestamp":now_ms()});
        self.enqueue(ev);
    }

    pub async fn send_error(&self, message: &str) {
        let ev = json!({"type":"error","message":message,"timestamp":now_ms()});
        self.enqueue(ev);
    }

    fn enqueue(&self, ev: Value) {
        let mut buf = self.buffer.lock().unwrap();
        if buf.len() >= self.cfg.buffer_limit {
            buf.pop_front();
            *self.dropped.lock().unwrap() += 1;
        }
        buf.push_back(ev);
    }

    async fn flush_buffer(&self, ws: &mut WsStream) -> Result<(), BridgeError> {
        let (pending, dropped) = {
            let mut buf = self.buffer.lock().unwrap();
            let pending: Vec<_> = buf.drain(..).collect();
            let dropped = std::mem::take(&mut *self.dropped.lock().unwrap());
            (pending, dropped)
        };
        for ev in pending {
            ws.send(Message::Text(ev.to_string().into())).await?;
        }
        if dropped > 0 {
            let info = json!({"type":"info","level":"info","message":format!("bridge buffered drop count={}", dropped)});
            ws.send(Message::Text(info.to_string().into())).await?;
        }
        Ok(())
    }

    async fn respond_control(&self, ws: &mut WsStream, msg: &Value) -> Result<(), BridgeError> {
        let handler_opt = {
            let guard = self.control_handler.lock().unwrap();
            guard.clone()
        };
        if let Some(handler) = handler_opt {
            let id_val = msg.get("id").cloned().unwrap_or(Value::Null);
            let resp = match handler(msg.clone()) {
                Ok(res) => json!({"type":"control_result","id":id_val,"ok":true,"result":res}),
                Err(e) => json!({"type":"control_result","id":id_val,"ok":false,"error":{"message":e}}),
            };
            ws.send(Message::Text(resp.to_string().into())).await?;
        }
        Ok(())
    }

    async fn wait_for_auth_success(&self, ws: &mut WsStream) -> Result<(), BridgeError> {
        let deadline = time::Instant::now() + Duration::from_millis(self.cfg.heartbeat_timeout_ms);
        loop {
            let timeout = deadline.saturating_duration_since(time::Instant::now());
            if timeout.is_zero() {
                return Err(BridgeError::AuthTimeout);
            }
            let msg = time::timeout(timeout, ws.next()).await;
            match msg {
                Ok(Some(Ok(Message::Text(txt)))) => {
                    if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                        match v.get("type").and_then(|t| t.as_str()) {
                            Some("auth_success") => return Ok(()),
                            Some("ping") => {
                                ws.send(Message::Text(json!({"type":"pong"}).to_string().into()))
                                    .await?;
                            }
                            Some("control_request") => {
                                self.respond_control(ws, &v).await?;
                            }
                            _ => {}
                        }
                    }
                }
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(e))) => return Err(BridgeError::Ws(e)),
                Ok(None) => return Err(BridgeError::AuthTimeout),
                Err(_) => return Err(BridgeError::AuthTimeout),
            }
        }
    }

    pub async fn run_with_reconnect(&self) -> Result<(), BridgeError> {
        let mut delay = Duration::from_millis(self.cfg.backoff_initial_ms);
        loop {
            match self.connect_once().await {
                Ok(_) => {
                    delay = Duration::from_millis(self.cfg.backoff_initial_ms);
                }
                Err(_) => {
                    let jittered = jitter(delay, self.cfg.backoff_max_ms);
                    time::sleep(jittered).await;
                    delay = std::cmp::min(delay * 2, Duration::from_millis(self.cfg.backoff_max_ms));
                }
            }
        }
    }

    async fn connect_once(&self) -> Result<(), BridgeError> {
        let (mut ws, _) = connect_async(&self.cfg.url).await?;

        ws.send(Message::Text(
            json!({"type":"auth","secret":self.cfg.secret,"role":"bridge"}).to_string().into(),
        ))
        .await?;
        self.wait_for_auth_success(&mut ws).await?;

        ws.send(Message::Text(
            json!({"type":"hello","capabilities":self.cfg.capabilities,"platform":"rust","projectId":self.cfg.project_id,"protocol":PROTOCOL_VERSION}).to_string().into(),
        ))
        .await?;

        self.flush_buffer(&mut ws).await?;

        let (mut write, mut read) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        let tx_clone = tx.clone();
        let buffer = self.buffer.clone();
        let dropped = self.dropped.clone();
        let control_handler = self.control_handler.clone();

        {
            let mut buf = buffer.lock().unwrap();
            while let Some(ev) = buf.pop_front() {
                let _ = tx_clone.send(ev);
            }
            let dropped_count = std::mem::take(&mut *dropped.lock().unwrap());
            if dropped_count > 0 {
                let _ = tx_clone.send(json!({"type":"info","level":"info","message":format!("bridge buffered drop count={}", dropped_count)}));
            }
        }

        let heartbeat_interval = Duration::from_millis(self.cfg.heartbeat_interval_ms);
        let heartbeat_timeout = Duration::from_millis(self.cfg.heartbeat_timeout_ms);
        let mut hb_interval = time::interval(heartbeat_interval);
        let mut pong_deadline = time::Instant::now() + heartbeat_timeout;

        let sender = tokio::spawn(async move {
            while let Some(v) = rx.recv().await {
                let _ = write.send(Message::Text(v.to_string().into())).await;
            }
        });

        loop {
            tokio::select! {
                _ = hb_interval.tick() => {
                    let _ = tx.send(json!({"type":"ping"}));
                    // do not extend deadline here; only pong extends so timeout can fire
                }
                maybe_msg = read.next() => {
                    match maybe_msg {
                        Some(Ok(Message::Text(txt))) => {
                            if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                                match v.get("type").and_then(|t| t.as_str()) {
                                    Some("ping") => { let _ = tx.send(json!({"type":"pong"})); }
                                    Some("pong") => { pong_deadline = time::Instant::now() + heartbeat_timeout; }
                                    Some("control_request") => {
                                        if let Some(handler) = control_handler.lock().unwrap().as_ref() {
                                            let id_val = v.get("id").cloned().unwrap_or(Value::Null);
                                            let resp = match handler(v.clone()) {
                                                Ok(res) => json!({"type":"control_result","id":id_val,"ok":true,"result":res}),
                                                Err(e) => json!({"type":"control_result","id":id_val,"ok":false,"error":{"message":e}}),
                                            };
                                            let _ = tx.send(resp);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                        _ => {}
                    }
                }
                _ = time::sleep_until(pong_deadline) => {
                    break;
                }
            }
        }

        sender.abort();
        Err(BridgeError::AuthTimeout)
    }
}

fn jitter(base: Duration, max_ms: u64) -> Duration {
    let mut rng = rand::thread_rng();
    let factor: f64 = rng.gen_range(1.0..=1.5);
    let dur = base.mul_f64(factor);
    std::cmp::min(dur, Duration::from_millis(max_ms))
}

fn now_ms() -> u64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    now.as_millis() as u64
}

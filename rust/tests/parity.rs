use std::sync::{Arc, Mutex};

use code_bridge_client::{BridgeClient, BridgeConfig};
use futures_util::SinkExt;
use serde_json::json;
use futures_util::StreamExt;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::{accept_async, tungstenite::Message};

struct Host {
    addr: String,
    messages: Arc<Mutex<Vec<Value>>>,
    handle: JoinHandle<()>,
}

impl Host {
    async fn start(auto_pong: bool, send_control: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let msgs = messages.clone();
        let handle = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let msgs = msgs.clone();
                    tokio::spawn(async move {
                        Host::serve_connection(stream, msgs, auto_pong, send_control).await;
                    });
                }
                Err(_) => break,
            }
        }
        });
        Self { addr, messages, handle }
    }

    async fn serve_connection(stream: TcpStream, msgs: Arc<Mutex<Vec<Value>>>, auto_pong: bool, send_control: bool) {
        let ws = accept_async(stream).await.unwrap();
        Host::read_loop(ws, msgs, auto_pong, send_control).await;
    }

    async fn read_loop(
        mut ws: tokio_tungstenite::WebSocketStream<TcpStream>,
        msgs: Arc<Mutex<Vec<Value>>>,
        auto_pong: bool,
        send_control: bool,
    ) {
        let mut control_sent = false;
        while let Some(msg) = ws.next().await {
            match msg {
                Ok(Message::Text(txt)) => {
                    if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                        if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
                            match t {
                                "auth" => {
                                    let _ = ws
                                        .send(Message::Text(
                                            "{\"type\":\"auth_success\",\"role\":\"bridge\"}"
                                                .into(),
                                        ))
                                        .await;
                                }
                                "ping" => {
                                    if auto_pong {
                                        let _ = ws
                                            .send(Message::Text("{\"type\":\"pong\"}".into()))
                                            .await;
                                    }
                                }
                                "hello" => {
                                    if send_control && !control_sent {
                                        control_sent = true;
                                        let _ = ws
                                            .send(Message::Text(
                                                "{\"type\":\"control_request\",\"id\":\"c1\",\"action\":\"echo\",\"args\":{\"value\":1}}".into(),
                                            ))
                                            .await;
                                    }
                                }
                                _ => {}
                            }
                        }
                        msgs.lock().unwrap().push(v);
                    }
                }
                Ok(Message::Ping(_)) => {
                    let _ = ws.send(Message::Pong(Vec::new().into())).await;
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    }
}

#[tokio::test]
async fn handshake_and_buffer_drop_notice() {
    let host = Host::start(true, false).await;
    let cfg = BridgeConfig { url: format!("ws://{}", host.addr), buffer_limit: 3, ..BridgeConfig::default() };
    let client = BridgeClient::new(cfg);

    for i in 0..5 {
        client.send_console("info", &format!("m{}", i)).await;
    }

    let run = tokio::spawn(async move { client.run_with_reconnect().await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    run.abort();

    host.handle.abort();
    let msgs = host.messages.lock().unwrap().clone();

    let types: Vec<String> = msgs.iter().filter_map(|v| v.get("type").and_then(|t| t.as_str()).map(|s| s.to_string())).collect();
    assert_eq!(types[0], "auth");
    assert_eq!(types[1], "hello");

    let consoles: Vec<String> = msgs
        .iter()
        .filter(|v| v.get("type") == Some(&Value::String("console".into())))
        .filter_map(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
        .collect();
    assert_eq!(consoles, vec!["m2", "m3", "m4"]);

    let drop_info = msgs.iter().find(|v| v.get("type") == Some(&Value::String("info".into())));
    assert!(drop_info.is_some());
    assert!(drop_info.unwrap()["message"].as_str().unwrap().contains("drop count=2"));
}

#[tokio::test]
async fn control_request_roundtrip() {
    let host = Host::start(true, true).await;
    let cfg = BridgeConfig { url: format!("ws://{}", host.addr), ..BridgeConfig::default() };
    let client = BridgeClient::new(cfg);
    client.on_control(|msg| {
        if msg.get("action").and_then(|a| a.as_str()) == Some("echo") {
            Ok(json!({"echo": msg.get("args")}))
        } else {
            Err("boom".into())
        }
    });

    let run = tokio::spawn(async move { client.run_with_reconnect().await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    run.abort();
    host.handle.abort();
    let msgs = host.messages.lock().unwrap().clone();
    let resp = msgs.iter().find(|v| v.get("type") == Some(&Value::String("control_result".into())));
    assert!(resp.is_some());
    assert_eq!(resp.unwrap().get("ok").and_then(|o| o.as_bool()), Some(true));
}

#[tokio::test]
async fn heartbeat_timeout_reconnects() {
    let host = Host::start(false, false).await;
    let cfg = BridgeConfig {
        url: format!("ws://{}", host.addr),
        heartbeat_interval_ms: 50,
        heartbeat_timeout_ms: 120,
        backoff_initial_ms: 50,
        backoff_max_ms: 200,
        ..BridgeConfig::default()
    };
    let client = BridgeClient::new(cfg);
    let run = tokio::spawn(async move { client.run_with_reconnect().await.unwrap() });
    tokio::time::sleep(std::time::Duration::from_millis(6000)).await;
    run.abort();
    host.handle.abort();
    let msgs = host.messages.lock().unwrap();
    let opens = msgs.iter().filter(|v| v.get("type") == Some(&Value::String("hello".into()))).count();
    assert!(opens >= 2);
}

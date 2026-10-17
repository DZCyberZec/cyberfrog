//! AI assistant: the user's Anthropic API key in the macOS Keychain and calls to the Claude Messages API.
//! The key never reaches the webview; the UI only sends the prompt and gets the text back.

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

const SERVICE: &str = "com.cyberzec.cyberfrog.anthropic";
const ACCOUNT: &str = "api-key";
const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";

/// Anthropic keys look like `sk-ant-…` with URL-safe characters; checking this also keeps the key
/// safe to pass through `security -i`, which parses its input like a shell line.
fn valid_key(key: &str) -> bool {
    key.starts_with("sk-ant-")
        && key.len() < 300
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Stores the key in the login Keychain, replacing any previous one; an empty key removes it.
pub fn set_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT])
            .output();
        return Ok(());
    }
    if !valid_key(key) {
        return Err("Chiave API non valida: deve iniziare con sk-ant-".into());
    }
    // the key goes through stdin, never argv, so other processes can't read it from `ps`
    let mut child = Command::new("security")
        .arg("-i")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Portachiavi non disponibile: {e}"))?;
    child
        .stdin
        .take()
        .expect("stdin is piped")
        .write_all(
            format!("add-generic-password -U -s {SERVICE} -a {ACCOUNT} -l CyberFrog -w {key}\n")
                .as_bytes(),
        )
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() || !out.stderr.is_empty() {
        return Err(format!(
            "Portachiavi: salvataggio non riuscito ({})",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

pub fn get_key() -> Option<String> {
    let out = Command::new("security")
        .args(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"])
        .output()
        .ok()?;
    let key = String::from_utf8(out.stdout).ok()?.trim().to_owned();
    (out.status.success() && !key.is_empty()).then_some(key)
}

/// One request to Claude; returns the text of the answer.
pub async fn complete(system: &str, prompt: &str) -> Result<String, String> {
    let key = get_key().ok_or("Aggiungi la tua chiave API Anthropic nelle Impostazioni.")?;
    complete_at(API_URL, &key, system, prompt).await
}

async fn complete_at(url: &str, key: &str, system: &str, prompt: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": MODEL,
        "max_tokens": 16000,
        "output_config": {"effort": "medium"},
        // re-runs a request the safety classifiers decline on the recommended fallback model
        "fallbacks": "default",
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    });
    let resp = reqwest::Client::new()
        .post(url)
        .timeout(Duration::from_secs(180))
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Connessione ad Anthropic non riuscita: {e}"))?;
    let status = resp.status().as_u16();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Risposta di Anthropic interrotta: {e}"))?;
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Risposta di Anthropic non leggibile: {e}"))?;
    if status != 200 {
        let message = json["error"]["message"]
            .as_str()
            .unwrap_or("errore sconosciuto");
        return Err(match status {
            401 | 403 => {
                "Chiave API non valida o senza permessi: controllala nelle Impostazioni.".into()
            }
            429 => "Limite di richieste Anthropic raggiunto: riprova tra poco.".into(),
            529 => "Claude è sovraccarico: riprova tra poco.".into(),
            _ => format!("Errore Anthropic {status}: {message}"),
        });
    }
    if json["stop_reason"] == "refusal" {
        return Err("Claude ha rifiutato la richiesta.".into());
    }
    // thinking blocks come back empty by default; only text blocks are the answer
    let text: String = json["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect();
    if text.trim().is_empty() {
        return Err("Claude non ha restituito testo.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Answers one request with `status` and `body`, and hands back the raw request it received.
    async fn serve_once(
        status: &'static str,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/messages", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut req = Vec::new();
            let mut buf = [0; 8192];
            // read headers, then as much body as Content-Length says
            loop {
                let n = sock.read(&mut buf).await.unwrap();
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req);
                if let Some(end) = text.find("\r\n\r\n") {
                    let len = text
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if req.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            sock.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&req).into_owned()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn sends_the_documented_request_and_joins_text_blocks() {
        let (url, req) = serve_once(
            "200 OK",
            r#"{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"Ciao "},{"type":"text","text":"mondo"}]}"#,
        )
        .await;
        let text = complete_at(&url, "sk-ant-test", "sys", "domanda")
            .await
            .unwrap();
        assert_eq!(text, "Ciao mondo");
        let req = req.await.unwrap().to_ascii_lowercase();
        assert!(req.contains("x-api-key: sk-ant-test"));
        assert!(req.contains("anthropic-version: 2023-06-01"));
        assert!(req.contains("anthropic-beta: server-side-fallback-2026-07-01"));
        assert!(req.contains(r#""model":"claude-opus-5-5""#));
        assert!(req.contains(r#""fallbacks":"default""#));
    }

    #[tokio::test]
    async fn maps_api_errors_and_refusals() {
        let (url, _) = serve_once("401 Unauthorized", r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#).await;
        assert!(
            complete_at(&url, "k", "s", "p")
                .await
                .unwrap_err()
                .starts_with("Chiave API non valida")
        );
        let (url, _) = serve_once(
            "400 Bad Request",
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}"#,
        )
        .await;
        assert_eq!(
            complete_at(&url, "k", "s", "p").await.unwrap_err(),
            "Errore Anthropic 400: bad"
        );
        let (url, _) = serve_once("200 OK", r#"{"stop_reason":"refusal","content":[]}"#).await;
        assert_eq!(
            complete_at(&url, "k", "s", "p").await.unwrap_err(),
            "Claude ha rifiutato la richiesta."
        );
    }

    #[test]
    fn only_well_formed_keys_are_stored() {
        assert!(valid_key("sk-ant-api03-AbC_12-x"));
        assert!(!valid_key("sk-ant-x y"));
        assert!(!valid_key("sk-ant-x\nadd-generic-password"));
        assert!(!valid_key("hello"));
    }
}

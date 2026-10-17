//! Claude through the Messages API, paid per token with the user's API key.

use std::time::Duration;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-opus-5-5";

pub async fn complete(key: &str, system: &str, prompt: &str) -> Result<String, String> {
    complete_at(API_URL, key, system, prompt).await
}

async fn complete_at(url: &str, key: &str, system: &str, prompt: &str) -> Result<String, String> {
    let json = post(
        url,
        key,
        &request(
            system,
            vec![serde_json::json!({"role": "user", "content": prompt})],
            None,
        ),
    )
    .await?;
    // thinking blocks come back empty by default; only text blocks are the answer
    let text = texts(&json);
    if text.trim().is_empty() {
        return Err("Claude non ha restituito testo.".into());
    }
    Ok(text)
}

fn request(
    system: &str,
    messages: Vec<serde_json::Value>,
    tools: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": MODEL,
        "max_tokens": 16000,
        "output_config": {"effort": "medium"},
        // re-runs a request the safety classifiers decline on the recommended fallback model
        "fallbacks": "default",
        "system": system,
        "messages": messages,
    });
    if let Some(tools) = tools {
        body["tools"] = tools;
    }
    body
}

fn texts(json: &serde_json::Value) -> String {
    json["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect()
}

/// One Messages API call; maps HTTP errors and refusals to messages for the user.
async fn post(url: &str, key: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
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
    Ok(json)
}

/// Turns the server-side web search may take before Claude finishes; each `pause_turn` resumes it.
const MAX_SEARCH_TURNS: usize = 4;

/// Answers `query` with Claude's server-side web search, returning the answer and its sources.
pub async fn search(key: &str, system: &str, query: &str) -> Result<super::SearchAnswer, String> {
    search_at(API_URL, key, system, query).await
}

async fn search_at(
    url: &str,
    key: &str,
    system: &str,
    query: &str,
) -> Result<super::SearchAnswer, String> {
    let tools =
        serde_json::json!([{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}]);
    let mut messages = vec![serde_json::json!({"role": "user", "content": query})];
    let mut answer = super::SearchAnswer::default();
    for _ in 0..MAX_SEARCH_TURNS {
        let json = post(
            url,
            key,
            &request(system, messages.clone(), Some(tools.clone())),
        )
        .await?;
        answer.answer.push_str(&texts(&json));
        collect_sources(&json["content"], &mut answer);
        if json["stop_reason"] != "pause_turn" {
            break;
        }
        // a paused turn continues by sending its content back as the assistant's message
        messages.push(serde_json::json!({"role": "assistant", "content": json["content"]}));
    }
    if answer.answer.trim().is_empty() {
        return Err("Claude non ha restituito testo.".into());
    }
    Ok(answer)
}

/// URLs cited in the answer (citations) and the ones the search returned, each list deduplicated.
fn collect_sources(v: &serde_json::Value, out: &mut super::SearchAnswer) {
    match v {
        serde_json::Value::Array(items) => items.iter().for_each(|i| collect_sources(i, out)),
        serde_json::Value::Object(map) => {
            if let Some(url) = map.get("url").and_then(|u| u.as_str()) {
                let list = match map.get("type").and_then(|t| t.as_str()) {
                    Some("web_search_result_location") => Some(&mut out.cited),
                    Some("web_search_result") => Some(&mut out.results),
                    _ => None,
                };
                if let Some(list) = list
                    && !list.iter().any(|u| u == url)
                {
                    list.push(url.to_owned());
                }
            }
            map.values().for_each(|i| collect_sources(i, out));
        }
        _ => {}
    }
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
    async fn web_search_collects_cited_and_returned_sources() {
        let (url, req) = serve_once(
            "200 OK",
            r#"{"stop_reason":"end_turn","content":[
                {"type":"server_tool_use","name":"web_search","input":{"query":"seo marche"}},
                {"type":"web_search_tool_result","content":[{"type":"web_search_result","url":"https://a.it/","title":"A"},{"type":"web_search_result","url":"https://b.it/x","title":"B"}]},
                {"type":"text","text":"Consulenti SEO nelle Marche: ","citations":[{"type":"web_search_result_location","url":"https://b.it/x","cited_text":"..."}]},
                {"type":"text","text":"B è il più citato."}]}"#,
        )
        .await;
        let a = search_at(&url, "k", "sys", "consulente seo marche")
            .await
            .unwrap();
        assert_eq!(a.answer, "Consulenti SEO nelle Marche: B è il più citato.");
        assert_eq!(a.cited, vec!["https://b.it/x"]);
        assert_eq!(a.results, vec!["https://a.it/", "https://b.it/x"]);
        assert!(
            req.await
                .unwrap()
                .contains(r#""type":"web_search_20260209""#)
        );
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
}

//! "Sign in with Google" for a desktop app (RFC 8252): the browser comes back to a one-shot listener
//! on 127.0.0.1, and PKCE (RFC 7636) plus a random state tie the answer to this request.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use url::Url;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// Read-only Search Console, plus the email so the app can say which account is connected.
pub const SCOPES: &str = "https://www.googleapis.com/auth/webmasters.readonly openid email";
/// The user has this long to finish signing in in the browser.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// An OAuth client of type "Desktop app", as in the JSON Google Cloud lets you download.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Client {
    pub client_id: String,
    /// Google issues one to desktop clients too; it is not confidential there (RFC 8252 §8.5).
    pub client_secret: String,
}

impl Client {
    /// Accepts the downloaded file (`{"installed": {...}}`) or the bare object.
    pub fn from_json(json: &str) -> Result<Self, String> {
        let v: serde_json::Value = serde_json::from_str(json)
            .map_err(|_| "File client OAuth non valido: non è JSON".to_string())?;
        if v.get("web").is_some() {
            return Err("Client OAuth di tipo \"Applicazione web\": in Google Cloud crea un client di tipo \"App desktop\"".into());
        }
        let c = v.get("installed").unwrap_or(&v);
        let field = |k: &str| {
            c.get(k)
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        };
        let client = Client {
            client_id: field("client_id").ok_or("File client OAuth non valido: manca client_id")?,
            client_secret: field("client_secret")
                .ok_or("File client OAuth non valido: manca client_secret")?,
        };
        if !client.client_id.ends_with(".apps.googleusercontent.com") {
            return Err("File client OAuth non valido: client_id non è di Google".into());
        }
        Ok(client)
    }

    /// The client built into release builds, from environment variables at compile time, so the
    /// repository never holds it.
    pub fn builtin() -> Option<Self> {
        Some(Client {
            client_id: option_env!("CYBERFROG_GOOGLE_CLIENT_ID")?.to_owned(),
            client_secret: option_env!("CYBERFROG_GOOGLE_CLIENT_SECRET")?.to_owned(),
        })
    }
}

/// Tokens from the token endpoint; only the fields we use.
#[derive(Debug, serde::Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
}

fn random_b64(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    aws_lc_rs::rand::fill(&mut buf)
        .map_err(|_| "Generatore casuale non disponibile".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

/// S256 code challenge of a PKCE verifier.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(aws_lc_rs::digest::digest(
        &aws_lc_rs::digest::SHA256,
        verifier.as_bytes(),
    ))
}

fn auth_url(client: &Client, redirect: &str, state: &str, challenge: &str) -> String {
    let mut url = Url::parse(AUTH_URL).expect("static URL");
    url.query_pairs_mut()
        .append_pair("client_id", &client.client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        // a refresh token, so the user signs in once
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url.into()
}

/// The `code` from the browser's request line, after checking `state`; Google's error otherwise.
pub fn parse_callback(request_line: &str, state: &str) -> Result<Option<String>, String> {
    let Some(target) = request_line.split_whitespace().nth(1) else {
        return Ok(None);
    };
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|e| e.to_string())?;
    let get = |k: &str| {
        url.query_pairs()
            .find(|(name, _)| name == k)
            .map(|(_, v)| v.into_owned())
    };
    if let Some(err) = get("error") {
        return Err(if err == "access_denied" {
            "Accesso a Google annullato".into()
        } else {
            format!("Google ha rifiutato l'accesso: {err}")
        });
    }
    match (get("code"), get("state")) {
        (Some(code), Some(s)) if s == state => Ok(Some(code)),
        (Some(_), _) => Err("Risposta di Google non valida (state diverso): riprova".into()),
        // favicon and other requests the browser may send first
        _ => Ok(None),
    }
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>CyberFrog</title>\
<body style=\"font:16px system-ui;margin:15vh auto;max-width:420px;text-align:center\">\
<h1>✓ CyberFrog</h1><p>Accesso completato: puoi chiudere questa scheda e tornare all'app.</p>";

/// Opens Google's consent page and waits for the browser to come back with an authorization code.
pub async fn sign_in(client: &Client) -> Result<Tokens, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let redirect = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let (state, verifier) = (random_b64(24)?, random_b64(48)?);
    let url = auth_url(client, &redirect, &state, &challenge(&verifier));
    // `open` is macOS's own launcher; the URL is one argument, never a shell string
    std::process::Command::new("/usr/bin/open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Browser non avviabile: {e}"))?;

    let code = tokio::time::timeout(LOGIN_TIMEOUT, async {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.map_err(|e| e.to_string())?;
            let request = String::from_utf8_lossy(&buf[..n]);
            let result = parse_callback(request.lines().next().unwrap_or(""), &state);
            let body = if matches!(result, Ok(Some(_))) { DONE_PAGE } else { "" };
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = sock.write_all(reply.as_bytes()).await;
            if let Some(code) = result? {
                return Ok::<String, String>(code);
            }
        }
    })
    .await
    .map_err(|_| "Accesso a Google non completato entro 5 minuti".to_string())??;

    token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("client_id", &client.client_id),
        ("client_secret", &client.client_secret),
        ("redirect_uri", &redirect),
        ("code_verifier", &verifier),
    ])
    .await
}

pub async fn refresh(client: &Client, refresh_token: &str) -> Result<Tokens, String> {
    token_request(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", &client.client_id),
        ("client_secret", &client.client_secret),
    ])
    .await
}

/// POST to Google's token endpoint with a form body; shared with the service account flow.
pub async fn token_request(form: &[(&str, &str)]) -> Result<Tokens, String> {
    token_request_at(TOKEN_URL, form).await
}

pub async fn token_request_at(url: &str, form: &[(&str, &str)]) -> Result<Tokens, String> {
    let body: String = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form)
        .finish();
    let resp = reqwest::Client::new()
        .post(url)
        .timeout(Duration::from_secs(30))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Connessione a Google non riuscita: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let err = v["error"].as_str().unwrap_or("errore sconosciuto");
        return Err(if err == "invalid_grant" {
            "Accesso a Google scaduto o revocato: accedi di nuovo dalle Impostazioni".into()
        } else {
            format!("Google ha rifiutato il token: {err}")
        });
    }
    serde_json::from_str(&text).map_err(|e| format!("Risposta di Google non leggibile: {e}"))
}

/// The email inside an ID token. Not verified: it came straight from Google's token endpoint over
/// TLS, and is only shown to the user.
pub fn email_of(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let json: serde_json::Value =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    json["email"].as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_the_rfc_example() {
        // RFC 7636 appendix B
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_ne!(random_b64(32).unwrap(), random_b64(32).unwrap());
    }

    #[test]
    fn reads_desktop_clients_and_rejects_others() {
        let json = r#"{"installed":{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"GOCSPX-x","redirect_uris":["http://localhost"]}}"#;
        assert_eq!(
            Client::from_json(json).unwrap().client_id,
            "123-abc.apps.googleusercontent.com"
        );
        assert!(
            Client::from_json(r#"{"web":{"client_id":"x"}}"#)
                .unwrap_err()
                .contains("App desktop")
        );
        assert!(
            Client::from_json(
                r#"{"installed":{"client_id":"evil.example.com","client_secret":"s"}}"#
            )
            .is_err()
        );
        assert!(Client::from_json("not json").is_err());
    }

    #[test]
    fn checks_state_and_reads_the_code() {
        assert_eq!(
            parse_callback("GET /?code=4%2Fabc&state=s1&scope=x HTTP/1.1", "s1").unwrap(),
            Some("4/abc".into())
        );
        assert!(
            parse_callback("GET /?code=x&state=other HTTP/1.1", "s1").is_err(),
            "a forged answer is refused"
        );
        assert!(
            parse_callback("GET /?error=access_denied&state=s1 HTTP/1.1", "s1")
                .unwrap_err()
                .contains("annullato")
        );
        assert_eq!(
            parse_callback("GET /favicon.ico HTTP/1.1", "s1").unwrap(),
            None
        );
    }

    #[test]
    fn builds_the_consent_url_with_pkce_and_read_only_scope() {
        let c = Client {
            client_id: "id.apps.googleusercontent.com".into(),
            client_secret: "s".into(),
        };
        let url = Url::parse(&auth_url(&c, "http://127.0.0.1:5555", "st", "ch")).unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555");
        assert!(q["scope"].contains("webmasters.readonly") && !q["scope"].contains("webmasters "));
        assert!(
            !url.as_str().contains("client_secret"),
            "the secret never goes to the browser"
        );
    }

    #[test]
    fn reads_the_email_from_an_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(r#"{"email":"me@example.com"}"#);
        assert_eq!(
            email_of(&format!("h.{payload}.sig")).as_deref(),
            Some("me@example.com")
        );
        assert_eq!(email_of("garbage"), None);
    }
}

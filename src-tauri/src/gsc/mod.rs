//! Google Search Console: sign in (OAuth, or a service account as the advanced option), keep the
//! credentials in the Keychain, and read Search Analytics. Access tokens live only in memory.

pub mod api;
pub mod oauth;
pub mod service_account;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::secrets::{self, GOOGLE};
use oauth::Client;
use service_account::ServiceAccount;

/// Keychain accounts under the Google service.
const CLIENT: &str = "oauth-client";
const OAUTH: &str = "oauth";
const SERVICE_ACCOUNT: &str = "service-account";

/// What the OAuth sign-in leaves in the Keychain.
#[derive(serde::Serialize, serde::Deserialize)]
struct Saved {
    refresh_token: String,
    email: Option<String>,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Status {
    pub connected: bool,
    /// "oauth" or "service_account".
    pub method: Option<&'static str>,
    pub account: Option<String>,
    /// Which OAuth client sign-in would use: "builtin" (in the app) or "custom" (imported).
    pub client: Option<&'static str>,
}

/// The access token and when it stops working; never written to disk.
static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn custom_client() -> Option<Client> {
    serde_json::from_str(&secrets::load(GOOGLE, CLIENT)?).ok()
}

fn client() -> Option<(Client, &'static str)> {
    custom_client()
        .map(|c| (c, "custom"))
        .or_else(|| Client::builtin().map(|c| (c, "builtin")))
}

fn saved() -> Option<Saved> {
    serde_json::from_str(&secrets::load(GOOGLE, OAUTH)?).ok()
}

fn service_account() -> Option<ServiceAccount> {
    serde_json::from_str(&secrets::load(GOOGLE, SERVICE_ACCOUNT)?).ok()
}

pub fn status() -> Status {
    let client = client().map(|(_, kind)| kind);
    if let Some(sa) = service_account() {
        return Status {
            connected: true,
            method: Some("service_account"),
            account: Some(sa.client_email),
            client,
        };
    }
    match saved() {
        Some(s) => Status {
            connected: true,
            method: Some("oauth"),
            account: s.email,
            client,
        },
        None => Status {
            connected: false,
            method: None,
            account: None,
            client,
        },
    }
}

fn remember(token: &str, expires_in: Option<u64>) {
    // a minute early, so a token never expires mid-request
    let ttl = Duration::from_secs(expires_in.unwrap_or(3600).saturating_sub(60));
    *ACCESS.lock().expect("token lock") = Some((token.to_owned(), Instant::now() + ttl));
}

pub async fn login() -> Result<Status, String> {
    let (client, _) = client()
        .ok_or("Nessun client OAuth: importa il file JSON del client Google nelle Impostazioni")?;
    let tokens = oauth::sign_in(&client).await?;
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or("Google non ha restituito un token di aggiornamento: riprova")?;
    let email = tokens.id_token.as_deref().and_then(oauth::email_of);
    secrets::store(
        GOOGLE,
        OAUTH,
        &serde_json::to_string(&Saved {
            refresh_token,
            email,
        })
        .map_err(|e| e.to_string())?,
    )?;
    // one connection at a time: signing in replaces a service account
    secrets::remove(GOOGLE, SERVICE_ACCOUNT);
    remember(&tokens.access_token, tokens.expires_in);
    Ok(status())
}

pub fn logout() {
    secrets::remove(GOOGLE, OAUTH);
    secrets::remove(GOOGLE, SERVICE_ACCOUNT);
    *ACCESS.lock().expect("token lock") = None;
}

pub fn set_client(json: &str) -> Result<(), String> {
    let client = Client::from_json(json)?;
    secrets::store(
        GOOGLE,
        CLIENT,
        &serde_json::to_string(&client).map_err(|e| e.to_string())?,
    )
}

pub fn set_service_account(json: &str) -> Result<Status, String> {
    let sa = ServiceAccount::from_json(json)?;
    secrets::store(
        GOOGLE,
        SERVICE_ACCOUNT,
        &serde_json::to_string(&sa).map_err(|e| e.to_string())?,
    )?;
    secrets::remove(GOOGLE, OAUTH);
    *ACCESS.lock().expect("token lock") = None;
    Ok(status())
}

async fn access_token() -> Result<String, String> {
    if let Some((token, until)) = ACCESS.lock().expect("token lock").clone()
        && Instant::now() < until
    {
        return Ok(token);
    }
    let tokens = if let Some(sa) = service_account() {
        service_account::token(&sa).await?
    } else {
        let s = saved().ok_or("Collega Google Search Console nelle Impostazioni")?;
        let (client, _) = client().ok_or(
            "Nessun client OAuth: importa il file JSON del client Google nelle Impostazioni",
        )?;
        oauth::refresh(&client, &s.refresh_token).await?
    };
    remember(&tokens.access_token, tokens.expires_in);
    Ok(tokens.access_token)
}

pub async fn sites() -> Result<Vec<api::Site>, String> {
    api::sites(&access_token().await?).await
}

pub async fn query(site: &str, start: &str, end: &str) -> Result<api::GscData, String> {
    api::query(&access_token().await?, site, start, end).await
}

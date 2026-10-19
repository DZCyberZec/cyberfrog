//! Google Search Console: sign in (OAuth, or a service account as the advanced option), keep the
//! credentials in the Keychain, and read Search Analytics. Several accounts can be connected at once;
//! access tokens live only in memory.

pub mod accounts;
pub mod api;
pub mod oauth;
pub mod service_account;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::secrets::{self, GOOGLE};
use accounts::{Account, Credentials, Saved};
use oauth::Client;
use service_account::ServiceAccount;

/// Keychain item with the imported OAuth client.
const CLIENT: &str = "oauth-client";

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Status {
    pub accounts: Vec<Account>,
    /// Which OAuth client sign-in would use: "builtin" (in the app) or "custom" (imported).
    pub client: Option<&'static str>,
}

/// A property and the account that can read it.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct SiteOf {
    pub site_url: String,
    pub permission_level: String,
    pub account: String,
    pub email: Option<String>,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Sites {
    pub sites: Vec<SiteOf>,
    /// Accounts that could not be read, as "email: error", so one expired account doesn't hide the rest.
    pub failed: Vec<String>,
}

/// Access tokens per account id and when they stop working; never written to disk.
static ACCESS: Mutex<Option<HashMap<String, (String, Instant)>>> = Mutex::new(None);

fn custom_client() -> Option<Client> {
    serde_json::from_str(&secrets::load(GOOGLE, CLIENT)?).ok()
}

fn client() -> Option<(Client, &'static str)> {
    custom_client()
        .map(|c| (c, "custom"))
        .or_else(|| Client::builtin().map(|c| (c, "builtin")))
}

pub fn status() -> Status {
    Status {
        accounts: accounts::list(),
        client: client().map(|(_, kind)| kind),
    }
}

fn remember(id: &str, token: &str, expires_in: Option<u64>) {
    // a minute early, so a token never expires mid-request
    let ttl = Duration::from_secs(expires_in.unwrap_or(3600).saturating_sub(60));
    ACCESS
        .lock()
        .expect("token lock")
        .get_or_insert_default()
        .insert(id.to_owned(), (token.to_owned(), Instant::now() + ttl));
}

fn forget(id: &str) {
    if let Some(map) = ACCESS.lock().expect("token lock").as_mut() {
        map.remove(id);
    }
}

/// Adds a Google account by signing in; the same account signed in again replaces its old entry.
/// `client_json` gives this account an OAuth client of its own (e.g. a Google Cloud project of the
/// site owner); otherwise the shared client is used.
pub async fn login(client_json: Option<&str>) -> Result<Status, String> {
    let own_client = client_json.is_some();
    let client = match client_json {
        Some(json) => Client::from_json(json)?,
        None => client()
            .ok_or(
                "Nessun client OAuth: importa il file JSON del client Google nelle Impostazioni",
            )?
            .0,
    };
    let tokens = oauth::sign_in(&client).await?;
    let refresh_token = tokens
        .refresh_token
        .clone()
        .ok_or("Google non ha restituito un token di aggiornamento: riprova")?;
    let email = tokens.id_token.as_deref().and_then(oauth::email_of);
    let account = accounts::store(Credentials::OAuth(Saved {
        refresh_token,
        email,
        client: Some(client),
        own_client,
    }))?;
    remember(&account.id, &tokens.access_token, tokens.expires_in);
    Ok(status())
}

pub fn logout(id: &str) -> Result<Status, String> {
    accounts::remove(id)?;
    forget(id);
    Ok(status())
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
    let account = accounts::store(Credentials::ServiceAccount(sa))?;
    forget(&account.id);
    Ok(status())
}

async fn access_token(id: &str) -> Result<String, String> {
    if let Some((token, until)) = ACCESS
        .lock()
        .expect("token lock")
        .as_ref()
        .and_then(|m| m.get(id).cloned())
        && Instant::now() < until
    {
        return Ok(token);
    }
    let tokens = match accounts::credentials(id)? {
        Credentials::ServiceAccount(sa) => service_account::token(&sa).await?,
        Credentials::OAuth(saved) => {
            let client = match saved.client {
                Some(c) => c,
                None => client().map(|(c, _)| c).ok_or(
                    "Nessun client OAuth: importa il file JSON del client Google nelle Impostazioni",
                )?,
            };
            oauth::refresh(&client, &saved.refresh_token).await?
        }
    };
    remember(id, &tokens.access_token, tokens.expires_in);
    Ok(tokens.access_token)
}

/// Properties of every connected account.
pub async fn sites() -> Result<Sites, String> {
    let list = accounts::list();
    if list.is_empty() {
        return Err("Collega Google Search Console nelle Impostazioni".into());
    }
    let mut out = Sites {
        sites: Vec::new(),
        failed: Vec::new(),
    };
    for account in list {
        let found = match access_token(&account.id).await {
            Ok(token) => api::sites(&token).await,
            Err(e) => Err(e),
        };
        match found {
            Ok(sites) => out.sites.extend(sites.into_iter().map(|s| SiteOf {
                site_url: s.site_url,
                permission_level: s.permission_level,
                account: account.id.clone(),
                email: account.email.clone(),
            })),
            Err(e) => out.failed.push(format!(
                "{}: {e}",
                account.email.as_deref().unwrap_or("Google")
            )),
        }
    }
    Ok(out)
}

pub async fn query(
    account: &str,
    site: &str,
    start: &str,
    end: &str,
) -> Result<api::GscData, String> {
    if !accounts::valid_id(account) {
        return Err("Account Google sconosciuto".into());
    }
    api::query(&access_token(account).await?, site, start, end).await
}

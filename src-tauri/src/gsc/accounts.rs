//! Several Google connections side by side (one per client, agency or site owner). The list of
//! accounts holds no secrets; each account's refresh token or service-account key is its own
//! Keychain item, named after the account id.

use crate::secrets::{self, GOOGLE};
use service_account::ServiceAccount;

use super::oauth::Client;
use super::service_account;

/// Keychain item with the account list.
const INDEX: &str = "accounts";
/// Where v0.10 kept its single connection; moved into the list on first read.
const LEGACY_OAUTH: &str = "oauth";
const LEGACY_SERVICE_ACCOUNT: &str = "service-account";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Account {
    /// Short hex id, also part of the Keychain item name.
    pub id: String,
    /// "oauth" or "service_account".
    pub method: String,
    pub email: Option<String>,
    /// Signed in with an OAuth client of its own, not the one shared by every account.
    #[serde(default)]
    pub own_client: bool,
}

/// What an OAuth sign-in leaves in the Keychain.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Saved {
    pub refresh_token: String,
    pub email: Option<String>,
    /// The client the account signed in with: Google only refreshes a token for that same client,
    /// so it stays with the account even if the shared client changes later. None before v0.11.1.
    #[serde(default)]
    pub client: Option<Client>,
    #[serde(default)]
    pub own_client: bool,
}

pub enum Credentials {
    OAuth(Saved),
    ServiceAccount(ServiceAccount),
}

/// Same method and identity give the same id, so signing in again replaces the old entry.
pub fn id_for(method: &str, identity: &str) -> String {
    let hash = aws_lc_rs::digest::digest(
        &aws_lc_rs::digest::SHA256,
        format!("{method}\n{identity}").as_bytes(),
    );
    hash.as_ref()[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Ids come back from the webview: only our own 16-hex-digit ids name a Keychain item.
pub fn valid_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn item(id: &str) -> String {
    format!("account-{id}")
}

fn save_index(list: &[Account]) -> Result<(), String> {
    if list.is_empty() {
        secrets::remove(GOOGLE, INDEX);
        return Ok(());
    }
    secrets::store(
        GOOGLE,
        INDEX,
        &serde_json::to_string(list).map_err(|e| e.to_string())?,
    )
}

pub fn list() -> Vec<Account> {
    let mut list: Vec<Account> = secrets::load(GOOGLE, INDEX)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    // move a v0.10 connection into the list, once
    if let Some(text) = secrets::load(GOOGLE, LEGACY_OAUTH)
        && let Ok(saved) = serde_json::from_str::<Saved>(&text)
        && add(&mut list, Credentials::OAuth(saved)).is_ok()
    {
        secrets::remove(GOOGLE, LEGACY_OAUTH);
    }
    if let Some(text) = secrets::load(GOOGLE, LEGACY_SERVICE_ACCOUNT)
        && let Ok(sa) = serde_json::from_str::<ServiceAccount>(&text)
        && add(&mut list, Credentials::ServiceAccount(sa)).is_ok()
    {
        secrets::remove(GOOGLE, LEGACY_SERVICE_ACCOUNT);
    }
    list
}

/// Stores the credentials and puts the account in `list` (replacing the same account), then saves the list.
fn add(list: &mut Vec<Account>, credentials: Credentials) -> Result<Account, String> {
    let (account, secret) = match &credentials {
        Credentials::OAuth(s) => (
            Account {
                id: id_for("oauth", s.email.as_deref().unwrap_or(&s.refresh_token)),
                method: "oauth".into(),
                email: s.email.clone(),
                own_client: s.own_client,
            },
            serde_json::to_string(s),
        ),
        Credentials::ServiceAccount(sa) => (
            Account {
                id: id_for("service_account", &sa.client_email),
                method: "service_account".into(),
                email: Some(sa.client_email.clone()),
                own_client: false,
            },
            serde_json::to_string(sa),
        ),
    };
    secrets::store(
        GOOGLE,
        &item(&account.id),
        &secret.map_err(|e| e.to_string())?,
    )?;
    list.retain(|a| a.id != account.id);
    list.push(account.clone());
    save_index(list)?;
    Ok(account)
}

pub fn store(credentials: Credentials) -> Result<Account, String> {
    add(&mut list(), credentials)
}

pub fn remove(id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Account Google sconosciuto".into());
    }
    let mut list = list();
    list.retain(|a| a.id != id);
    secrets::remove(GOOGLE, &item(id));
    save_index(&list)
}

pub fn credentials(id: &str) -> Result<Credentials, String> {
    let account = list()
        .into_iter()
        .find(|a| a.id == id)
        .ok_or("Account Google sconosciuto")?;
    let text = secrets::load(GOOGLE, &item(&account.id))
        .ok_or("Credenziali dell'account Google mancanti: collegalo di nuovo")?;
    let parsed = if account.method == "service_account" {
        serde_json::from_str(&text).map(Credentials::ServiceAccount)
    } else {
        serde_json::from_str(&text).map(Credentials::OAuth)
    };
    parsed.map_err(|_| "Credenziali dell'account Google non valide: collegalo di nuovo".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_short_hex_and_keyed_by_method() {
        let a = id_for("oauth", "me@example.com");
        assert_eq!(a, id_for("oauth", "me@example.com"));
        assert_ne!(a, id_for("service_account", "me@example.com"));
        assert_ne!(a, id_for("oauth", "other@example.com"));
        assert!(valid_id(&a));
        assert!(crate::secrets::plain(&item(&a)));
    }

    #[test]
    fn accounts_saved_before_per_account_clients_still_load() {
        let old: Saved =
            serde_json::from_str(r#"{"refresh_token":"r","email":"me@x.it"}"#).unwrap();
        assert!(old.client.is_none() && !old.own_client);
        let index: Vec<Account> =
            serde_json::from_str(r#"[{"id":"0123456789abcdef","method":"oauth","email":null}]"#)
                .unwrap();
        assert!(!index[0].own_client);
        let new = Saved {
            client: Some(Client {
                client_id: "id".into(),
                client_secret: "s".into(),
            }),
            own_client: true,
            ..old
        };
        let back: Saved = serde_json::from_str(&serde_json::to_string(&new).unwrap()).unwrap();
        assert_eq!(back.client.unwrap().client_id, "id");
        assert!(back.own_client);
    }

    #[test]
    fn only_our_ids_name_a_keychain_item() {
        assert!(!valid_id(""));
        assert!(!valid_id("../../etc"));
        assert!(!valid_id("0123456789abcdeg"));
        assert!(!valid_id("0123456789abcdef0"));
        assert!(!valid_id("01234567 9abcdef"));
    }
}

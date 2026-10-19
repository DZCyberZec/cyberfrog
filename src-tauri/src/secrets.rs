//! Secrets of any shape (Google tokens, OAuth client and service account JSON) in the macOS login
//! Keychain. Each is stored hex-encoded: the text reaching `security` on stdin is then always plain
//! hex, so nothing in a secret can be read as part of the command, and it never appears in argv.

use std::io::Write;
use std::process::{Command, Stdio};

/// Keychain service for everything Google; accounts tell the items apart.
pub const GOOGLE: &str = "com.cyberzec.cyberfrog.google";

/// Secrets this big are a mistake (a wrong file picked), not a key.
const MAX_BYTES: usize = 64 * 1024;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    let text = text.trim();
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Service and account are our own constants; refusing anything else keeps the command line fixed.
pub(crate) fn plain(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

pub fn store(service: &str, account: &str, secret: &str) -> Result<(), String> {
    if !plain(service) || !plain(account) {
        return Err("Nome non valido per il Portachiavi".into());
    }
    if secret.is_empty() || secret.len() > MAX_BYTES {
        return Err("Dato da salvare vuoto o troppo grande".into());
    }
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
            format!(
                "add-generic-password -U -s {service} -a {account} -l CyberFrog -w {}\n",
                hex(secret.as_bytes())
            )
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

pub fn load(service: &str, account: &str) -> Option<String> {
    if !plain(service) || !plain(account) {
        return None;
    }
    let out = Command::new("security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(unhex(&String::from_utf8(out.stdout).ok()?)?).ok()
}

pub fn remove(service: &str, account: &str) {
    if plain(service) && plain(account) {
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", service, "-a", account])
            .output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_any_text_and_names_stay_plain() {
        let json = "{\"private_key\": \"-----BEGIN-----\\nab c\\n\", \"x\": \"é ✓ ; rm -rf\"}\n";
        assert_eq!(unhex(&hex(json.as_bytes())).unwrap(), json.as_bytes());
        assert!(hex(json.as_bytes()).chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(unhex("abc"), None);
        assert!(plain(GOOGLE) && plain("oauth-refresh"));
        assert!(!plain("a b") && !plain("x;y") && !plain(""));
    }
}

//! The user's Anthropic API key in the macOS login Keychain, read and written with `security`.

use std::io::Write;
use std::process::{Command, Stdio};

const SERVICE: &str = "com.cyberzec.cyberfrog.anthropic";
const ACCOUNT: &str = "api-key";

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_well_formed_keys_are_stored() {
        assert!(valid_key("sk-ant-api03-AbC_12-x"));
        assert!(!valid_key("sk-ant-x y"));
        assert!(!valid_key("sk-ant-x\nadd-generic-password"));
        assert!(!valid_key("hello"));
    }
}

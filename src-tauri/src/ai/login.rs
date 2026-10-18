//! Signing the CLIs in from CyberFrog, so nobody needs the Terminal.
//!
//! - Claude Code: `claude auth login` opens the browser; after sign-in Anthropic shows a code, which
//!   the user pastes in CyberFrog and we pass to the CLI on stdin.
//! - Codex: `codex login` opens the browser and finishes by itself.
//!
//! One sign-in at a time; the waiting CLI is kept here until the code arrives or it is cancelled.

use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdout};

/// A Claude Code sign-in waiting for its code. Its output stays open: closing it could stop the
/// CLI when it prints the result.
static PENDING: Mutex<Option<(Child, ChildStdout)>> = Mutex::new(None);

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Started {
    /// The sign-in page, in case the browser didn't open by itself.
    pub url: Option<String>,
    /// Claude Code waits for the code Anthropic shows after sign-in.
    pub needs_code: bool,
}

/// The authorization link in the CLI's output; only Anthropic's own pages are passed on.
pub fn sign_in_url(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|w| {
            w.starts_with("https://claude.com/")
                || w.starts_with("https://claude.ai/")
                || w.starts_with("https://console.anthropic.com/")
        })
        .map(str::to_owned)
}

/// What Anthropic shows is a single token of URL-safe characters (with a `#` in the middle).
pub fn valid_code(code: &str) -> bool {
    let code = code.trim();
    !code.is_empty()
        && code.len() < 1024
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '#' | '.' | '~'))
}

pub fn cancel() {
    if let Some((mut child, _)) = PENDING.lock().expect("login lock").take() {
        let _ = child.start_kill();
    }
}

pub async fn start_claude() -> Result<Started, String> {
    let bin = super::claude_code::find()
        .ok_or("Claude Code non trovato: installalo da claude.com/code.")?;
    cancel();
    let mut child = tokio::process::Command::new(bin)
        .args(["auth", "login", "--claudeai"])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Claude Code non avviabile: {e}"))?;
    // the CLI prints the link, then waits for the code: read until the link shows up
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut seen = String::new();
    let mut buf = [0u8; 4096];
    let read = tokio::time::timeout(Duration::from_secs(15), async {
        while sign_in_url(&seen).is_none() {
            let n = stdout.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            seen.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
        Ok::<(), String>(())
    })
    .await;
    if !matches!(read, Ok(Ok(()))) || sign_in_url(&seen).is_none() {
        let _ = child.start_kill();
        return Err(
            "Claude Code non ha avviato l'accesso: riprova o usa il Terminale (claude, poi /login)"
                .into(),
        );
    }
    *PENDING.lock().expect("login lock") = Some((child, stdout));
    Ok(Started {
        url: sign_in_url(&seen),
        needs_code: true,
    })
}

/// Gives the pending Claude Code sign-in the code from Anthropic's page; true when logged in.
pub async fn finish_claude(code: &str) -> Result<bool, String> {
    if !valid_code(code) {
        return Err("Codice non valido: copia il codice mostrato da Claude dopo l'accesso".into());
    }
    let (mut child, mut stdout) = PENDING
        .lock()
        .expect("login lock")
        .take()
        .ok_or("Nessun accesso in corso: premi di nuovo Accedi")?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    stdin
        .write_all(format!("{}\n", code.trim()).as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    drop(stdin);
    // keep reading what the CLI prints until it exits
    let drain = tokio::spawn(async move {
        let mut sink = Vec::new();
        let _ = stdout.read_to_end(&mut sink).await;
    });
    let waited = tokio::time::timeout(Duration::from_secs(60), child.wait()).await;
    drain.abort();
    match waited {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            let _ = child.start_kill();
            return Err("Claude Code non ha completato l'accesso entro 60 s".into());
        }
    }
    let bin = super::claude_code::find().ok_or("Claude Code non trovato")?;
    Ok(super::claude_code::logged_in(&bin).await)
}

/// Codex signs in by itself in the browser; waits up to 5 minutes. True when logged in.
pub async fn codex() -> Result<bool, String> {
    let bin = super::codex::find()
        .ok_or("Codex non trovato: installa l'app ChatGPT per Mac oppure la CLI Codex.")?;
    let run = tokio::process::Command::new(&bin)
        .arg("login")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .status();
    tokio::time::timeout(Duration::from_secs(300), run)
        .await
        .map_err(|_| "Accesso a Codex non completato entro 5 minuti".to_string())?
        .map_err(|e| format!("Codex non avviabile: {e}"))?;
    Ok(super::codex::logged_in(&bin).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_anthropics_link_and_checks_codes() {
        let out = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x\nPaste code here if prompted > ";
        assert_eq!(
            sign_in_url(out).as_deref(),
            Some("https://claude.com/cai/oauth/authorize?code=true&state=x")
        );
        assert_eq!(
            sign_in_url("visit: https://evil.example/claude.com/"),
            None,
            "only Anthropic's pages"
        );
        assert!(valid_code("AbC-12_x#Yz9.~"));
        assert!(!valid_code("abc\nlogout") && !valid_code("a b") && !valid_code(""));
    }
}

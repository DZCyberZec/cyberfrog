//! Claude's alternative engine: OpenAI's Codex CLI (`codex exec`), on the user's ChatGPT plan.
//!
//! Crawled pages reach the prompt, so Codex runs isolated: the user's config (and so their MCP
//! servers) and exec rules are ignored, the shell, apps, browser, computer use, plugins and hooks
//! are off, the sandbox is read-only, from an empty folder, with the prompt on stdin and a timeout.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

const TIMEOUT: Duration = Duration::from_secs(300);

const ISOLATION: &[&str] = &[
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--color",
    "never",
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.apps=false",
    "-c",
    "features.browser_use=false",
    "-c",
    "features.computer_use=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.hooks=false",
];

/// Apps opened from Finder get a minimal PATH: the ChatGPT app's bundled CLI and the usual install
/// folders are checked first.
pub fn find() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let known = [
        PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
        home.join(".local/bin/codex"),
        home.join(".npm-global/bin/codex"),
    ];
    known.into_iter().find(|p| p.is_file()).or_else(|| {
        std::env::split_paths(&std::env::var_os("PATH")?)
            .map(|d| d.join("codex"))
            .find(|p| p.is_file())
    })
}

/// `codex login status` succeeds and says "Logged in" when the CLI can answer; no tokens spent.
pub async fn logged_in(bin: &Path) -> bool {
    let run = tokio::process::Command::new(bin)
        .args(["login", "status"])
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(Duration::from_secs(10), run).await {
        Ok(Ok(out)) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            out.status.success() && text.contains("Logged in")
        }
        _ => false,
    }
}

fn binary() -> Result<PathBuf, String> {
    find().ok_or_else(|| {
        "Codex non trovato: installa l'app ChatGPT per Mac oppure la CLI Codex.".into()
    })
}

pub async fn complete(system: &str, prompt: &str) -> Result<String, String> {
    run(&binary()?, false, &format!("{system}\n\n---\n\n{prompt}")).await
}

/// Answers `query` with Codex's web search, the only tool it gets.
pub async fn search(system: &str, query: &str) -> Result<super::SearchAnswer, String> {
    let prompt = format!(
        "{system}\nEnd with a line \"{}\" followed by every source URL you used, one per line.\n\n---\n\n{query}",
        super::SOURCES
    );
    let text = run(&binary()?, true, &prompt).await?;
    Ok(super::split_sources(&text))
}

/// `codex exec` prints only the final message on stdout; logs go to stderr.
async fn run(bin: &Path, web_search: bool, prompt: &str) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(bin);
    if web_search {
        cmd.arg("--search");
    }
    let mut child = cmd
        .arg("exec")
        .args(ISOLATION)
        .arg("-")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Codex non avviabile: {e}"))?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    drop(stdin);
    let out = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| format!("Codex non ha risposto entro {} s", TIMEOUT.as_secs()))?
        .map_err(|e| e.to_string())?;
    parse(out.status.success(), &out.stdout, &out.stderr)
}

fn parse(ok: bool, stdout: &[u8], stderr: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(stdout).trim().to_owned();
    if ok && !text.is_empty() {
        return Ok(text);
    }
    let err = String::from_utf8_lossy(stderr).to_lowercase();
    if err.contains("not logged in")
        || err.contains("login")
        || err.contains("401")
        || err.contains("unauthorized")
    {
        return Err(
            "Codex non ha un login attivo: apri il Terminale ed esegui codex login.".into(),
        );
    }
    let last = String::from_utf8_lossy(stderr)
        .trim()
        .lines()
        .last()
        .unwrap_or("nessuna risposta")
        .to_owned();
    Err(format!("Codex: {last}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_final_message_and_explains_failures() {
        assert_eq!(parse(true, b"  OK\n", b"log noise").unwrap(), "OK");
        assert!(
            parse(false, b"", b"Error: Not logged in")
                .unwrap_err()
                .contains("codex login")
        );
        assert_eq!(parse(false, b"", b"one\nboom").unwrap_err(), "Codex: boom");
    }

    #[tokio::test]
    async fn runs_isolated_with_the_prompt_on_stdin() {
        let dir = std::env::temp_dir().join(format!("cyberfrog-fake-codex-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("codex");
        std::fs::write(
            &bin,
            "#!/bin/sh\nin=$(cat)\nprintf '%s|%s' \"$*\" \"$in\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        let out = run(&bin, true, "domanda").await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            out.starts_with(
                "--search exec --ignore-user-config --ignore-rules --sandbox read-only"
            ),
            "{out}"
        );
        assert!(out.contains("-c features.shell_tool=false"), "{out}");
        assert!(out.ends_with(" -|domanda"), "{out}");
    }
}

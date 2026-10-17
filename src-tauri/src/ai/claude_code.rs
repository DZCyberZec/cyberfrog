//! Claude through the user's own Claude Code CLI (`claude -p`), which runs on their Claude
//! subscription instead of a paid API key.
//!
//! Crawled pages end up in the prompt, so they are untrusted: the CLI runs with every tool and MCP
//! server disabled, no slash commands, no saved session, in an empty folder, with a timeout.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

const TIMEOUT: Duration = Duration::from_secs(300);

/// Apps opened from Finder get a minimal PATH, so the usual install locations are checked first.
pub fn find() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let known = [
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ];
    known.into_iter().find(|p| p.is_file()).or_else(|| {
        std::env::split_paths(&std::env::var_os("PATH")?)
            .map(|d| d.join("claude"))
            .find(|p| p.is_file())
    })
}

pub async fn complete(system: &str, prompt: &str) -> Result<String, String> {
    let bin = find().ok_or(
        "Claude Code non trovato: installalo da claude.com/code oppure usa una chiave API.",
    )?;
    complete_with(&bin, system, prompt, "").await
}

/// Marks where the source list starts in a web search answer; asked for in the system prompt.
const SOURCES: &str = "SOURCES:";

/// Answers `query` with web search as the only tool the CLI may use.
pub async fn search(system: &str, query: &str) -> Result<super::SearchAnswer, String> {
    let bin = find().ok_or(
        "Claude Code non trovato: installalo da claude.com/code oppure usa una chiave API.",
    )?;
    let system = format!(
        "{system}\nEnd with a line \"{SOURCES}\" followed by every source URL you used, one per line."
    );
    let text = complete_with(&bin, &system, query, "WebSearch").await?;
    Ok(split_sources(&text))
}

/// The answer before the source list, and the http(s) URLs listed after it.
fn split_sources(text: &str) -> super::SearchAnswer {
    let (answer, list) = text.rsplit_once(SOURCES).unwrap_or((text, ""));
    let mut cited: Vec<String> = Vec::new();
    for word in list.split_whitespace() {
        let url = word.trim_matches(|c: char| {
            matches!(c, '-' | '*' | '<' | '>' | '(' | ')' | '[' | ']' | ',')
        });
        if (url.starts_with("https://") || url.starts_with("http://"))
            && !cited.iter().any(|u| u == url)
        {
            cited.push(url.to_owned());
        }
    }
    super::SearchAnswer {
        answer: answer.trim().to_owned(),
        results: cited.clone(),
        cited,
    }
}

/// `tools` is the comma-separated list of built-in tools the CLI may use; empty means none.
async fn complete_with(
    bin: &Path,
    system: &str,
    prompt: &str,
    tools: &str,
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(["-p", "--output-format", "json", "--tools", tools]);
    if !tools.is_empty() {
        // print mode can't ask for permission, so the one tool it may use is pre-approved
        cmd.args(["--allowedTools", tools]);
    }
    let mut child = cmd
        .args([
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--system-prompt",
            system,
        ])
        // no project instructions or files around it
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Claude Code non avviabile: {e}"))?;
    // the prompt can be long, so it goes through stdin rather than argv
    let mut stdin = child.stdin.take().expect("stdin is piped");
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    drop(stdin);
    let out = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| format!("Claude Code non ha risposto entro {} s", TIMEOUT.as_secs()))?
        .map_err(|e| e.to_string())?;
    parse(&out.stdout, &out.stderr)
}

/// The `--output-format json` result: `{"is_error": bool, "result": "...", ...}`.
fn parse(stdout: &[u8], stderr: &[u8]) -> Result<String, String> {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(stdout) else {
        let err = String::from_utf8_lossy(stderr);
        return Err(format!(
            "Claude Code: {}",
            err.trim()
                .lines()
                .last()
                .unwrap_or("risposta non leggibile")
        ));
    };
    let text = json["result"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_owned();
    if json["is_error"].as_bool().unwrap_or(true) {
        if text.contains("authenticate") || text.contains("log in") || text.contains("login") {
            return Err("Claude Code non ha un login attivo: apri il Terminale, esegui claude e poi /login.".into());
        }
        return Err(format!(
            "Claude Code: {}",
            if text.is_empty() {
                "errore sconosciuto"
            } else {
                &text
            }
        ));
    }
    if text.is_empty() {
        return Err("Claude non ha restituito testo.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_answer_from_its_sources() {
        let a = split_sources(
            "Ecco i migliori.\n\nSOURCES:\n- https://a.it/x\n- <https://b.it/>\n- not a url\n- https://a.it/x",
        );
        assert_eq!(a.answer, "Ecco i migliori.");
        assert_eq!(a.cited, vec!["https://a.it/x", "https://b.it/"]);
        assert_eq!(split_sources("niente fonti").cited, Vec::<String>::new());
    }

    #[test]
    fn reads_results_and_explains_failures() {
        assert_eq!(
            parse(br#"{"is_error":false,"result":" Titolo nuovo\n"}"#, b"").unwrap(),
            "Titolo nuovo"
        );
        let expired =
            br#"{"is_error":true,"result":"Failed to authenticate: OAuth session expired"}"#;
        assert!(parse(expired, b"").unwrap_err().contains("/login"));
        assert_eq!(
            parse(b"", b"boom\nlast line").unwrap_err(),
            "Claude Code: last line"
        );
    }

    #[tokio::test]
    async fn runs_the_cli_without_tools_and_sends_the_prompt_on_stdin() {
        // a stand-in for `claude` that echoes its arguments and stdin back as the result
        let dir =
            std::env::temp_dir().join(format!("cyberfrog-fake-claude-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("claude");
        std::fs::write(
            &bin,
            "#!/bin/sh\nin=$(cat)\nprintf '{\"is_error\":false,\"result\":\"%s|%s\"}' \"$*\" \"$in\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        let out = complete_with(&bin, "sys", "domanda", "").await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            out.starts_with("-p --output-format json --tools  --strict-mcp-config"),
            "{out}"
        );
        assert!(out.ends_with("--system-prompt sys|domanda"), "{out}");
    }
}

//! AI assistant. Two engines: the user's Claude Code CLI (their subscription) or the Messages API
//! with their key from the Keychain. Neither the key nor the CLI is reachable from the webview,
//! which only sends a prompt and gets text back.

mod api;
mod claude_code;
pub mod keychain;

#[derive(serde::Serialize)]
pub struct Status {
    pub has_key: bool,
    /// Path of the Claude Code CLI, when installed.
    pub claude_code: Option<String>,
}

pub fn status() -> Status {
    Status {
        has_key: keychain::get_key().is_some(),
        claude_code: claude_code::find().map(|p| p.display().to_string()),
    }
}

/// `engine` is "claude-code" or "api".
pub async fn complete(engine: &str, system: &str, prompt: &str) -> Result<String, String> {
    match engine {
        "claude-code" => claude_code::complete(system, prompt).await,
        "api" => {
            let key = keychain::get_key()
                .ok_or("Aggiungi la tua chiave API Anthropic nelle Impostazioni.")?;
            api::complete(&key, system, prompt).await
        }
        _ => Err("Motore AI sconosciuto".into()),
    }
}

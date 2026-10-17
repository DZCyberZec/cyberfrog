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

/// An answer from Claude with web search: the text, the URLs it cites, and the ones the search returned.
#[derive(serde::Serialize, Default, Debug)]
pub struct SearchAnswer {
    pub answer: String,
    pub cited: Vec<String>,
    pub results: Vec<String>,
}

/// How the tracker asks: like a person using an AI search engine, in the question's language.
const SEARCH_SYSTEM: &str = "You are an AI search assistant like ChatGPT search or Perplexity. \
Answer the user's question the way you would for anyone asking it, in the language of the question, \
using web search, and cite the sources you rely on.";

/// Asks `query` with web search through `engine`, the way the AI visibility tracker needs.
pub async fn search(engine: &str, query: &str) -> Result<SearchAnswer, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 300 {
        return Err("Domanda vuota o troppo lunga (massimo 300 caratteri)".into());
    }
    match engine {
        "claude-code" => claude_code::search(SEARCH_SYSTEM, query).await,
        "api" => {
            let key = keychain::get_key()
                .ok_or("Aggiungi la tua chiave API Anthropic nelle Impostazioni.")?;
            api::search(&key, SEARCH_SYSTEM, query).await
        }
        _ => Err("Motore AI sconosciuto".into()),
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

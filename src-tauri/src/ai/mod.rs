//! AI assistant. Two engines: the user's Claude Code CLI (their subscription) or the Messages API
//! with their key from the Keychain. Neither the key nor the CLI is reachable from the webview,
//! which only sends a prompt and gets text back.

mod api;
mod claude_code;
mod codex;
pub mod keychain;

#[derive(serde::Serialize)]
pub struct Status {
    pub has_key: bool,
    /// Path of the Claude Code CLI, when installed, and whether it is logged in.
    pub claude_code: Option<String>,
    pub claude_code_ready: bool,
    /// Path of the Codex CLI, when installed, and whether it is logged in.
    pub codex: Option<String>,
    pub codex_ready: bool,
}

/// What each engine needs, checked without spending tokens: a stored key, installed and logged-in CLIs.
pub async fn status() -> Status {
    let (claude, codex) = (claude_code::find(), codex::find());
    let claude_code_ready = match &claude {
        Some(bin) => claude_code::logged_in(bin).await,
        None => false,
    };
    let codex_ready = match &codex {
        Some(bin) => codex::logged_in(bin).await,
        None => false,
    };
    Status {
        has_key: keychain::get_key().is_some(),
        claude_code: claude.map(|p| p.display().to_string()),
        claude_code_ready,
        codex: codex.map(|p| p.display().to_string()),
        codex_ready,
    }
}

/// Marks where the source list starts in a web search answer from a CLI; asked for in the prompt.
const SOURCES: &str = "SOURCES:";

/// The answer before the source list, and the http(s) URLs listed after it.
pub(crate) fn split_sources(text: &str) -> SearchAnswer {
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
    SearchAnswer {
        answer: answer.trim().to_owned(),
        results: cited.clone(),
        cited,
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
        "codex" => codex::search(SEARCH_SYSTEM, query).await,
        "api" => {
            let key = keychain::get_key()
                .ok_or("Aggiungi la tua chiave API Anthropic nelle Impostazioni.")?;
            api::search(&key, SEARCH_SYSTEM, query).await
        }
        _ => Err("Motore AI sconosciuto".into()),
    }
}

/// `engine` is "claude-code", "codex" or "api".
pub async fn complete(engine: &str, system: &str, prompt: &str) -> Result<String, String> {
    match engine {
        "claude-code" => claude_code::complete(system, prompt).await,
        "codex" => codex::complete(system, prompt).await,
        "api" => {
            let key = keychain::get_key()
                .ok_or("Aggiungi la tua chiave API Anthropic nelle Impostazioni.")?;
            api::complete(&key, system, prompt).await
        }
        _ => Err("Motore AI sconosciuto".into()),
    }
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
}

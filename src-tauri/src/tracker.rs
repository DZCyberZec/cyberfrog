//! Storage of the AI visibility tracker: the questions to watch per site and every check's result,
//! in one JSON file next to the crawls. The UI owns the shape; Rust only bounds and stores it.

use std::path::PathBuf;

/// Generous for years of weekly checks, small enough to load at once.
const MAX_BYTES: usize = 4 * 1024 * 1024;

fn file() -> PathBuf {
    crate::mcp::crawls_dir()
        .parent()
        .map(|p| p.join("ai_tracker.json"))
        .unwrap_or_else(|| PathBuf::from("ai_tracker.json"))
}

pub fn load() -> serde_json::Value {
    std::fs::read(file())
        .ok()
        .filter(|b| b.len() <= MAX_BYTES)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Replaces the file atomically (write a sibling, then rename), so a crash never leaves half a file.
pub fn save(data: &serde_json::Value) -> Result<(), String> {
    if !data.is_object() {
        return Err("Dati del tracker non validi".into());
    }
    let bytes = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err(
            "Storico del tracker troppo grande: elimina le domande che non segui più".into(),
        );
    }
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Salvataggio non riuscito: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Salvataggio non riuscito: {e}"))
}

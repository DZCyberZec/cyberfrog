pub mod crawler;
pub mod report;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use tauri::Manager;
use tauri::ipc::Channel;
use url::Url;

use crawler::{Config, Page, Progress};
use report::{
    BadLinkRow, BrokenLink, ExternalLink, HreflangRow, ImageRow, ImageUse, PageLinks, StructuredRow,
};

const RECENT_LIMIT: usize = 15;
const MAX_URLS_LIMIT: usize = 100_000;
const MAX_CONCURRENCY: usize = 32;

/// Crawl settings from the UI's settings dialog; mirrors `Settings` in src/App.tsx.
#[derive(serde::Deserialize)]
struct Settings {
    max_urls: usize,
    concurrency: usize,
    user_agent: String,
    respect_robots: bool,
    check_external: bool,
    check_images: bool,
    use_sitemaps: bool,
    /// Regular expressions, one per entry; blank entries are ignored.
    exclude: Vec<String>,
}

/// Turns UI settings into a crawler config, clamping limits and rejecting bad patterns.
fn config(start: Url, s: Settings) -> Result<Config, String> {
    let exclude = s
        .exclude
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| {
            Regex::new(p).map_err(|e| format!("Pattern di esclusione non valido \"{p}\": {e}"))
        })
        .collect::<Result<_, _>>()?;
    let user_agent = s.user_agent.trim();
    Ok(Config {
        max_urls: s.max_urls.clamp(1, MAX_URLS_LIMIT),
        concurrency: s.concurrency.clamp(1, MAX_CONCURRENCY),
        user_agent: if user_agent.is_empty() {
            crawler::USER_AGENT.to_owned()
        } else {
            user_agent.to_owned()
        },
        respect_robots: s.respect_robots,
        check_external: s.check_external,
        check_images: s.check_images,
        use_sitemaps: s.use_sitemaps,
        exclude,
        ..Config::new(start)
    })
}

/// A crawl file and its pages, as shown in the UI.
#[derive(serde::Serialize)]
struct CrawlData {
    path: String,
    pages: Vec<Page>,
    external: Vec<ExternalLink>,
    broken: Vec<BrokenLink>,
    images: Vec<ImageRow>,
    hreflang: Vec<HreflangRow>,
    structured: Vec<StructuredRow>,
    bad_links: Vec<BadLinkRow>,
}

#[derive(serde::Serialize)]
struct CrawlSummary {
    path: String,
    start_url: Option<String>,
    pages: u32,
    modified_ms: u128,
}

fn crawls_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("crawls");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn load(path: &Path) -> Result<CrawlData, String> {
    let unreadable =
        |e: rusqlite::Error| format!("Il file non è un crawl CyberFrog leggibile ({e})");
    Ok(CrawlData {
        path: path.to_string_lossy().into_owned(),
        pages: crawler::read_pages(path).map_err(unreadable)?,
        external: report::read_external(path).map_err(unreadable)?,
        broken: report::read_broken(path).map_err(unreadable)?,
        images: report::read_images(path).map_err(unreadable)?,
        hreflang: report::read_hreflang(path).map_err(unreadable)?,
        structured: report::read_structured(path).map_err(unreadable)?,
        bad_links: report::read_bad_links(path).map_err(unreadable)?,
    })
}

/// Stop signal of the crawl currently running, shared with `stop_crawl`.
#[derive(Default)]
struct CrawlStop(Arc<AtomicBool>);

/// Ends the running crawl; `start_crawl` then returns what was stored so far.
#[tauri::command]
fn stop_crawl(stop: tauri::State<CrawlStop>) {
    stop.0.store(true, Ordering::Relaxed);
}

/// Crawls `url` into a new SQLite file under the app data dir, streaming progress, and returns every page.
#[tauri::command]
async fn start_crawl(
    app: tauri::AppHandle,
    url: String,
    settings: Settings,
    on_progress: Channel<Progress>,
    stop: tauri::State<'_, CrawlStop>,
) -> Result<CrawlData, String> {
    let start = Url::parse(url.trim()).map_err(|e| format!("URL non valido: {e}"))?;
    if !matches!(start.scheme(), "http" | "https") {
        return Err("L'URL deve iniziare con http:// o https://".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let db_path = crawls_dir(&app)?.join(format!("crawl-{stamp}.sqlite"));

    stop.0.store(false, Ordering::Relaxed);
    let cfg = Config {
        stop: stop.0.clone(),
        ..config(start, settings)?
    };
    crawler::crawl(cfg, &db_path, |p| {
        let _ = on_progress.send(p); // a closed window just stops listening
    })
    .await
    .map_err(|e| e.to_string())?;
    load(&db_path)
}

#[tauri::command]
fn open_crawl(path: String) -> Result<CrawlData, String> {
    load(Path::new(&path))
}

#[tauri::command]
fn page_links(path: String, url: String) -> Result<PageLinks, String> {
    report::page_links(Path::new(&path), &url).map_err(|e| e.to_string())
}

#[tauri::command]
fn image_pages(path: String, src: String) -> Result<Vec<ImageUse>, String> {
    report::image_pages(Path::new(&path), &src).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_crawl_as(from: String, to: String) -> Result<(), String> {
    crawler::save_copy(Path::new(&from), Path::new(&to))
        .map_err(|e| format!("Salvataggio non riuscito: {e}"))
}

/// Most recent crawls in the app data dir, newest first; unreadable files are skipped.
#[tauri::command]
fn list_crawls(app: tauri::AppHandle) -> Result<Vec<CrawlSummary>, String> {
    let mut out: Vec<CrawlSummary> = std::fs::read_dir(crawls_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "sqlite"))
        .filter_map(|path| {
            let (start_url, pages) = crawler::summary(&path).ok()?;
            let modified_ms = path
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis();
            Some(CrawlSummary {
                path: path.to_string_lossy().into_owned(),
                start_url,
                pages,
                modified_ms,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out.truncate(RECENT_LIMIT);
    Ok(out)
}

/// Writes an export to a path the user picked in the save dialog.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CrawlStop::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_crawl,
            stop_crawl,
            open_crawl,
            page_links,
            image_pages,
            save_crawl_as,
            list_crawls,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(exclude: &[&str]) -> Settings {
        Settings {
            max_urls: 0,
            concurrency: 500,
            user_agent: "  ".into(),
            respect_robots: false,
            check_external: false,
            check_images: true,
            use_sitemaps: false,
            exclude: exclude.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn settings_are_clamped_defaulted_and_validated() {
        let start = Url::parse("https://s.it/").unwrap();
        let cfg = config(start.clone(), settings(&["/tag/", "  ", "\\?replytocom="])).unwrap();
        assert_eq!((cfg.max_urls, cfg.concurrency), (1, MAX_CONCURRENCY));
        assert_eq!(
            cfg.user_agent,
            crawler::USER_AGENT,
            "blank user agent falls back to the default"
        );
        assert_eq!(cfg.exclude.len(), 2, "blank patterns are ignored");
        assert!(!cfg.respect_robots && cfg.check_images && !cfg.use_sitemaps);

        let err = config(start, settings(&["(unclosed"])).err().unwrap();
        assert!(err.contains("(unclosed"), "{err}");
    }
}

mod ai;
pub mod crawler;
pub mod geo;
mod gsc;
pub mod mcp;
pub mod report;
pub mod schedule;
mod secrets;
pub mod topics;
mod tracker;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use tauri::Manager;
use tauri::ipc::Channel;
use url::Url;

use crawler::{Config, CustomRule, Page, Progress, Renderer};
use report::{
    BadLinkRow, BrokenLink, CustomData, ExternalLink, HreflangRow, ImageRow, ImageUse, PageLinks,
    StructuredRow,
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
    /// Custom extraction and search rules; rows without a name or expression are ignored.
    #[serde(default)]
    rules: Vec<RuleSpec>,
    /// Analyse pages after JavaScript rendering in a local headless browser.
    #[serde(default)]
    render_js: bool,
}

#[derive(serde::Deserialize)]
struct RuleSpec {
    name: String,
    /// "css", "regex" or "search".
    kind: String,
    expr: String,
    attr: Option<String>,
}

fn web_url(text: &str) -> Result<Url, String> {
    let url = Url::parse(text).map_err(|e| format!("URL non valido: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("L'URL deve iniziare con http:// o https://".into());
    }
    Ok(url)
}

/// URLs for list mode, one per line or separated by spaces; a bad one is reported, not skipped.
pub(crate) fn parse_list(text: &str) -> Result<Vec<Url>, String> {
    text.split_whitespace()
        .map(|t| web_url(t).map_err(|e| format!("{e} ({t})")))
        .collect()
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
    let mut names = std::collections::HashSet::new();
    let rules = s
        .rules
        .iter()
        .filter(|r| !r.name.trim().is_empty() && !r.expr.trim().is_empty())
        .map(|r| {
            let name = r.name.trim();
            if !names.insert(name) {
                return Err(format!("Regola \"{name}\" duplicata: usa nomi diversi"));
            }
            CustomRule::new(name, &r.kind, r.expr.trim(), r.attr.as_deref())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let renderer = if s.render_js {
        let browser = Renderer::find_browser().ok_or(
            "Rendering JavaScript: nessun browser trovato. Installa Google Chrome, Chromium, Brave o Edge.",
        )?;
        Some(Arc::new(Renderer::new(browser, s.concurrency)))
    } else {
        None
    };
    let user_agent = s.user_agent.trim();
    Ok(Config {
        renderer,
        rules: Arc::new(rules),
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
    custom: CustomData,
    geo: geo::GeoData,
    topics: topics::TopicsData,
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
        custom: report::read_custom(path).map_err(unreadable)?,
        geo: geo::read(path).map_err(unreadable)?,
        topics: topics::analyze(path).map_err(unreadable)?,
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
    // list mode: pasted URLs, separated by spaces or new lines
    list: Option<String>,
    on_progress: Channel<Progress>,
    stop: tauri::State<'_, CrawlStop>,
) -> Result<CrawlData, String> {
    let list = parse_list(list.as_deref().unwrap_or(""))?;
    let start = match list.first() {
        Some(first) => first.clone(),
        None => web_url(url.trim())?,
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let db_path = crawls_dir(&app)?.join(format!("crawl-{stamp}.sqlite"));

    stop.0.store(false, Ordering::Relaxed);
    let cfg = Config {
        stop: stop.0.clone(),
        list,
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
/// Which AI engines are usable: a stored API key, an installed Claude Code (never the key itself).
#[tauri::command]
async fn ai_status() -> ai::Status {
    ai::status().await
}

/// Stores the API key in the Keychain; an empty key removes it.
/// Starts signing in a CLI: Claude Code returns at once and waits for the code; Codex returns
/// when the browser sign-in is done.
#[tauri::command]
async fn ai_login(engine: String) -> Result<ai::login::Started, String> {
    match engine.as_str() {
        "claude-code" => ai::login::start_claude().await,
        "codex" => {
            ai::login::codex().await?;
            Ok(ai::login::Started {
                url: None,
                needs_code: false,
            })
        }
        _ => Err("Motore AI sconosciuto".into()),
    }
}

/// Completes a Claude Code sign-in with the code Anthropic showed.
#[tauri::command]
async fn ai_login_code(code: String) -> Result<bool, String> {
    ai::login::finish_claude(&code).await
}

#[tauri::command]
fn ai_login_cancel() {
    ai::login::cancel()
}

#[tauri::command]
fn ai_set_key(key: String) -> Result<(), String> {
    ai::keychain::set_key(&key)
}

/// Asks Claude through `engine` ("claude-code" or "api") and returns the answer text.
#[tauri::command]
async fn ai_complete(engine: String, system: String, prompt: String) -> Result<String, String> {
    ai::complete(&engine, &system, &prompt).await
}

/// Asks a question the way an AI search engine would, with web search, for the visibility tracker.
#[tauri::command]
async fn ai_search(engine: String, query: String) -> Result<ai::SearchAnswer, String> {
    ai::search(&engine, &query).await
}

#[tauri::command]
fn gsc_status() -> gsc::Status {
    gsc::status()
}

/// Opens Google's sign-in in the browser and waits for it (up to 5 minutes).
#[tauri::command]
async fn gsc_login() -> Result<gsc::Status, String> {
    gsc::login().await
}

#[tauri::command]
fn gsc_logout() {
    gsc::logout()
}

/// Imports the OAuth client JSON downloaded from Google Cloud ("Desktop app").
#[tauri::command]
fn gsc_set_client(json: String) -> Result<(), String> {
    gsc::set_client(&json)
}

/// Imports a service account key JSON (advanced option).
#[tauri::command]
fn gsc_set_service_account(json: String) -> Result<gsc::Status, String> {
    gsc::set_service_account(&json)
}

#[tauri::command]
async fn gsc_sites() -> Result<Vec<gsc::api::Site>, String> {
    gsc::sites().await
}

#[tauri::command]
async fn gsc_query(site: String, start: String, end: String) -> Result<gsc::api::GscData, String> {
    gsc::query(&site, &start, &end).await
}

#[tauri::command]
fn tracker_load() -> serde_json::Value {
    tracker::load()
}

#[tauri::command]
fn tracker_save(data: serde_json::Value) -> Result<(), String> {
    tracker::save(&data)
}

/// Topics a competitor covers that you don't, and the reverse, from two crawl files.
#[tauri::command]
fn content_gap(mine: String, theirs: String) -> Result<topics::gap::ContentGap, String> {
    topics::gap::content_gap(Path::new(&mine), Path::new(&theirs)).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_schedules() -> Vec<schedule::Schedule> {
    schedule::load()
}

/// Weekday 0 = every day, 1–7 = Monday–Sunday; `settings` is the UI's crawl settings.
#[tauri::command]
fn add_schedule(
    url: String,
    settings: serde_json::Value,
    weekday: u8,
    hour: u8,
    lang: String,
) -> Result<Vec<schedule::Schedule>, String> {
    schedule::add(&url, settings, weekday, hour, &lang)
}

#[tauri::command]
fn remove_schedule(id: String) -> Result<Vec<schedule::Schedule>, String> {
    schedule::remove(&id)
}

/// The browser JavaScript rendering would use, for the settings dialog.
#[tauri::command]
fn find_browser() -> Option<String> {
    Renderer::find_browser().map(|p| p.display().to_string())
}

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

/// Largest page `faq_schema` reads; the rest is ignored.
const FAQ_MAX_BYTES: usize = 2 * 1024 * 1024;

/// FAQPage JSON-LD built from the question headings of one page, fetched fresh.
#[tauri::command]
async fn faq_schema(url: String) -> Result<String, String> {
    let url = web_url(&url)?;
    let fetch = |e: reqwest::Error| format!("Download della pagina non riuscito: {e}");
    let mut resp = reqwest::Client::builder()
        .user_agent(crawler::USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(fetch)?
        .get(url)
        .send()
        .await
        .map_err(fetch)?;
    if !resp.status().is_success() {
        return Err(format!(
            "La pagina ha risposto con errore HTTP {}",
            resp.status().as_u16()
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(fetch)? {
        body.extend_from_slice(&chunk);
        if body.len() >= FAQ_MAX_BYTES {
            body.truncate(FAQ_MAX_BYTES);
            break;
        }
    }
    let pairs = geo::faq::faq_from_html(&String::from_utf8_lossy(&body));
    if pairs.is_empty() {
        return Err("Nessun sottotitolo a domanda trovato nella pagina".into());
    }
    Ok(geo::faq::faq_jsonld(&pairs))
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
            find_browser,
            list_schedules,
            content_gap,
            ai_search,
            tracker_load,
            tracker_save,
            gsc_status,
            gsc_login,
            gsc_logout,
            gsc_set_client,
            gsc_set_service_account,
            gsc_sites,
            gsc_query,
            add_schedule,
            remove_schedule,
            ai_status,
            ai_login,
            ai_login_code,
            ai_login_cancel,
            ai_set_key,
            ai_complete,
            write_text_file,
            faq_schema
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
            rules: Vec::new(),
            render_js: false,
        }
    }

    #[test]
    fn list_mode_urls_are_split_and_validated() {
        let urls = parse_list("https://a.it/x\n  https://b.it/ \t\n\n").unwrap();
        assert_eq!(urls.len(), 2);
        assert_eq!(parse_list("").unwrap(), Vec::<Url>::new());
        let err = parse_list("https://a.it/\nftp://b.it/").unwrap_err();
        assert!(err.contains("ftp://b.it/"), "{err}");
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

        let err = config(start.clone(), settings(&["(unclosed"]))
            .err()
            .unwrap();
        assert!(err.contains("(unclosed"), "{err}");

        let rule = |name: &str, kind: &str, expr: &str| RuleSpec {
            name: name.into(),
            kind: kind.into(),
            expr: expr.into(),
            attr: None,
        };
        let mut s = settings(&[]);
        s.rules = vec![
            rule("Autore", "css", ".author"),
            rule("", "css", ".x"),
            rule("GA4", "search", "G-"),
        ];
        let cfg = config(start.clone(), s).unwrap();
        let names: Vec<&str> = cfg.rules.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Autore", "GA4"], "unnamed rows are skipped");
        let mut s = settings(&[]);
        s.rules = vec![rule("A", "css", "div[")];
        assert!(
            config(start.clone(), s)
                .err()
                .unwrap()
                .starts_with("Regola \"A\" non valida")
        );
        let mut s = settings(&[]);
        s.rules = vec![rule("A", "css", "p"), rule("A", "regex", "x")];
        assert!(config(start, s).err().unwrap().contains("duplicata"));
    }
}

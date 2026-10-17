pub mod crawler;
pub mod report;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;
use tauri::ipc::Channel;
use url::Url;

use crawler::{Config, Page, Progress};
use report::{BrokenLink, ExternalLink, ImageRow, ImageUse, PageLinks};

// shortcut: fixed limits, expose them in the UI when crawl settings land
const CONCURRENCY: usize = 8;
const MAX_URLS: usize = 10_000;
const RECENT_LIMIT: usize = 15;

/// A crawl file and its pages, as shown in the UI.
#[derive(serde::Serialize)]
struct CrawlData {
    path: String,
    pages: Vec<Page>,
    external: Vec<ExternalLink>,
    broken: Vec<BrokenLink>,
    images: Vec<ImageRow>,
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
    })
}

/// Crawls `url` into a new SQLite file under the app data dir, streaming progress, and returns every page.
#[tauri::command]
async fn start_crawl(
    app: tauri::AppHandle,
    url: String,
    on_progress: Channel<Progress>,
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

    let cfg = Config {
        start,
        concurrency: CONCURRENCY,
        max_urls: MAX_URLS,
        check_external: true,
        check_images: true,
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_crawl,
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

//! Same-host breadth-first crawler that writes one row per URL to SQLite.

use std::collections::{HashSet, VecDeque};
use std::error::Error;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, LOCATION};
use reqwest::{Client, redirect::Policy};
use rusqlite::{Connection, OpenFlags, params};
use scraper::{Html, Selector};
use texting_robots::Robot;
use tokio::task::JoinSet;
use url::Url;

pub const USER_AGENT: &str = "CyberFrog/0.1";

/// The product token robots.txt groups are matched on: "Googlebot" for
/// "Mozilla/5.0 (compatible; Googlebot/2.1; ...)", "CyberFrog" for "CyberFrog/0.1".
fn robots_token(user_agent: &str) -> &str {
    let compatible = user_agent.split("compatible;").nth(1).unwrap_or(user_agent);
    compatible
        .trim_start()
        .split(['/', ' ', ';', ')'])
        .find(|t| !t.is_empty())
        .unwrap_or(user_agent)
}

pub type CrawlResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub struct Config {
    pub start: Url,
    pub concurrency: usize,
    /// Upper bound on URLs stored; URLs discovered past it are dropped. Also caps external checks.
    pub max_urls: usize,
    /// After the crawl, request every linked external URL once to record its status.
    pub check_external: bool,
    /// After the crawl, request every image once to record its status and weight.
    pub check_images: bool,
    /// Read the XML sitemaps (from robots.txt, else /sitemap.xml) and also crawl URLs found only there.
    pub use_sitemaps: bool,
    /// Sent with every request and matched against robots.txt groups.
    pub user_agent: String,
    /// When false, robots.txt disallow rules are reported but not obeyed.
    pub respect_robots: bool,
    /// Discovered URLs matching any of these are skipped (the start URL never is).
    pub exclude: Vec<Regex>,
}

impl Config {
    /// Defaults matching the app's settings dialog.
    pub fn new(start: Url) -> Self {
        Config {
            start,
            concurrency: 8,
            max_urls: 10_000,
            check_external: true,
            check_images: true,
            use_sitemaps: true,
            user_agent: USER_AGENT.to_owned(),
            respect_robots: true,
            exclude: Vec::new(),
        }
    }
}

/// Link depth from the start URL; `None` for URLs reached only through a sitemap.
type Depth = Option<u32>;
const MAX_SITEMAP_FILES: usize = 50;

struct Fetched {
    url: Url,
    depth: Depth,
    status: Option<u16>,
    content_type: Option<String>,
    /// All X-Robots-Tag header values, comma-joined.
    x_robots_tag: Option<String>,
    redirect_to: Option<Url>,
    /// `None` unless the response was HTML and its body was read.
    html: Option<HtmlData>,
    error: Option<String>,
}

/// What we keep from an HTML document.
#[derive(Debug, Default, PartialEq)]
struct HtmlData {
    title: Option<String>,
    meta_description: Option<String>,
    h1: Option<String>,
    canonical: Option<Url>,
    meta_robots: Option<String>,
    word_count: u32,
    links: Vec<Link>,
    images: Vec<Image>,
}

/// An `<img src>` found in a page.
#[derive(Debug, PartialEq)]
struct Image {
    src: Url,
    /// `None` when the attribute is absent; `Some("")` marks a decorative image.
    alt: Option<String>,
    /// Both width and height attributes are set, so the browser can reserve space.
    has_size: bool,
}

/// An `<a href>` found in a page.
#[derive(Debug, PartialEq)]
struct Link {
    url: Url,
    /// Visible text, or the alt text of an image inside the link.
    anchor: Option<String>,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Page {
    pub url: String,
    pub depth: Depth,
    pub status: Option<u16>,
    pub content_type: Option<String>,
    pub redirect_to: Option<String>,
    pub blocked_by_robots: bool,
    pub error: Option<String>,
    pub title: Option<String>,
    pub meta_description: Option<String>,
    pub h1: Option<String>,
    pub canonical: Option<String>,
    pub meta_robots: Option<String>,
    pub word_count: Option<u32>,
    pub x_robots_tag: Option<String>,
    /// Distinct crawled pages linking here with `<a href>`, self-links excluded.
    pub inlinks: u32,
    /// Distinct same-site URLs this page links to, itself excluded.
    pub outlinks: u32,
    /// Distinct external URLs this page links to.
    pub external_outlinks: u32,
    /// Listed in one of the site's XML sitemaps.
    pub in_sitemap: bool,
}

/// Crawl progress within a stage: items finished, and items waiting or in flight.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Progress {
    pub stage: Stage,
    pub done: usize,
    pub pending: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    /// Fetching same-site pages.
    Pages,
    /// Checking the status of linked external URLs.
    External,
    /// Checking status and weight of images.
    Images,
}

/// Opens an existing crawl without creating or changing anything in the file.
pub(crate) fn open_existing(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// All pages, in crawl order.
pub fn read_pages(path: &Path) -> rusqlite::Result<Vec<Page>> {
    let db = open_existing(path)?;
    // crawls saved before X-Robots-Tag was recorded lack the column; read them as "no header"
    let x_robots = if db.prepare("SELECT x_robots_tag FROM pages LIMIT 0").is_ok() {
        "x_robots_tag"
    } else {
        "NULL"
    };
    // crawls saved before external links were stored count every link as same-site
    let (outlinks, external) = if db.prepare("SELECT external FROM links LIMIT 0").is_ok() {
        (
            "(SELECT count(*) FROM links WHERE source = pages.url AND external = 0)",
            "(SELECT count(*) FROM links WHERE source = pages.url AND external = 1)",
        )
    } else {
        ("(SELECT count(*) FROM links WHERE source = pages.url)", "0")
    };
    let in_sitemap = if db.prepare("SELECT url FROM sitemap LIMIT 0").is_ok() {
        "EXISTS (SELECT 1 FROM sitemap WHERE sitemap.url = pages.url)"
    } else {
        "0"
    };
    let mut stmt = db.prepare(&format!(
        "SELECT url, depth, status, content_type, redirect_to, blocked_by_robots, error,
                title, meta_description, h1, canonical, meta_robots, word_count,
                (SELECT count(*) FROM links WHERE target = pages.url), {x_robots}, {outlinks}, {external}, {in_sitemap}
         FROM pages ORDER BY rowid"
    ))?;
    stmt.query_map([], |r| {
        Ok(Page {
            url: r.get(0)?,
            depth: r.get(1)?,
            status: r.get(2)?,
            content_type: r.get(3)?,
            redirect_to: r.get(4)?,
            blocked_by_robots: r.get(5)?,
            error: r.get(6)?,
            title: r.get(7)?,
            meta_description: r.get(8)?,
            h1: r.get(9)?,
            canonical: r.get(10)?,
            meta_robots: r.get(11)?,
            word_count: r.get(12)?,
            inlinks: r.get(13)?,
            x_robots_tag: r.get(14)?,
            outlinks: r.get(15)?,
            external_outlinks: r.get(16)?,
            in_sitemap: r.get(17)?,
        })
    })?
    .collect()
}

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS pages (
             url               TEXT PRIMARY KEY,
             depth             INTEGER,
             status            INTEGER,
             content_type      TEXT,
             redirect_to       TEXT,
             blocked_by_robots INTEGER NOT NULL DEFAULT 0,
             error             TEXT,
             title             TEXT,
             meta_description  TEXT,
             h1                TEXT,
             canonical         TEXT,
             meta_robots       TEXT,
             word_count        INTEGER,
             x_robots_tag      TEXT
         );
         CREATE TABLE IF NOT EXISTS links (
             source   TEXT NOT NULL,
             target   TEXT NOT NULL,
             anchor   TEXT,
             external INTEGER NOT NULL DEFAULT 0,
             PRIMARY KEY (source, target)
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS links_target ON links (target);
         CREATE TABLE IF NOT EXISTS sitemap (
             url  TEXT PRIMARY KEY,
             file TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS images (
             page     TEXT NOT NULL,
             src      TEXT NOT NULL,
             alt      TEXT,
             has_size INTEGER NOT NULL,
             PRIMARY KEY (page, src)
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS images_src ON images (src);
         CREATE TABLE IF NOT EXISTS image_info (
             src          TEXT PRIMARY KEY,
             status       INTEGER,
             bytes        INTEGER,
             content_type TEXT,
             error        TEXT
         );
         CREATE TABLE IF NOT EXISTS external (
             url          TEXT PRIMARY KEY,
             status       INTEGER,
             content_type TEXT,
             error        TEXT
         );",
    )?;
    Ok(db)
}

/// Start URL and page count of a saved crawl. Fails for files `read_pages` could not open.
pub fn summary(path: &Path) -> rusqlite::Result<(Option<String>, u32)> {
    let db = open_existing(path)?;
    // preparing this rejects crawls saved before metadata and inlinks existed
    db.prepare("SELECT title FROM pages, links LIMIT 0")?;
    db.query_row(
        "SELECT (SELECT url FROM pages ORDER BY rowid LIMIT 1), count(*) FROM pages",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
}

/// Writes a compact, self-contained copy of the crawl at `from` to `to`, replacing `to`.
pub fn save_copy(from: &Path, to: &Path) -> CrawlResult<()> {
    let db = open_existing(from)?;
    db.query_row("SELECT count(*) FROM pages", [], |_| Ok(()))?; // refuse files that are not crawls
    if to.exists() {
        std::fs::remove_file(to)?; // VACUUM INTO refuses an existing file; the save dialog already confirmed
    }
    db.execute("VACUUM INTO ?1", [to.to_string_lossy()])?;
    Ok(())
}

/// Crawls from `cfg.start`, staying on its host and port, and returns the number of rows written.
/// `on_progress` runs after every stored URL.
pub async fn crawl(
    cfg: Config,
    db_path: &Path,
    mut on_progress: impl FnMut(Progress) + Send,
) -> CrawlResult<usize> {
    let client = Client::builder()
        .user_agent(&cfg.user_agent)
        .redirect(Policy::none()) // redirects are recorded as rows, their targets queued
        .timeout(Duration::from_secs(20))
        .build()?;
    // robots.txt and sitemaps may redirect (http -> https, www), so they follow redirects
    let follow = Client::builder()
        .user_agent(&cfg.user_agent)
        .timeout(Duration::from_secs(20))
        .build()?;
    let robot = load_robots(&follow, &cfg.start, &cfg.user_agent).await;
    let mut db = open_db(db_path)?;
    let concurrency = cfg.concurrency.max(1);

    // URLs listed only in a sitemap are queued once link discovery runs dry
    let mut sitemap_seed = None;
    if cfg.use_sitemaps {
        let listed = load_sitemaps(&follow, &cfg.start, robot.as_ref(), cfg.max_urls).await;
        let tx = db.transaction()?;
        for (url, file) in &listed {
            tx.execute(
                "INSERT OR IGNORE INTO sitemap (url, file) VALUES (?1, ?2)",
                params![url.as_str(), file],
            )?;
        }
        tx.commit()?;
        sitemap_seed = Some(listed.into_iter().map(|(url, _)| url));
    }

    let mut start = cfg.start.clone();
    start.set_fragment(None);
    let mut seen = HashSet::from([start.to_string()]);
    let mut queue: VecDeque<(Url, Depth)> = VecDeque::from([(start, Some(0))]);
    let mut tasks = JoinSet::new();
    let mut written = 0;

    loop {
        while tasks.len() < concurrency
            && let Some((url, depth)) = queue.pop_front()
        {
            if cfg.respect_robots && robot.as_ref().is_some_and(|r| !r.allowed(url.as_str())) {
                db.execute(
                    "INSERT OR IGNORE INTO pages (url, depth, blocked_by_robots) VALUES (?1, ?2, 1)",
                    params![url.as_str(), depth],
                )?;
                written += 1;
                on_progress(Progress {
                    stage: Stage::Pages,
                    done: written,
                    pending: queue.len() + tasks.len(),
                });
                continue;
            }
            tasks.spawn(fetch(client.clone(), url, depth));
        }

        let Some(joined) = tasks.join_next().await else {
            for url in sitemap_seed.take().into_iter().flatten() {
                if same_site(&url, &cfg.start)
                    && !excluded(&cfg, &url)
                    && seen.len() < cfg.max_urls
                    && seen.insert(url.to_string())
                {
                    queue.push_back((url, None));
                }
            }
            if queue.is_empty() {
                break;
            }
            continue;
        };
        let page = joined?;
        let is_html = page.html.is_some();
        let html = page.html.unwrap_or_default();
        let (internal, external): (Vec<Link>, Vec<Link>) = html
            .links
            .into_iter()
            .map(|l| Link {
                url: normalize(l.url),
                ..l
            })
            .filter(|l| matches!(l.url.scheme(), "http" | "https"))
            .partition(|l| same_site(&l.url, &cfg.start));

        // shortcut: one transaction per page, batch several if large crawls get slow
        let tx = db.transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO pages (url, depth, status, content_type, redirect_to, error,
                 title, meta_description, h1, canonical, meta_robots, word_count, x_robots_tag)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                page.url.as_str(),
                page.depth,
                page.status,
                page.content_type,
                page.redirect_to.as_ref().map(Url::as_str),
                page.error,
                html.title,
                html.meta_description,
                html.h1,
                html.canonical.as_ref().map(Url::as_str),
                html.meta_robots,
                is_html.then_some(html.word_count),
                page.x_robots_tag,
            ],
        )?;
        {
            // OR IGNORE keeps the first anchor when a page links the same target twice
            let mut insert = tx.prepare_cached(
                "INSERT OR IGNORE INTO links (source, target, anchor, external) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for link in internal.iter().filter(|l| l.url != page.url) {
                insert.execute(params![
                    page.url.as_str(),
                    link.url.as_str(),
                    link.anchor,
                    false
                ])?;
            }
            let mut insert_img = tx.prepare_cached(
                "INSERT OR IGNORE INTO images (page, src, alt, has_size) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for img in &html.images {
                insert_img.execute(params![
                    page.url.as_str(),
                    img.src.as_str(),
                    img.alt,
                    img.has_size
                ])?;
            }
            for link in &external {
                insert.execute(params![
                    page.url.as_str(),
                    link.url.as_str(),
                    link.anchor,
                    true
                ])?;
            }
        }
        tx.commit()?;
        written += 1;

        let redirect = page
            .redirect_to
            .map(normalize)
            .filter(|l| same_site(l, &cfg.start));
        for link in redirect
            .into_iter()
            .chain(internal.into_iter().map(|l| l.url))
        {
            if !excluded(&cfg, &link) && seen.len() < cfg.max_urls && seen.insert(link.to_string())
            {
                queue.push_back((link, page.depth.map(|d| d + 1)));
            }
        }
        on_progress(Progress {
            stage: Stage::Pages,
            done: written,
            pending: queue.len() + tasks.len(),
        });
    }
    if cfg.check_external {
        check_external(
            &client,
            &mut db,
            concurrency,
            cfg.max_urls,
            &mut on_progress,
        )
        .await?;
    }
    if cfg.check_images {
        check_images(
            &client,
            &mut db,
            concurrency,
            cfg.max_urls,
            &mut on_progress,
        )
        .await?;
    }
    Ok(written)
}

/// Runs `check` on every URL with bounded concurrency, storing each result as it arrives.
async fn check_all<T, Fut>(
    urls: Vec<String>,
    concurrency: usize,
    stage: Stage,
    on_progress: &mut (impl FnMut(Progress) + Send),
    check: impl Fn(String) -> Fut,
    mut store: impl FnMut(T) -> rusqlite::Result<()>,
) -> CrawlResult<()>
where
    T: Send + 'static,
    Fut: Future<Output = T> + Send + 'static,
{
    let total = urls.len();
    let mut queue = urls.into_iter();
    let mut tasks = JoinSet::new();
    let mut done = 0;
    loop {
        while tasks.len() < concurrency
            && let Some(url) = queue.next()
        {
            tasks.spawn(check(url));
        }
        let Some(joined) = tasks.join_next().await else {
            break;
        };
        store(joined?)?;
        done += 1;
        on_progress(Progress {
            stage,
            done,
            pending: total - done,
        });
    }
    Ok(())
}

fn distinct(db: &Connection, sql: &str, max: usize) -> rusqlite::Result<Vec<String>> {
    db.prepare(sql)?
        .query_map([max as i64], |r| r.get(0))?
        .collect()
}

/// Requests each external link target once and stores its status in `external`.
async fn check_external(
    client: &Client,
    db: &mut Connection,
    concurrency: usize,
    max: usize,
    on_progress: &mut (impl FnMut(Progress) + Send),
) -> CrawlResult<()> {
    let urls = distinct(
        db,
        "SELECT DISTINCT target FROM links WHERE external = 1 ORDER BY target LIMIT ?1",
        max,
    )?;
    check_all(
        urls,
        concurrency,
        Stage::External,
        on_progress,
        |url| status_of(client.clone(), url),
        move |(url, status, content_type, error)| {
            db.execute(
                "INSERT OR REPLACE INTO external (url, status, content_type, error) VALUES (?1, ?2, ?3, ?4)",
                params![url, status, content_type, error],
            )
            .map(drop)
        },
    )
    .await
}

/// Requests each image once and stores its status and weight in `image_info`.
async fn check_images(
    client: &Client,
    db: &mut Connection,
    concurrency: usize,
    max: usize,
    on_progress: &mut (impl FnMut(Progress) + Send),
) -> CrawlResult<()> {
    let urls = distinct(
        db,
        "SELECT DISTINCT src FROM images ORDER BY src LIMIT ?1",
        max,
    )?;
    check_all(
        urls,
        concurrency,
        Stage::Images,
        on_progress,
        |url| image_info(client.clone(), url),
        move |(src, status, bytes, content_type, error)| {
            db.execute(
                "INSERT OR REPLACE INTO image_info (src, status, bytes, content_type, error)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![src, status, bytes, content_type, error],
            )
            .map(drop)
        },
    )
    .await
}

type ImageInfo = (
    String,
    Option<u16>,
    Option<i64>,
    Option<String>,
    Option<String>,
);

/// Status and size in bytes: from HEAD's Content-Length when present, otherwise by downloading it.
async fn image_info(client: Client, url: String) -> ImageInfo {
    if let Ok(r) = client.head(&url).send().await
        && r.status().as_u16() < 400
        && let Some(len) = header(&r, CONTENT_LENGTH).and_then(|l| l.parse().ok())
    {
        return (
            url,
            Some(r.status().as_u16()),
            Some(len),
            header(&r, CONTENT_TYPE),
            None,
        );
    }
    match client.get(&url).send().await {
        Ok(r) => {
            let status = r.status().as_u16();
            let content_type = header(&r, CONTENT_TYPE);
            match r.bytes().await {
                Ok(body) => (
                    url,
                    Some(status),
                    Some(body.len() as i64),
                    content_type,
                    None,
                ),
                Err(e) => (url, Some(status), None, content_type, Some(e.to_string())),
            }
        }
        Err(e) => (url, None, None, None, Some(e.to_string())),
    }
}

/// HEAD first; any HEAD error status or failure is confirmed with GET, since some servers
/// (support.google.com among them) answer HEAD with 404 for pages that exist. Redirects are not followed.
async fn status_of(
    client: Client,
    url: String,
) -> (String, Option<u16>, Option<String>, Option<String>) {
    let head = client.head(&url).send().await;
    let resp = match head {
        Ok(r) if r.status().as_u16() < 400 => Ok(r),
        _ => client.get(&url).send().await,
    };
    match resp {
        Ok(r) => {
            let content_type = header(&r, CONTENT_TYPE);
            (url, Some(r.status().as_u16()), content_type, None)
        }
        Err(e) => (url, None, None, Some(e.to_string())),
    }
}

fn excluded(cfg: &Config, url: &Url) -> bool {
    cfg.exclude.iter().any(|re| re.is_match(url.as_str()))
}

fn normalize(mut url: Url) -> Url {
    url.set_fragment(None);
    url
}

fn same_site(url: &Url, start: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && (url.host_str(), url.port()) == (start.host_str(), start.port())
}

/// `None` means everything is allowed.
async fn load_robots(client: &Client, start: &Url, user_agent: &str) -> Option<Robot> {
    let resp = client
        .get(start.join("/robots.txt").ok()?)
        .send()
        .await
        .ok()?;
    // shortcut: any non-2xx allows all, Google treats 5xx as disallow-all
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.bytes().await.ok()?;
    Robot::new(robots_token(user_agent), &body).ok()
}

/// Every `<loc>` in the site's sitemaps, with the sitemap file listing it. Sitemap indexes are
/// followed; files that fail to load are skipped. Uses robots.txt `Sitemap:` lines, else /sitemap.xml.
async fn load_sitemaps(
    client: &Client,
    start: &Url,
    robot: Option<&Robot>,
    max_urls: usize,
) -> Vec<(Url, String)> {
    // robots.txt should list absolute URLs, but relative ones are common enough to accept
    let declared: Vec<String> = robot
        .map(|r| {
            r.sitemaps
                .iter()
                .filter_map(|s| start.join(s.trim()).ok())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let mut files: VecDeque<String> = if declared.is_empty() {
        start
            .join("/sitemap.xml")
            .map(|u| vec![u.to_string()])
            .unwrap_or_default()
            .into()
    } else {
        declared.into()
    };
    let mut fetched = HashSet::new();
    let mut out = Vec::new();
    while let Some(file) = files.pop_front() {
        if fetched.len() >= MAX_SITEMAP_FILES || out.len() >= max_urls {
            break;
        }
        if !fetched.insert(file.clone()) {
            continue;
        }
        let Ok(resp) = client.get(&file).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(body) = resp.text().await else {
            continue;
        };
        let is_index = body.contains("<sitemapindex");
        for loc in xml_locs(&body) {
            if is_index {
                files.push_back(loc);
            } else if let Ok(url) = Url::parse(&loc) {
                out.push((normalize(url), file.clone()));
            }
        }
    }
    out.truncate(max_urls);
    out
}

/// `<loc>` values of a sitemap or sitemap index, with XML entities decoded.
// shortcut: string scan, not an XML parser; misses CDATA, prefixed tags and gzipped .xml.gz files
fn xml_locs(xml: &str) -> Vec<String> {
    xml.split("<loc>")
        .skip(1)
        .filter_map(|rest| rest.split("</loc>").next())
        .map(|l| {
            l.trim()
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&amp;", "&")
        })
        .collect()
}

async fn fetch(client: Client, url: Url, depth: Depth) -> Fetched {
    let mut page = Fetched {
        url,
        depth,
        status: None,
        content_type: None,
        x_robots_tag: None,
        redirect_to: None,
        html: None,
        error: None,
    };
    let resp = match client.get(page.url.clone()).send().await {
        Ok(resp) => resp,
        Err(e) => {
            page.error = Some(e.to_string());
            return page;
        }
    };
    page.status = Some(resp.status().as_u16());
    page.content_type = header(&resp, CONTENT_TYPE);
    let x_robots: Vec<&str> = resp
        .headers()
        .get_all("x-robots-tag")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect();
    page.x_robots_tag = (!x_robots.is_empty()).then(|| x_robots.join(", "));
    if resp.status().is_redirection() {
        page.redirect_to = header(&resp, LOCATION).and_then(|l| page.url.join(&l).ok());
        return page;
    }
    if page
        .content_type
        .as_deref()
        .is_some_and(|c| c.starts_with("text/html"))
    {
        match resp.text().await {
            Ok(body) => page.html = Some(parse_html(&page.url, &body)),
            Err(e) => page.error = Some(e.to_string()),
        }
    }
    page
}

fn header(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    resp.headers().get(name)?.to_str().ok().map(str::to_owned)
}

fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("static selector")
}

static ANCHORS: LazyLock<Selector> = LazyLock::new(|| selector("a[href]"));
static TITLE: LazyLock<Selector> = LazyLock::new(|| selector("title"));
static H1: LazyLock<Selector> = LazyLock::new(|| selector("h1"));
static META: LazyLock<Selector> = LazyLock::new(|| selector("meta[name][content]"));
static LINK_REL: LazyLock<Selector> = LazyLock::new(|| selector("link[rel][href]"));
static BODY: LazyLock<Selector> = LazyLock::new(|| selector("body"));
static IMG_ALT: LazyLock<Selector> = LazyLock::new(|| selector("img[alt]"));
static IMG: LazyLock<Selector> = LazyLock::new(|| selector("img[src]"));

// shortcut: ignores <base href>, add it when a site needs it
fn parse_html(base: &Url, html: &str) -> HtmlData {
    let doc = Html::parse_document(html);
    let first_text = |sel: &Selector| doc.select(sel).next().and_then(|e| squash(e.text()));
    let meta = |name: &str| {
        doc.select(&META)
            .find(|m| {
                m.value()
                    .attr("name")
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
            .and_then(|m| squash(m.value().attr("content")))
    };
    let canonical = doc
        .select(&LINK_REL)
        .find(|l| {
            l.value().attr("rel").is_some_and(|rel| {
                rel.split_ascii_whitespace()
                    .any(|r| r.eq_ignore_ascii_case("canonical"))
            })
        })
        .and_then(|l| base.join(l.value().attr("href")?.trim()).ok());

    HtmlData {
        title: first_text(&TITLE),
        meta_description: meta("description"),
        h1: first_text(&H1),
        canonical,
        meta_robots: meta("robots"),
        word_count: word_count(&doc),
        links: doc
            .select(&ANCHORS)
            .filter_map(|a| {
                let url = base.join(a.value().attr("href")?.trim()).ok()?;
                let anchor = squash(a.text()).or_else(|| {
                    a.select(&IMG_ALT)
                        .find_map(|img| squash(img.value().attr("alt")))
                });
                Some(Link { url, anchor })
            })
            .collect(),
        // shortcut: only `src`, not srcset or <picture><source>; add them when a site relies on them
        images: doc
            .select(&IMG)
            .filter_map(|img| {
                let e = img.value();
                let src = base.join(e.attr("src")?.trim()).ok()?;
                matches!(src.scheme(), "http" | "https").then(|| Image {
                    src: normalize(src),
                    alt: e
                        .attr("alt")
                        .map(|a| a.split_whitespace().collect::<Vec<_>>().join(" ")),
                    has_size: e.attr("width").is_some() && e.attr("height").is_some(),
                })
            })
            .collect(),
    }
}

/// Joins text pieces, collapses whitespace, and treats an empty result as missing.
fn squash<'a>(parts: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let text = parts
        .into_iter()
        .flat_map(str::split_whitespace)
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

/// Whitespace-separated words in `<body>`, ignoring script, style, noscript and template content.
fn word_count(doc: &Html) -> u32 {
    let Some(body) = doc.select(&BODY).next() else {
        return 0;
    };
    body.descendants()
        .filter_map(|n| Some((n, n.value().as_text()?)))
        .filter(|(n, _)| {
            !n.ancestors().any(|a| {
                a.value().as_element().is_some_and(|e| {
                    matches!(e.name(), "script" | "style" | "noscript" | "template")
                })
            })
        })
        .map(|(_, t)| t.split_whitespace().count() as u32)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn respond(path: &str) -> String {
        let (status, headers, body) = match path {
            "/robots.txt" => (
                "200 OK",
                "Content-Type: text/plain\r\n",
                "User-agent: *\nDisallow: /private\n",
            ),
            "/" => (
                "200 OK",
                "Content-Type: text/html\r\n",
                r##"<a href="/a">a</a><a href="/private/x">p</a><a href="/old">o</a>
                    <a href="http://other.example/">ext</a><a href="#top">f</a><a href="mailto:x@y.z">m</a>"##,
            ),
            "/a" => (
                "200 OK",
                "Content-Type: text/html; charset=utf-8\r\n",
                r#"<a href="/">h</a><a href="/missing">m</a><a href="/a#s">s</a>"#,
            ),
            "/old" => ("301 Moved Permanently", "Location: /new\r\n", ""),
            "/new" => (
                "200 OK",
                "Content-Type: text/html\r\nX-Robots-Tag: noindex\r\nX-Robots-Tag: googlebot: nofollow\r\n",
                "<p>no links</p>",
            ),
            _ => ("404 Not Found", "Content-Type: text/html\r\n", "nope"),
        };
        http(status, headers, body)
    }

    fn http(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    async fn serve() -> Url {
        serve_with(|_, path| respond(path)).await
    }

    /// Local HTTP server answering each request with `handler(method, path)`.
    async fn serve_with(handler: impl Fn(&str, &str) -> String + Send + Sync + 'static) -> Url {
        let handler = std::sync::Arc::new(handler);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let handler = handler.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0; 4096];
                    let n = sock.read(&mut buf).await.unwrap();
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let mut parts = req.split_whitespace();
                    let method = parts.next().unwrap_or("GET").to_owned();
                    let path = parts.next().unwrap_or("/").to_owned();
                    sock.write_all(handler(&method, &path).as_bytes())
                        .await
                        .unwrap();
                });
            }
        });
        Url::parse(&format!("http://{addr}/")).unwrap()
    }

    fn db_path(name: &str) -> std::path::PathBuf {
        let p =
            std::env::temp_dir().join(format!("cyberfrog-{name}-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
    }

    type Row = (String, Option<u32>, Option<u16>, Option<String>, bool, u32);

    fn rows(path: &Path) -> Vec<Row> {
        let mut rows: Vec<Row> = read_pages(path)
            .unwrap()
            .into_iter()
            .map(|p| {
                (
                    p.url,
                    p.depth,
                    p.status,
                    p.redirect_to,
                    p.blocked_by_robots,
                    p.inlinks,
                )
            })
            .collect();
        rows.sort(); // crawl order depends on response timing
        rows
    }

    #[tokio::test]
    async fn crawls_same_host_respecting_robots_and_redirects() {
        let base = serve().await;
        let path = db_path("full");
        let cfg = Config {
            concurrency: 4,
            max_urls: 100,
            check_external: false,
            check_images: false,
            use_sitemaps: false,
            ..Config::new(base.clone())
        };

        let mut progress = Vec::new();
        let written = crawl(cfg, &path, |p| progress.push(p)).await.unwrap();

        let u = |p: &str| base.join(p).unwrap().to_string();
        assert_eq!(written, 6);
        assert_eq!(
            rows(&path),
            vec![
                (u("/"), Some(0), Some(200), None, false, 1),
                (u("/a"), Some(1), Some(200), None, false, 1), // its own /a#s self-link is not counted
                (u("/missing"), Some(2), Some(404), None, false, 1),
                (u("/new"), Some(2), Some(200), None, false, 0), // reached only through a redirect
                (u("/old"), Some(1), Some(301), Some(u("/new")), false, 1),
                (u("/private/x"), Some(1), None, None, true, 1),
            ]
        );
        let pages = read_pages(&path).unwrap();
        let x_robots = |p: &str| {
            pages
                .iter()
                .find(|pg| pg.url == u(p))
                .unwrap()
                .x_robots_tag
                .clone()
        };
        assert_eq!(
            x_robots("/new").as_deref(),
            Some("noindex, googlebot: nofollow")
        );
        assert_eq!(x_robots("/a"), None);

        // crawls saved before the X-Robots-Tag column existed still open
        Connection::open(&path)
            .unwrap()
            .execute_batch("ALTER TABLE pages DROP COLUMN x_robots_tag;")
            .unwrap();
        let old = read_pages(&path).unwrap();
        assert_eq!(old.len(), 6);
        assert!(old.iter().all(|p| p.x_robots_tag.is_none()));
        assert!(summary(&path).is_ok());

        let done: Vec<usize> = progress.iter().map(|p| p.done).collect();
        assert_eq!(
            done,
            (1..=6).collect::<Vec<_>>(),
            "one report per stored URL, in order"
        );
        assert_eq!(
            progress.last(),
            Some(&Progress {
                stage: Stage::Pages,
                done: 6,
                pending: 0
            })
        );
    }

    #[tokio::test]
    async fn saved_copy_reopens_identically_and_non_crawls_are_refused() {
        let base = serve().await;
        let path = db_path("orig");
        let cfg = Config {
            concurrency: 4,
            max_urls: 100,
            check_external: false,
            check_images: false,
            use_sitemaps: false,
            ..Config::new(base.clone())
        };
        crawl(cfg, &path, |_| {}).await.unwrap();

        let copy = db_path("copy");
        std::fs::write(&copy, "stale").unwrap(); // the save dialog may point at an existing file
        save_copy(&path, &copy).unwrap();
        assert_eq!(read_pages(&copy).unwrap(), read_pages(&path).unwrap());
        assert_eq!(summary(&copy).unwrap(), (Some(base.to_string()), 6));

        let other = db_path("other");
        Connection::open(&other)
            .unwrap()
            .execute_batch("CREATE TABLE notes (x TEXT);")
            .unwrap();
        assert!(save_copy(&other, &db_path("never")).is_err());
        assert!(read_pages(&other).is_err());
        assert!(summary(&other).is_err());

        let legacy = db_path("legacy"); // the step-1 format, without metadata columns or links
        Connection::open(&legacy)
            .unwrap()
            .execute_batch("CREATE TABLE pages (url TEXT PRIMARY KEY, depth INTEGER NOT NULL); INSERT INTO pages VALUES ('x', 0);")
            .unwrap();
        assert!(
            summary(&legacy).is_err(),
            "legacy crawls are left out of the recent list"
        );
        let tables: u32 = Connection::open(&other)
            .unwrap()
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            tables, 1,
            "opening a foreign file must not add our tables to it"
        );
    }

    #[test]
    fn parses_metadata_and_counts_visible_words() {
        let base = Url::parse("https://site.test/blog/post").unwrap();
        let html = r#"<html><head>
            <title>
              My   Post
            </title>
            <META NAME="Description" CONTENT="  A short   summary ">
            <meta name="robots" content="noindex, follow">
            <link rel="stylesheet" href="/s.css">
            <link rel="Canonical" href=" ../post?ref=1 ">
            <style>.x { color: red }</style>
          </head><body>
            <h1>Hello <span>world</span></h1><h1>Second</h1>
            <p>one two three</p>
            <script>var not = "counted at all";</script>
            <noscript>enable js please</noscript>
            <a href="/other#frag">x</a>
          </body></html>"#;

        let data = parse_html(&base, html);

        assert_eq!(data.title.as_deref(), Some("My Post"));
        assert_eq!(data.meta_description.as_deref(), Some("A short summary"));
        assert_eq!(data.meta_robots.as_deref(), Some("noindex, follow"));
        assert_eq!(
            data.canonical.as_ref().map(Url::as_str),
            Some("https://site.test/post?ref=1")
        );
        assert_eq!(data.h1.as_deref(), Some("Hello world"));
        assert_eq!(data.word_count, 7); // Hello world Second one two three x
        assert_eq!(
            data.links,
            vec![Link {
                url: Url::parse("https://site.test/other#frag").unwrap(),
                anchor: Some("x".to_owned())
            }]
        );
    }

    #[test]
    fn empty_or_absent_metadata_is_missing() {
        let base = Url::parse("https://site.test/").unwrap();
        let data = parse_html(
            &base,
            "<title>  </title><meta name=description content=''><p>hi</p>",
        );
        assert_eq!(
            data,
            HtmlData {
                word_count: 1,
                ..HtmlData::default()
            }
        );
    }

    #[tokio::test]
    async fn checks_external_links_and_reports_broken_ones() {
        type BrokenRow = (String, String, Option<String>, Option<u16>, bool);
        const HTML: &str = "Content-Type: text/html\r\n";
        let ext = serve_with(|method, path| match (method, path) {
            (_, "/ok") => http("200 OK", HTML, "fine"),
            ("HEAD", "/nohead") => http("404 Not Found", "", ""), // like support.google.com
            (_, "/nohead") => http("200 OK", HTML, "fine on GET"),
            _ => http("404 Not Found", HTML, "gone"),
        })
        .await;
        let e = ext.to_string();
        let site = serve_with(move |_, path| match path {
            "/" => http(
                "200 OK",
                HTML,
                &format!(
                    r#"<a href="/b">Pagina  B</a><a href="{e}ok">Esterno ok</a>
                       <a href="{e}gone"><img alt="Logo rotto"></a><a href="{e}nohead">x</a>"#
                ),
            ),
            "/b" => http(
                "200 OK",
                HTML,
                &format!(r#"<a href="/missing">Rotto</a><a href="{e}gone">di nuovo</a>"#),
            ),
            _ => http("404 Not Found", HTML, "nope"),
        })
        .await;
        let path = db_path("external");
        let cfg = Config {
            concurrency: 4,
            max_urls: 100,
            check_external: true,
            check_images: false,
            use_sitemaps: false,
            ..Config::new(site.clone())
        };
        let mut progress = Vec::new();
        crawl(cfg, &path, |p| progress.push(p)).await.unwrap();

        let s = |p: &str| site.join(p).unwrap().to_string();
        let x = |p: &str| ext.join(p).unwrap().to_string();
        assert_eq!(
            progress.last(),
            Some(&Progress {
                stage: Stage::External,
                done: 3,
                pending: 0
            })
        );

        let external: Vec<(String, Option<u16>, u32)> = report::read_external(&path)
            .unwrap()
            .into_iter()
            .map(|l| (l.url, l.status, l.inlinks))
            .collect();
        assert_eq!(
            external,
            vec![
                (x("/gone"), Some(404), 2),
                (x("/nohead"), Some(200), 1),
                (x("/ok"), Some(200), 1)
            ]
        );

        let mut broken: Vec<BrokenRow> = report::read_broken(&path)
            .unwrap()
            .into_iter()
            .map(|b| (b.source, b.target, b.anchor, b.status, b.external))
            .collect();
        broken.sort();
        let mut expected = vec![
            (
                s("/"),
                x("/gone"),
                Some("Logo rotto".to_owned()),
                Some(404),
                true,
            ),
            (
                s("/b"),
                x("/gone"),
                Some("di nuovo".to_owned()),
                Some(404),
                true,
            ),
            (
                s("/b"),
                s("/missing"),
                Some("Rotto".to_owned()),
                Some(404),
                false,
            ),
        ];
        expected.sort();
        assert_eq!(broken, expected);

        let links = report::page_links(&path, &s("/")).unwrap();
        let out: Vec<(String, Option<u16>, bool)> = links
            .outlinks
            .into_iter()
            .map(|l| (l.url, l.status, l.external))
            .collect();
        assert_eq!(
            out[0],
            (s("/b"), Some(200), false),
            "same-site links come first"
        );
        assert_eq!(out.len(), 4);
        let into_b = report::page_links(&path, &s("/b")).unwrap().inlinks;
        assert_eq!(into_b.len(), 1);
        assert_eq!(
            (into_b[0].url.as_str(), into_b[0].anchor.as_deref()),
            (s("/").as_str(), Some("Pagina B"))
        );

        let home = read_pages(&path)
            .unwrap()
            .into_iter()
            .find(|p| p.url == s("/"))
            .unwrap();
        assert_eq!((home.outlinks, home.external_outlinks), (1, 3));
    }

    #[tokio::test]
    async fn records_images_with_alt_size_and_weight() {
        const HTML: &str = "Content-Type: text/html\r\n";
        let big = "x".repeat(150_000);
        let site = serve_with(move |method, path| match (method, path) {
            (_, "/") => http(
                "200 OK",
                HTML,
                r#"<img src="/logo.png" alt=" Logo  CyberZec " width="10" height="10">
                   <img src="/big.jpg"><img src="data:image/png;base64,AAAA" alt="inline">
                   <a href="/b">b</a>"#,
            ),
            (_, "/b") => http(
                "200 OK",
                HTML,
                r#"<img src="/logo.png" alt=""><img src="/gone.png" alt="x" width="1">"#,
            ),
            (_, "/logo.png") => http("200 OK", "Content-Type: image/png\r\n", "0123456789"),
            // HEAD without Content-Length forces a download to learn the weight
            ("HEAD", "/big.jpg") => {
                "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nConnection: close\r\n\r\n".into()
            }
            (_, "/big.jpg") => http("200 OK", "Content-Type: image/jpeg\r\n", &big),
            _ => http("404 Not Found", HTML, "nope"),
        })
        .await;
        let path = db_path("images");
        let cfg = Config {
            concurrency: 4,
            max_urls: 100,
            check_external: false,
            check_images: true,
            use_sitemaps: false,
            ..Config::new(site.clone())
        };
        let mut progress = Vec::new();
        crawl(cfg, &path, |p| progress.push(p)).await.unwrap();
        assert_eq!(
            progress.last(),
            Some(&Progress {
                stage: Stage::Images,
                done: 3,
                pending: 0
            })
        );

        let s = |p: &str| site.join(p).unwrap().to_string();
        let images: Vec<_> = report::read_images(&path)
            .unwrap()
            .into_iter()
            .map(|i| {
                (
                    i.src,
                    i.status,
                    i.bytes,
                    i.pages,
                    i.missing_alt,
                    i.empty_alt,
                    i.missing_size,
                    i.alt,
                )
            })
            .collect();
        assert_eq!(
            images,
            vec![
                (s("/big.jpg"), Some(200), Some(150_000), 1, 1, 0, 1, None),
                (
                    s("/gone.png"),
                    Some(404),
                    Some(4),
                    1,
                    0,
                    0,
                    1,
                    Some("x".to_owned())
                ),
                (
                    s("/logo.png"),
                    Some(200),
                    Some(10),
                    2,
                    0,
                    1,
                    1,
                    Some("Logo CyberZec".to_owned())
                ),
            ]
        );
        let uses = report::image_pages(&path, &s("/logo.png")).unwrap();
        assert_eq!(
            uses.iter()
                .map(|u| (u.page.as_str(), u.alt.as_deref(), u.has_size))
                .collect::<Vec<_>>(),
            vec![
                (s("/").as_str(), Some("Logo CyberZec"), true),
                (s("/b").as_str(), Some(""), false)
            ]
        );
    }

    #[tokio::test]
    async fn reads_sitemaps_and_crawls_urls_found_only_there() {
        type SitemapRow = (String, Option<u32>, Option<u16>, bool, bool, u32);
        const HTML: &str = "Content-Type: text/html\r\n";
        const XML: &str = "Content-Type: application/xml\r\n";
        // sitemap locs are absolute, so the handler learns its own address after binding
        let base = std::sync::Arc::new(std::sync::OnceLock::<String>::new());
        let b = base.clone();
        let site = serve_with(move |_, path| {
            let b = b.get().unwrap();
            match path {
                "/robots.txt" => http("200 OK", "", "User-agent: *\nDisallow: /private\nSitemap: /sm-index.xml\n"),
                "/sm-index.xml" => http(
                    "200 OK",
                    XML,
                    &format!(
                        "<sitemapindex><sitemap><loc>{b}sm1.xml</loc></sitemap>\
                         <sitemap><loc>{b}missing.xml</loc></sitemap></sitemapindex>"
                    ),
                ),
                "/sm1.xml" => http(
                    "200 OK",
                    XML,
                    &format!(
                        "<urlset><url><loc>{b}</loc></url><url><loc> {b}linked </loc></url>\
                         <url><loc>{b}orphan</loc></url><url><loc>{b}private/p</loc></url>\
                         <url><loc>{b}q?a=1&amp;b=2</loc></url><url><loc>http://other.invalid/x</loc></url></urlset>"
                    ),
                ),
                "/" => http("200 OK", HTML, r#"<a href="/linked">l</a>"#),
                "/linked" | "/orphan-child" => http("200 OK", HTML, "ok"),
                "/orphan" => http("200 OK", HTML, r#"<a href="/orphan-child">c</a>"#),
                _ => http("404 Not Found", HTML, "nope"),
            }
        })
        .await;
        base.set(site.to_string()).unwrap();

        let path = db_path("sitemap");
        let cfg = Config {
            concurrency: 4,
            max_urls: 100,
            check_external: false,
            check_images: false,
            use_sitemaps: true,
            ..Config::new(site.clone())
        };
        crawl(cfg, &path, |_| {}).await.unwrap();

        let u = |p: &str| site.join(p).unwrap().to_string();
        let mut got: Vec<SitemapRow> = read_pages(&path)
            .unwrap()
            .into_iter()
            .map(|p| {
                (
                    p.url,
                    p.depth,
                    p.status,
                    p.blocked_by_robots,
                    p.in_sitemap,
                    p.inlinks,
                )
            })
            .collect();
        got.sort();
        let mut expected = vec![
            (u("/"), Some(0), Some(200), false, true, 0),
            (u("/linked"), Some(1), Some(200), false, true, 1),
            (u("/orphan"), None, Some(200), false, true, 0), // in the sitemap, linked from nowhere
            (u("/orphan-child"), None, Some(200), false, false, 1),
            (u("/private/p"), None, None, true, true, 0),
            (u("/q?a=1&b=2"), None, Some(404), false, true, 0), // &amp; decoded
        ];
        expected.sort();
        assert_eq!(got, expected);
        let listed: u32 = Connection::open(&path)
            .unwrap()
            .query_row("SELECT count(*) FROM sitemap", [], |r| r.get(0))
            .unwrap();
        assert_eq!(listed, 6, "cross-host locs are recorded but not crawled");
    }

    #[tokio::test]
    async fn exclude_patterns_and_ignoring_robots() {
        let base = serve().await;
        let u = |p: &str| base.join(p).unwrap().to_string();

        let path = db_path("exclude");
        let cfg = Config {
            check_external: false,
            check_images: false,
            use_sitemaps: false,
            exclude: vec![Regex::new("/(old|missing)$").unwrap()],
            ..Config::new(base.clone())
        };
        crawl(cfg, &path, |_| {}).await.unwrap();
        let urls: Vec<String> = rows(&path).into_iter().map(|r| r.0).collect();
        assert_eq!(
            urls,
            vec![u("/"), u("/a"), u("/private/x")],
            "excluded URLs and what only they lead to are skipped"
        );

        let path = db_path("no-robots");
        let cfg = Config {
            check_external: false,
            check_images: false,
            use_sitemaps: false,
            respect_robots: false,
            ..Config::new(base.clone())
        };
        crawl(cfg, &path, |_| {}).await.unwrap();
        let private = rows(&path)
            .into_iter()
            .find(|r| r.0 == u("/private/x"))
            .unwrap();
        assert_eq!(
            (private.2, private.4),
            (Some(404), false),
            "fetched instead of blocked"
        );
    }

    #[test]
    fn robots_token_comes_from_the_product_name() {
        assert_eq!(robots_token("CyberFrog/0.1"), "CyberFrog");
        assert_eq!(
            robots_token(
                "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
            ),
            "Googlebot"
        );
        assert_eq!(
            robots_token("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
            "bingbot"
        );
        assert_eq!(robots_token("MyCrawler"), "MyCrawler");
    }

    #[tokio::test]
    async fn stops_at_max_urls() {
        let base = serve().await;
        let path = db_path("limit");
        let cfg = Config {
            concurrency: 2,
            max_urls: 2,
            check_external: false,
            check_images: false,
            use_sitemaps: false,
            ..Config::new(base)
        };

        assert_eq!(crawl(cfg, &path, |_| {}).await.unwrap(), 2);
        assert_eq!(rows(&path).len(), 2);
    }
}

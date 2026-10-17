//! Same-host breadth-first crawler that writes one row per URL to SQLite.

use std::collections::{HashSet, VecDeque};
use std::error::Error;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::{Client, redirect::Policy};
use rusqlite::{Connection, OpenFlags, params};
use scraper::{Html, Selector};
use texting_robots::Robot;
use tokio::task::JoinSet;
use url::Url;

pub const USER_AGENT: &str = "CyberFrog/0.1";
const ROBOTS_AGENT: &str = "CyberFrog";

pub type CrawlResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub struct Config {
    pub start: Url,
    pub concurrency: usize,
    /// Upper bound on URLs stored; URLs discovered past it are dropped.
    pub max_urls: usize,
}

struct Fetched {
    url: Url,
    depth: u32,
    status: Option<u16>,
    content_type: Option<String>,
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
    links: Vec<Url>,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Page {
    pub url: String,
    pub depth: u32,
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
    /// Distinct crawled pages linking here with `<a href>`, self-links excluded.
    pub inlinks: u32,
}

/// Crawl progress: URLs written so far, and URLs waiting or in flight.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Progress {
    pub done: usize,
    pub pending: usize,
}

/// Opens an existing crawl without creating or changing anything in the file.
fn open_existing(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// All pages, in crawl order.
pub fn read_pages(path: &Path) -> rusqlite::Result<Vec<Page>> {
    let db = open_existing(path)?;
    let mut stmt = db.prepare(
        "SELECT url, depth, status, content_type, redirect_to, blocked_by_robots, error,
                title, meta_description, h1, canonical, meta_robots, word_count,
                (SELECT count(*) FROM links WHERE target = pages.url)
         FROM pages ORDER BY rowid",
    )?;
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
             depth             INTEGER NOT NULL,
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
             word_count        INTEGER
         );
         CREATE TABLE IF NOT EXISTS links (
             source TEXT NOT NULL,
             target TEXT NOT NULL,
             PRIMARY KEY (source, target)
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS links_target ON links (target);",
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
        .user_agent(USER_AGENT)
        .redirect(Policy::none()) // redirects are recorded as rows, their targets queued
        .timeout(Duration::from_secs(20))
        .build()?;
    let robot = load_robots(&client, &cfg.start).await;
    let mut db = open_db(db_path)?;
    let concurrency = cfg.concurrency.max(1);

    let mut start = cfg.start.clone();
    start.set_fragment(None);
    let mut seen = HashSet::from([start.to_string()]);
    let mut queue = VecDeque::from([(start, 0u32)]);
    let mut tasks = JoinSet::new();
    let mut written = 0;

    loop {
        while tasks.len() < concurrency
            && let Some((url, depth)) = queue.pop_front()
        {
            if robot.as_ref().is_some_and(|r| !r.allowed(url.as_str())) {
                db.execute(
                    "INSERT OR IGNORE INTO pages (url, depth, blocked_by_robots) VALUES (?1, ?2, 1)",
                    params![url.as_str(), depth],
                )?;
                written += 1;
                on_progress(Progress {
                    done: written,
                    pending: queue.len() + tasks.len(),
                });
                continue;
            }
            tasks.spawn(fetch(client.clone(), url, depth));
        }

        let Some(joined) = tasks.join_next().await else {
            break;
        };
        let page = joined?;
        let is_html = page.html.is_some();
        let html = page.html.unwrap_or_default();
        let links: Vec<Url> = html
            .links
            .into_iter()
            .map(normalize)
            .filter(|l| same_site(l, &cfg.start))
            .collect();

        // shortcut: one transaction per page, batch several if large crawls get slow
        let tx = db.transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO pages (url, depth, status, content_type, redirect_to, error,
                 title, meta_description, h1, canonical, meta_robots, word_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
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
            ],
        )?;
        {
            let mut insert =
                tx.prepare_cached("INSERT OR IGNORE INTO links (source, target) VALUES (?1, ?2)")?;
            for link in links.iter().filter(|l| **l != page.url) {
                insert.execute(params![page.url.as_str(), link.as_str()])?;
            }
        }
        tx.commit()?;
        written += 1;

        let redirect = page
            .redirect_to
            .map(normalize)
            .filter(|l| same_site(l, &cfg.start));
        for link in redirect.into_iter().chain(links) {
            if seen.len() < cfg.max_urls && seen.insert(link.to_string()) {
                queue.push_back((link, page.depth + 1));
            }
        }
        on_progress(Progress {
            done: written,
            pending: queue.len() + tasks.len(),
        });
    }
    Ok(written)
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
async fn load_robots(client: &Client, start: &Url) -> Option<Robot> {
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
    Robot::new(ROBOTS_AGENT, &body).ok()
}

async fn fetch(client: Client, url: Url, depth: u32) -> Fetched {
    let mut page = Fetched {
        url,
        depth,
        status: None,
        content_type: None,
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
            .filter_map(|a| base.join(a.value().attr("href")?.trim()).ok())
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
            "/new" => ("200 OK", "Content-Type: text/html\r\n", "<p>no links</p>"),
            _ => ("404 Not Found", "Content-Type: text/html\r\n", "nope"),
        };
        format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    async fn serve() -> Url {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = vec![0; 4096];
                    let n = sock.read(&mut buf).await.unwrap();
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_owned();
                    sock.write_all(respond(&path).as_bytes()).await.unwrap();
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

    type Row = (String, u32, Option<u16>, Option<String>, bool, u32);

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
            start: base.clone(),
            concurrency: 4,
            max_urls: 100,
        };

        let mut progress = Vec::new();
        let written = crawl(cfg, &path, |p| progress.push(p)).await.unwrap();

        let u = |p: &str| base.join(p).unwrap().to_string();
        assert_eq!(written, 6);
        assert_eq!(
            rows(&path),
            vec![
                (u("/"), 0, Some(200), None, false, 1),
                (u("/a"), 1, Some(200), None, false, 1), // its own /a#s self-link is not counted
                (u("/missing"), 2, Some(404), None, false, 1),
                (u("/new"), 2, Some(200), None, false, 0), // reached only through a redirect
                (u("/old"), 1, Some(301), Some(u("/new")), false, 1),
                (u("/private/x"), 1, None, None, true, 1),
            ]
        );
        let done: Vec<usize> = progress.iter().map(|p| p.done).collect();
        assert_eq!(
            done,
            (1..=6).collect::<Vec<_>>(),
            "one report per stored URL, in order"
        );
        assert_eq!(
            progress.last(),
            Some(&Progress {
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
            start: base.clone(),
            concurrency: 4,
            max_urls: 100,
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
            vec![Url::parse("https://site.test/other#frag").unwrap()]
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
    async fn stops_at_max_urls() {
        let base = serve().await;
        let path = db_path("limit");
        let cfg = Config {
            start: base,
            concurrency: 2,
            max_urls: 2,
        };

        assert_eq!(crawl(cfg, &path, |_| {}).await.unwrap(), 2);
        assert_eq!(rows(&path).len(), 2);
    }
}

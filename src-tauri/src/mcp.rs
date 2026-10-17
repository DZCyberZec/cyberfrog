//! Model Context Protocol server over stdio, started with `cyberfrog --mcp`.
//! Lets an AI assistant crawl sites and read crawl files: one JSON-RPC message per line.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use rusqlite::types::ValueRef;
use serde_json::{Value, json};
use url::Url;

use crate::crawler::{self, Config, CustomRule};
use crate::report;

const PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_ROWS: usize = 200;
const DEFAULT_MCP_MAX_URLS: usize = 500;
const MAX_MCP_URLS: usize = 10_000;

/// Same folder the desktop app keeps its crawls in (Tauri's app data dir for our identifier).
pub fn crawls_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.cyberzec.cyberfrog")
        .join("crawls")
}

/// Serves requests from stdin until it closes. Logs go to stderr, which MCP clients show as logs.
pub fn run() {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let dir = crawls_dir();
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => runtime.block_on(handle(&msg, &dir)),
            Err(e) => Some(
                json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": e.to_string()}}),
            ),
        };
        if let Some(r) = response {
            let mut out = stdout.lock();
            let _ = writeln!(out, "{r}");
            let _ = out.flush();
        }
    }
}

/// The reply to one message, or `None` for notifications.
pub async fn handle(msg: &Value, dir: &Path) -> Option<Value> {
    let id = msg.get("id")?.clone(); // notifications carry no id and get no reply
    let method = msg
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "cyberfrog", "title": "CyberFrog – Another SEO Tool", "version": env!("CARGO_PKG_VERSION")},
            "instructions": "Crawl websites and analyse SEO data. Start with crawl_site or list_crawls, then crawl_summary; use query_crawl for anything specific."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools()})),
        "tools/call" => Ok(call_tool(&params, dir).await),
        _ => Err(json!({"code": -32601, "message": format!("Method not found: {method}")})),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err(e) => json!({"jsonrpc": "2.0", "id": id, "error": e}),
    })
}

const SCHEMA_HELP: &str = "Tables: pages(url, depth, status, content_type, redirect_to, blocked_by_robots, error, title, \
meta_description, h1, canonical, meta_robots, word_count, x_robots_tag, response_ms, size_bytes, content_hash, simhash); \
links(source, target, anchor, external); external(url, status, content_type, error); images(page, src, alt, has_size); \
image_info(src, status, bytes, content_type, error); sitemap(url, file); hreflang(page, lang, href); \
structured(page, format, kind, issue); bad_links(page, kind, raw, reason); custom_rules(name, kind, expr, attr); \
custom(page, rule, value) — a search rule stores its match count as value. Older crawls may lack some tables.";

fn tools() -> Value {
    let crawl_arg = json!({"type": "string", "description": "Path of a crawl file from list_crawls. Defaults to the most recent crawl."});
    json!([
        {
            "name": "crawl_site",
            "title": "Crawl a website",
            "description": "Crawl a website from a start URL (same host, robots.txt respected) and return an SEO summary. \
    The crawl is saved and can be opened in the CyberFrog app. Only crawl sites you own or may audit.",
            "inputSchema": {"type": "object", "properties": {
                "url": {"type": "string", "description": "Start URL, http:// or https://"},
                "max_urls": {"type": "integer", "description": "URL limit, default 500, max 10000"},
                "check_external": {"type": "boolean", "description": "Also check external links (slower). Default false."},
                "check_images": {"type": "boolean", "description": "Also check image size and status (slower). Default false."},
                "rules": {"type": "array", "description": "Custom extraction/search rules; results land in the custom table", "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "kind": {"type": "string", "enum": ["css", "regex", "search"], "description": "css: element text or attr; regex: first group; search: count of a literal text"},
                        "expr": {"type": "string"},
                        "attr": {"type": "string", "description": "For css: read this attribute instead of the text"}
                    },
                    "required": ["name", "kind", "expr"]
                }}
            }, "required": ["url"]}
        },
        {
            "name": "list_crawls",
            "title": "List saved crawls",
            "description": "List saved crawls, newest first, with start URL, page count and date.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "crawl_summary",
            "title": "Summarise a crawl",
            "description": "SEO summary of a saved crawl: status codes, indexability, missing or duplicate titles, meta descriptions and H1, broken links, slow pages, heavy images.",
            "inputSchema": {"type": "object", "properties": {"crawl": crawl_arg}}
        },
        {
            "name": "query_crawl",
            "title": "Query a crawl with SQL",
            "description": format!("Run one read-only SQLite SELECT on a crawl and get up to {MAX_ROWS} rows. {SCHEMA_HELP}"),
            "inputSchema": {"type": "object", "properties": {
                "crawl": crawl_arg,
                "sql": {"type": "string", "description": "A single SELECT statement"}
            }, "required": ["sql"]}
        },
        {
            "name": "page_details",
            "title": "Page details and links",
            "description": "One crawled URL: its metadata plus inlinks and outlinks with anchor text and status.",
            "inputSchema": {"type": "object", "properties": {
                "crawl": crawl_arg,
                "url": {"type": "string", "description": "A URL of the crawl, exactly as listed"}
            }, "required": ["url"]}
        }
    ])
}

/// Tool results are text for the model; failures are reported as tool errors, not protocol errors.
async fn call_tool(params: &Value, dir: &Path) -> Value {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let args = params.get("arguments").cloned().unwrap_or(json!({}));
    let outcome = match name {
        "crawl_site" => crawl_site(&args, dir).await,
        "list_crawls" => list_crawls(dir),
        "crawl_summary" => crawl_path(&args, dir).and_then(|p| summarize(&p)),
        "query_crawl" => crawl_path(&args, dir)
            .and_then(|p| query(&p, str_arg(&args, "sql").unwrap_or_default())),
        "page_details" => crawl_path(&args, dir)
            .and_then(|p| page_details(&p, str_arg(&args, "url").unwrap_or_default())),
        _ => Err(format!("Unknown tool: {name}")),
    };
    match outcome {
        Ok(v) => {
            json!({"content": [{"type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default()}]})
        }
        Err(e) => json!({"content": [{"type": "text", "text": e}], "isError": true}),
    }
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

async fn crawl_site(args: &Value, dir: &Path) -> Result<Value, String> {
    let start = Url::parse(str_arg(args, "url").unwrap_or_default().trim())
        .map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(start.scheme(), "http" | "https") {
        return Err("The URL must start with http:// or https://".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = dir.join(format!("crawl-{stamp}.sqlite"));
    let max_urls = args
        .get("max_urls")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_MCP_MAX_URLS, |n| {
            (n as usize).clamp(1, MAX_MCP_URLS)
        });
    let flag = |key: &str| args.get(key).and_then(Value::as_bool).unwrap_or(false);
    let rules = args
        .get("rules")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|r| {
            let s = |k: &str| r.get(k).and_then(Value::as_str);
            CustomRule::new(
                s("name").unwrap_or_default(),
                s("kind").unwrap_or_default(),
                s("expr").unwrap_or_default(),
                s("attr"),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let cfg = Config {
        rules: std::sync::Arc::new(rules),
        max_urls,
        check_external: flag("check_external"),
        check_images: flag("check_images"),
        ..Config::new(start)
    };
    crawler::crawl(cfg, &path, |_| {})
        .await
        .map_err(|e| e.to_string())?;
    summarize(&path)
}

fn list_crawls(dir: &Path) -> Result<Value, String> {
    let mut crawls: Vec<(u128, Value)> = std::fs::read_dir(dir)
        .map_err(|e| format!("No crawls yet ({e})"))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "sqlite"))
        .filter_map(|path| {
            let (start_url, pages) = crawler::summary(&path).ok()?;
            let modified = path.metadata().ok()?.modified().ok()?;
            let ms = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis();
            Some((ms, json!({"crawl": path, "start_url": start_url, "pages": pages, "modified_unix_ms": ms})))
        })
        .collect();
    crawls.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(Value::Array(crawls.into_iter().map(|(_, v)| v).collect()))
}

/// The crawl named in `args`, or the most recent one.
fn crawl_path(args: &Value, dir: &Path) -> Result<PathBuf, String> {
    if let Some(p) = str_arg(args, "crawl") {
        return Ok(PathBuf::from(p));
    }
    let latest = list_crawls(dir)?;
    latest
        .get(0)
        .and_then(|c| c.get("crawl"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "No crawls yet: run crawl_site first.".into())
}

/// Indexable here means 200 HTML without noindex and without a canonical to another URL,
/// matching the app's on-page checks.
const SUMMARY_SQL: &str = "
WITH html AS (SELECT * FROM pages WHERE status = 200 AND content_type LIKE 'text/html%'),
     idx AS (SELECT * FROM html
             WHERE lower(coalesce(meta_robots, '') || ',' || coalesce(x_robots_tag, '')) NOT LIKE '%noindex%'
               AND (canonical IS NULL OR canonical = url))
SELECT
  (SELECT url FROM pages ORDER BY rowid LIMIT 1),
  (SELECT count(*) FROM pages),
  (SELECT count(*) FROM pages WHERE status BETWEEN 200 AND 299),
  (SELECT count(*) FROM pages WHERE status BETWEEN 300 AND 399),
  (SELECT count(*) FROM pages WHERE status BETWEEN 400 AND 499),
  (SELECT count(*) FROM pages WHERE status >= 500),
  (SELECT count(*) FROM pages WHERE blocked_by_robots = 1),
  (SELECT count(*) FROM pages WHERE status IS NULL AND blocked_by_robots = 0),
  (SELECT count(*) FROM idx),
  (SELECT count(*) FROM html WHERE lower(coalesce(meta_robots, '') || ',' || coalesce(x_robots_tag, '')) LIKE '%noindex%'),
  (SELECT count(*) FROM idx WHERE title IS NULL),
  (SELECT count(*) FROM idx WHERE title IN (SELECT title FROM idx GROUP BY title HAVING count(*) > 1)),
  (SELECT count(*) FROM idx WHERE meta_description IS NULL),
  (SELECT count(*) FROM idx WHERE meta_description IN (SELECT meta_description FROM idx GROUP BY meta_description HAVING count(*) > 1)),
  (SELECT count(*) FROM idx WHERE h1 IS NULL),
  (SELECT count(*) FROM pages WHERE response_ms > 1000),
  (SELECT CAST(avg(response_ms) AS INTEGER) FROM pages WHERE response_ms IS NOT NULL)
";

fn summarize(path: &Path) -> Result<Value, String> {
    let db = crawler::open_existing(path).map_err(|e| e.to_string())?;
    let n = |v: rusqlite::Result<i64>| v.unwrap_or(0);
    let mut summary = db
        .query_row(SUMMARY_SQL, [], |r| {
            Ok(json!({
                "crawl": path,
                "start_url": r.get::<_, Option<String>>(0)?,
                "urls": n(r.get(1)),
                "status": {"2xx": n(r.get(2)), "3xx": n(r.get(3)), "4xx": n(r.get(4)), "5xx": n(r.get(5)),
                           "blocked_by_robots": n(r.get(6)), "no_response": n(r.get(7))},
                "indexable_pages": n(r.get(8)),
                "noindex_pages": n(r.get(9)),
                "indexable_pages_with": {
                    "missing_title": n(r.get(10)), "duplicate_title": n(r.get(11)),
                    "missing_meta_description": n(r.get(12)), "duplicate_meta_description": n(r.get(13)),
                    "missing_h1": n(r.get(14))
                },
                "slow_pages_over_1s": n(r.get(15)),
                "average_response_ms": r.get::<_, Option<i64>>(16)?,
            }))
        })
        .map_err(|e| format!("Not a readable CyberFrog crawl ({e})"))?;
    let broken = report::read_broken(path).map_err(|e| e.to_string())?;
    let images = report::read_images(path).map_err(|e| e.to_string())?;
    summary["broken_links"] = json!({
        "internal": broken.iter().filter(|b| !b.external).count(),
        "external": broken.iter().filter(|b| b.external).count(),
    });
    summary["images"] = json!({
        "total": images.len(),
        // sizes exist only when the crawl ran with check_images
        "sizes_checked": images.iter().any(|i| i.status.is_some()),
        "over_100_kb": images.iter().filter(|i| i.bytes.unwrap_or(0) > 100 * 1024).count(),
        "missing_alt": images.iter().filter(|i| i.missing_alt > 0).count(),
    });
    Ok(summary)
}

fn query(path: &Path, sql: &str) -> Result<Value, String> {
    let sql = sql.trim().trim_end_matches(';');
    if !sql.to_ascii_lowercase().starts_with("select")
        && !sql.to_ascii_lowercase().starts_with("with")
    {
        return Err("Only SELECT queries are allowed.".into());
    }
    let db = crawler::open_existing(path).map_err(|e| e.to_string())?; // read-only connection
    // wrapping keeps it to one statement and caps the rows
    let mut stmt = db
        .prepare(&format!("SELECT * FROM ({sql}) LIMIT {}", MAX_ROWS + 1))
        .map_err(|e| format!("SQL error: {e}"))?;
    let columns: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = serde_json::Map::new();
        for (i, name) in columns.iter().enumerate() {
            let v = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                ValueRef::Blob(b) => json!(format!("<{} bytes>", b.len())),
            };
            obj.insert(name.clone(), v);
        }
        out.push(Value::Object(obj));
    }
    let truncated = out.len() > MAX_ROWS;
    out.truncate(MAX_ROWS);
    Ok(json!({"rows": out, "truncated": truncated}))
}

fn page_details(path: &Path, url: &str) -> Result<Value, String> {
    let page = crawler::read_pages(path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|p| p.url == url)
        .ok_or_else(|| format!("{url} is not in this crawl"))?;
    let links = report::page_links(path, url).map_err(|e| e.to_string())?;
    Ok(json!({"page": page, "inlinks": links.inlinks, "outlinks": links.outlinks}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cyberfrog-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A tiny crawl file written through the crawler's own schema.
    fn sample_crawl(dir: &Path) -> PathBuf {
        let path = dir.join("crawl-1.sqlite");
        let db = crawler::open_db(&path).unwrap();
        db.execute_batch(
            "INSERT INTO pages (url, depth, status, content_type, title, h1, response_ms) VALUES
               ('https://s.it/', 0, 200, 'text/html', 'Home', 'Hi', 120),
               ('https://s.it/a', 1, 200, 'text/html', 'Home', NULL, 1500),
               ('https://s.it/gone', 1, 404, 'text/html', NULL, NULL, 50);
             INSERT INTO links (source, target, anchor, external) VALUES
               ('https://s.it/', 'https://s.it/a', 'A', 0), ('https://s.it/a', 'https://s.it/gone', 'Gone', 0);",
        )
        .unwrap();
        path
    }

    async fn call(dir: &Path, name: &str, arguments: Value) -> (bool, Value) {
        let req = json!({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": name, "arguments": arguments}});
        let res = handle(&req, dir).await.unwrap();
        let result = &res["result"];
        let text = result["content"][0]["text"].as_str().unwrap();
        (
            result["isError"].as_bool().unwrap_or(false),
            serde_json::from_str(text).unwrap_or(json!(text)),
        )
    }

    #[tokio::test]
    async fn speaks_the_protocol_basics() {
        let dir = temp_dir("proto");
        let init = handle(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}), &dir)
            .await
            .unwrap();
        assert_eq!(
            init["result"]["protocolVersion"], "2025-03-26",
            "echoes the client's version"
        );
        assert_eq!(init["result"]["serverInfo"]["name"], "cyberfrog");
        assert!(
            handle(
                &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
                &dir
            )
            .await
            .is_none()
        );
        let list = handle(
            &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            &dir,
        )
        .await
        .unwrap();
        let names: Vec<&str> = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "crawl_site",
                "list_crawls",
                "crawl_summary",
                "query_crawl",
                "page_details"
            ]
        );
        let unknown = handle(&json!({"jsonrpc": "2.0", "id": 3, "method": "nope"}), &dir)
            .await
            .unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn summarizes_queries_and_describes_a_crawl() {
        let dir = temp_dir("tools");
        let path = sample_crawl(&dir);

        let (err, list) = call(&dir, "list_crawls", json!({})).await;
        assert!(!err);
        assert_eq!(list[0]["start_url"], "https://s.it/");

        let (err, s) = call(&dir, "crawl_summary", json!({})).await; // defaults to the latest crawl
        assert!(!err, "{s}");
        assert_eq!(
            (s["urls"].as_i64(), s["status"]["4xx"].as_i64()),
            (Some(3), Some(1))
        );
        assert_eq!(s["indexable_pages"], 2);
        assert_eq!(s["indexable_pages_with"]["duplicate_title"], 2);
        assert_eq!(s["indexable_pages_with"]["missing_h1"], 1);
        assert_eq!(s["slow_pages_over_1s"], 1);
        assert_eq!(s["broken_links"]["internal"], 1);

        let (err, q) = call(
            &dir,
            "query_crawl",
            json!({"crawl": path, "sql": "SELECT url, status FROM pages WHERE status >= 400;"}),
        )
        .await;
        assert!(!err, "{q}");
        assert_eq!(
            q["rows"],
            json!([{"url": "https://s.it/gone", "status": 404}])
        );

        for bad in [
            "DELETE FROM pages",
            "SELECT 1; DROP TABLE pages",
            "ATTACH 'x' AS y",
        ] {
            let (err, _) = call(&dir, "query_crawl", json!({"sql": bad})).await;
            assert!(err, "{bad} must be refused");
        }
        assert_eq!(
            crawler::read_pages(&path).unwrap().len(),
            3,
            "the crawl is untouched"
        );

        let (err, p) = call(&dir, "page_details", json!({"url": "https://s.it/a"})).await;
        assert!(!err, "{p}");
        assert_eq!(
            (
                p["inlinks"][0]["anchor"].as_str(),
                p["outlinks"][0]["status"].as_i64()
            ),
            (Some("A"), Some(404))
        );
    }
}

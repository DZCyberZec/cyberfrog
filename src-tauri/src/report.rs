//! Read-only reports over a saved crawl: external links, broken links, and the links of one page.
//! Crawls saved before anchors and external checks existed still open, with those parts empty.

use std::path::Path;

use rusqlite::{Connection, params};

use crate::crawler::open_existing;

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct ExternalLink {
    pub url: String,
    pub status: Option<u16>,
    pub content_type: Option<String>,
    pub error: Option<String>,
    /// Crawled pages linking to it.
    pub inlinks: u32,
}

/// A link from a crawled page to a URL that answered 4xx/5xx or not at all.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct BrokenLink {
    pub source: String,
    pub target: String,
    pub anchor: Option<String>,
    pub status: Option<u16>,
    pub error: Option<String>,
    pub external: bool,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct LinkRow {
    pub url: String,
    pub anchor: Option<String>,
    pub status: Option<u16>,
    pub external: bool,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct PageLinks {
    pub inlinks: Vec<LinkRow>,
    pub outlinks: Vec<LinkRow>,
}

fn compiles(db: &Connection, sql: &str) -> bool {
    db.prepare(sql).is_ok()
}

/// What this crawl file's schema supports.
struct Schema {
    anchors: bool,
    external: bool,
}

fn schema(db: &Connection) -> Schema {
    Schema {
        anchors: compiles(db, "SELECT anchor, external FROM links LIMIT 0"),
        external: compiles(db, "SELECT url FROM external LIMIT 0"),
    }
}

pub fn read_external(path: &Path) -> rusqlite::Result<Vec<ExternalLink>> {
    let db = open_existing(path)?;
    if !schema(&db).external {
        return Ok(Vec::new());
    }
    let mut stmt = db.prepare(
        "SELECT e.url, e.status, e.content_type, e.error,
                (SELECT count(*) FROM links WHERE target = e.url)
         FROM external e ORDER BY e.url",
    )?;
    stmt.query_map([], |r| {
        Ok(ExternalLink {
            url: r.get(0)?,
            status: r.get(1)?,
            content_type: r.get(2)?,
            error: r.get(3)?,
            inlinks: r.get(4)?,
        })
    })?
    .collect()
}

pub fn read_broken(path: &Path) -> rusqlite::Result<Vec<BrokenLink>> {
    let db = open_existing(path)?;
    let s = schema(&db);
    if !(s.anchors && s.external) {
        return Ok(Vec::new());
    }
    let mut stmt = db.prepare(
        "SELECT l.source, l.target, l.anchor, coalesce(p.status, e.status), coalesce(p.error, e.error), l.external
         FROM links l
         LEFT JOIN pages p ON p.url = l.target AND l.external = 0
         LEFT JOIN external e ON e.url = l.target AND l.external = 1
         WHERE (p.url IS NOT NULL AND p.blocked_by_robots = 0 AND (p.status >= 400 OR p.status IS NULL))
            OR (e.url IS NOT NULL AND (e.status >= 400 OR e.status IS NULL))
         ORDER BY l.target, l.source",
    )?;
    stmt.query_map([], |r| {
        Ok(BrokenLink {
            source: r.get(0)?,
            target: r.get(1)?,
            anchor: r.get(2)?,
            status: r.get(3)?,
            error: r.get(4)?,
            external: r.get(5)?,
        })
    })?
    .collect()
}

/// Pages linking to `url`, and the URLs `url` links to, with each target's status.
pub fn page_links(path: &Path, url: &str) -> rusqlite::Result<PageLinks> {
    let db = open_existing(path)?;
    let s = schema(&db);
    let anchor = if s.anchors { "l.anchor" } else { "NULL" };
    let external = if s.anchors { "l.external" } else { "0" };
    let (join_ext, status) = if s.external {
        (
            "LEFT JOIN external e ON e.url = l.target",
            "coalesce(p.status, e.status)",
        )
    } else {
        ("", "p.status")
    };
    let rows = |sql: &str| -> rusqlite::Result<Vec<LinkRow>> {
        db.prepare(sql)?
            .query_map(params![url], |r| {
                Ok(LinkRow {
                    url: r.get(0)?,
                    anchor: r.get(1)?,
                    status: r.get(2)?,
                    external: r.get(3)?,
                })
            })?
            .collect()
    };
    Ok(PageLinks {
        inlinks: rows(&format!(
            "SELECT l.source, {anchor}, p.status, 0 FROM links l
             LEFT JOIN pages p ON p.url = l.source
             WHERE l.target = ?1 ORDER BY l.source"
        ))?,
        outlinks: rows(&format!(
            "SELECT l.target, {anchor}, {status}, {external} FROM links l
             LEFT JOIN pages p ON p.url = l.target {join_ext}
             WHERE l.source = ?1 ORDER BY {external}, l.target"
        ))?,
    })
}

/// One image, with how the pages that show it describe it.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct ImageRow {
    pub src: String,
    pub status: Option<u16>,
    pub bytes: Option<i64>,
    pub content_type: Option<String>,
    pub error: Option<String>,
    /// Crawled pages showing it.
    pub pages: u32,
    /// Pages where the `alt` attribute is absent.
    pub missing_alt: u32,
    /// Pages where `alt=""` marks it as decorative.
    pub empty_alt: u32,
    /// Pages where width or height is not set.
    pub missing_size: u32,
    /// A non-empty alt text used for it, if any.
    pub alt: Option<String>,
}

/// How one page uses an image.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct ImageUse {
    pub page: String,
    pub alt: Option<String>,
    pub has_size: bool,
}

pub fn read_images(path: &Path) -> rusqlite::Result<Vec<ImageRow>> {
    let db = open_existing(path)?;
    if !compiles(&db, "SELECT 1 FROM images, image_info LIMIT 0") {
        return Ok(Vec::new());
    }
    let mut stmt = db.prepare(
        "SELECT i.src, info.status, info.bytes, info.content_type, info.error, count(*),
                sum(i.alt IS NULL), sum(i.alt IS ''), sum(NOT i.has_size), max(nullif(i.alt, ''))
         FROM images i LEFT JOIN image_info info ON info.src = i.src
         GROUP BY i.src ORDER BY i.src",
    )?;
    stmt.query_map([], |r| {
        Ok(ImageRow {
            src: r.get(0)?,
            status: r.get(1)?,
            bytes: r.get(2)?,
            content_type: r.get(3)?,
            error: r.get(4)?,
            pages: r.get(5)?,
            missing_alt: r.get(6)?,
            empty_alt: r.get(7)?,
            missing_size: r.get(8)?,
            alt: r.get(9)?,
        })
    })?
    .collect()
}

pub fn image_pages(path: &Path, src: &str) -> rusqlite::Result<Vec<ImageUse>> {
    let db = open_existing(path)?;
    if !compiles(&db, "SELECT src FROM images LIMIT 0") {
        return Ok(Vec::new());
    }
    db.prepare("SELECT page, alt, has_size FROM images WHERE src = ?1 ORDER BY page")?
        .query_map(params![src], |r| {
            Ok(ImageUse {
                page: r.get(0)?,
                alt: r.get(1)?,
                has_size: r.get(2)?,
            })
        })?
        .collect()
}

/// One hreflang annotation as written on a crawled page.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct HreflangRow {
    pub page: String,
    pub lang: String,
    pub href: String,
}

pub fn read_hreflang(path: &Path) -> rusqlite::Result<Vec<HreflangRow>> {
    let db = open_existing(path)?;
    if !compiles(&db, "SELECT 1 FROM hreflang LIMIT 0") {
        return Ok(Vec::new());
    }
    db.prepare("SELECT page, lang, href FROM hreflang ORDER BY page, lang")?
        .query_map([], |r| {
            Ok(HreflangRow {
                page: r.get(0)?,
                lang: r.get(1)?,
                href: r.get(2)?,
            })
        })?
        .collect()
}

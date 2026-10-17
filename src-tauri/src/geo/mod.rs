//! GEO (generative engine optimisation): can AI answer engines reach, read and quote the site?
//! The crawler stores raw material (robots.txt, llms.txt, per-page signals); this module turns it
//! into what the GEO report shows.

pub mod bots;
pub mod faq;
pub mod llms;
pub mod signals;

use std::collections::HashMap;
use std::path::Path;

use url::Url;

use crate::crawler::open_existing;

#[derive(serde::Serialize)]
pub struct GeoPage {
    pub page: String,
    #[serde(flatten)]
    pub signals: signals::Signals,
    /// AI bots robots.txt keeps out of this page.
    pub blocked_bots: Vec<&'static str>,
}

#[derive(serde::Serialize)]
pub struct BotAccess {
    #[serde(flatten)]
    pub bot: bots::Bot,
    /// HTML pages of the crawl this bot may not read.
    pub blocked_pages: u32,
}

#[derive(serde::Serialize)]
pub struct Llms {
    pub url: String,
    pub status: Option<u16>,
    /// Format check, when the file exists.
    pub check: Option<llms::Check>,
}

#[derive(serde::Serialize, Default)]
pub struct GeoData {
    pub pages: Vec<GeoPage>,
    pub bots: Vec<BotAccess>,
    pub llms: Option<Llms>,
    /// `Content-Signal:` lines of the start site's robots.txt.
    pub content_signals: Vec<String>,
}

/// Crawls saved before GEO data existed give an empty result.
pub fn read(path: &Path) -> rusqlite::Result<GeoData> {
    let db = open_existing(path)?;
    if db
        .prepare("SELECT 1 FROM geo, robots_txt, llms_txt LIMIT 0")
        .is_err()
    {
        return Ok(GeoData::default());
    }
    let robots: Vec<(String, String)> = db
        .prepare("SELECT origin, body FROM robots_txt WHERE body IS NOT NULL ORDER BY rowid")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let rules: HashMap<&str, bots::Rules> = robots
        .iter()
        .map(|(origin, body)| (origin.as_str(), bots::Rules::parse(body)))
        .collect();

    let mut stmt = db.prepare(
        "SELECT page, first_para_words, question_headings, subheadings, lists, tables, stats,
                has_author, has_date, js_shell FROM geo ORDER BY rowid",
    )?;
    let pages: Vec<GeoPage> = stmt
        .query_map([], |r| {
            let page: String = r.get(0)?;
            let origin = Url::parse(&page)
                .map(|u| u.origin().ascii_serialization())
                .unwrap_or_default();
            let blocked_bots = rules
                .get(origin.as_str())
                .map(|rl| rl.blocked(&page))
                .unwrap_or_default();
            Ok(GeoPage {
                signals: signals::Signals {
                    first_para_words: r.get(1)?,
                    question_headings: r.get(2)?,
                    subheadings: r.get(3)?,
                    lists: r.get(4)?,
                    tables: r.get(5)?,
                    stats: r.get(6)?,
                    has_author: r.get(7)?,
                    has_date: r.get(8)?,
                    js_shell: r.get(9)?,
                },
                page,
                blocked_bots,
            })
        })?
        .collect::<Result<_, _>>()?;

    let bots = bots::BOTS
        .iter()
        .map(|b| BotAccess {
            bot: *b,
            blocked_pages: pages
                .iter()
                .filter(|p| p.blocked_bots.contains(&b.token))
                .count() as u32,
        })
        .collect();
    let llms = db
        .query_row("SELECT url, status, body FROM llms_txt LIMIT 1", [], |r| {
            let (url, status, body): (String, Option<u16>, Option<String>) =
                (r.get(0)?, r.get(1)?, r.get(2)?);
            Ok(Llms {
                url,
                status,
                check: body
                    .filter(|_| status == Some(200))
                    .map(|b| llms::check(&b)),
            })
        })
        .ok();
    Ok(GeoData {
        content_signals: robots
            .first()
            .map(|(_, b)| bots::content_signals(b))
            .unwrap_or_default(),
        pages,
        bots,
        llms,
    })
}

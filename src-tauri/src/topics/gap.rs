//! Content gap between your site and a competitor's: both crawls go into one TF-IDF corpus, and
//! each page is matched with the most similar page of the other site.

use std::path::Path;

use super::corpus::{self, Corpus};
use crate::crawler::Page;

/// A page counts as covered by the other site when its closest match there is at least this similar.
const COVERED: f32 = 0.30;
/// Pages of the same uncovered topic group together from this similarity.
const TOPIC_SIM: f32 = 0.30;
/// Topics on the same subject where the competitor's page has this many times your words.
const DEEPER: f32 = 1.5;
const MAX_TOPICS: usize = 60;
const MAX_PAGES_PER_TOPIC: usize = 8;
const MAX_DEEPER: usize = 40;

#[derive(serde::Serialize)]
pub struct GapPage {
    pub url: String,
    pub title: Option<String>,
    pub words: Option<u32>,
}

/// A subject one site covers and the other doesn't.
#[derive(serde::Serialize)]
pub struct GapTopic {
    pub label: Vec<String>,
    pub pages: Vec<GapPage>,
}

/// The same subject on both sites, where the competitor's page is much longer.
#[derive(serde::Serialize)]
pub struct Deeper {
    pub mine: String,
    pub theirs: String,
    pub similarity: f32,
    pub mine_words: u32,
    pub theirs_words: u32,
}

#[derive(serde::Serialize)]
pub struct ContentGap {
    pub mine_pages: u32,
    pub theirs_pages: u32,
    /// Your pages whose subject the competitor also covers.
    pub mine_covered: u32,
    /// Topics the competitor covers and you don't.
    pub gaps: Vec<GapTopic>,
    /// Topics you cover and the competitor doesn't.
    pub strengths: Vec<GapTopic>,
    pub deeper: Vec<Deeper>,
}

pub fn content_gap(mine: &Path, theirs: &Path) -> rusqlite::Result<ContentGap> {
    let (a, b) = (corpus::load(mine)?, corpus::load(theirs)?);
    let mut keywords = a.keywords;
    keywords.extend(b.keywords);
    Ok(compare(&a.pages, &b.pages, &keywords))
}

fn compare(mine: &[Page], theirs: &[Page], keywords: &corpus::Keywords) -> ContentGap {
    let m = mine.len();
    let pages: Vec<&Page> = mine.iter().chain(theirs).collect();
    let c = Corpus::build(pages.iter().copied(), keywords);
    let neighbours = c.neighbours(0.2);
    let other_site = |i: usize| move |&&(j, _): &&(usize, f32)| (i < m) != (j < m);
    // closest page on the other site, if any is similar enough to matter
    let best: Vec<Option<(usize, f32)>> = (0..pages.len())
        .map(|i| neighbours[i].iter().find(other_site(i)).copied())
        .collect();
    let covered = |i: usize| best[i].is_some_and(|(_, s)| s >= COVERED);

    let order = corpus::strongest_first(&pages);
    let topics = |side: &dyn Fn(usize) -> bool| -> Vec<GapTopic> {
        let uncovered: Vec<usize> = order
            .iter()
            .copied()
            .filter(|&i| side(i) && !covered(i))
            .collect();
        let mut groups = Corpus::clusters(&uncovered, &neighbours, TOPIC_SIM);
        let grouped: std::collections::HashSet<usize> =
            groups.iter().flat_map(|(_, g)| g.iter().copied()).collect();
        groups.extend(
            uncovered
                .iter()
                .filter(|i| !grouped.contains(i))
                .map(|&i| (i, vec![i])),
        );
        groups.truncate(MAX_TOPICS);
        groups
            .into_iter()
            .map(|(_, g)| GapTopic {
                label: c.label(&g),
                pages: g
                    .iter()
                    .take(MAX_PAGES_PER_TOPIC)
                    .map(|&i| GapPage {
                        url: pages[i].url.clone(),
                        title: pages[i].title.clone(),
                        words: pages[i].word_count,
                    })
                    .collect(),
            })
            .collect()
    };

    let mut deeper: Vec<Deeper> = (m..pages.len())
        .filter_map(|j| {
            let (i, s) = best[j]?;
            let (mine_words, theirs_words) = (pages[i].word_count?, pages[j].word_count?);
            (s >= 0.4 && theirs_words as f32 >= DEEPER * mine_words as f32).then(|| Deeper {
                mine: pages[i].url.clone(),
                theirs: pages[j].url.clone(),
                similarity: s,
                mine_words,
                theirs_words,
            })
        })
        .collect();
    deeper.sort_by(|a, b| (b.theirs_words - b.mine_words).cmp(&(a.theirs_words - a.mine_words)));
    deeper.truncate(MAX_DEEPER);

    ContentGap {
        mine_pages: m as u32,
        theirs_pages: theirs.len() as u32,
        mine_covered: (0..m).filter(|&i| covered(i)).count() as u32,
        gaps: topics(&|i| i >= m),
        strengths: topics(&|i| i < m),
        deeper,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn page(url: &str, title: &str, words: u32) -> Page {
        Page {
            url: url.into(),
            title: Some(title.into()),
            word_count: Some(words),
            ..Page::default()
        }
    }

    #[test]
    fn finds_topics_each_site_lacks_and_where_the_competitor_goes_deeper() {
        let mine = vec![
            page("me/seo", "Consulenza SEO per PMI", 400),
            page("me/cyber", "Cybersecurity per aziende", 900),
            page("me/wp", "Sicurezza WordPress", 700),
        ];
        let theirs = vec![
            page("them/seo", "Consulenza SEO aziende", 1500),
            page("them/ads", "Campagne Google Ads", 800),
            page("them/ads-shop", "Google Ads per ecommerce", 600),
            page("them/social", "Gestione social media", 500),
        ];
        let kw = |list: &[(&str, u32)]| {
            list.iter()
                .map(|(t, c)| (t.to_string(), *c))
                .collect::<Vec<_>>()
        };
        let keywords: corpus::Keywords = HashMap::from([
            (
                "me/seo".to_string(),
                kw(&[("seo", 9), ("posizionamento", 5), ("google", 3)]),
            ),
            (
                "me/cyber".to_string(),
                kw(&[("cybersecurity", 9), ("attacchi", 5), ("backup", 3)]),
            ),
            (
                "me/wp".to_string(),
                kw(&[("wordpress", 9), ("plugin", 5), ("sicurezza", 4)]),
            ),
            (
                "them/seo".to_string(),
                kw(&[("seo", 10), ("posizionamento", 6), ("google", 4)]),
            ),
            (
                "them/ads".to_string(),
                kw(&[("ads", 10), ("campagne", 6), ("budget", 4)]),
            ),
            (
                "them/ads-shop".to_string(),
                kw(&[("ads", 8), ("ecommerce", 6), ("campagne", 4)]),
            ),
            (
                "them/social".to_string(),
                kw(&[("social", 10), ("instagram", 6), ("post", 4)]),
            ),
        ]);
        let g = compare(&mine, &theirs, &keywords);

        assert_eq!(
            (g.mine_pages, g.theirs_pages, g.mine_covered),
            (3, 4, 1),
            "only the SEO page is matched"
        );
        let gap_urls: Vec<Vec<&str>> = g
            .gaps
            .iter()
            .map(|t| t.pages.iter().map(|p| p.url.as_str()).collect())
            .collect();
        assert!(
            gap_urls.contains(&vec!["them/ads", "them/ads-shop"])
                || gap_urls.contains(&vec!["them/ads-shop", "them/ads"]),
            "{gap_urls:?}"
        );
        assert!(
            gap_urls.contains(&vec!["them/social"]),
            "single pages are topics too"
        );
        assert!(
            !gap_urls.iter().flatten().any(|u| *u == "them/seo"),
            "covered by me/seo"
        );
        let strength_urls: Vec<&str> = g
            .strengths
            .iter()
            .flat_map(|t| t.pages.iter().map(|p| p.url.as_str()))
            .collect();
        assert!(strength_urls.contains(&"me/cyber") && strength_urls.contains(&"me/wp"));
        assert_eq!(g.deeper.len(), 1);
        assert_eq!(
            (g.deeper[0].mine.as_str(), g.deeper[0].theirs.as_str()),
            ("me/seo", "them/seo")
        );
    }
}

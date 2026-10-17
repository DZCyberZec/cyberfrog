//! Topic analysis of a crawl, computed locally with TF-IDF: which pages cover the same subject
//! (clusters around a hub page), which ones compete for the same query (cannibalization), and which
//! internal links are missing between related pages.

pub mod corpus;
pub mod gap;
pub mod terms;

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::crawler::Page;
use corpus::{Corpus, dot};

#[derive(serde::Serialize)]
pub struct Cluster {
    /// The terms that best describe the cluster.
    pub label: Vec<String>,
    /// The strongest page of the cluster (highest Link Score): the one the others should support.
    pub hub: String,
    pub pages: Vec<String>,
}

/// Two indexable pages whose titles and content target the same query.
#[derive(serde::Serialize)]
pub struct Cannibal {
    pub a: String,
    pub b: String,
    /// Cosine similarity of the whole page (content, title, H1), 0–1.
    pub similarity: f32,
    /// Cosine similarity of title and H1 alone.
    pub title_similarity: f32,
    pub shared: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct LinkSuggestion {
    pub from: String,
    pub to: String,
    pub similarity: f32,
    /// Anchor text to use: the target's H1, else its title.
    pub anchor: String,
    /// "hub": the hub should link this cluster page; "to-hub": the page should link its hub;
    /// "related": a stronger, similar page could pass authority to a weak one.
    pub reason: &'static str,
}

#[derive(serde::Serialize, Default)]
pub struct TopicsData {
    pub clusters: Vec<Cluster>,
    pub cannibal: Vec<Cannibal>,
    pub suggestions: Vec<LinkSuggestion>,
    /// Indexable HTML pages the analysis covered.
    pub analysed: u32,
}

/// Similarity a page needs with a cluster's hub to join it.
const CLUSTER_SIM: f32 = 0.30;
/// Least similarity worth keeping for any use below.
const MIN_SIM: f32 = 0.25;
const CANNIBAL_TITLE: f32 = 0.5;
const CANNIBAL_CONTENT: f32 = 0.3;
/// Pages with at most this many inlinks get "related" link suggestions.
const WEAK_INLINKS: u32 = 3;
const MAX_PER_TARGET: usize = 3;
const MAX_CANNIBAL: usize = 500;
pub fn analyze(path: &Path) -> rusqlite::Result<TopicsData> {
    let corpus::Loaded {
        pages,
        keywords,
        links,
    } = corpus::load(path)?;
    Ok(analyse_pages(&pages, &keywords, &links))
}

fn analyse_pages(
    pages: &[Page],
    keywords: &corpus::Keywords,
    links: &HashSet<(String, String)>,
) -> TopicsData {
    let refs: Vec<&Page> = pages.iter().collect();
    let c = Corpus::build(refs.iter().copied(), keywords);
    let neighbours = c.neighbours(MIN_SIM);
    let sim = |i: usize, j: usize| {
        neighbours[i]
            .iter()
            .find(|(k, _)| *k == j)
            .map_or(0.0, |(_, s)| *s)
    };
    let mut clusters = Corpus::clusters(&corpus::strongest_first(&refs), &neighbours, CLUSTER_SIM);
    clusters.sort_by(|a, b| {
        b.1.len()
            .cmp(&a.1.len())
            .then(pages[a.0].url.cmp(&pages[b.0].url))
    });

    let linked =
        |from: usize, to: usize| links.contains(&(pages[from].url.clone(), pages[to].url.clone()));
    let anchor = |i: usize| {
        let p = &pages[i];
        let text = p.h1.clone().or_else(|| p.title.clone()).unwrap_or_default();
        text.chars().take(70).collect::<String>()
    };
    let mut suggestions: Vec<LinkSuggestion> = Vec::new();
    let mut per_target: HashMap<usize, usize> = HashMap::new();
    let mut suggested: HashSet<(usize, usize)> = HashSet::new();
    let mut suggest =
        |from: usize, to: usize, s: f32, reason: &'static str, out: &mut Vec<LinkSuggestion>| {
            let count = per_target.entry(to).or_default();
            if from == to
                || *count >= MAX_PER_TARGET
                || linked(from, to)
                || !suggested.insert((from, to))
            {
                return;
            }
            *count += 1;
            out.push(LinkSuggestion {
                from: pages[from].url.clone(),
                to: pages[to].url.clone(),
                similarity: s,
                anchor: anchor(to),
                reason,
            });
        };
    for (hub, m) in &clusters {
        for &p in m.iter().filter(|&&p| p != *hub) {
            suggest(*hub, p, sim(*hub, p), "hub", &mut suggestions);
            suggest(p, *hub, sim(*hub, p), "to-hub", &mut suggestions);
        }
    }
    for (p, page) in pages
        .iter()
        .enumerate()
        .filter(|(_, pg)| pg.inlinks <= WEAK_INLINKS)
    {
        for &(q, s) in neighbours[p]
            .iter()
            .filter(|&&(q, s)| s >= CLUSTER_SIM && pages[q].link_score > page.link_score)
        {
            suggest(q, p, s, "related", &mut suggestions);
        }
    }

    let mut cannibal: Vec<Cannibal> = Vec::new();
    for (i, nb) in neighbours.iter().enumerate() {
        for &(j, s) in nb.iter().filter(|&&(j, s)| j > i && s >= CANNIBAL_CONTENT) {
            let same_text =
                pages[i].content_hash.is_some() && pages[i].content_hash == pages[j].content_hash;
            let title_similarity = dot(&c.heads[i], &c.heads[j]);
            if same_text || title_similarity < CANNIBAL_TITLE {
                continue; // identical text is reported as a duplicate, not as cannibalization
            }
            let mut shared: Vec<(u32, f32)> = c.heads[i]
                .iter()
                .filter_map(|&(t, w)| {
                    c.heads[j]
                        .iter()
                        .find(|(u, _)| *u == t)
                        .map(|&(_, w2)| (t, w.min(w2)))
                })
                .collect();
            shared.sort_by(|a, b| b.1.total_cmp(&a.1));
            cannibal.push(Cannibal {
                a: pages[i].url.clone(),
                b: pages[j].url.clone(),
                similarity: s,
                title_similarity,
                shared: shared
                    .iter()
                    .take(5)
                    .map(|(t, _)| c.names[*t as usize].clone())
                    .collect(),
            });
        }
    }
    cannibal.sort_by(|a, b| {
        b.title_similarity
            .total_cmp(&a.title_similarity)
            .then(b.similarity.total_cmp(&a.similarity))
    });
    cannibal.truncate(MAX_CANNIBAL);

    TopicsData {
        clusters: clusters
            .into_iter()
            .map(|(hub, m)| Cluster {
                label: c.label(&m),
                hub: pages[hub].url.clone(),
                pages: m.iter().map(|&p| pages[p].url.clone()).collect(),
            })
            .collect(),
        cannibal,
        suggestions,
        analysed: pages.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(url: &str, title: &str, link_score: u8, inlinks: u32) -> Page {
        Page {
            url: url.into(),
            title: Some(title.into()),
            link_score,
            inlinks,
            ..Page::default()
        }
    }

    #[test]
    fn clusters_pages_flags_cannibalization_and_suggests_links() {
        let pages = vec![
            page("/seo", "Consulenza SEO Marche", 100, 20),
            page("/seo-audit", "Audit SEO tecnico", 40, 3),
            page("/seo-locale", "SEO locale per aziende Marche", 30, 1),
            page("/consulenza-seo", "Consulenza SEO nelle Marche", 20, 1),
            page("/cyber", "Cybersecurity aziende", 90, 15),
            page("/pentest", "Penetration test cybersecurity", 10, 0),
        ];
        let kw = |list: &[(&str, u32)]| {
            list.iter()
                .map(|(t, c)| (t.to_string(), *c))
                .collect::<Vec<_>>()
        };
        let keywords = HashMap::from([
            (
                "/seo".to_string(),
                kw(&[
                    ("seo", 12),
                    ("posizionamento", 6),
                    ("google", 5),
                    ("marche", 3),
                ]),
            ),
            (
                "/seo-audit".to_string(),
                kw(&[("seo", 8), ("audit", 7), ("google", 4), ("tecnico", 3)]),
            ),
            (
                "/seo-locale".to_string(),
                kw(&[("seo", 6), ("locale", 6), ("google", 4), ("marche", 4)]),
            ),
            (
                "/consulenza-seo".to_string(),
                kw(&[
                    ("seo", 11),
                    ("posizionamento", 5),
                    ("google", 5),
                    ("marche", 3),
                ]),
            ),
            (
                "/cyber".to_string(),
                kw(&[("cybersecurity", 9), ("attacchi", 5), ("aziende", 4)]),
            ),
            (
                "/pentest".to_string(),
                kw(&[("cybersecurity", 6), ("penetration", 6), ("attacchi", 4)]),
            ),
        ]);
        let links = HashSet::from([("/seo".to_string(), "/seo-audit".to_string())]);
        let t = analyse_pages(&pages, &keywords, &links);

        assert_eq!(t.analysed, 6);
        let seo = t
            .clusters
            .iter()
            .find(|c| c.hub == "/seo")
            .expect("SEO cluster");
        assert!(
            seo.pages.contains(&"/consulenza-seo".to_string()),
            "{:?}",
            seo.pages
        );
        assert!(!seo.pages.contains(&"/pentest".to_string()));
        // "seo" is on most pages of this tiny corpus, so it carries no weight here
        assert!(
            ["consulenza", "marche"].contains(&seo.label[0].as_str()),
            "a word the titles share names the cluster: {:?}",
            seo.label
        );
        assert!(
            t.clusters
                .iter()
                .any(|c| c.hub == "/cyber" && c.pages.contains(&"/pentest".to_string()))
        );

        let pair = &t.cannibal[0];
        assert_eq!(
            (pair.a.as_str(), pair.b.as_str()),
            ("/seo", "/consulenza-seo"),
            "same title topic and content"
        );
        assert!(pair.shared.contains(&"consulenza".to_string()));

        assert!(
            !t.suggestions
                .iter()
                .any(|s| s.from == "/seo" && s.to == "/seo-audit"),
            "existing links are never suggested"
        );
        assert!(
            t.suggestions
                .iter()
                .any(|s| s.from == "/cyber" && s.to == "/pentest" && s.reason == "hub")
        );
        assert!(
            t.suggestions
                .iter()
                .any(|s| s.from == "/pentest" && s.to == "/cyber" && s.reason == "to-hub")
        );
        let to_pentest = t.suggestions.iter().filter(|s| s.to == "/pentest").count();
        assert!(to_pentest <= MAX_PER_TARGET);
    }
}

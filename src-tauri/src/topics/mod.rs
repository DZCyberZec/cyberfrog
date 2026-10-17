//! Topic analysis of a crawl, computed locally with TF-IDF: which pages cover the same subject
//! (clusters around a hub page), which ones compete for the same query (cannibalization), and which
//! internal links are missing between related pages.

pub mod terms;

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::crawler::{Page, open_existing, read_pages};

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
/// Title words weigh as much as this many occurrences in the text; H1 words a bit less.
const TITLE_WEIGHT: u32 = 8;
const H1_WEIGHT: u32 = 4;

/// Page 2, 3… of an archive repeats the first page's subject by design: not a topic of its own.
static PAGINATED: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"(/page/\d+/?$)|([?&](page|paged|p)=\d+)").expect("static regex")
});

fn indexable(p: &Page) -> bool {
    let noindex = |v: &Option<String>| {
        v.as_deref()
            .is_some_and(|s| s.to_lowercase().contains("noindex"))
    };
    p.status == Some(200)
        && p.content_type
            .as_deref()
            .is_some_and(|c| c.starts_with("text/html"))
        && !noindex(&p.meta_robots)
        && !noindex(&p.x_robots_tag)
        && p.canonical.as_deref().is_none_or(|c| c == p.url)
        && !PAGINATED.is_match(&p.url)
}

/// Sparse unit vector: (term id, weight), sorted by term id.
type Vector = Vec<(u32, f32)>;

fn dot(a: &Vector, b: &Vector) -> f32 {
    let (mut i, mut j, mut sum) = (0, 0, 0.0);
    while i < a.len() && j < b.len() {
        match a[i].0.cmp(&b[j].0) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                sum += a[i].1 * b[j].1;
                i += 1;
                j += 1;
            }
        }
    }
    sum
}

/// TF-IDF with a log term frequency, normalised to length 1.
fn vectorize(counts: &HashMap<u32, u32>, idf: &[f32]) -> Vector {
    let mut v: Vector = counts
        .iter()
        .map(|(&t, &c)| (t, (1.0 + (c as f32).ln()) * idf[t as usize]))
        .filter(|(_, w)| *w > 0.0)
        .collect();
    let norm = v.iter().map(|(_, w)| w * w).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|(_, w)| *w /= norm);
    }
    v.sort_by_key(|(t, _)| *t);
    v
}

pub fn analyze(path: &Path) -> rusqlite::Result<TopicsData> {
    let pages: Vec<Page> = read_pages(path)?.into_iter().filter(indexable).collect();
    let db = open_existing(path)?;
    // crawls saved before keywords were stored still cluster on titles and H1 alone
    let mut keywords: HashMap<String, Vec<(String, u32)>> = HashMap::new();
    if let Ok(mut stmt) = db.prepare("SELECT page, term, count FROM keywords") {
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?)))? {
            let (page, term, count) = row?;
            keywords.entry(page).or_default().push((term, count));
        }
    }
    let mut links: HashSet<(String, String)> = HashSet::new();
    if let Ok(mut stmt) = db.prepare("SELECT source, target FROM links WHERE external = 0") {
        for row in stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))? {
            links.insert(row?);
        }
    }
    Ok(analyse_pages(&pages, &keywords, &links))
}

fn analyse_pages(
    pages: &[Page],
    keywords: &HashMap<String, Vec<(String, u32)>>,
    links: &HashSet<(String, String)>,
) -> TopicsData {
    let n = pages.len();
    let mut vocab: HashMap<String, u32> = HashMap::new();
    let mut names: Vec<String> = Vec::new();
    let mut id = |t: String| -> u32 {
        *vocab.entry(t.clone()).or_insert_with(|| {
            names.push(t);
            names.len() as u32 - 1
        })
    };
    // per page: all counts (content + weighted title/H1) and title/H1 counts alone
    let mut full: Vec<HashMap<u32, u32>> = Vec::with_capacity(n);
    let mut head: Vec<HashMap<u32, u32>> = Vec::with_capacity(n);
    for p in pages {
        let (mut f, mut h) = (HashMap::new(), HashMap::new());
        for (term, count) in keywords.get(&p.url).into_iter().flatten() {
            *f.entry(id(term.clone())).or_default() += count;
        }
        for (text, weight) in [(&p.title, TITLE_WEIGHT), (&p.h1, H1_WEIGHT)] {
            for t in text.as_deref().map(terms::tokens).into_iter().flatten() {
                let t = id(t);
                *f.entry(t).or_default() += weight;
                *h.entry(t).or_default() += 1;
            }
        }
        full.push(f);
        head.push(h);
    }
    let mut df = vec![0u32; names.len()];
    for f in &full {
        for &t in f.keys() {
            df[t as usize] += 1;
        }
    }
    // a word on most pages (brand, menu) says nothing about any one of them
    let idf: Vec<f32> = df
        .iter()
        .map(|&d| {
            if n > 3 && d as usize * 2 > n {
                0.0
            } else {
                (n as f32 / d.max(1) as f32).ln()
            }
        })
        .collect();
    let vectors: Vec<Vector> = full.iter().map(|c| vectorize(c, &idf)).collect();
    let heads: Vec<Vector> = head.iter().map(|c| vectorize(c, &idf)).collect();

    // similar pairs through an inverted index; very common terms are left out of the index to keep
    // it fast on big sites, but still count in each vector's length
    let cap = (n / 10).max(50);
    let mut postings: HashMap<u32, Vec<(usize, f32)>> = HashMap::new();
    for (i, v) in vectors.iter().enumerate() {
        for &(t, w) in v {
            if (2..=cap as u32).contains(&df[t as usize]) {
                postings.entry(t).or_default().push((i, w));
            }
        }
    }
    let mut neighbours: Vec<Vec<(usize, f32)>> = vec![Vec::new(); n];
    for (i, v) in vectors.iter().enumerate() {
        let mut acc: HashMap<usize, f32> = HashMap::new();
        for (t, w) in v {
            for &(j, wj) in postings.get(t).into_iter().flatten() {
                if j > i {
                    *acc.entry(j).or_default() += w * wj;
                }
            }
        }
        for (j, s) in acc.into_iter().filter(|&(_, s)| s >= MIN_SIM) {
            neighbours[i].push((j, s));
            neighbours[j].push((i, s));
        }
    }
    neighbours
        .iter_mut()
        .for_each(|nb| nb.sort_by(|a, b| b.1.total_cmp(&a.1)));
    let sim = |i: usize, j: usize| {
        neighbours[i]
            .iter()
            .find(|(k, _)| *k == j)
            .map_or(0.0, |(_, s)| *s)
    };

    // clusters: strongest pages first; each joins the most similar existing hub, or starts its own
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        let (pa, pb) = (&pages[a], &pages[b]);
        pb.link_score
            .cmp(&pa.link_score)
            .then(pb.inlinks.cmp(&pa.inlinks))
            .then(pa.url.cmp(&pb.url))
    });
    let mut hubs: Vec<usize> = Vec::new();
    let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
    for &p in &order {
        let best = hubs
            .iter()
            .map(|&h| (h, sim(p, h)))
            .filter(|&(_, s)| s >= CLUSTER_SIM)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        match best {
            Some((h, _)) => members.get_mut(&h).expect("hub has members").push(p),
            None => {
                hubs.push(p);
                members.insert(p, vec![p]);
            }
        }
    }
    let mut clusters: Vec<(usize, Vec<usize>)> =
        members.into_iter().filter(|(_, m)| m.len() > 1).collect();
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
            let title_similarity = dot(&heads[i], &heads[j]);
            if same_text || title_similarity < CANNIBAL_TITLE {
                continue; // identical text is reported as a duplicate, not as cannibalization
            }
            let mut shared: Vec<(u32, f32)> = heads[i]
                .iter()
                .filter_map(|&(t, w)| {
                    heads[j]
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
                    .map(|(t, _)| names[*t as usize].clone())
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

    let clusters = clusters
        .into_iter()
        .map(|(hub, m)| {
            // titles and H1 name the subject better than body text; words shared by several titles
            // first, so one page's catchy wording doesn't name the whole cluster
            let mut score: HashMap<u32, (u32, f32)> = HashMap::new();
            for &p in &m {
                let head = if heads[p].is_empty() {
                    &vectors[p]
                } else {
                    &heads[p]
                };
                for &(t, w) in head {
                    let e = score.entry(t).or_default();
                    e.0 += 1;
                    e.1 += w;
                }
            }
            let mut top: Vec<(u32, (u32, f32))> = score.into_iter().collect();
            top.sort_by(|a, b| {
                b.1.0
                    .cmp(&a.1.0)
                    .then(b.1.1.total_cmp(&a.1.1))
                    .then(a.0.cmp(&b.0))
            });
            Cluster {
                label: top
                    .iter()
                    .take(3)
                    .map(|(t, _)| names[*t as usize].clone())
                    .collect(),
                hub: pages[hub].url.clone(),
                pages: m.iter().map(|&p| pages[p].url.clone()).collect(),
            }
        })
        .collect();
    TopicsData {
        clusters,
        cannibal,
        suggestions,
        analysed: n as u32,
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

//! TF-IDF vectors of a set of pages, their similar pairs and topic clusters. Shared by the topics
//! report (one site) and the competitor gap (two sites in one corpus).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use super::terms;
use crate::crawler::{Page, open_existing, read_pages};

/// Title words weigh as much as this many occurrences in the text; H1 words a bit less.
const TITLE_WEIGHT: u32 = 8;
const H1_WEIGHT: u32 = 4;

/// Page 2, 3… of an archive repeats the first page's subject by design: not a topic of its own.
static PAGINATED: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(/page/\d+/?$)|([?&](page|paged|p)=\d+)").expect("static regex")
});

pub fn indexable(p: &Page) -> bool {
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

pub type Keywords = HashMap<String, Vec<(String, u32)>>;

/// What a crawl file gives the topic analysis: its indexable pages, their keywords, internal links.
pub struct Loaded {
    pub pages: Vec<Page>,
    pub keywords: Keywords,
    pub links: HashSet<(String, String)>,
}

pub fn load(path: &Path) -> rusqlite::Result<Loaded> {
    let pages: Vec<Page> = read_pages(path)?.into_iter().filter(indexable).collect();
    let db = open_existing(path)?;
    // crawls saved before keywords were stored still cluster on titles and H1 alone
    let mut keywords = Keywords::new();
    if let Ok(mut stmt) = db.prepare("SELECT page, term, count FROM keywords") {
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?)))? {
            let (page, term, count) = row?;
            keywords.entry(page).or_default().push((term, count));
        }
    }
    let mut links = HashSet::new();
    if let Ok(mut stmt) = db.prepare("SELECT source, target FROM links WHERE external = 0") {
        for row in stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))? {
            links.insert(row?);
        }
    }
    Ok(Loaded {
        pages,
        keywords,
        links,
    })
}

/// Term id → count on one page.
type Counts = HashMap<u32, u32>;

/// Sparse unit vector: (term id, weight), sorted by term id.
pub type Vector = Vec<(u32, f32)>;

pub fn dot(a: &Vector, b: &Vector) -> f32 {
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

pub struct Corpus {
    /// Term id → word.
    pub names: Vec<String>,
    /// Whole page: content keywords plus weighted title and H1.
    pub vectors: Vec<Vector>,
    /// Title and H1 alone.
    pub heads: Vec<Vector>,
    df: Vec<u32>,
}

impl Corpus {
    pub fn build<'a>(pages: impl IntoIterator<Item = &'a Page>, keywords: &Keywords) -> Self {
        let mut vocab: HashMap<String, u32> = HashMap::new();
        let mut names: Vec<String> = Vec::new();
        let mut id = |t: String| -> u32 {
            *vocab.entry(t.clone()).or_insert_with(|| {
                names.push(t);
                names.len() as u32 - 1
            })
        };
        let (mut full, mut head): (Vec<Counts>, Vec<Counts>) = (Vec::new(), Vec::new());
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
        let n = full.len();
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
        Corpus {
            vectors: full.iter().map(|c| vectorize(c, &idf)).collect(),
            heads: head.iter().map(|c| vectorize(c, &idf)).collect(),
            names,
            df,
        }
    }

    /// For every page, the others at least `min` similar, most similar first. Uses an inverted
    /// index; very common terms stay out of it to keep big sites fast, but still count in each
    /// vector's length.
    pub fn neighbours(&self, min: f32) -> Vec<Vec<(usize, f32)>> {
        let n = self.vectors.len();
        let cap = (n / 10).max(50) as u32;
        let mut postings: HashMap<u32, Vec<(usize, f32)>> = HashMap::new();
        for (i, v) in self.vectors.iter().enumerate() {
            for &(t, w) in v {
                if (2..=cap).contains(&self.df[t as usize]) {
                    postings.entry(t).or_default().push((i, w));
                }
            }
        }
        let mut out: Vec<Vec<(usize, f32)>> = vec![Vec::new(); n];
        for (i, v) in self.vectors.iter().enumerate() {
            let mut acc: HashMap<usize, f32> = HashMap::new();
            for (t, w) in v {
                for &(j, wj) in postings.get(t).into_iter().flatten() {
                    if j > i {
                        *acc.entry(j).or_default() += w * wj;
                    }
                }
            }
            for (j, s) in acc.into_iter().filter(|&(_, s)| s >= min) {
                out[i].push((j, s));
                out[j].push((i, s));
            }
        }
        out.iter_mut()
            .for_each(|nb| nb.sort_by(|a, b| b.1.total_cmp(&a.1)));
        out
    }

    /// Clusters of 2+ pages among `order` (strongest first): each page joins the most similar
    /// existing hub at least `threshold` similar, or starts its own. Largest clusters first.
    pub fn clusters(
        order: &[usize],
        neighbours: &[Vec<(usize, f32)>],
        threshold: f32,
    ) -> Vec<(usize, Vec<usize>)> {
        let sim = |i: usize, j: usize| {
            neighbours[i]
                .iter()
                .find(|(k, _)| *k == j)
                .map_or(0.0, |(_, s)| *s)
        };
        let mut hubs: Vec<usize> = Vec::new();
        let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
        for &p in order {
            let best = hubs
                .iter()
                .map(|&h| (h, sim(p, h)))
                .filter(|&(_, s)| s >= threshold)
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
        // ties by hub index keep the order stable for the caller to sort further
        clusters.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
        clusters
    }

    /// Words naming a group of pages: the ones most of their titles share first, so one page's
    /// catchy wording doesn't name the whole group.
    pub fn label(&self, members: &[usize]) -> Vec<String> {
        let mut score: HashMap<u32, (u32, f32)> = HashMap::new();
        for &p in members {
            let head = if self.heads[p].is_empty() {
                &self.vectors[p]
            } else {
                &self.heads[p]
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
        top.iter()
            .take(3)
            .map(|(t, _)| self.names[*t as usize].clone())
            .collect()
    }
}

/// Pages strongest first: Link Score, then inlinks, then URL for a stable order.
pub fn strongest_first(pages: &[&Page]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..pages.len()).collect();
    order.sort_by(|&a, &b| {
        let (pa, pb) = (pages[a], pages[b]);
        pb.link_score
            .cmp(&pa.link_score)
            .then(pb.inlinks.cmp(&pa.inlinks))
            .then(pa.url.cmp(&pb.url))
    });
    order
}

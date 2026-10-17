//! Words that say what a page is about: lowercase tokens without stopwords, numbers or fragments.

use std::collections::HashMap;

/// Italian and English function words; they say nothing about the topic.
#[rustfmt::skip]
const STOPWORDS: &[&str] = &[
    // Italian
    "abbiamo", "agli", "alla", "alle", "allo", "anche", "ancora", "avere", "che", "chi", "come", "con", "cosa", "cui",
    "dal", "dalla", "dalle", "dei", "del", "dell", "della", "delle", "dello", "deve", "devi", "dopo", "dove", "due", "ecco",
    "essere", "fare", "gli", "hai", "hanno", "loro", "lui", "molto", "nei", "nel", "nella", "nelle", "noi", "non", "nostra",
    "nostre", "nostri", "nostro", "ogni", "oppure", "per", "perché", "perche", "piu", "più", "poi", "possono", "può", "puo",
    "qui", "quale", "quali", "quando", "quanto", "quella", "quelle", "quelli", "quello", "questa", "queste", "questi",
    "questo", "sei", "senza", "siamo", "sia", "solo", "sono", "sua", "sue", "sugli", "sui", "sul", "sulla", "suo", "suoi",
    "tra", "tua", "tue", "tuo", "tuoi", "tutti", "tutto", "tutte", "una", "uno", "voi", "vostra", "vostro", "anni",
    // English
    "about", "after", "all", "also", "and", "any", "are", "because", "been", "but", "can", "could", "did", "does", "for",
    "from", "had", "has", "have", "her", "his", "how", "into", "its", "just", "more", "most", "not", "now", "only", "other",
    "our", "out", "over", "she", "should", "some", "than", "that", "the", "their", "them", "then", "there", "these", "they",
    "this", "those", "through", "too", "under", "very", "was", "were", "what", "when", "where", "which", "while", "who",
    "why", "will", "with", "would", "you", "your", "yours",
    // site furniture
    "home", "menu", "cookie", "cookies", "privacy", "policy", "leggi", "scopri", "clicca", "click", "read",
];

fn is_stopword(w: &str) -> bool {
    STOPWORDS.contains(&w)
}

/// Topic tokens of a text. shortcut: no stemming, so "servizio" and "servizi" count as different
/// words; add a light Italian/English stemmer if clusters split on plurals.
pub fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| {
            w.chars().count() >= 3 && !w.chars().all(|c| c.is_ascii_digit()) && !is_stopword(w)
        })
}

/// The `n` most frequent topic tokens of a page's main-content words, with their counts.
pub fn top_terms(words: &[String], n: usize) -> Vec<(String, u32)> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for w in words {
        for t in tokens(w) {
            *counts.entry(t).or_default() += 1;
        }
    }
    let mut top: Vec<(String, u32)> = counts.into_iter().collect();
    // ties broken alphabetically so the stored list is stable across runs
    top.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    top.truncate(n);
    top
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_topic_words_only() {
        let t: Vec<String> =
            tokens("La consulenza SEO dell'azienda: 2024, per l'e-commerce e più").collect();
        assert_eq!(t, vec!["consulenza", "seo", "azienda", "commerce"]);
        let words: Vec<String> = "seo seo audit seo audit della backlink"
            .split(' ')
            .map(String::from)
            .collect();
        assert_eq!(
            top_terms(&words, 2),
            vec![("seo".into(), 3), ("audit".into(), 2)]
        );
    }
}

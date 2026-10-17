//! Page features that make content easy for AI answer engines (ChatGPT, Perplexity, AI Overviews)
//! to understand and quote: an answer up front, question headings, structure, facts, authorship.

use std::sync::LazyLock;

use scraper::{ElementRef, Html, Selector};

/// Raw signals; the score and the advice built on them live in the UI (src/geo.ts).
#[derive(Debug, Default, Clone, PartialEq, serde::Serialize)]
pub struct Signals {
    /// Words in the first paragraph of the main content: an answer-first intro is short.
    pub first_para_words: u32,
    /// h2/h3 written as a question ("Quanto costa…?", "How does…").
    pub question_headings: u32,
    pub subheadings: u32,
    /// Lists and tables in the main content.
    pub lists: u32,
    pub tables: u32,
    /// Numbers, percentages and dates in the text: facts an answer can cite.
    pub stats: u32,
    pub has_author: bool,
    pub has_date: bool,
    /// Almost no text in the HTML but an app container or scripts: the content is built by
    /// JavaScript, which AI crawlers don't run.
    pub js_shell: bool,
}

fn sel(css: &str) -> Selector {
    Selector::parse(css).expect("static selector")
}

pub(crate) static MAIN: LazyLock<Selector> = LazyLock::new(|| sel("main, article, [role=main]"));
pub(crate) static BODY: LazyLock<Selector> = LazyLock::new(|| sel("body"));
static P: LazyLock<Selector> = LazyLock::new(|| sel("p"));
static SUBHEADINGS: LazyLock<Selector> = LazyLock::new(|| sel("h2, h3"));
static LISTS: LazyLock<Selector> = LazyLock::new(|| sel("ul, ol, dl"));
static TABLES: LazyLock<Selector> = LazyLock::new(|| sel("table"));
static AUTHOR: LazyLock<Selector> = LazyLock::new(|| {
    sel(r#"meta[name=author], [rel~=author], [itemprop=author], .author, .byline"#)
});
static DATE: LazyLock<Selector> = LazyLock::new(|| {
    sel(
        r#"time[datetime], meta[property="article:published_time"], meta[property="article:modified_time"], [itemprop=datePublished], [itemprop=dateModified]"#,
    )
});
static JSON_LD: LazyLock<Selector> = LazyLock::new(|| sel(r#"script[type="application/ld+json"]"#));
static APP_ROOT: LazyLock<Selector> =
    LazyLock::new(|| sel("#root, #app, #__next, #__nuxt, [data-reactroot], [ng-app], app-root"));
static BODY_SCRIPTS: LazyLock<Selector> = LazyLock::new(|| sel("body script[src]"));

/// Elements around the content rather than in it.
pub(crate) fn in_chrome(e: &ElementRef) -> bool {
    e.ancestors().any(|a| {
        a.value()
            .as_element()
            .is_some_and(|el| matches!(el.name(), "nav" | "footer" | "header" | "aside"))
    })
}

pub(crate) fn text(e: &ElementRef) -> String {
    e.text().collect::<Vec<_>>().join(" ")
}

const QUESTION_WORDS: &[&str] = &[
    // Italian
    "come", "cosa", "che", "perché", "perche", "quando", "quale", "quali", "quanto", "quanti",
    "chi", "dove", // English
    "how", "what", "why", "when", "which", "who", "where", "can", "does", "do", "is", "are",
    "should",
];

pub(crate) fn is_question(heading: &str) -> bool {
    let h = heading.trim().to_lowercase();
    h.ends_with('?')
        || h.split_whitespace()
            .next()
            .is_some_and(|w| QUESTION_WORDS.contains(&w.trim_start_matches('¿')))
}

/// `words` are the page's main-content words, as the crawler already counts them.
pub fn signals(doc: &Html, words: &[String]) -> Signals {
    let Some(root) = doc
        .select(&MAIN)
        .next()
        .or_else(|| doc.select(&BODY).next())
    else {
        return Signals::default();
    };
    let content = |s: &Selector| root.select(s).filter(|e| !in_chrome(e)).collect::<Vec<_>>();
    let first_para_words = content(&P)
        .iter()
        .map(|p| text(p).split_whitespace().count() as u32)
        .find(|&n| n > 0)
        .unwrap_or(0);
    let subheadings = content(&SUBHEADINGS);
    let json_ld: String = doc.select(&JSON_LD).map(|s| text(&s)).collect();
    Signals {
        first_para_words,
        question_headings: subheadings.iter().filter(|h| is_question(&text(h))).count() as u32,
        subheadings: subheadings.len() as u32,
        lists: content(&LISTS).len() as u32,
        tables: content(&TABLES).len() as u32,
        stats: words
            .iter()
            .filter(|w| w.bytes().any(|b| b.is_ascii_digit()))
            .count() as u32,
        has_author: doc.select(&AUTHOR).next().is_some() || json_ld.contains("\"author\""),
        has_date: doc.select(&DATE).next().is_some()
            || json_ld.contains("\"datePublished\"")
            || json_ld.contains("\"dateModified\""),
        js_shell: words.len() < 50
            && (doc.select(&APP_ROOT).next().is_some() || doc.select(&BODY_SCRIPTS).count() >= 3),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(html: &Html) -> Vec<String> {
        // same idea as the crawler: body text outside nav/footer
        html.root_element()
            .select(&BODY)
            .flat_map(|b| {
                b.text()
                    .flat_map(|t| t.split_whitespace().map(str::to_lowercase))
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    #[test]
    fn reads_answer_first_structure_facts_and_authorship() {
        let doc = Html::parse_document(
            r#"<html><head><meta name="author" content="Daniele">
            <script type="application/ld+json">{"@type":"Article","datePublished":"2026-01-01"}</script></head>
            <body><nav><p>Home Servizi Blog Contatti menu</p><ul><li>x</li></ul></nav>
            <main><h1>Consulenza SEO</h1>
            <p>Una consulenza SEO costa da 500 a 2.000 euro al mese, a seconda del sito.</p>
            <h2>Quanto dura una consulenza?</h2><h2>Cosa include</h2><h3>Risultati</h3>
            <ul><li>Audit</li><li>Report</li></ul><table><tr><td>Piano</td><td>30%</td></tr></table></main>
            <footer><ul><li>privacy</li></ul></footer></body></html>"#,
        );
        let s = signals(&doc, &words(&doc));
        assert_eq!(s.first_para_words, 15, "the nav paragraph is skipped");
        assert_eq!(
            (s.question_headings, s.subheadings),
            (2, 3),
            "\"Cosa include\" starts with a question word"
        );
        assert_eq!(
            (s.lists, s.tables),
            (1, 1),
            "nav and footer lists don't count"
        );
        assert!(s.stats >= 3, "500, 2.000, 30%");
        assert!(s.has_author && s.has_date && !s.js_shell);
    }

    #[test]
    fn spots_pages_built_by_javascript() {
        let doc = Html::parse_document(
            r#"<html><body><div id="root"></div><script src="/app.js"></script></body></html>"#,
        );
        let s = signals(&doc, &words(&doc));
        assert!(s.js_shell);
        assert_eq!(
            s,
            Signals {
                js_shell: true,
                ..Signals::default()
            }
        );
    }
}

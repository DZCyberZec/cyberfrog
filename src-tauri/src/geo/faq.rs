//! FAQ schema from a page's own question headings: each h2/h3 phrased as a question, with the
//! paragraphs and lists that follow it as the answer. Only text the page already shows is used,
//! since FAQPage markup must match visible content.

use scraper::{Html, Node};
use serde_json::json;

use super::signals::{BODY, MAIN, in_chrome, is_question, text};

const MAX_ANSWER_CHARS: usize = 600;
/// Google shows few FAQ items and pages with more are mostly accordions of boilerplate.
const MAX_PAIRS: usize = 30;

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn cap(s: String) -> String {
    if s.chars().count() <= MAX_ANSWER_CHARS {
        return s;
    }
    let cut: String = s.chars().take(MAX_ANSWER_CHARS).collect();
    // end on a whole word
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head);
    format!("{cut}…")
}

/// (question, answer) pairs in document order; questions without an answer are dropped.
pub fn faq_from_html(html: &str) -> Vec<(String, String)> {
    let doc = Html::parse_document(html);
    let Some(root) = doc
        .select(&MAIN)
        .next()
        .or_else(|| doc.select(&BODY).next())
    else {
        return Vec::new();
    };
    let mut pairs: Vec<(String, String)> = Vec::new();
    // the question whose answer is being collected
    let mut open: Option<(String, Vec<String>)> = None;
    let mut close = |open: &mut Option<(String, Vec<String>)>| {
        if let Some((q, parts)) = open.take() {
            let answer = clean(&parts.join(" "));
            if !answer.is_empty() && !pairs.iter().any(|(p, _)| *p == q) {
                pairs.push((q, cap(answer)));
            }
        }
    };
    for node in root.descendants() {
        let Node::Element(el) = node.value() else {
            continue;
        };
        let Some(e) = scraper::ElementRef::wrap(node) else {
            continue;
        };
        if in_chrome(&e) {
            continue;
        }
        match el.name() {
            "h2" | "h3" if is_question(&text(&e)) => {
                close(&mut open);
                open = Some((clean(&text(&e)), Vec::new()));
            }
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => close(&mut open),
            "p" | "ul" | "ol" | "dl" => {
                // a list is taken whole, so skip the paragraphs and items inside one
                let nested = e.ancestors().any(|a| {
                    a.value()
                        .as_element()
                        .is_some_and(|x| matches!(x.name(), "ul" | "ol" | "dl" | "p"))
                });
                if let (Some((_, parts)), false) = (open.as_mut(), nested) {
                    parts.push(text(&e));
                }
            }
            _ => {}
        }
    }
    close(&mut open);
    pairs.truncate(MAX_PAIRS);
    pairs
}

/// A FAQPage `<script type="application/ld+json">` block, ready to paste in the page head.
pub fn faq_jsonld(pairs: &[(String, String)]) -> String {
    let data = json!({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": pairs.iter().map(|(q, a)| json!({
            "@type": "Question",
            "name": q,
            "acceptedAnswer": { "@type": "Answer", "text": a },
        })).collect::<Vec<_>>(),
    });
    let body = serde_json::to_string_pretty(&data).expect("plain JSON value");
    // serde_json leaves "<" as is, and "</script>" in page text would end the block early
    format!(
        "<script type=\"application/ld+json\">\n{}\n</script>",
        body.replace("</", "<\\/")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<html><body>
        <header><h2>Come ti chiami?</h2><p>Menu</p></header>
        <main><h1>Consulenza SEO</h1><p>Intro</p>
        <h2>Quanto costa una consulenza?</h2>
        <p>Da 500   euro</p><p>al mese.</p><ul><li>Audit</li><li>Report <p>x</p></li></ul>
        <h2>Servizi</h2><p>Non una domanda.</p>
        <h3>Come funziona?</h3><p>In tre passi.</p>
        <h3>Cosa succede dopo?</h3>
        <h3>Si paga prima?</h3><p>No.</p></main>
        <aside><p>box</p></aside></body></html>"#;

    #[test]
    fn pairs_questions_with_the_text_up_to_the_next_heading() {
        let pairs = faq_from_html(PAGE);
        assert_eq!(
            pairs,
            vec![
                (
                    "Quanto costa una consulenza?".to_string(),
                    "Da 500 euro al mese. Audit Report x".to_string()
                ),
                ("Come funziona?".to_string(), "In tre passi.".to_string()),
                ("Si paga prima?".to_string(), "No.".to_string()),
            ],
            "header questions and unanswered ones are skipped, the list counts once"
        );
    }

    #[test]
    fn long_answers_are_cut_on_a_word() {
        let long = "parola ".repeat(200);
        let html = format!("<main><h2>Perché?</h2><p>{long}</p></main>");
        let a = &faq_from_html(&html)[0].1;
        assert!(a.chars().count() <= MAX_ANSWER_CHARS + 1 && a.ends_with("parola…"));
    }

    #[test]
    fn jsonld_is_valid_and_cannot_close_its_script() {
        let out = faq_jsonld(&[("Perché \"così\"?".into(), "</script><b>x</b>".into())]);
        assert!(out.starts_with("<script type=\"application/ld+json\">\n"));
        assert!(out.ends_with("\n</script>"));
        let inner = out
            .strip_prefix("<script type=\"application/ld+json\">\n")
            .and_then(|s| s.strip_suffix("\n</script>"))
            .unwrap();
        assert!(!inner.contains("</"));
        let v: serde_json::Value = serde_json::from_str(inner).unwrap();
        assert_eq!(v["@type"], "FAQPage");
        assert_eq!(v["mainEntity"][0]["name"], "Perché \"così\"?");
        assert_eq!(
            v["mainEntity"][0]["acceptedAnswer"]["text"],
            "</script><b>x</b>"
        );
    }
}

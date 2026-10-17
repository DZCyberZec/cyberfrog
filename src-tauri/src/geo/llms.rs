//! llms.txt (llmstxt.org): a Markdown file at the site root that tells language models what the
//! site is and which pages matter: an H1 with the name, a `>` summary, then lists of links.

#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub struct Check {
    pub has_title: bool,
    pub has_summary: bool,
    /// Markdown links `[name](url)`.
    pub links: u32,
    /// What doesn't follow the format, in Italian (the UI translates).
    pub issues: Vec<&'static str>,
}

pub fn check(body: &str) -> Check {
    let lines: Vec<&str> = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let mut c = Check {
        has_title: lines.first().is_some_and(|l| l.starts_with("# ")),
        has_summary: lines.iter().any(|l| l.starts_with('>')),
        links: body.matches("](").count() as u32,
        issues: Vec::new(),
    };
    let head = body
        .trim_start()
        .get(..200)
        .unwrap_or(body)
        .to_ascii_lowercase();
    if head.starts_with("<!doctype") || head.starts_with("<html") {
        c.issues.push("È una pagina HTML, non un file Markdown");
        c.has_title = false;
        c.links = 0;
        return c;
    }
    if !c.has_title {
        c.issues
            .push("Manca il titolo (# Nome del sito) nella prima riga");
    }
    if !c.has_summary {
        c.issues.push("Manca il riassunto (riga che inizia con >)");
    }
    if c.links == 0 {
        c.issues.push("Nessun link alle pagine importanti");
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_the_llmstxt_format() {
        let good = check(
            "# CyberZec\n\n> Consulenza AI e cybersecurity.\n\n## Servizi\n- [SEO](https://cyberzec.it/seo/): audit\n",
        );
        assert_eq!(
            good,
            Check {
                has_title: true,
                has_summary: true,
                links: 1,
                issues: vec![]
            }
        );
        let bare = check("Benvenuti\n");
        assert_eq!(bare.issues.len(), 3);
        let html = check("<!DOCTYPE html><html><a href=x>[a](b)</a>");
        assert_eq!(html.issues, vec!["È una pagina HTML, non un file Markdown"]);
    }
}

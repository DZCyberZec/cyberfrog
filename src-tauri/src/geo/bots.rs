//! AI crawlers and what each site's robots.txt lets them read.

use texting_robots::Robot;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Bot {
    /// The robots.txt product token.
    pub token: &'static str,
    pub owner: &'static str,
    /// "search": fetches pages to answer and cite in AI search; "training": collects model
    /// training data; "user": fetches a page a person asked the assistant about.
    pub purpose: &'static str,
}

/// Tokens from each company's public crawler documentation.
pub const BOTS: &[Bot] = &[
    Bot {
        token: "OAI-SearchBot",
        owner: "OpenAI",
        purpose: "search",
    },
    Bot {
        token: "ChatGPT-User",
        owner: "OpenAI",
        purpose: "user",
    },
    Bot {
        token: "GPTBot",
        owner: "OpenAI",
        purpose: "training",
    },
    Bot {
        token: "Claude-SearchBot",
        owner: "Anthropic",
        purpose: "search",
    },
    Bot {
        token: "Claude-User",
        owner: "Anthropic",
        purpose: "user",
    },
    Bot {
        token: "ClaudeBot",
        owner: "Anthropic",
        purpose: "training",
    },
    Bot {
        token: "PerplexityBot",
        owner: "Perplexity",
        purpose: "search",
    },
    Bot {
        token: "Perplexity-User",
        owner: "Perplexity",
        purpose: "user",
    },
    Bot {
        token: "Google-Extended",
        owner: "Google",
        purpose: "training",
    },
    Bot {
        token: "Applebot-Extended",
        owner: "Apple",
        purpose: "training",
    },
    Bot {
        token: "CCBot",
        owner: "Common Crawl",
        purpose: "training",
    },
    Bot {
        token: "meta-externalagent",
        owner: "Meta",
        purpose: "training",
    },
];

/// Every AI bot's rules from one robots.txt. A bot without its own group follows `*`.
pub struct Rules(Vec<(&'static str, Robot)>);

impl Rules {
    pub fn parse(body: &str) -> Self {
        Rules(
            BOTS.iter()
                .filter_map(|b| Some((b.token, Robot::new(b.token, body.as_bytes()).ok()?)))
                .collect(),
        )
    }

    /// Tokens of the bots `url` is closed to.
    pub fn blocked(&self, url: &str) -> Vec<&'static str> {
        self.0
            .iter()
            .filter(|(_, r)| !r.allowed(url))
            .map(|(t, _)| *t)
            .collect()
    }
}

/// `Content-Signal:` lines (search, ai-input, ai-train preferences) as written.
pub fn content_signals(body: &str) -> Vec<String> {
    body.lines()
        .filter_map(|l| {
            let (key, value) = l.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case("content-signal")
                .then(|| value.trim().to_owned())
        })
        .filter(|v| !v.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_each_bots_group_and_falls_back_to_star() {
        let rules = Rules::parse(
            "User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /privato/\n\n\
             User-agent: *\nDisallow: /admin/\nContent-Signal: search=yes, ai-train=no\n",
        );
        let home = rules.blocked("https://s.it/");
        assert_eq!(home, vec!["GPTBot"]);
        let private = rules.blocked("https://s.it/privato/x");
        assert!(private.contains(&"PerplexityBot") && private.contains(&"GPTBot"));
        assert!(
            !private.contains(&"ClaudeBot"),
            "ClaudeBot follows *, which allows /privato/"
        );
        assert_eq!(
            rules.blocked("https://s.it/admin/").len(),
            BOTS.len() - 1,
            "PerplexityBot has its own group"
        );
        assert_eq!(
            content_signals("User-agent: *\ncontent-signal: search=yes, ai-train=no\n"),
            vec!["search=yes, ai-train=no"]
        );
    }
}

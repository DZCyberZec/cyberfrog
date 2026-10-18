//! Search Console API (read-only): the properties the account can see, and Search Analytics rows.

use std::time::Duration;

const BASE: &str = "https://www.googleapis.com/webmasters/v3";
/// Google's maximum rows per request.
const PAGE_ROWS: usize = 25_000;
/// Enough for big sites without loading forever.
const MAX_PAGE_ROWS: usize = 100_000;
const MAX_QUERY_ROWS: usize = 50_000;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Site {
    pub site_url: String,
    pub permission_level: String,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct PageRow {
    pub page: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct QueryRow {
    pub query: String,
    pub page: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
}

#[derive(serde::Serialize, Debug, Default)]
pub struct GscData {
    pub pages: Vec<PageRow>,
    pub queries: Vec<QueryRow>,
}

/// A property is "sc-domain:example.com" or a URL prefix.
pub fn valid_site(site: &str) -> bool {
    site.strip_prefix("sc-domain:").map_or_else(
        || url::Url::parse(site).is_ok_and(|u| matches!(u.scheme(), "http" | "https")),
        |d| {
            !d.is_empty()
                && d.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
        },
    )
}

/// YYYY-MM-DD with plausible numbers; Google validates the calendar.
pub fn valid_date(d: &str) -> bool {
    let p: Vec<&str> = d.split('-').collect();
    p.len() == 3
        && p[0].len() == 4
        && p[1].len() == 2
        && p[2].len() == 2
        && p.iter().all(|x| x.chars().all(|c| c.is_ascii_digit()))
}

async fn call(token: &str, req: reqwest::RequestBuilder) -> Result<serde_json::Value, String> {
    let resp = req
        .bearer_auth(token)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Connessione a Search Console non riuscita: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    match status {
        200 => Ok(json),
        401 => Err("Accesso a Google scaduto o revocato: accedi di nuovo dalle Impostazioni".into()),
        403 => Err("Nessun permesso su questa proprietà di Search Console (per un service account: aggiungi la sua email come utente della proprietà)".into()),
        _ => Err(format!("Errore Search Console {status}: {}", json["error"]["message"].as_str().unwrap_or("errore sconosciuto"))),
    }
}

pub async fn sites(token: &str) -> Result<Vec<Site>, String> {
    sites_at(BASE, token).await
}

async fn sites_at(base: &str, token: &str) -> Result<Vec<Site>, String> {
    let json = call(token, reqwest::Client::new().get(format!("{base}/sites"))).await?;
    Ok(json["siteEntry"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["permissionLevel"] != "siteUnverifiedUser")
        .filter_map(|s| {
            Some(Site {
                site_url: s["siteUrl"].as_str()?.to_owned(),
                permission_level: s["permissionLevel"].as_str().unwrap_or("").to_owned(),
            })
        })
        .collect())
}

pub async fn query(token: &str, site: &str, start: &str, end: &str) -> Result<GscData, String> {
    query_at(BASE, token, site, start, end).await
}

async fn query_at(
    base: &str,
    token: &str,
    site: &str,
    start: &str,
    end: &str,
) -> Result<GscData, String> {
    if !valid_site(site) {
        return Err("Proprietà di Search Console non valida".into());
    }
    if !valid_date(start) || !valid_date(end) {
        return Err("Date non valide (usa AAAA-MM-GG)".into());
    }
    let encoded: String = url::form_urlencoded::byte_serialize(site.as_bytes()).collect();
    let url = format!("{base}/sites/{encoded}/searchAnalytics/query");
    let rows = |dims: &[&str], max: usize| {
        let (url, token) = (url.clone(), token.to_owned());
        let dims: Vec<String> = dims.iter().map(|d| d.to_string()).collect();
        async move {
            let mut out: Vec<serde_json::Value> = Vec::new();
            while out.len() < max {
                let body = serde_json::json!({
                    "startDate": start, "endDate": end, "dimensions": dims,
                    "rowLimit": PAGE_ROWS, "startRow": out.len(), "dataState": "final",
                });
                let json = call(&token, reqwest::Client::new().post(&url).json_body(&body)).await?;
                let page: Vec<serde_json::Value> =
                    json["rows"].as_array().cloned().unwrap_or_default();
                let n = page.len();
                out.extend(page);
                if n < PAGE_ROWS {
                    break;
                }
            }
            out.truncate(max);
            Ok::<_, String>(out)
        }
    };
    let num = |r: &serde_json::Value, k: &str| r[k].as_f64().unwrap_or(0.0);
    let key = |r: &serde_json::Value, i: usize| r["keys"][i].as_str().unwrap_or("").to_owned();
    let pages = rows(&["page"], MAX_PAGE_ROWS)
        .await?
        .iter()
        .map(|r| PageRow {
            page: key(r, 0),
            clicks: num(r, "clicks"),
            impressions: num(r, "impressions"),
            ctr: num(r, "ctr"),
            position: num(r, "position"),
        })
        .collect();
    let queries = rows(&["query", "page"], MAX_QUERY_ROWS)
        .await?
        .iter()
        .map(|r| QueryRow {
            query: key(r, 0),
            page: key(r, 1),
            clicks: num(r, "clicks"),
            impressions: num(r, "impressions"),
            ctr: num(r, "ctr"),
            position: num(r, "position"),
        })
        .collect();
    Ok(GscData { pages, queries })
}

/// reqwest's `json` feature isn't enabled; a JSON body by hand keeps the dependency list short.
trait JsonBody {
    fn json_body(self, v: &serde_json::Value) -> Self;
}
impl JsonBody for reqwest::RequestBuilder {
    fn json_body(self, v: &serde_json::Value) -> Self {
        self.header("content-type", "application/json")
            .body(v.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Answers every request with `body`, collecting the requests it saw.
    async fn serve(body: &'static str) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0; 16384];
                let n = sock.read(&mut buf).await.unwrap();
                log.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buf[..n]).into_owned());
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                sock.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        (base, seen)
    }

    #[test]
    fn validates_properties_and_dates() {
        assert!(valid_site("sc-domain:cyberzec.it") && valid_site("https://cyberzec.it/"));
        assert!(
            !valid_site("sc-domain:")
                && !valid_site("sc-domain:a/b")
                && !valid_site("ftp://x")
                && !valid_site("cyberzec.it")
        );
        assert!(
            valid_date("2026-10-15") && !valid_date("2026-1-15") && !valid_date("2026-10-15T00")
        );
    }

    #[tokio::test]
    async fn lists_verified_sites_only() {
        let (base, seen) = serve(r#"{"siteEntry":[{"siteUrl":"sc-domain:cyberzec.it","permissionLevel":"siteOwner"},{"siteUrl":"https://x.it/","permissionLevel":"siteUnverifiedUser"}]}"#).await;
        let s = sites_at(&base, "tok").await.unwrap();
        assert_eq!(
            s,
            vec![Site {
                site_url: "sc-domain:cyberzec.it".into(),
                permission_level: "siteOwner".into()
            }]
        );
        assert!(
            seen.lock().unwrap()[0]
                .to_lowercase()
                .contains("authorization: bearer tok")
        );
    }

    #[tokio::test]
    async fn queries_pages_and_queries_for_an_encoded_property() {
        let (base, seen) = serve(r#"{"rows":[{"keys":["https://cyberzec.it/","seo marche"],"clicks":3,"impressions":120,"ctr":0.025,"position":7.4}]}"#).await;
        let d = query_at(
            &base,
            "tok",
            "sc-domain:cyberzec.it",
            "2026-09-17",
            "2026-10-14",
        )
        .await
        .unwrap();
        assert_eq!(d.pages[0].page, "https://cyberzec.it/");
        assert_eq!(
            (d.queries[0].query.as_str(), d.queries[0].impressions),
            ("https://cyberzec.it/", 120.0),
            "keys are read in order"
        );
        let req = seen.lock().unwrap()[0].clone();
        assert!(
            req.starts_with("POST /sites/sc-domain%3Acyberzec.it/searchAnalytics/query"),
            "{req}"
        );
        assert!(
            req.contains(r#""dimensions":["page"]"#) && req.contains(r#""startDate":"2026-09-17""#)
        );
        assert!(
            query_at(
                &base,
                "tok",
                "sc-domain:x/../../",
                "2026-09-17",
                "2026-10-14"
            )
            .await
            .is_err()
        );
    }
}

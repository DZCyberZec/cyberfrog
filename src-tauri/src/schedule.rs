//! Scheduled crawls. macOS launchd runs `cyberfrog --scheduled <id>` at the chosen time (also when
//! the app is closed, and on wake if the Mac was asleep); the run crawls, compares with the previous
//! crawl of the same site and posts a notification with what changed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::crawler;

/// What the comparison needs from a crawled URL.
type Row = (String, Option<u16>);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Schedule {
    pub id: String,
    pub url: String,
    /// Crawl settings as the UI saved them; validated again at every run.
    pub settings: serde_json::Value,
    /// 0 = every day, 1–7 = Monday–Sunday.
    pub weekday: u8,
    pub hour: u8,
    /// "it" or "en", for the notification.
    pub lang: String,
    pub last_run_ms: Option<u64>,
    pub last_report: Option<String>,
    /// Crawl file of the last run: the next run compares with it, so limits and settings match.
    #[serde(default)]
    pub last_crawl: Option<String>,
}

const LABEL: &str = "com.cyberzec.cyberfrog.schedule";

fn data_dir() -> PathBuf {
    crate::mcp::crawls_dir()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

fn file() -> PathBuf {
    data_dir().join("schedules.json")
}

pub fn load() -> Vec<Schedule> {
    std::fs::read(file())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store(list: &[Schedule]) -> Result<(), String> {
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(file(), json).map_err(|e| format!("Salvataggio non riuscito: {e}"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn plist_path(id: &str) -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(format!("Library/LaunchAgents/{LABEL}.{id}.plist")))
}

/// The launchd job: run this executable with `--scheduled <id>` at the given local time.
fn plist(id: &str, exe: &Path, weekday: u8, hour: u8) -> String {
    let esc = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    // launchd counts Sunday as 0 (or 7) and Monday as 1, like our 1–7, so 7 works as is
    let day = if weekday == 0 {
        String::new()
    } else {
        format!("<key>Weekday</key><integer>{weekday}</integer>")
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{LABEL}.{id}</string>
<key>ProgramArguments</key><array><string>{exe}</string><string>--scheduled</string><string>{id}</string></array>
<key>StartCalendarInterval</key><dict>{day}<key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>0</integer></dict>
<key>ProcessType</key><string>Background</string>
</dict></plist>
"#,
        exe = esc(&exe.to_string_lossy())
    )
}

fn launchctl(args: &[&str]) -> Result<(), String> {
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}

fn gui_domain() -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let home = dirs::home_dir().ok_or("cartella utente non trovata")?;
    let uid = std::fs::metadata(home).map_err(|e| e.to_string())?.uid();
    Ok(format!("gui/{uid}"))
}

/// Saves a schedule and registers its launchd job.
pub fn add(
    url: &str,
    settings: serde_json::Value,
    weekday: u8,
    hour: u8,
    lang: &str,
) -> Result<Vec<Schedule>, String> {
    let start = crate::web_url(url.trim())?;
    if weekday > 7 || hour > 23 {
        return Err("Giorno o ora non validi".into());
    }
    // a bad setting should fail now, not silently at 3 am
    crate::config(
        start.clone(),
        serde_json::from_value(settings.clone()).map_err(|e| e.to_string())?,
    )?;
    let id = now_ms().to_string();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = plist_path(&id).ok_or("cartella utente non trovata")?;
    std::fs::create_dir_all(path.parent().expect("plist is in a folder"))
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, plist(&id, &exe, weekday, hour)).map_err(|e| e.to_string())?;
    launchctl(&["bootstrap", &gui_domain()?, &path.to_string_lossy()])
        .map_err(|e| format!("Pianificazione non registrata in macOS: {e}"))?;
    let mut list = load();
    list.push(Schedule {
        id,
        url: start.to_string(),
        settings,
        weekday,
        hour,
        lang: lang.to_owned(),
        last_run_ms: None,
        last_report: None,
        last_crawl: None,
    });
    store(&list)?;
    Ok(list)
}

/// Removes a schedule and its launchd job; crawls it already made stay.
pub fn remove(id: &str) -> Result<Vec<Schedule>, String> {
    // ids come from our own file, but they also build a path: accept digits only
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Pianificazione sconosciuta".into());
    }
    let _ = launchctl(&["bootout", &format!("{}/{LABEL}.{id}", gui_domain()?)]);
    if let Some(path) = plist_path(id) {
        let _ = std::fs::remove_file(path);
    }
    let mut list = load();
    list.retain(|s| s.id != id);
    store(&list)?;
    Ok(list)
}

/// Entry point of `cyberfrog --scheduled <id>`.
pub fn run(id: &str) {
    let Some(job) = load().into_iter().find(|s| s.id == id) else {
        eprintln!("cyberfrog: no schedule {id}");
        return;
    };
    let en = job.lang == "en";
    let host = Url::parse(&job.url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| job.url.clone());
    let result = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt.block_on(crawl_and_compare(&job)),
        Err(e) => Err(e.to_string()),
    };
    let text = match &result {
        Ok((report, _)) => report.describe(en),
        Err(e) => format!(
            "{} {e}",
            if en {
                "Crawl failed:"
            } else {
                "Crawl non riuscito:"
            }
        ),
    };
    notify(&host, &text);
    let mut list = load();
    if let Some(s) = list.iter_mut().find(|s| s.id == id) {
        s.last_run_ms = Some(now_ms());
        s.last_report = Some(text);
        if let Ok((_, path)) = result {
            s.last_crawl = Some(path.to_string_lossy().into_owned());
        }
    }
    let _ = store(&list);
}

async fn crawl_and_compare(job: &Schedule) -> Result<(Report, PathBuf), String> {
    let start = crate::web_url(&job.url)?;
    let settings = serde_json::from_value(job.settings.clone()).map_err(|e| e.to_string())?;
    let cfg = crate::config(start.clone(), settings)?;
    let dir = crate::mcp::crawls_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("crawl-{}.sqlite", now_ms()));
    crawler::crawl(cfg, &path, |_| {})
        .await
        .map_err(|e| e.to_string())?;
    let rows = |p: &Path| -> Option<Vec<Row>> {
        Some(
            crawler::read_pages(p)
                .ok()?
                .into_iter()
                .map(|pg| (pg.url, pg.status))
                .collect(),
        )
    };
    let cur = rows(&path).ok_or("crawl illeggibile")?;
    // a deleted or unreadable previous crawl counts as a first run
    let prev = job.last_crawl.as_deref().and_then(|p| rows(Path::new(p)));
    Ok((compare(prev.as_deref(), &cur), path))
}

#[derive(Debug, PartialEq)]
pub struct Report {
    pub urls: usize,
    /// None on the first crawl of a site.
    pub before: Option<usize>,
    pub added: usize,
    pub removed: usize,
    /// URLs answering 4xx/5xx now, and how many of them didn't before.
    pub errors: usize,
    pub new_errors: usize,
    pub status_changed: usize,
}

fn is_error(status: Option<u16>) -> bool {
    status.is_some_and(|s| s >= 400)
}

pub fn compare(prev: Option<&[Row]>, cur: &[Row]) -> Report {
    let errors = cur.iter().filter(|(_, s)| is_error(*s)).count();
    let Some(prev) = prev else {
        return Report {
            urls: cur.len(),
            before: None,
            added: 0,
            removed: 0,
            errors,
            new_errors: errors,
            status_changed: 0,
        };
    };
    let old: HashMap<&str, Option<u16>> = prev.iter().map(|(u, s)| (u.as_str(), *s)).collect();
    let now: HashMap<&str, Option<u16>> = cur.iter().map(|(u, s)| (u.as_str(), *s)).collect();
    let mut r = Report {
        urls: cur.len(),
        before: Some(prev.len()),
        added: 0,
        removed: 0,
        errors,
        new_errors: 0,
        status_changed: 0,
    };
    for (url, status) in cur {
        match old.get(url.as_str()) {
            None => r.added += 1,
            Some(o) if o != status => r.status_changed += 1,
            _ => {}
        }
        if is_error(*status) && !old.get(url.as_str()).is_some_and(|o| is_error(*o)) {
            r.new_errors += 1;
        }
    }
    r.removed = prev
        .iter()
        .filter(|(u, _)| !now.contains_key(u.as_str()))
        .count();
    r
}

impl Report {
    pub fn describe(&self, en: bool) -> String {
        let mut parts = vec![format!("{} URL", self.urls)];
        if self.before.is_none() {
            parts.push(if en {
                "first crawl".into()
            } else {
                "primo crawl".into()
            });
        } else if self.added + self.removed + self.status_changed + self.new_errors == 0 {
            parts.push(if en {
                "no changes".into()
            } else {
                "nessuna modifica".into()
            });
        } else {
            if self.added > 0 {
                parts.push(if en {
                    format!("+{} new", self.added)
                } else {
                    format!("+{} nuove", self.added)
                });
            }
            if self.removed > 0 {
                parts.push(if en {
                    format!("−{} removed", self.removed)
                } else {
                    format!("−{} rimosse", self.removed)
                });
            }
            if self.status_changed > 0 {
                parts.push(if en {
                    format!("{} status changes", self.status_changed)
                } else {
                    format!("{} codici cambiati", self.status_changed)
                });
            }
        }
        if self.new_errors > 0 {
            parts.push(if en {
                format!("{} new 4xx/5xx errors", self.new_errors)
            } else {
                format!("{} nuovi errori 4xx/5xx", self.new_errors)
            });
        } else if self.errors > 0 {
            parts.push(if en {
                format!("{} 4xx/5xx errors", self.errors)
            } else {
                format!("{} errori 4xx/5xx", self.errors)
            });
        }
        parts.join(" · ")
    }
}

/// A macOS notification; the text goes as an argument, never inside the script.
fn notify(title: &str, text: &str) {
    let _ = Command::new("osascript")
        .args([
            "-e",
            "on run argv",
            "-e",
            "display notification (item 2 of argv) with title \"CyberFrog\" subtitle (item 1 of argv)",
            "-e",
            "end run",
            title,
            text,
        ])
        .output();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(url: &str, status: u16) -> Row {
        (url.to_owned(), Some(status))
    }

    #[test]
    fn reports_what_changed_since_the_previous_crawl() {
        let prev = [
            page("/a", 200),
            page("/b", 200),
            page("/gone", 200),
            page("/err", 404),
        ];
        let cur = [
            page("/a", 200),
            page("/b", 500),
            page("/new", 200),
            page("/err", 404),
        ];
        let r = compare(Some(&prev), &cur);
        assert_eq!(
            r,
            Report {
                urls: 4,
                before: Some(4),
                added: 1,
                removed: 1,
                errors: 2,
                new_errors: 1,
                status_changed: 1
            }
        );
        assert_eq!(
            r.describe(false),
            "4 URL · +1 nuove · −1 rimosse · 1 codici cambiati · 1 nuovi errori 4xx/5xx"
        );
        let same = compare(Some(&prev), &prev);
        assert_eq!(same.describe(true), "4 URL · no changes · 1 4xx/5xx errors");
        assert_eq!(
            compare(None, &cur).describe(true),
            "4 URL · first crawl · 2 new 4xx/5xx errors"
        );
    }

    #[test]
    fn launchd_job_runs_this_app_at_the_chosen_time() {
        let weekly = plist("17", Path::new("/Applications/Cyber & Frog.app/x"), 1, 7);
        assert!(weekly.contains("<string>com.cyberzec.cyberfrog.schedule.17</string>"));
        assert!(weekly.contains("<string>/Applications/Cyber &amp; Frog.app/x</string><string>--scheduled</string><string>17</string>"));
        assert!(
            weekly.contains(
                "<key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer>"
            )
        );
        assert!(
            !plist("17", Path::new("/x"), 0, 7).contains("Weekday"),
            "daily jobs have no weekday"
        );
    }
}

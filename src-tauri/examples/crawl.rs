//! Crawl from the terminal without the UI: cargo run --example crawl -- https://example.com [out.sqlite]

use cyberfrog_lib::crawler::{Config, crawl, read_pages};

#[tokio::main]
async fn main() -> cyberfrog_lib::crawler::CrawlResult<()> {
    let mut args = std::env::args().skip(1);
    let start = url::Url::parse(&args.next().ok_or("usage: crawl <url> [out.sqlite]")?)?;
    let out = std::path::PathBuf::from(args.next().unwrap_or_else(|| "crawl.sqlite".into()));
    let _ = std::fs::remove_file(&out);

    let t0 = std::time::Instant::now();
    let written = crawl(
        Config {
            start,
            concurrency: 8,
            max_urls: 10_000,
        },
        &out,
        |p| eprint!("\r{} URL, {} in coda   ", p.done, p.pending),
    )
    .await?;
    eprintln!();
    println!(
        "{written} URLs in {:.1}s -> {}",
        t0.elapsed().as_secs_f32(),
        out.display()
    );
    for p in read_pages(&out)?.iter().take(5) {
        println!(
            "{:?} {} | {:?} | {:?} words, {} inlinks",
            p.status, p.url, p.title, p.word_count, p.inlinks
        );
    }
    Ok(())
}

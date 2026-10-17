// Self-check for filters and CSV export. Run: node scripts/pages.check.ts
import assert from "node:assert/strict";
import {
  BROKEN_FILTERS, PERF_FILTERS, medianMs, SITEMAP_FILTERS, buildSitemapXml, CHECKS, CODE_FILTERS, IMAGE_FILTERS, formatBytes, directives, indexFilters, metaFilters, metaRows, nonIndexableReason, toCsv, type Page,
} from "../src/pages.ts";

const base: Page = {
  url: "", depth: 0, status: 200, content_type: "text/html", redirect_to: null, blocked_by_robots: false,
  error: null, title: null, meta_description: null, h1: null, canonical: null, meta_robots: null,
  word_count: 0, inlinks: 0, x_robots_tag: null, outlinks: 0, external_outlinks: 0, in_sitemap: false, response_ms: null, size_bytes: null,
};
const pages: Page[] = [
  { ...base, url: "/a", title: "Same title for both pages here!" },
  { ...base, url: "/b", title: "Same title for both pages here!" },
  { ...base, url: "/c", title: "Short" },
  { ...base, url: "/d", title: "x".repeat(61) },
  { ...base, url: "/e" },
  { ...base, url: "/f", title: "è".repeat(60) }, // 60 characters, not over the limit
  { ...base, url: "/404", status: 404, title: null }, // not judged
  { ...base, url: "/img", content_type: "image/png" }, // not judged
];
const pick = <T extends { url: string }>(rows: T[], filters: { id: string; test: (r: T) => boolean }[], id: string) =>
  rows.filter(filters.find((f) => f.id === id)!.test).map((r) => r.url);

const title = metaFilters(CHECKS[0]);
const rows = metaRows(pages, "title");
assert.deepEqual(pick(rows, title, "all"), ["/a", "/b", "/c", "/d", "/e", "/f"]);
assert.deepEqual(pick(rows, title, "missing"), ["/e"]);
assert.deepEqual(pick(rows, title, "duplicate"), ["/a", "/b"]);
assert.deepEqual(pick(rows, title, "long"), ["/d"]);
assert.deepEqual(pick(rows, title, "short"), ["/c"]);
assert.equal(metaFilters(CHECKS[2]).some((f) => f.id === "short"), false, "H1 has no minimum");

const codes: Page[] = [
  { ...base, url: "/ok" },
  { ...base, url: "/moved", status: 301 },
  { ...base, url: "/gone", status: 404 },
  { ...base, url: "/boom", status: 503 },
  { ...base, url: "/robots", status: null, blocked_by_robots: true },
  { ...base, url: "/timeout", status: null, error: "timed out" },
];
assert.deepEqual(pick(codes, CODE_FILTERS, "client"), ["/gone"]);
assert.deepEqual(pick(codes, CODE_FILTERS, "server"), ["/boom"]);
assert.deepEqual(pick(codes, CODE_FILTERS, "blocked"), ["/robots"]);
assert.deepEqual(pick(codes, CODE_FILTERS, "none"), ["/timeout"]);

assert.equal(
  toCsv(["URL", "Title"], [["/a", 'He said "hi"; ok'], ["/b", "=HYPERLINK(1)"], ["/c", null]]),
  '﻿URL;Title\r\n/a;"He said ""hi""; ok"\r\n/b;\'=HYPERLINK(1)\r\n/c;\r\n',
);
const site: Page[] = [
  { ...base, url: "https://s.it/", canonical: "https://s.it/" },
  { ...base, url: "https://s.it/a", meta_robots: "NoIndex, follow" },
  { ...base, url: "https://s.it/b", x_robots_tag: "googlebot: noindex" },
  { ...base, url: "https://s.it/c", meta_robots: "none" },
  { ...base, url: "https://s.it/d", meta_robots: "noindexing-is-not-a-directive" },
  { ...base, url: "https://s.it/e", canonical: "https://s.it/" },
  { ...base, url: "https://s.it/f", canonical: "https://s.it/gone" },
  { ...base, url: "https://s.it/gone", status: 404 },
  { ...base, url: "https://s.it/g", canonical: "https://other.it/x" },
  { ...base, url: "https://s.it/pdf", content_type: "application/pdf", x_robots_tag: "noindex" },
];
const reasons = Object.fromEntries(site.map((p) => [p.url.slice(12) || "/", nonIndexableReason(p)]));
assert.deepEqual(reasons, {
  "/": null, "/a": "Noindex", "/b": "Noindex", "/c": "Noindex", "/d": null, "/e": "Canonicalizzata",
  "/f": "Canonicalizzata", "/gone": "Errore client (4xx)", "/g": "Canonicalizzata", "/pdf": "Noindex",
});
assert.deepEqual(directives(site[3]), { noindex: true, nofollow: true });
assert.deepEqual(directives(site[1]), { noindex: true, nofollow: false });
const idx = indexFilters(site);
const short = (id: string) => pick(site, idx, id).map((u) => u.slice(12) || "/");
assert.deepEqual(short("indexable"), ["/", "/d"]);
assert.deepEqual(short("nofollow"), ["/c"]);
assert.deepEqual(short("self"), ["/"]);
assert.deepEqual(short("bad-canonical"), ["/f"], "only crawled non-200 targets");
assert.deepEqual(short("no-canonical"), ["/a", "/b", "/c", "/d"], "HTML 200 pages only");
assert.deepEqual(short("x-robots"), ["/b", "/pdf"]);
const broken = [
  { source: "/s", target: "/in404", anchor: null, status: 404, error: null, external: false },
  { source: "/s", target: "x/500", anchor: null, status: 500, error: null, external: true },
  { source: "/s", target: "x/dns", anchor: null, status: null, error: "dns", external: true },
].map((b) => ({ ...b, url: b.target }));
assert.deepEqual(pick(broken, BROKEN_FILTERS, "external"), ["x/500", "x/dns"]);
assert.deepEqual(pick(broken, BROKEN_FILTERS, "client"), ["/in404"]);
assert.deepEqual(pick(broken, BROKEN_FILTERS, "none"), ["x/dns"]);
const img = { status: 200, bytes: 1000, content_type: null, error: null, pages: 1, missing_alt: 0, empty_alt: 0, missing_size: 0, alt: "a" };
const imgs = [
  { ...img, src: "light" },
  { ...img, src: "heavy", bytes: 102401 },
  { ...img, src: "edge", bytes: 102400 },
  { ...img, src: "noalt", missing_alt: 2, alt: null },
  { ...img, src: "broken", status: 404 },
  { ...img, src: "unreachable", status: null, bytes: null },
].map((i) => ({ ...i, url: i.src }));
assert.deepEqual(pick(imgs, IMAGE_FILTERS, "large"), ["heavy"], "exactly 100 KB is not over");
assert.deepEqual(pick(imgs, IMAGE_FILTERS, "missing-alt"), ["noalt"]);
assert.deepEqual(pick(imgs, IMAGE_FILTERS, "errors"), ["broken", "unreachable"]);
assert.deepEqual([formatBytes(850), formatBytes(12595), formatBytes(1468006), formatBytes(null)], ["850 B", "12,3 KB", "1,4 MB", ""]);
const sm: Page[] = [
  { ...base, url: "https://s.it/", depth: 0, in_sitemap: true },
  { ...base, url: "https://s.it/linked", depth: 1, inlinks: 3, in_sitemap: true },
  { ...base, url: "https://s.it/orphan", depth: null, in_sitemap: true },
  { ...base, url: "https://s.it/forgot", depth: 2, inlinks: 1 },
  { ...base, url: "https://s.it/noidx", depth: 1, inlinks: 1, in_sitemap: true, meta_robots: "noindex" },
  { ...base, url: "https://s.it/q?a=1&b=<2>", depth: 1, inlinks: 1 },
  { ...base, url: "https://s.it/old", depth: 1, inlinks: 1, status: 301 },
];
const smShort = (id: string) => pick(sm, SITEMAP_FILTERS, id).map((u) => u.slice(12));
assert.deepEqual(smShort("orphan"), ["/orphan"], "the start URL is never an orphan");
assert.deepEqual(smShort("missing"), ["/forgot", "/q?a=1&b=<2>"]);
assert.deepEqual(smShort("non-indexable"), ["/noidx"]);
const xml = buildSitemapXml(sm);
assert.ok(xml.includes("<loc>https://s.it/q?a=1&amp;b=&lt;2&gt;</loc>"), xml);
assert.ok(!xml.includes("/noidx") && !xml.includes("/old"), "only indexable 200 HTML pages");
assert.equal((xml.match(/<url>/g) ?? []).length, 5);
const perf: Page[] = [
  { ...base, url: "/fast", response_ms: 120, size_bytes: 40_000 },
  { ...base, url: "/slow", response_ms: 1500, size_bytes: 600_000 },
  { ...base, url: "/crawl", response_ms: 3001 },
  { ...base, url: "/pdf", content_type: "application/pdf", size_bytes: 9_000_000, response_ms: 900 },
  { ...base, url: "/down", status: null },
];
assert.deepEqual(pick(perf, PERF_FILTERS, "slow"), ["/slow", "/crawl"]);
assert.deepEqual(pick(perf, PERF_FILTERS, "very-slow"), ["/crawl"]);
assert.deepEqual(pick(perf, PERF_FILTERS, "heavy"), ["/slow"], "only HTML pages count as heavy");
assert.equal(medianMs(perf), 1200);
assert.equal(medianMs([]), null);
console.log("pages.check: ok");

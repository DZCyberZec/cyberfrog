// Self-check for filters and CSV export. Run: node scripts/pages.check.ts
import assert from "node:assert/strict";
import {
  CHECKS, CODE_FILTERS, directives, indexFilters, metaFilters, metaRows, nonIndexableReason, toCsv, type Page,
} from "../src/pages.ts";

const base: Page = {
  url: "", depth: 0, status: 200, content_type: "text/html", redirect_to: null, blocked_by_robots: false,
  error: null, title: null, meta_description: null, h1: null, canonical: null, meta_robots: null,
  word_count: 0, inlinks: 0, x_robots_tag: null,
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
console.log("pages.check: ok");

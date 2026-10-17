// Self-check for filters and CSV export. Run: node scripts/pages.check.ts
import assert from "node:assert/strict";
import type { Page } from "../src/pages.ts";

// expected labels below are Italian, the source language; pin it before the modules load
Object.defineProperty(globalThis, "navigator", { value: { language: "it-IT" }, configurable: true });
const {
  BROKEN_FILTERS, customRows, customFilters, CHANGE_FILTERS, compareCrawls, allIssues, BAD_LINK_FILTERS, badLinkReason, ISSUES, countIssues, DUP_FILTERS, dupPages, schemaFilters, schemaPages, HREFLANG_FILTERS, hreflangIssues, hreflangPages, validHreflang, PERF_FILTERS, medianMs, SITEMAP_FILTERS, buildSitemapXml, CHECKS, CODE_FILTERS, IMAGE_FILTERS, formatBytes, directives, indexFilters, metaFilters, metaRows, nonIndexableReason, toCsv,
  REDIRECT_FILTERS, redirectChains, siteTree, depthCounts, JS_FILTERS,
} = await import("../src/pages.ts");
const { hasTranslation } = await import("../src/i18n.ts");
const { pageIssues, withExamples } = await import("../src/pages.ts");
const { systemPrompt, metaPrompt, explainPrompt, planPrompt } = await import("../src/ai.ts");
const { healthScore } = await import("../src/health.ts");
const { TOPIC_FILTERS, topicFindings, REASON_LABEL } = await import("../src/topics.ts");
const { buildLlmsTxt } = await import("../src/llms.ts");
const { EMPTY_GEO, geoFilters, geoRows, botState, CITABILITY, PURPOSE_LABEL } = await import("../src/geo.ts");

const base: Page = {
  url: "", depth: 0, status: 200, content_type: "text/html", redirect_to: null, blocked_by_robots: false,
  error: null, title: null, meta_description: null, h1: null, canonical: null, meta_robots: null,
  word_count: 0, inlinks: 0, x_robots_tag: null, outlinks: 0, external_outlinks: 0, in_sitemap: false, response_ms: null, size_bytes: null, content_hash: null, simhash: null, link_score: 0, rendered: false, raw_word_count: null, raw_links: null, render_error: null,
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
  { ...base, url: "/tag", title: "Same title for both pages here!", meta_robots: "noindex" }, // not judged
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
assert.deepEqual(short("no-canonical"), ["/d"], "indexable HTML 200 pages only");
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
for (const ok of ["it", "en-GB", "zh-Hant-TW", "es-419", "x-default", "EN-us"]) assert.ok(validHreflang(ok), ok);
for (const bad of ["en-UK", "english", "en_GB", "e", "it-ITA"]) assert.ok(!validHreflang(bad), bad);
const hp: Page[] = [
  { ...base, url: "/it" }, { ...base, url: "/en" }, { ...base, url: "/fr" }, { ...base, url: "/de", status: 301 },
];
const hr = [
  { page: "/it", lang: "it", href: "/it" }, { page: "/it", lang: "en-UK", href: "/en" },
  { page: "/it", lang: "fr", href: "/fr" }, { page: "/it", lang: "de", href: "/de" },
  { page: "/it", lang: "x-default", href: "/it" }, { page: "/it", lang: "es", href: "/es-not-crawled" },
  { page: "/en", lang: "en", href: "/en" }, { page: "/en", lang: "it", href: "/it" },
  { page: "/fr", lang: "it", href: "/it" },
];
const hps = hreflangPages(hp, hr);
const it = hps.find((h) => h.url === "/it")!;
assert.deepEqual(it.invalid, ["en-UK"]);
assert.deepEqual(it.noReturn, ["/de"], "/en and /fr link back; /es is not crawled so not judged");
assert.deepEqual(it.badTarget, ["/de"]);
assert.ok(it.selfRef && it.xDefault);
const fr = hps.find((h) => h.url === "/fr")!;
assert.equal(hreflangIssues(fr), "Manca l'auto-riferimento · Manca x-default");
assert.deepEqual(pick(hps, HREFLANG_FILTERS, "no-self"), ["/fr"]);
assert.deepEqual(pick(hps, HREFLANG_FILTERS, "no-x-default"), ["/en", "/fr"]);
const sp: Page[] = [
  { ...base, url: "/a" }, { ...base, url: "/b" }, { ...base, url: "/c" }, { ...base, url: "/img", content_type: "image/png" },
];
const sr = [
  { page: "/a", format: "JSON-LD", kind: "Organization", issue: null },
  { page: "/a", format: "JSON-LD", kind: "Product", issue: "Mancano: name" },
  { page: "/a", format: "Microdata", kind: "Organization", issue: null },
  { page: "/b", format: "JSON-LD", kind: null, issue: "JSON non valido: x" },
  { page: "/b", format: "JSON-LD", kind: "Article", issue: null },
];
const sps = schemaPages(sp, sr);
assert.deepEqual(sps.map((r) => r.url), ["/a", "/b", "/c"], "HTML 200 pages only, including those without data");
assert.deepEqual(sps[0].types, ["Organization", "Product"]);
assert.equal(sps[0].formats, "JSON-LD, Microdata");
assert.equal(sps[0].issues, "Product: Mancano: name");
const sf = schemaFilters(sps);
assert.deepEqual(sf.map((f) => f.id).slice(5), ["type:Article", "type:Organization", "type:Product"]);
assert.deepEqual(pick(sps, sf, "errors"), ["/b"]);
assert.deepEqual(pick(sps, sf, "warnings"), ["/a"]);
assert.deepEqual(pick(sps, sf, "without"), ["/c"]);
const dp: Page[] = [
  { ...base, url: "/a", content_hash: "h1", simhash: "ffffffff00000000", word_count: 500 },
  { ...base, url: "/a-copy", content_hash: "h1", simhash: "ffffffff00000000", word_count: 500 },
  { ...base, url: "/close", content_hash: "h2", simhash: "ffffffff0000003f", word_count: 480 }, // 6 bits from /a
  { ...base, url: "/far", content_hash: "h3", simhash: "ffffffff000000ff", word_count: 90 }, // 8 bits from /a
  { ...base, url: "/noidx", content_hash: "h1", simhash: "ffffffff00000000", meta_robots: "noindex" },
  { ...base, url: "/empty", content_hash: null, simhash: null },
];
const dups = dupPages(dp);
assert.deepEqual(dups.map((d) => d.url), ["/a", "/a-copy", "/close", "/far"], "indexable pages with text only");
const da = dups[0];
assert.deepEqual([da.exact, da.near, da.similarity, da.closest], [1, 1, 1, "/a-copy"]);
assert.equal(dups[2].near, 3, "/close is within 6 bits of /a, /a-copy and /far");
assert.equal(dups[3].similarity, 1 - 2 / 64);
assert.deepEqual(pick(dups, DUP_FILTERS, "exact"), ["/a", "/a-copy"]);
assert.deepEqual(pick(dups, DUP_FILTERS, "low"), ["/far"]);
assert.deepEqual(dupPages([dp[0]]).map((d) => d.similarity), [null], "a lone page has nothing to compare with");
const issues = countIssues(ISSUES, {
  codes: { rows: codes, filters: CODE_FILTERS },
  title: { rows, filters: metaFilters(CHECKS[0]) },
});
assert.deepEqual(
  issues.map((i) => [i.priority, i.label, i.count]),
  [
    ["Alta", "Pagine con errore 4xx", 1],
    ["Alta", "Pagine con errore 5xx", 1],
    ["Alta", "Title mancante", 1],
    ["Media", "Title duplicati", 2],
    ["Bassa", "Redirect (3xx)", 1],
    ["Bassa", "Title oltre 60 caratteri", 1],
    ["Bassa", "Title sotto 30 caratteri", 1],
    ["Bassa", "URL bloccati da robots.txt", 1],
  ],
  "only issues with URLs, severest first; reports not provided are skipped",
);
const tabsWithFilters: Record<string, string[]> = {
  codes: CODE_FILTERS.map((f) => f.id), index: indexFilters([]).map((f) => f.id), broken: BROKEN_FILTERS.map((f) => f.id),
  title: metaFilters(CHECKS[0]).map((f) => f.id), meta_description: metaFilters(CHECKS[1]).map((f) => f.id),
  h1: metaFilters(CHECKS[2]).map((f) => f.id), images: IMAGE_FILTERS.map((f) => f.id), perf: PERF_FILTERS.map((f) => f.id),
  sitemap: SITEMAP_FILTERS.map((f) => f.id), schema: schemaFilters([]).map((f) => f.id), hreflang: HREFLANG_FILTERS.map((f) => f.id),
  duplicates: DUP_FILTERS.map((f) => f.id), badlinks: BAD_LINK_FILTERS.map((f) => f.id),
  redirects: REDIRECT_FILTERS.map((f) => f.id), js: JS_FILTERS.map((f) => f.id), geo: geoFilters(EMPTY_GEO).map((f) => f.id), topics: TOPIC_FILTERS.map((f) => f.id),
};
for (const d of ISSUES) assert.ok(tabsWithFilters[d.tab]?.includes(d.filter), `issue ${d.label} points to a real filter`);
const labels = [
  ...ISSUES.flatMap((d) => [d.label, d.fix, d.priority]),
  ...[CODE_FILTERS, BROKEN_FILTERS, CHANGE_FILTERS, REDIRECT_FILTERS, BAD_LINK_FILTERS, IMAGE_FILTERS, SITEMAP_FILTERS, PERF_FILTERS, JS_FILTERS, HREFLANG_FILTERS, DUP_FILTERS,
      indexFilters([]), schemaFilters([]), geoFilters(EMPTY_GEO), CITABILITY, TOPIC_FILTERS, ...CHECKS.map(metaFilters)].flat().map((f) => f.label),
  ...Object.values(PURPOSE_LABEL),
  ...Object.values(REASON_LABEL),
  // llms.txt problems come from Rust in Italian
  "È una pagina HTML, non un file Markdown", "Manca il titolo (# Nome del sito) nella prima riga", "Manca il riassunto (riga che inizia con >)", "Nessun link alle pagine importanti",
];
const untranslated = [...new Set(labels)].filter((l) => !hasTranslation(l) && !/^(\d|Tutt|Oltre|Sotto|Contenuto scarso \(|Citabilità sotto )/.test(l));
assert.deepEqual(untranslated, [], "every issue and filter label has an English translation");
assert.equal(badLinkReason("href su <span>"), "href su <span>");
assert.equal(badLinkReason("URL non valido: invalid IPv6 address"), "URL non valido: invalid IPv6 address");
for (const r of ["href javascript:", "href su {tag}", "<a> senza href (onclick)", "navigazione JavaScript (onclick su {tag})"])
  assert.ok(hasTranslation(r), `crawler reason "${r}" has an English translation`);
const snap = (pages: Page[]) => ({ pages, broken: [], images: [], hreflang: [], structured: [], bad_links: [] });
const v1 = snap([
  { ...base, url: "/", title: "Home page title long enough here" },
  { ...base, url: "/old", title: "Old page with a fine long title" },
  { ...base, url: "/moved", title: "Moving page with a long title here" },
  { ...base, url: "/hidden", title: "Hidden later page with long title" },
]);
const v2 = snap([
  { ...base, url: "/", title: "Home page title changed to be long" },
  { ...base, url: "/moved", status: 301 },
  { ...base, url: "/hidden", title: "Hidden later page with long title", meta_robots: "noindex" },
  { ...base, url: "/new" },
]);
const changes = compareCrawls(v1, v2);
const ofKind = (k: string) => changes.filter((c) => c.kind === k).map((c) => [c.key, c.before, c.after]);
assert.deepEqual(ofKind("added"), [["/new", "", "200"]]);
assert.deepEqual(ofKind("removed"), [["/old", "200", ""]]);
assert.deepEqual(ofKind("status"), [["/moved", "200", "301"]]);
assert.deepEqual(ofKind("indexability"), [["/moved", "Indicizzabile", "Redirect"], ["/hidden", "Indicizzabile", "Noindex"]]);
assert.deepEqual(ofKind("title").map((c) => c[0]), ["/", "/moved"]);
assert.deepEqual(
  ofKind("issue"),
  [
    ["Meta description mancante", "4", "2"], // 4 indexable pages before, 2 after
    ["H1 mancante", "4", "2"],
    ["Canonical mancante", "4", "2"],
    ["Pagine indicizzabili non nella sitemap", "4", "2"],
    ["Title mancante", "0", "1"],
    ["Redirect (3xx)", "0", "1"],
  ],
  "only issues whose count moved",
);
assert.equal(pick(changes.map((c) => ({ ...c, url: c.key })), CHANGE_FILTERS, "content").length, 2);
assert.equal(allIssues(v2).find((i) => i.label === "Title mancante")?.count, 1);
const cdata = {
  rules: [
    { name: "GTM", kind: "search" as const, expr: "googletagmanager", attr: null },
    { name: "Autore", kind: "css" as const, expr: ".author", attr: null },
  ],
  values: [
    { page: "/a", rule: "GTM", value: "2" }, { page: "/a", rule: "Autore", value: "Ada" }, { page: "/a", rule: "Autore", value: "Bob" },
    { page: "/b", rule: "GTM", value: "0" },
  ],
};
const crows = customRows([{ ...base, url: "/a" }, { ...base, url: "/b" }, { ...base, url: "/pdf", word_count: null }], cdata);
assert.deepEqual(crows.map((r) => r.url), ["/a", "/b"], "only pages whose HTML was read");
assert.deepEqual(crows[0].values.Autore, ["Ada", "Bob"]);
const cf = customFilters(cdata.rules);
assert.deepEqual(cf.map((f) => f.label), ["Tutte", "Contiene: GTM", "Non contiene: GTM", "Con Autore", "Senza Autore"]);
assert.deepEqual(pick(crows, cf, "no:GTM"), ["/b"]);
assert.deepEqual(pick(crows, cf, "no:Autore"), ["/b"]);
const rp: Page[] = [
  { ...base, url: "/a", status: 301, redirect_to: "/b", inlinks: 3 },
  { ...base, url: "/b", status: 302, redirect_to: "/c" },
  { ...base, url: "/c" },
  { ...base, url: "/x", status: 301, redirect_to: "/y" },
  { ...base, url: "/y", status: 301, redirect_to: "/x" },
  { ...base, url: "/gone", status: 301, redirect_to: "/404" },
  { ...base, url: "/404", status: 404 },
  { ...base, url: "/out", status: 301, redirect_to: "https://other.it/" },
];
const chains = redirectChains(rp);
const a = chains.find((c) => c.url === "/a")!;
assert.deepEqual([a.hops, a.chain.join(">"), a.finalStatus, a.inlinks], [2, "/a>/b>/c", "200", 3]);
assert.deepEqual(pick(chains, REDIRECT_FILTERS, "chains"), ["/a"], "/b alone is a single redirect");
assert.deepEqual(pick(chains, REDIRECT_FILTERS, "loops"), ["/x", "/y"]);
assert.deepEqual(pick(chains, REDIRECT_FILTERS, "bad-final"), ["/gone"]);
assert.deepEqual(pick(chains, REDIRECT_FILTERS, "leaves"), ["/out"]);
const tp: Page[] = [
  { ...base, url: "https://s.it/", link_score: 100 },
  { ...base, url: "https://s.it/blog/", depth: 1, link_score: 60 },
  { ...base, url: "https://s.it/blog/a/", depth: 2, link_score: 20 },
  { ...base, url: "https://s.it/blog/b/", depth: 2, link_score: 10, meta_robots: "noindex" },
  { ...base, url: "https://s.it/blog/?page=2", depth: 2, link_score: 5 },
  { ...base, url: "https://s.it/chi-sono/", depth: 1, link_score: 40 },
  { ...base, url: "https://s.it/solo-sitemap/", depth: null, link_score: 0 },
];
const tree = siteTree(tp);
assert.equal(tree.urls, 7);
assert.deepEqual(tree.children.map((c) => [c.name, c.urls, c.indexable, c.maxScore]), [["blog", 4, 3, 60], ["chi-sono", 1, 1, 40], ["solo-sitemap", 1, 1, 0]]);
assert.equal(tree.children[0].page?.url, "https://s.it/blog/", "the ?page=2 variant doesn't replace the folder's own page");
assert.deepEqual(depthCounts(tp), [{ depth: 0, count: 1 }, { depth: 1, count: 2 }, { depth: 2, count: 3 }, { depth: null, count: 1 }]);
const jp: Page[] = [
  { ...base, url: "/spa", rendered: true, word_count: 400, raw_word_count: 10, outlinks: 5, raw_links: 2 },
  { ...base, url: "/widget", rendered: true, word_count: 1000, raw_word_count: 940, outlinks: 3, raw_links: 3 },
  { ...base, url: "/fail", render_error: "timeout", word_count: 100, raw_word_count: 100, raw_links: 0 },
  { ...base, url: "/off", word_count: 500 },
];
assert.deepEqual(pick(jp, JS_FILTERS, "all"), ["/spa", "/widget", "/fail"], "pages crawled without rendering are left out");
assert.deepEqual(pick(jp, JS_FILTERS, "js-content"), ["/spa"], "60 extra words in 1000 is a widget, not content");
assert.deepEqual(pick(jp, JS_FILTERS, "js-links"), ["/spa"]);
assert.deepEqual(pick(jp, JS_FILTERS, "errors"), ["/fail"]);
const ap: Page[] = [
  { ...base, url: "https://s.it/", title: "Home", h1: "Benvenuti", meta_description: "x".repeat(130) },
  { ...base, url: "https://s.it/a", title: null, h1: "A", meta_description: "y".repeat(130) },
  { ...base, url: "https://s.it/b", title: null, h1: "B", meta_description: "z".repeat(130) },
];
const asnap = snap(ap);
assert.deepEqual(pageIssues("https://s.it/a", asnap).map((i) => i.label), ["Title mancante", "Canonical mancante", "Pagine indicizzabili non nella sitemap"]);
assert.ok(!pageIssues("https://s.it/", asnap).some((i) => i.label === "Title mancante"));
const withEx = withExamples(allIssues(asnap), asnap);
assert.deepEqual(withEx.find((i) => i.label === "Title mancante")?.examples, ["https://s.it/a", "https://s.it/b"]);
assert.match(systemPrompt(), /Write in Italian/);
assert.match(metaPrompt(ap[0]), /Title: Home\n/);
assert.match(explainPrompt(ap[1], pageIssues(ap[1].url, asnap)), /- \[Alta\] Title mancante/);
assert.match(planPrompt("s.it", ap, withEx), /Title mancante: 2\..*Examples: https:\/\/s\.it\/a, https:\/\/s\.it\/b/);
const sig = { first_para_words: 30, question_headings: 1, subheadings: 3, lists: 1, tables: 0, stats: 5, has_author: true, has_date: true, js_shell: false, blocked_bots: [] as string[] };
const html = { ...base, status: 200, content_type: "text/html", word_count: 800, external_outlinks: 2 };
const gp: Page[] = [
  { ...html, url: "/top" },
  { ...html, url: "/thin", word_count: 100, external_outlinks: 0 },
  { ...html, url: "/shell" },
  { ...html, url: "/noindex", meta_robots: "noindex" },
];
const gd = {
  ...EMPTY_GEO,
  bots: [
    { token: "OAI-SearchBot", owner: "OpenAI", purpose: "search" as const, blocked_pages: 1 },
    { token: "GPTBot", owner: "OpenAI", purpose: "training" as const, blocked_pages: 3 },
  ],
  pages: [
    { ...sig, page: "/top" },
    { ...sig, page: "/thin", first_para_words: 150, has_author: false, has_date: false, blocked_bots: ["OAI-SearchBot", "GPTBot"] },
    { ...sig, page: "/shell", js_shell: true, blocked_bots: ["GPTBot"] },
    { ...sig, page: "/noindex" },
  ],
};
const gr = geoRows(gp, gd, [{ page: "/top", format: "json-ld", kind: "Article", issue: null }]);
assert.deepEqual(gr.map((r) => [r.url, r.score]), [["/top", 100], ["/thin", 40], ["/shell", 95]], "noindex pages are left out; points add up");
assert.deepEqual(gr[1].missingIds, ["answer", "depth", "author", "date", "sources", "schema"]);
const gf = geoFilters(gd);
const geoPick = (id: string) => gr.filter(gf.find((f) => f.id === id)!.test).map((r) => r.url);
assert.deepEqual(geoPick("blocked-search"), ["/thin"], "only search and user bots count for AI answers");
assert.deepEqual(geoPick("blocked-training"), ["/thin", "/shell"]);
assert.deepEqual(geoPick("js-invisible"), ["/shell"]);
assert.deepEqual(geoPick("low"), ["/thin"]);
assert.deepEqual(geoPick("no-author-date"), ["/thin"]);
assert.deepEqual([botState(gd.bots[0], 3), botState(gd.bots[1], 3), botState({ ...gd.bots[0], blocked_pages: 0 }, 3)], ["partial", "closed", "open"]);
assert.ok(allIssues({ ...snap(gp), geo: gd }).some((i) => i.label === "Pagine chiuse ai motori di ricerca AI" && i.count === 1));
const issue = (priority: "Alta" | "Media" | "Bassa", count: number) => ({ tab: "x", filter: "y", label: "z", fix: "", priority, count });
assert.equal(healthScore([], 100), 100);
assert.equal(healthScore([issue("Alta", 100)], 100), 70, "a high issue on every page costs its full weight");
assert.equal(healthScore([issue("Media", 1)], 100), 99, "one page in a hundred costs a little");
assert.equal(healthScore([issue("Alta", 100), issue("Alta", 100), issue("Alta", 100), issue("Alta", 100)], 100), 0, "never below 0");
const tf = topicFindings({
  analysed: 4,
  clusters: [],
  cannibal: [{ a: "/x", b: "/y", similarity: 0.5, title_similarity: 0.8, shared: [] }, { a: "/x", b: "/z", similarity: 0.4, title_similarity: 0.6, shared: [] }],
  suggestions: [{ from: "/x", to: "/w", similarity: 0.4, anchor: "W", reason: "related" }],
});
assert.deepEqual(tf, [{ url: "/x", kind: "cannibal" }, { url: "/y", kind: "cannibal" }, { url: "/z", kind: "cannibal" }, { url: "/w", kind: "links" }], "a page in two pairs counts once");
const lp = (url: string, title: string | null, desc: string | null = null, depth = 1): Page => ({ ...base, url, title, meta_description: desc, depth });
const llms = buildLlmsTxt({
  ...snap([
    lp("https://x.it/", "Acme | Tagline lunga", "Consulenza SEO\ne GEO.", 0),
    lp("https://x.it/seo", "SEO [guida] (2026)", "Come fare SEO"),
    lp("https://x.it/seo/audit", "Audit"),
    lp("https://x.it/contatti", "Contatti"),
    { ...lp("https://x.it/old", "Old"), status: 404 },
    { ...lp("https://x.it/hidden", "Hidden"), meta_robots: "noindex" },
    lp("https://x.it/a b(1)", "Spazi"),
  ]),
  path: "", external: [], custom: { rules: [], values: [] }, geo: EMPTY_GEO,
  topics: { analysed: 3, suggestions: [], cannibal: [], clusters: [{ label: ["seo", "audit"], hub: "https://x.it/seo", pages: ["https://x.it/seo/audit", "https://x.it/old", "https://x.it/hidden"] }] },
});
assert.equal(llms, [
  "# Acme", "", "> Consulenza SEO e GEO.", "",
  "## Seo audit", "", "- [SEO \\[guida\\] (2026)](https://x.it/seo): Come fare SEO", "- [Audit](https://x.it/seo/audit)", "",
  "## Altre pagine", "", "- [Acme | Tagline lunga](https://x.it/): Consulenza SEO e GEO.", "- [Contatti](https://x.it/contatti)", "- [Spazi](https://x.it/a%20b%281%29)", "",
].join("\n"), "hub first, noindex and errors left out, brackets and parentheses escaped");
assert.ok(hasTranslation("Altre pagine"));
console.log("pages.check: ok");

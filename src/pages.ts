import { LOCALE, tr } from "./i18n.ts";

/** Mirrors `crawler::Page` in src-tauri/src/crawler.rs. */
export type Page = {
  url: string;
  /** Link depth from the start URL; null when found only through a sitemap. */
  depth: number | null;
  status: number | null;
  content_type: string | null;
  redirect_to: string | null;
  blocked_by_robots: boolean;
  error: string | null;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  canonical: string | null;
  meta_robots: string | null;
  word_count: number | null;
  inlinks: number;
  x_robots_tag: string | null;
  outlinks: number;
  external_outlinks: number;
  in_sitemap: boolean;
  response_ms: number | null;
  size_bytes: number | null;
  /** Equal for pages whose main-content text is identical. */
  content_hash: string | null;
  /** 64-bit SimHash as 16 hex digits; few differing bits mean similar text. */
  simhash: string | null;
};

/** Mirrors `report::ExternalLink`, `BrokenLink`, `LinkRow` and `PageLinks` in src-tauri/src/report.rs. */
export type ExternalLink = {
  url: string;
  status: number | null;
  content_type: string | null;
  error: string | null;
  inlinks: number;
};
export type BrokenLink = {
  source: string;
  target: string;
  anchor: string | null;
  status: number | null;
  error: string | null;
  external: boolean;
};
export type LinkRow = { url: string; anchor: string | null; status: number | null; external: boolean };
export type PageLinks = { inlinks: LinkRow[]; outlinks: LinkRow[] };
/** Mirrors `report::ImageRow` and `report::ImageUse`. */
export type ImageRow = {
  src: string;
  status: number | null;
  bytes: number | null;
  content_type: string | null;
  error: string | null;
  pages: number;
  missing_alt: number;
  empty_alt: number;
  missing_size: number;
  alt: string | null;
};
export type ImageUse = { page: string; alt: string | null; has_size: boolean };

export type MetaField = "title" | "meta_description" | "h1";

/** Length limits in characters; `min` is omitted where "too short" is not a useful signal. */
export type Check = { field: MetaField; label: string; max: number; min?: number };

export const CHECKS: Check[] = [
  { field: "title", label: "Title", max: 60, min: 30 },
  { field: "meta_description", label: "Meta description", max: 155, min: 70 },
  { field: "h1", label: "H1", max: 70 },
];

export type MetaRow = { url: string; value: string | null; length: number; occurrences: number };

export type FilterDef<T> = { id: string; label: string; test: (row: T) => boolean };

export type StatusKind = "ok" | "redirect" | "client" | "server" | "blocked" | "none";

export function statusKind(p: Page): StatusKind {
  return p.blocked_by_robots ? "blocked" : kindOf(p.status);
}

export function kindOf(status: number | null): StatusKind {
  if (status === null) return "none";
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  if (status >= 300) return "redirect";
  return "ok";
}

/** Label for a bare status: the code, or why there is none. */
export function codeLabel(status: number | null, error: string | null): string {
  if (status !== null) return String(status);
  return error ? tr("Nessuna risposta: {e}", { e: error }) : tr("Nessuna risposta");
}

export function statusLabel(p: Page): string {
  if (p.blocked_by_robots) return tr("Bloccato da robots.txt");
  if (p.status === null) return p.error ? tr("Nessuna risposta: {e}", { e: p.error }) : tr("Nessuna risposta");
  return String(p.status);
}

/** Status filters for rows that carry only a status code (external and broken links). */
export function statusFilters<T extends { status: number | null }>(): FilterDef<T>[] {
  const is = (k: StatusKind) => (r: T) => kindOf(r.status) === k;
  return [
    { id: "all", label: tr("Tutti"), test: () => true },
    { id: "ok", label: tr("2xx Successo"), test: is("ok") },
    { id: "redirect", label: tr("3xx Redirect"), test: is("redirect") },
    { id: "client", label: tr("4xx Errore client"), test: is("client") },
    { id: "server", label: tr("5xx Errore server"), test: is("server") },
    { id: "none", label: tr("Nessuna risposta"), test: is("none") },
  ];
}

export const BROKEN_FILTERS: FilterDef<BrokenLink>[] = [
  { id: "all", label: tr("Tutti"), test: () => true },
  { id: "internal", label: tr("Interni"), test: (b) => !b.external },
  { id: "external", label: tr("Esterni"), test: (b) => b.external },
  ...statusFilters<BrokenLink>().filter((f) => ["client", "server", "none"].includes(f.id)),
];

export const CODE_FILTERS: FilterDef<Page>[] = [
  { id: "all", label: tr("Tutti"), test: () => true },
  { id: "ok", label: tr("2xx Successo"), test: (p) => statusKind(p) === "ok" },
  { id: "redirect", label: tr("3xx Redirect"), test: (p) => statusKind(p) === "redirect" },
  { id: "client", label: tr("4xx Errore client"), test: (p) => statusKind(p) === "client" },
  { id: "server", label: tr("5xx Errore server"), test: (p) => statusKind(p) === "server" },
  { id: "blocked", label: tr("Bloccati da robots.txt"), test: (p) => statusKind(p) === "blocked" },
  { id: "none", label: tr("Nessuna risposta"), test: (p) => statusKind(p) === "none" },
];

export function metaFilters(check: Check): FilterDef<MetaRow>[] {
  const { max, min } = check;
  return [
    { id: "all", label: tr("Tutti"), test: () => true },
    { id: "missing", label: tr("Mancante"), test: (r) => r.value === null },
    { id: "duplicate", label: tr("Duplicato"), test: (r) => r.occurrences > 1 },
    { id: "long", label: tr("Oltre {n} caratteri", { n: max }), test: (r) => r.length > max },
    ...(min === undefined
      ? []
      : [{ id: "short", label: tr("Sotto {n} caratteri", { n: min }), test: (r: MetaRow) => r.value !== null && r.length < min }]),
  ];
}

/** Metadata is only judged on pages that answered 200 with HTML. */
export function isHtmlPage(p: Page): boolean {
  return p.status === 200 && (p.content_type ?? "").startsWith("text/html");
}

/** Title, meta description and H1 are judged on indexable pages only, so noindex archives don't raise false duplicates. */
export function metaRows(pages: Page[], field: MetaField): MetaRow[] {
  const html = pages.filter((p) => isHtmlPage(p) && nonIndexableReason(p) === null);
  const counts = new Map<string, number>();
  for (const p of html) {
    const v = p[field];
    if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return html.map((p) => {
    const v = p[field];
    return {
      url: p.url,
      value: v,
      length: v === null ? 0 : Array.from(v).length, // characters, not UTF-16 units
      occurrences: v === null ? 0 : counts.get(v)!,
    };
  });
}

/**
 * Semicolon-separated CSV with a BOM, which Excel opens as columns in Italian locales.
 * Cells starting with = + - @ are prefixed with ' so crawled text cannot run as a formula.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Robots directives from the meta tag and the X-Robots-Tag header combined. */
// shortcut: agent-scoped values like "googlebot: noindex" count for every crawler, scope them if it matters
export function directives(p: Page): { noindex: boolean; nofollow: boolean } {
  const all = `${p.meta_robots ?? ""},${p.x_robots_tag ?? ""}`.toLowerCase();
  const has = (d: string) => new RegExp(`(^|[\\s,:])${d}($|[\\s,])`).test(all);
  return { noindex: has("noindex") || has("none"), nofollow: has("nofollow") || has("none") };
}

/** Canonical pointing to a different URL than the page itself. */
export function isCanonicalised(p: Page): boolean {
  return p.canonical !== null && p.canonical !== p.url;
}

/** Why a URL can't be indexed, or null when it can. First matching reason wins. */
export function nonIndexableReason(p: Page): string | null {
  switch (statusKind(p)) {
    case "blocked":
      return tr("Bloccato da robots.txt");
    case "none":
      return tr("Nessuna risposta");
    case "redirect":
      return "Redirect";
    case "client":
      return tr("Errore client (4xx)");
    case "server":
      return tr("Errore server (5xx)");
  }
  if (directives(p).noindex) return "Noindex";
  if (isCanonicalised(p)) return tr("Canonicalizzata");
  return null;
}

/** Indexability filters; `pages` lets canonical targets be checked against what was crawled. */
export function indexFilters(pages: Page[]): FilterDef<Page>[] {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const html = (p: Page) => isHtmlPage(p);
  return [
    { id: "all", label: tr("Tutti"), test: () => true },
    { id: "indexable", label: tr("Indicizzabili"), test: (p) => nonIndexableReason(p) === null },
    { id: "non-indexable", label: tr("Non indicizzabili"), test: (p) => nonIndexableReason(p) !== null },
    { id: "noindex", label: "Noindex", test: (p) => directives(p).noindex },
    { id: "nofollow", label: "Nofollow", test: (p) => directives(p).nofollow },
    { id: "canonicalised", label: tr("Canonicalizzate"), test: (p) => isCanonicalised(p) },
    { id: "self", label: tr("Canonical auto-referenziale"), test: (p) => p.canonical === p.url },
    {
      id: "no-canonical",
      label: tr("Canonical mancante"),
      test: (p) => html(p) && p.canonical === null && nonIndexableReason(p) === null,
    },
    {
      id: "bad-canonical",
      label: tr("Canonical verso URL non 200"),
      test: (p) => {
        if (!isCanonicalised(p)) return false;
        const target = byUrl.get(p.canonical!);
        return target !== undefined && target.status !== 200; // uncrawled targets (other hosts) are not judged
      },
    },
    { id: "x-robots", label: tr("X-Robots-Tag presente"), test: (p) => p.x_robots_tag !== null },
  ];
}

/** Images heavier than this are flagged; 100 KB is the usual SEO-audit threshold. */
export const LARGE_IMAGE_BYTES = 100 * 1024;

export const IMAGE_FILTERS: FilterDef<ImageRow>[] = [
  { id: "all", label: tr("Tutte"), test: () => true },
  { id: "large", label: tr("Oltre 100 KB"), test: (i) => (i.bytes ?? 0) > LARGE_IMAGE_BYTES },
  { id: "missing-alt", label: tr("Alt mancante"), test: (i) => i.missing_alt > 0 },
  { id: "empty-alt", label: tr("Alt vuoto (decorative)"), test: (i) => i.empty_alt > 0 },
  { id: "no-size", label: tr("Senza width/height"), test: (i) => i.missing_size > 0 },
  { id: "errors", label: tr("Errori"), test: (i) => i.status === null || i.status >= 400 },
];

const kb = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** "850 B", "12,3 KB", "1,4 MB". */
export function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${kb.format(n / 1024)} KB`;
  return `${kb.format(n / 1024 / 1024)} MB`;
}

export const SITEMAP_FILTERS: FilterDef<Page>[] = [
  { id: "all", label: tr("Tutti"), test: () => true },
  { id: "listed", label: tr("Nella sitemap"), test: (p) => p.in_sitemap },
  {
    id: "missing",
    label: tr("Indicizzabili non nella sitemap"),
    test: (p) => !p.in_sitemap && isHtmlPage(p) && nonIndexableReason(p) === null,
  },
  { id: "orphan", label: tr("Orfane (nessun inlink)"), test: (p) => p.in_sitemap && p.inlinks === 0 && p.depth !== 0 },
  {
    id: "non-indexable",
    label: tr("Non indicizzabili nella sitemap"),
    test: (p) => p.in_sitemap && nonIndexableReason(p) !== null,
  },
];

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** A sitemap.xml listing the indexable HTML pages, in crawl order. */
// shortcut: one file, fine up to the 50,000-URL sitemap limit; split into an index past that
export function buildSitemapXml(pages: Page[]): string {
  const urls = pages
    .filter((p) => isHtmlPage(p) && nonIndexableReason(p) === null)
    .map((p) => `  <url><loc>${xmlEscape(p.url)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export const SLOW_MS = 1000;
export const VERY_SLOW_MS = 3000;
/** HTML this large slows parsing and rendering; most pages stay well under it. */
export const HEAVY_PAGE_BYTES = 512 * 1024;

export const PERF_FILTERS: FilterDef<Page>[] = [
  { id: "all", label: tr("Tutti"), test: () => true },
  { id: "slow", label: tr("Risposta oltre 1 s"), test: (p) => (p.response_ms ?? 0) > SLOW_MS },
  { id: "very-slow", label: tr("Risposta oltre 3 s"), test: (p) => (p.response_ms ?? 0) > VERY_SLOW_MS },
  { id: "heavy", label: tr("HTML oltre 512 KB"), test: (p) => isHtmlPage(p) && (p.size_bytes ?? 0) > HEAVY_PAGE_BYTES },
];

/** Median response time of pages that answered, or null when none did. */
export function medianMs(pages: Page[]): number | null {
  const times = pages.map((p) => p.response_ms).filter((t): t is number => t !== null).sort((a, b) => a - b);
  if (times.length === 0) return null;
  const mid = times.length >> 1;
  return times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2);
}

/** Mirrors `report::HreflangRow`. */
export type HreflangRow = { page: string; lang: string; href: string };

/** One page's hreflang annotations and what is wrong with them. */
export type HreflangPage = {
  url: string;
  langs: string;
  count: number;
  invalid: string[];
  /** Crawled alternates that don't link back to this page. */
  noReturn: string[];
  /** Crawled alternates that answered something other than 200. */
  badTarget: string[];
  selfRef: boolean;
  xDefault: boolean;
};

const LANG_CODE = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

/** Language[-Script][-Region] or x-default. */
// shortcut: checks the format, not the ISO lists; only flags "-UK", the classic mistake for GB
export function validHreflang(code: string): boolean {
  return LANG_CODE.test(code) && !/-uk$/i.test(code);
}

export function hreflangPages(pages: Page[], rows: HreflangRow[]): HreflangPage[] {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const byPage = new Map<string, HreflangRow[]>();
  for (const r of rows) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
  return [...byPage].map(([url, entries]) => {
    const others = entries.filter((e) => e.href !== url && byUrl.has(e.href));
    return {
      url,
      langs: entries.map((e) => e.lang).join(", "),
      count: entries.length,
      invalid: entries.filter((e) => !validHreflang(e.lang)).map((e) => e.lang),
      noReturn: others.filter((e) => !(byPage.get(e.href) ?? []).some((t) => t.href === url)).map((e) => e.href),
      badTarget: entries.filter((e) => byUrl.has(e.href) && byUrl.get(e.href)!.status !== 200).map((e) => e.href),
      selfRef: entries.some((e) => e.href === url),
      xDefault: entries.some((e) => e.lang.toLowerCase() === "x-default"),
    };
  });
}

export function hreflangIssues(h: HreflangPage): string {
  return [
    h.invalid.length > 0 && tr("Codice non valido: {codes}", { codes: h.invalid.join(", ") }),
    h.noReturn.length > 0 && tr("Manca il return link da {n}", { n: h.noReturn.length }),
    h.badTarget.length > 0 && tr("{n} alternative non 200", { n: h.badTarget.length }),
    !h.selfRef && tr("Manca l'auto-riferimento"),
    !h.xDefault && tr("Manca x-default"),
  ]
    .filter(Boolean)
    .join(" · ");
}

export const HREFLANG_FILTERS: FilterDef<HreflangPage>[] = [
  { id: "all", label: tr("Tutte"), test: () => true },
  { id: "invalid", label: tr("Codice non valido"), test: (h) => h.invalid.length > 0 },
  { id: "no-return", label: tr("Senza return link"), test: (h) => h.noReturn.length > 0 },
  { id: "bad-target", label: tr("Alternative non 200"), test: (h) => h.badTarget.length > 0 },
  { id: "no-self", label: tr("Senza auto-riferimento"), test: (h) => !h.selfRef },
  { id: "no-x-default", label: tr("Senza x-default"), test: (h) => !h.xDefault },
];

/** Mirrors `report::StructuredRow`: a schema.org type on a page, or a block that failed to parse. */
export type StructuredRow = { page: string; format: string; kind: string | null; issue: string | null };

/** Structured data of one HTML page, summarised. */
export type SchemaPage = {
  url: string;
  types: string[];
  formats: string;
  /** Blocks that could not be parsed. */
  errors: number;
  /** Items lacking properties Google requires. */
  warnings: number;
  issues: string;
};

/** Every 200 HTML page, with or without structured data. */
export function schemaPages(pages: Page[], rows: StructuredRow[]): SchemaPage[] {
  const byPage = new Map<string, StructuredRow[]>();
  for (const r of rows) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
  return pages.filter(isHtmlPage).map((p) => {
    const items = byPage.get(p.url) ?? [];
    const kinds = items.flatMap((i) => (i.kind ? [i.kind] : []));
    return {
      url: p.url,
      types: [...new Set(kinds)],
      formats: [...new Set(items.map((i) => i.format))].join(", "),
      errors: items.filter((i) => i.kind === null).length,
      warnings: items.filter((i) => i.kind !== null && i.issue !== null).length,
      issues: items.flatMap((i) => (i.issue ? [i.kind ? `${i.kind}: ${i.issue}` : i.issue] : [])).join(" · "),
    };
  });
}

/** Fixed filters plus one per type, most common first (at most 8). */
export function schemaFilters(rows: SchemaPage[]): FilterDef<SchemaPage>[] {
  const freq = new Map<string, number>();
  for (const r of rows) for (const t of r.types) freq.set(t, (freq.get(t) ?? 0) + 1);
  const top = [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  return [
    { id: "all", label: tr("Tutte"), test: () => true },
    { id: "with", label: tr("Con dati strutturati"), test: (r) => r.types.length > 0 },
    { id: "without", label: tr("Senza dati strutturati"), test: (r) => r.types.length === 0 && r.errors === 0 },
    { id: "errors", label: tr("JSON non valido"), test: (r) => r.errors > 0 },
    { id: "warnings", label: tr("Proprietà mancanti"), test: (r) => r.warnings > 0 },
    ...top.map(([t]) => ({ id: `type:${t}`, label: t, test: (r: SchemaPage) => r.types.includes(t) })),
  ];
}

/** Similarity 1 - differingBits/64 at or above this counts as near-duplicate (at most 6 bits). */
export const NEAR_DUPLICATE = 0.9;
export const LOW_CONTENT_WORDS = 200;

export type DupPage = {
  url: string;
  word_count: number | null;
  /** Other pages with identical main-content text. */
  exact: number;
  /** Other pages at least 90% similar but not identical. */
  near: number;
  /** Highest similarity to another page, 0-1; null when there is nothing to compare with. */
  similarity: number | null;
  closest: string | null;
};

function popcount(n: number): number {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Duplicate analysis over indexable 200 HTML pages, the ones search engines compare. */
// shortcut: compares all pairs, fine up to ~10k pages; use banded LSH on the SimHash beyond that
export function dupPages(pages: Page[]): DupPage[] {
  const cands = pages.filter((p) => isHtmlPage(p) && nonIndexableReason(p) === null && p.content_hash && p.simhash);
  const hi = cands.map((p) => parseInt(p.simhash!.slice(0, 8), 16));
  const lo = cands.map((p) => parseInt(p.simhash!.slice(8), 16));
  const exactCount = new Map<string, number>();
  for (const p of cands) exactCount.set(p.content_hash!, (exactCount.get(p.content_hash!) ?? 0) + 1);
  const maxBits = Math.floor(64 * (1 - NEAR_DUPLICATE));
  const near = cands.map(() => 0);
  const best = cands.map(() => 65);
  const bestIdx = cands.map(() => -1);
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const d = popcount(hi[i] ^ hi[j]) + popcount(lo[i] ^ lo[j]);
      if (d < best[i]) [best[i], bestIdx[i]] = [d, j];
      if (d < best[j]) [best[j], bestIdx[j]] = [d, i];
      if (d <= maxBits && cands[i].content_hash !== cands[j].content_hash) {
        near[i]++;
        near[j]++;
      }
    }
  }
  return cands.map((p, i) => ({
    url: p.url,
    word_count: p.word_count,
    exact: exactCount.get(p.content_hash!)! - 1,
    near: near[i],
    similarity: bestIdx[i] < 0 ? null : 1 - best[i] / 64,
    closest: bestIdx[i] < 0 ? null : cands[bestIdx[i]].url,
  }));
}

export const DUP_FILTERS: FilterDef<DupPage>[] = [
  { id: "all", label: tr("Tutte"), test: () => true },
  { id: "exact", label: tr("Duplicati esatti"), test: (d) => d.exact > 0 },
  { id: "near", label: tr("Quasi duplicati (≥ 90%)"), test: (d) => d.near > 0 },
  { id: "low", label: tr("Contenuto scarso (< {n} parole)", { n: LOW_CONTENT_WORDS }), test: (d) => (d.word_count ?? 0) < LOW_CONTENT_WORDS },
];

export type Priority = "Alta" | "Media" | "Bassa";

/** A problem worth fixing: which report and filter list the URLs, and what to do about it. */
export type IssueDef = { tab: string; filter: string; label: string; priority: Priority; fix: string };

export const ISSUES: IssueDef[] = [
  { tab: "codes", filter: "client", priority: "Alta", label: tr("Pagine con errore 4xx"), fix: tr("Ripristina la pagina o reindirizzala (301) e aggiorna i link che la puntano.") },
  { tab: "codes", filter: "server", priority: "Alta", label: tr("Pagine con errore 5xx"), fix: tr("Errore del server: controlla hosting, plugin e log.") },
  { tab: "broken", filter: "internal", priority: "Alta", label: tr("Link interni rotti"), fix: tr("Correggi o rimuovi i link verso pagine che non esistono.") },
  { tab: "title", filter: "missing", priority: "Alta", label: tr("Title mancante"), fix: tr("Scrivi un title unico che descriva la pagina.") },
  { tab: "index", filter: "bad-canonical", priority: "Alta", label: tr("Canonical verso URL non 200"), fix: tr("Punta il canonical a una pagina che risponde 200.") },
  { tab: "schema", filter: "errors", priority: "Alta", label: tr("Dati strutturati con JSON non valido"), fix: tr("Correggi la sintassi del JSON-LD: Google lo ignora interamente.") },
  { tab: "hreflang", filter: "invalid", priority: "Alta", label: tr("Codici hreflang non validi"), fix: tr("Usa codici lingua-regione ISO, es. it-IT, en-GB.") },
  { tab: "hreflang", filter: "no-return", priority: "Alta", label: tr("Hreflang senza return link"), fix: tr("Ogni pagina alternativa deve puntare di ritorno a questa.") },
  { tab: "title", filter: "duplicate", priority: "Media", label: tr("Title duplicati"), fix: tr("Rendi ogni title unico per la sua pagina.") },
  { tab: "meta_description", filter: "missing", priority: "Media", label: tr("Meta description mancante"), fix: tr("Aggiungi una descrizione che inviti al clic.") },
  { tab: "meta_description", filter: "duplicate", priority: "Media", label: tr("Meta description duplicate"), fix: tr("Scrivi descrizioni diverse per pagine diverse.") },
  { tab: "h1", filter: "missing", priority: "Media", label: tr("H1 mancante"), fix: tr("Aggiungi un H1 con l'argomento principale della pagina.") },
  { tab: "badlinks", filter: "uncrawlable", priority: "Media", label: tr("Link non scansionabili"), fix: tr("Usa <a href=\"URL\"> per i link: Google non segue la navigazione in JavaScript né gli href su altri elementi.") },
  { tab: "badlinks", filter: "invalid", priority: "Media", label: tr("Link con URL non validi"), fix: tr("Correggi la sintassi degli URL nei link.") },
  { tab: "broken", filter: "external", priority: "Media", label: tr("Link esterni rotti"), fix: tr("Aggiorna o rimuovi i link verso siti che non rispondono più.") },
  { tab: "images", filter: "large", priority: "Media", label: tr("Immagini oltre 100 KB"), fix: tr("Comprimi o converti in WebP/AVIF per velocizzare le pagine.") },
  { tab: "images", filter: "missing-alt", priority: "Media", label: tr("Immagini senza alt"), fix: tr("Aggiungi un testo alternativo descrittivo (o alt=\"\" se decorativa).") },
  { tab: "perf", filter: "slow", priority: "Media", label: tr("Pagine con risposta oltre 1 s"), fix: tr("Attiva cache e verifica hosting e query lente.") },
  { tab: "sitemap", filter: "orphan", priority: "Media", label: tr("Pagine orfane"), fix: tr("Linka queste pagine da altre pagine del sito.") },
  { tab: "sitemap", filter: "non-indexable", priority: "Media", label: tr("URL non indicizzabili nella sitemap"), fix: tr("La sitemap deve contenere solo pagine indicizzabili con risposta 200.") },
  { tab: "schema", filter: "warnings", priority: "Media", label: tr("Dati strutturati con proprietà mancanti"), fix: tr("Aggiungi le proprietà richieste per ottenere i risultati avanzati.") },
  { tab: "duplicates", filter: "exact", priority: "Media", label: tr("Contenuti duplicati"), fix: tr("Unisci le pagine o indica la principale con un canonical.") },
  { tab: "codes", filter: "redirect", priority: "Bassa", label: tr("Redirect (3xx)"), fix: tr("Aggiorna i link interni perché puntino direttamente alla destinazione.") },
  { tab: "title", filter: "long", priority: "Bassa", label: tr("Title oltre 60 caratteri"), fix: tr("Accorcia: in Google verrà troncato.") },
  { tab: "title", filter: "short", priority: "Bassa", label: tr("Title sotto 30 caratteri"), fix: tr("Sfrutta meglio lo spazio con parole chiave utili.") },
  { tab: "meta_description", filter: "long", priority: "Bassa", label: tr("Meta description oltre 155 caratteri"), fix: tr("Accorcia: in Google verrà troncata.") },
  { tab: "meta_description", filter: "short", priority: "Bassa", label: tr("Meta description sotto 70 caratteri"), fix: tr("Aggiungi dettagli e un invito all'azione.") },
  { tab: "h1", filter: "long", priority: "Bassa", label: tr("H1 oltre 70 caratteri"), fix: tr("Rendi l'H1 più conciso.") },
  { tab: "duplicates", filter: "near", priority: "Bassa", label: tr("Contenuti quasi duplicati"), fix: tr("Differenzia i testi o unisci le pagine simili.") },
  { tab: "duplicates", filter: "low", priority: "Bassa", label: tr("Contenuto scarso"), fix: tr("Arricchisci il testo o valuta un noindex.") },
  { tab: "images", filter: "no-size", priority: "Bassa", label: tr("Immagini senza width/height"), fix: tr("Indica le dimensioni per evitare spostamenti del layout (CLS).") },
  { tab: "index", filter: "no-canonical", priority: "Bassa", label: tr("Canonical mancante"), fix: tr("Aggiungi un canonical auto-referenziale.") },
  { tab: "sitemap", filter: "missing", priority: "Bassa", label: tr("Pagine indicizzabili non nella sitemap"), fix: tr("Aggiungile alla sitemap se vuoi che Google le trovi.") },
  { tab: "hreflang", filter: "no-x-default", priority: "Bassa", label: tr("Hreflang senza x-default"), fix: tr("Indica la versione predefinita con hreflang=\"x-default\".") },
  { tab: "codes", filter: "blocked", priority: "Bassa", label: tr("URL bloccati da robots.txt"), fix: tr("Verifica che il blocco sia voluto.") },
];

export type Issue = IssueDef & { count: number };

/** A report's rows and filters, keyed by tab id, as the Problemi tab counts them. */
// each report has its own row type
export type Reports = Record<string, { rows: any[]; filters: FilterDef<any>[] }>;

const RANK: Record<Priority, number> = { Alta: 0, Media: 1, Bassa: 2 };

/** Issues with at least one URL, most severe first, then by number of URLs. */
export function countIssues(defs: IssueDef[], reports: Reports): Issue[] {
  return defs
    .flatMap((d) => {
      const report = reports[d.tab];
      const filter = report?.filters.find((f) => f.id === d.filter);
      const count = filter ? report.rows.filter(filter.test).length : 0;
      return count > 0 ? [{ ...d, count }] : [];
    })
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.count - a.count);
}

/** Mirrors `report::BadLinkRow`. */
export type BadLinkRow = { page: string; kind: "uncrawlable" | "invalid"; raw: string; reason: string };

export const BAD_LINK_FILTERS: FilterDef<BadLinkRow>[] = [
  { id: "all", label: tr("Tutti"), test: () => true },
  { id: "uncrawlable", label: tr("Non scansionabili"), test: (b) => b.kind === "uncrawlable" },
  { id: "invalid", label: tr("URL non validi"), test: (b) => b.kind === "invalid" },
];

/** Reasons are stored in Italian by the crawler; "<tag>" parts are kept as they are. */
export function badLinkReason(reason: string): string {
  const tag = /<[a-z0-9-]+>/i.exec(reason)?.[0] ?? "";
  if (reason.startsWith("URL non valido")) return tr("URL non valido") + reason.slice("URL non valido".length);
  return tr(reason.replace(tag, "{tag}"), { tag });
}

/** What a crawl file holds, as the UI loads it (mirrors `CrawlData` in src-tauri/src/lib.rs, minus the path). */
export type CrawlSnapshot = {
  pages: Page[];
  broken: BrokenLink[];
  images: ImageRow[];
  hreflang: HreflangRow[];
  structured: StructuredRow[];
  bad_links: BadLinkRow[];
};

/** Every issue of a crawl. Pass `dups` from dupPages() to include duplicate content (it is costly). */
export function allIssues(d: CrawlSnapshot, dups: DupPage[] = []): Issue[] {
  const schema = schemaPages(d.pages, d.structured);
  const reports: Reports = {
    codes: { rows: d.pages, filters: CODE_FILTERS },
    index: { rows: d.pages, filters: indexFilters(d.pages) },
    broken: { rows: d.broken, filters: BROKEN_FILTERS },
    badlinks: { rows: d.bad_links, filters: BAD_LINK_FILTERS },
    images: { rows: d.images, filters: IMAGE_FILTERS },
    sitemap: { rows: d.pages, filters: SITEMAP_FILTERS },
    perf: { rows: d.pages, filters: PERF_FILTERS },
    hreflang: { rows: hreflangPages(d.pages, d.hreflang), filters: HREFLANG_FILTERS },
    schema: { rows: schema, filters: schemaFilters(schema) },
    duplicates: { rows: dups, filters: DUP_FILTERS },
    ...Object.fromEntries(CHECKS.map((c) => [c.field, { rows: metaRows(d.pages, c.field), filters: metaFilters(c) }])),
  };
  return countIssues(ISSUES, reports);
}

export type ChangeKind = "added" | "removed" | "status" | "indexability" | "title" | "meta_description" | "h1" | "canonical" | "issue";

/** One difference between two crawls: a URL that changed, or an issue whose URL count changed. */
export type Change = { kind: ChangeKind; key: string; before: string; after: string };

const CONTENT_FIELDS = ["title", "meta_description", "h1", "canonical"] as const;

/** What changed from `prev` to `cur`: pages, statuses, indexability, key tags and issue counts. */
export function compareCrawls(prev: CrawlSnapshot, cur: CrawlSnapshot): Change[] {
  const before = new Map(prev.pages.map((p) => [p.url, p]));
  const after = new Map(cur.pages.map((p) => [p.url, p]));
  const indexability = (p: Page) => nonIndexableReason(p) ?? tr("Indicizzabile");
  const changes: Change[] = [];
  for (const p of cur.pages) {
    const old = before.get(p.url);
    if (!old) {
      changes.push({ kind: "added", key: p.url, before: "", after: statusLabel(p) });
      continue;
    }
    if (statusLabel(old) !== statusLabel(p)) changes.push({ kind: "status", key: p.url, before: statusLabel(old), after: statusLabel(p) });
    if (indexability(old) !== indexability(p)) changes.push({ kind: "indexability", key: p.url, before: indexability(old), after: indexability(p) });
    for (const f of CONTENT_FIELDS) {
      if ((old[f] ?? "") !== (p[f] ?? "")) changes.push({ kind: f, key: p.url, before: old[f] ?? "", after: p[f] ?? "" });
    }
  }
  for (const p of prev.pages) {
    if (!after.has(p.url)) changes.push({ kind: "removed", key: p.url, before: statusLabel(p), after: "" });
  }
  const countsBefore = new Map(allIssues(prev, dupPages(prev.pages)).map((i) => [i.label, i.count]));
  const countsAfter = new Map(allIssues(cur, dupPages(cur.pages)).map((i) => [i.label, i.count]));
  for (const label of new Set([...countsBefore.keys(), ...countsAfter.keys()])) {
    const [b, a] = [countsBefore.get(label) ?? 0, countsAfter.get(label) ?? 0];
    if (a !== b) changes.push({ kind: "issue", key: label, before: String(b), after: String(a) });
  }
  return changes;
}

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  added: tr("Nuova pagina"),
  removed: tr("Pagina rimossa"),
  status: tr("Stato cambiato"),
  indexability: tr("Indicizzabilità cambiata"),
  title: tr("Title cambiato"),
  meta_description: tr("Meta description cambiata"),
  h1: tr("H1 cambiato"),
  canonical: tr("Canonical cambiato"),
  issue: tr("Problema"),
};

const contentKinds: ChangeKind[] = ["title", "meta_description", "h1", "canonical"];
export const CHANGE_FILTERS: FilterDef<Change>[] = [
  { id: "all", label: tr("Tutti"), test: () => true },
  { id: "issues", label: tr("Problemi"), test: (c) => c.kind === "issue" },
  { id: "added", label: tr("Nuove"), test: (c) => c.kind === "added" },
  { id: "removed", label: tr("Rimosse"), test: (c) => c.kind === "removed" },
  { id: "status", label: tr("Stato"), test: (c) => c.kind === "status" },
  { id: "indexability", label: tr("Indicizzabilità"), test: (c) => c.kind === "indexability" },
  { id: "content", label: tr("Title, meta, H1, canonical"), test: (c) => contentKinds.includes(c.kind) },
];

/** Mirrors `report::CustomData`. */
export type CustomRuleRow = { name: string; kind: "css" | "regex" | "search"; expr: string; attr: string | null };
export type CustomData = { rules: CustomRuleRow[]; values: { page: string; rule: string; value: string }[] };

/** One parsed HTML page with every rule's values (a search rule's single value is its match count). */
export type CustomRow = { url: string; values: Record<string, string[]> };

export function customRows(pages: Page[], data: CustomData): CustomRow[] {
  const byPage = new Map<string, Record<string, string[]>>();
  for (const v of data.values) {
    const row = byPage.get(v.page) ?? {};
    (row[v.rule] ??= []).push(v.value);
    byPage.set(v.page, row);
  }
  // pages whose HTML was read; word_count is null for everything else
  return pages.filter((p) => p.word_count !== null).map((p) => ({ url: p.url, values: byPage.get(p.url) ?? {} }));
}

/** Found / not found per rule: "contains" for searches, "has a value" for extractions. */
export function customFilters(rules: CustomRuleRow[]): FilterDef<CustomRow>[] {
  return [
    { id: "all", label: tr("Tutte"), test: () => true },
    ...rules.flatMap((r): FilterDef<CustomRow>[] => {
      const found = (row: CustomRow) =>
        r.kind === "search" ? Number(row.values[r.name]?.[0] ?? 0) > 0 : (row.values[r.name]?.length ?? 0) > 0;
      const [yes, no] = r.kind === "search" ? ["Contiene: {name}", "Non contiene: {name}"] : ["Con {name}", "Senza {name}"];
      return [
        { id: `yes:${r.name}`, label: tr(yes, { name: r.name }), test: found },
        { id: `no:${r.name}`, label: tr(no, { name: r.name }), test: (row) => !found(row) },
      ];
    }),
  ];
}

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
  return error ? `Nessuna risposta: ${error}` : "Nessuna risposta";
}

export function statusLabel(p: Page): string {
  if (p.blocked_by_robots) return "Bloccato da robots.txt";
  if (p.status === null) return p.error ? `Nessuna risposta: ${p.error}` : "Nessuna risposta";
  return String(p.status);
}

/** Status filters for rows that carry only a status code (external and broken links). */
export function statusFilters<T extends { status: number | null }>(): FilterDef<T>[] {
  const is = (k: StatusKind) => (r: T) => kindOf(r.status) === k;
  return [
    { id: "all", label: "Tutti", test: () => true },
    { id: "ok", label: "2xx Successo", test: is("ok") },
    { id: "redirect", label: "3xx Redirect", test: is("redirect") },
    { id: "client", label: "4xx Errore client", test: is("client") },
    { id: "server", label: "5xx Errore server", test: is("server") },
    { id: "none", label: "Nessuna risposta", test: is("none") },
  ];
}

export const BROKEN_FILTERS: FilterDef<BrokenLink>[] = [
  { id: "all", label: "Tutti", test: () => true },
  { id: "internal", label: "Interni", test: (b) => !b.external },
  { id: "external", label: "Esterni", test: (b) => b.external },
  ...statusFilters<BrokenLink>().filter((f) => ["client", "server", "none"].includes(f.id)),
];

export const CODE_FILTERS: FilterDef<Page>[] = [
  { id: "all", label: "Tutti", test: () => true },
  { id: "ok", label: "2xx Successo", test: (p) => statusKind(p) === "ok" },
  { id: "redirect", label: "3xx Redirect", test: (p) => statusKind(p) === "redirect" },
  { id: "client", label: "4xx Errore client", test: (p) => statusKind(p) === "client" },
  { id: "server", label: "5xx Errore server", test: (p) => statusKind(p) === "server" },
  { id: "blocked", label: "Bloccati da robots.txt", test: (p) => statusKind(p) === "blocked" },
  { id: "none", label: "Nessuna risposta", test: (p) => statusKind(p) === "none" },
];

export function metaFilters(check: Check): FilterDef<MetaRow>[] {
  const { max, min } = check;
  return [
    { id: "all", label: "Tutti", test: () => true },
    { id: "missing", label: "Mancante", test: (r) => r.value === null },
    { id: "duplicate", label: "Duplicato", test: (r) => r.occurrences > 1 },
    { id: "long", label: `Oltre ${max} caratteri`, test: (r) => r.length > max },
    ...(min === undefined
      ? []
      : [{ id: "short", label: `Sotto ${min} caratteri`, test: (r: MetaRow) => r.value !== null && r.length < min }]),
  ];
}

/** Metadata is only judged on pages that answered 200 with HTML. */
export function isHtmlPage(p: Page): boolean {
  return p.status === 200 && (p.content_type ?? "").startsWith("text/html");
}

export function metaRows(pages: Page[], field: MetaField): MetaRow[] {
  const html = pages.filter(isHtmlPage);
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
      return "Bloccato da robots.txt";
    case "none":
      return "Nessuna risposta";
    case "redirect":
      return "Redirect";
    case "client":
      return "Errore client (4xx)";
    case "server":
      return "Errore server (5xx)";
  }
  if (directives(p).noindex) return "Noindex";
  if (isCanonicalised(p)) return "Canonicalizzata";
  return null;
}

/** Indexability filters; `pages` lets canonical targets be checked against what was crawled. */
export function indexFilters(pages: Page[]): FilterDef<Page>[] {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const html = (p: Page) => isHtmlPage(p);
  return [
    { id: "all", label: "Tutti", test: () => true },
    { id: "indexable", label: "Indicizzabili", test: (p) => nonIndexableReason(p) === null },
    { id: "non-indexable", label: "Non indicizzabili", test: (p) => nonIndexableReason(p) !== null },
    { id: "noindex", label: "Noindex", test: (p) => directives(p).noindex },
    { id: "nofollow", label: "Nofollow", test: (p) => directives(p).nofollow },
    { id: "canonicalised", label: "Canonicalizzate", test: (p) => isCanonicalised(p) },
    { id: "self", label: "Canonical auto-referenziale", test: (p) => p.canonical === p.url },
    { id: "no-canonical", label: "Canonical mancante", test: (p) => html(p) && p.canonical === null },
    {
      id: "bad-canonical",
      label: "Canonical verso URL non 200",
      test: (p) => {
        if (!isCanonicalised(p)) return false;
        const target = byUrl.get(p.canonical!);
        return target !== undefined && target.status !== 200; // uncrawled targets (other hosts) are not judged
      },
    },
    { id: "x-robots", label: "X-Robots-Tag presente", test: (p) => p.x_robots_tag !== null },
  ];
}

/** Images heavier than this are flagged; 100 KB is the usual SEO-audit threshold. */
export const LARGE_IMAGE_BYTES = 100 * 1024;

export const IMAGE_FILTERS: FilterDef<ImageRow>[] = [
  { id: "all", label: "Tutte", test: () => true },
  { id: "large", label: "Oltre 100 KB", test: (i) => (i.bytes ?? 0) > LARGE_IMAGE_BYTES },
  { id: "missing-alt", label: "Alt mancante", test: (i) => i.missing_alt > 0 },
  { id: "empty-alt", label: "Alt vuoto (decorative)", test: (i) => i.empty_alt > 0 },
  { id: "no-size", label: "Senza width/height", test: (i) => i.missing_size > 0 },
  { id: "errors", label: "Errori", test: (i) => i.status === null || i.status >= 400 },
];

const kb = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

/** "850 B", "12,3 KB", "1,4 MB". */
export function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${kb.format(n / 1024)} KB`;
  return `${kb.format(n / 1024 / 1024)} MB`;
}

export const SITEMAP_FILTERS: FilterDef<Page>[] = [
  { id: "all", label: "Tutti", test: () => true },
  { id: "listed", label: "Nella sitemap", test: (p) => p.in_sitemap },
  {
    id: "missing",
    label: "Indicizzabili non nella sitemap",
    test: (p) => !p.in_sitemap && isHtmlPage(p) && nonIndexableReason(p) === null,
  },
  { id: "orphan", label: "Orfane (nessun inlink)", test: (p) => p.in_sitemap && p.inlinks === 0 && p.depth !== 0 },
  {
    id: "non-indexable",
    label: "Non indicizzabili nella sitemap",
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
  { id: "all", label: "Tutti", test: () => true },
  { id: "slow", label: "Risposta oltre 1 s", test: (p) => (p.response_ms ?? 0) > SLOW_MS },
  { id: "very-slow", label: "Risposta oltre 3 s", test: (p) => (p.response_ms ?? 0) > VERY_SLOW_MS },
  { id: "heavy", label: "HTML oltre 512 KB", test: (p) => isHtmlPage(p) && (p.size_bytes ?? 0) > HEAVY_PAGE_BYTES },
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
    h.invalid.length > 0 && `Codice non valido: ${h.invalid.join(", ")}`,
    h.noReturn.length > 0 && `Manca il return link da ${h.noReturn.length}`,
    h.badTarget.length > 0 && `${h.badTarget.length} alternative non 200`,
    !h.selfRef && "Manca l'auto-riferimento",
    !h.xDefault && "Manca x-default",
  ]
    .filter(Boolean)
    .join(" · ");
}

export const HREFLANG_FILTERS: FilterDef<HreflangPage>[] = [
  { id: "all", label: "Tutte", test: () => true },
  { id: "invalid", label: "Codice non valido", test: (h) => h.invalid.length > 0 },
  { id: "no-return", label: "Senza return link", test: (h) => h.noReturn.length > 0 },
  { id: "bad-target", label: "Alternative non 200", test: (h) => h.badTarget.length > 0 },
  { id: "no-self", label: "Senza auto-riferimento", test: (h) => !h.selfRef },
  { id: "no-x-default", label: "Senza x-default", test: (h) => !h.xDefault },
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
    { id: "all", label: "Tutte", test: () => true },
    { id: "with", label: "Con dati strutturati", test: (r) => r.types.length > 0 },
    { id: "without", label: "Senza dati strutturati", test: (r) => r.types.length === 0 && r.errors === 0 },
    { id: "errors", label: "JSON non valido", test: (r) => r.errors > 0 },
    { id: "warnings", label: "Proprietà mancanti", test: (r) => r.warnings > 0 },
    ...top.map(([t]) => ({ id: `type:${t}`, label: t, test: (r: SchemaPage) => r.types.includes(t) })),
  ];
}

/** Mirrors `crawler::Page` in src-tauri/src/crawler.rs. */
export type Page = {
  url: string;
  depth: number;
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

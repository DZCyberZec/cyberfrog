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
};

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
  if (p.blocked_by_robots) return "blocked";
  if (p.status === null) return "none";
  if (p.status >= 500) return "server";
  if (p.status >= 400) return "client";
  if (p.status >= 300) return "redirect";
  return "ok";
}

export function statusLabel(p: Page): string {
  if (p.blocked_by_robots) return "Bloccato da robots.txt";
  if (p.status === null) return p.error ? `Nessuna risposta: ${p.error}` : "Nessuna risposta";
  return String(p.status);
}

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

// GEO (generative engine optimisation): can AI answer engines reach, read and quote each page?
// Raw data comes from src-tauri/src/geo/; the score and advice are computed here so they're easy to tune.
import { tr } from "./i18n.ts";
import { isHtmlPage, jsAddsContent, jsLinks, nonIndexableReason, type FilterDef, type Page, type StructuredRow } from "./pages.ts";

/** Mirrors `geo::GeoPage` (signals flattened in). */
export type GeoPage = {
  page: string;
  first_para_words: number;
  question_headings: number;
  subheadings: number;
  lists: number;
  tables: number;
  stats: number;
  has_author: boolean;
  has_date: boolean;
  js_shell: boolean;
  blocked_bots: string[];
};
export type BotPurpose = "search" | "user" | "training";
export type BotAccess = { token: string; owner: string; purpose: BotPurpose; blocked_pages: number };
export type LlmsCheck = { has_title: boolean; has_summary: boolean; links: number; issues: string[] };
export type LlmsInfo = { url: string; status: number | null; check: LlmsCheck | null };
/** Mirrors `geo::GeoData`. */
export type GeoData = { pages: GeoPage[]; bots: BotAccess[]; llms: LlmsInfo | null; content_signals: string[] };

export const EMPTY_GEO: GeoData = { pages: [], bots: [], llms: null, content_signals: [] };

type Inputs = { page: Page; geo: GeoPage; hasSchema: boolean };
type Check = { id: string; label: string; points: number; ok: (i: Inputs) => boolean };

/** What makes a page easy for an AI answer to quote; points add up to 100. */
export const CITABILITY: Check[] = [
  { id: "answer", label: tr("Risposta in apertura (primo paragrafo di 20–80 parole)"), points: 15, ok: ({ geo }) => geo.first_para_words >= 20 && geo.first_para_words <= 80 },
  { id: "questions", label: tr("Sottotitoli a domanda"), points: 10, ok: ({ geo }) => geo.question_headings > 0 },
  { id: "structure", label: tr("Almeno 2 sottotitoli H2/H3"), points: 10, ok: ({ geo }) => geo.subheadings >= 2 },
  { id: "lists", label: tr("Liste o tabelle"), points: 10, ok: ({ geo }) => geo.lists + geo.tables > 0 },
  { id: "facts", label: tr("Dati e numeri (almeno 3)"), points: 10, ok: ({ geo }) => geo.stats >= 3 },
  { id: "depth", label: tr("Almeno 300 parole di contenuto"), points: 10, ok: ({ page }) => (page.word_count ?? 0) >= 300 },
  { id: "author", label: tr("Autore indicato"), points: 10, ok: ({ geo }) => geo.has_author },
  { id: "date", label: tr("Data di pubblicazione o aggiornamento"), points: 10, ok: ({ geo }) => geo.has_date },
  { id: "sources", label: tr("Link a fonti esterne"), points: 10, ok: ({ page }) => page.external_outlinks > 0 },
  { id: "schema", label: tr("Dati strutturati"), points: 5, ok: ({ hasSchema }) => hasSchema },
];

/** One indexable page in the GEO report. */
export type GeoRow = {
  url: string;
  score: number;
  /** Labels of the citability checks the page fails. */
  missing: string[];
  missingIds: string[];
  blocked_bots: string[];
  /** AI crawlers don't run JavaScript: the content or links they'd need come from it. */
  js_invisible: boolean;
};

export const LOW_SCORE = 50;

export function geoRows(pages: Page[], geo: GeoData, structured: StructuredRow[]): GeoRow[] {
  const signals = new Map(geo.pages.map((g) => [g.page, g]));
  const withSchema = new Set(structured.filter((s) => s.kind).map((s) => s.page));
  return pages.flatMap((page) => {
    const g = signals.get(page.url);
    if (!g || !isHtmlPage(page) || nonIndexableReason(page) !== null) return [];
    const inputs = { page, geo: g, hasSchema: withSchema.has(page.url) };
    const failed = CITABILITY.filter((c) => !c.ok(inputs));
    return [
      {
        url: page.url,
        score: 100 - failed.reduce((sum, c) => sum + c.points, 0),
        missing: failed.map((c) => c.label),
        missingIds: failed.map((c) => c.id),
        blocked_bots: g.blocked_bots,
        js_invisible: g.js_shell || jsAddsContent(page) || (jsLinks(page) ?? 0) > 0,
      },
    ];
  });
}

/** Bots that put pages in AI answers (search and on-demand fetches), as opposed to training crawlers. */
const answers = (geo: GeoData) => new Set(geo.bots.filter((b) => b.purpose !== "training").map((b) => b.token));

export function geoFilters(geo: GeoData): FilterDef<GeoRow>[] {
  const answerBots = answers(geo);
  const missing = (id: string) => (r: GeoRow) => r.missingIds.includes(id);
  return [
    { id: "all", label: tr("Tutte"), test: () => true },
    { id: "blocked-search", label: tr("Chiuse alla ricerca AI"), test: (r) => r.blocked_bots.some((b) => answerBots.has(b)) },
    { id: "blocked-training", label: tr("Chiuse all'addestramento AI"), test: (r) => r.blocked_bots.some((b) => !answerBots.has(b)) },
    { id: "js-invisible", label: tr("Invisibili ai crawler AI"), test: (r) => r.js_invisible },
    { id: "low", label: tr("Citabilità sotto {n}", { n: LOW_SCORE }), test: (r) => r.score < LOW_SCORE },
    { id: "no-answer", label: tr("Senza risposta in apertura"), test: missing("answer") },
    { id: "no-author-date", label: tr("Senza autore o data"), test: (r) => r.missingIds.includes("author") || r.missingIds.includes("date") },
  ];
}

/** Per bot: open everywhere, closed on some pages, or closed on every HTML page crawled. */
export function botState(b: BotAccess, htmlPages: number): "open" | "partial" | "closed" {
  if (b.blocked_pages === 0) return "open";
  return b.blocked_pages >= htmlPages ? "closed" : "partial";
}

export const PURPOSE_LABEL: Record<BotPurpose, string> = {
  search: tr("Ricerca AI"),
  user: tr("Su richiesta dell'utente"),
  training: tr("Addestramento"),
};

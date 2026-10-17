// Your site against a competitor's: the same numbers side by side, and what to do to overtake it.
import { LOCALE, tr } from "./i18n.ts";
import { EMPTY_GEO, geoRows, type GeoData } from "./geo.ts";
import { EMPTY_TOPICS, type TopicsData } from "./topics.ts";
import { healthScore } from "./health.ts";
import { allIssues, isHtmlPage, medianMs, nonIndexableReason, type CrawlSnapshot } from "./pages.ts";

/** Mirrors `topics::gap::ContentGap`. */
export type GapPage = { url: string; title: string | null; words: number | null };
export type GapTopic = { label: string[]; pages: GapPage[] };
export type Deeper = { mine: string; theirs: string; similarity: number; mine_words: number; theirs_words: number };
export type ContentGap = {
  mine_pages: number;
  theirs_pages: number;
  mine_covered: number;
  gaps: GapTopic[];
  strengths: GapTopic[];
  deeper: Deeper[];
};

/** One site's numbers. Shares are of indexable HTML pages, 0–1. */
export type SiteSummary = {
  host: string;
  pages: number;
  indexable: number;
  health: number;
  citability: number | null;
  /** Some AI search or on-demand bot is kept out of the start page. */
  aiSearchBlocked: boolean;
  llms: boolean;
  medianMs: number | null;
  avgWords: number;
  withMeta: number;
  withSchema: number;
  withAuthor: number;
  withDate: number;
  questionHeadings: number;
  clusters: number;
};

type Crawl = CrawlSnapshot & { geo?: GeoData; topics?: TopicsData };

const share = (n: number, of: number) => (of ? n / of : 0);

export function summarize(c: Crawl): SiteSummary {
  const geo = c.geo ?? EMPTY_GEO;
  const indexable = c.pages.filter((p) => isHtmlPage(p) && nonIndexableReason(p) === null);
  const n = indexable.length;
  const urls = new Set(indexable.map((p) => p.url));
  const signals = geo.pages.filter((g) => urls.has(g.page));
  const rows = geoRows(c.pages, geo, c.structured);
  const answerBots = new Set(geo.bots.filter((b) => b.purpose !== "training").map((b) => b.token));
  const start = geo.pages[0];
  const html = c.pages.filter(isHtmlPage);
  return {
    host: hostname(c.pages[0]?.url),
    pages: c.pages.length,
    indexable: n,
    health: healthScore(allIssues(c), Math.max(html.length, 1)),
    citability: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null,
    aiSearchBlocked: !!start && start.blocked_bots.some((b) => answerBots.has(b)),
    llms: !!geo.llms?.check,
    medianMs: medianMs(c.pages),
    avgWords: n ? Math.round(indexable.reduce((s, p) => s + (p.word_count ?? 0), 0) / n) : 0,
    withMeta: share(indexable.filter((p) => p.meta_description).length, n),
    withSchema: share(new Set(c.structured.filter((s) => s.kind && urls.has(s.page)).map((s) => s.page)).size, n),
    withAuthor: share(signals.filter((g) => g.has_author).length, n),
    withDate: share(signals.filter((g) => g.has_date).length, n),
    questionHeadings: share(signals.filter((g) => g.question_headings > 0).length, n),
    clusters: (c.topics ?? EMPTY_TOPICS).clusters.length,
  };
}

function hostname(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

const pct = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });
const num = (v: number) => v.toLocaleString(LOCALE);

export type MetricRow = { label: string; mine: string; theirs: string; winner: "mine" | "theirs" | "tie" };

/** `higher` says whether a bigger value is better. */
function row(label: string, mine: number | null, theirs: number | null, higher: boolean, fmt: (v: number) => string): MetricRow {
  const show = (v: number | null) => (v === null ? "–" : fmt(v));
  const winner =
    mine === null || theirs === null || mine === theirs ? "tie" : mine > theirs === higher ? "mine" : "theirs";
  return { label, mine: show(mine), theirs: show(theirs), winner };
}

export function metricRows(m: SiteSummary, t: SiteSummary): MetricRow[] {
  const yes = (b: boolean) => (b ? 1 : 0);
  const yesNo = (v: number) => (v ? tr("Sì") : tr("No"));
  return [
    row(tr("Salute SEO"), m.health, t.health, true, (v) => `${v}/100`),
    row(tr("Citabilità AI"), m.citability, t.citability, true, (v) => `${v}/100`),
    row(tr("Pagine indicizzabili"), m.indexable, t.indexable, true, num),
    row(tr("Parole medie per pagina"), m.avgWords, t.avgWords, true, num),
    row(tr("Argomenti (cluster)"), m.clusters, t.clusters, true, num),
    row(tr("Con meta description"), m.withMeta, t.withMeta, true, pct.format),
    row(tr("Con dati strutturati"), m.withSchema, t.withSchema, true, pct.format),
    row(tr("Con autore"), m.withAuthor, t.withAuthor, true, pct.format),
    row(tr("Con data"), m.withDate, t.withDate, true, pct.format),
    row(tr("Con sottotitoli a domanda"), m.questionHeadings, t.questionHeadings, true, pct.format),
    row(tr("Tempo di risposta mediano"), m.medianMs, t.medianMs, false, (v) => `${num(v)} ms`),
    row(tr("Aperto alla ricerca AI"), yes(!m.aiSearchBlocked), yes(!t.aiSearchBlocked), true, yesNo),
    row("llms.txt", yes(m.llms), yes(t.llms), true, yesNo),
  ];
}

export type Area = "SEO" | "GEO" | "Contenuti";
export type Action = { area: Area; priority: "Alta" | "Media" | "Bassa"; text: string };

const MAX_GAP_ACTIONS = 5;

/** Concrete steps to overtake the competitor, most important first; empty when you lead everywhere. */
export function competitorActions(m: SiteSummary, t: SiteSummary, gap: ContentGap | null): Action[] {
  const out: Action[] = [];
  const behind = (mine: number, theirs: number, margin: number) => theirs - mine > margin;
  const p = (v: number) => pct.format(v);
  if (m.aiSearchBlocked && !t.aiSearchBlocked)
    out.push({ area: "GEO", priority: "Alta", text: tr("Il tuo robots.txt chiude i bot di ricerca AI, quelli del competitor no: aprili per comparire nelle risposte di ChatGPT, Claude e Perplexity.") });
  if (behind(m.health, t.health, 5))
    out.push({ area: "SEO", priority: "Alta", text: tr("Salute SEO {m} contro {t}: risolvi prima i problemi Alta e Media del report Problemi.", { m: m.health, t: t.health }) });
  for (const topic of gap?.gaps.slice(0, MAX_GAP_ACTIONS) ?? [])
    out.push({
      area: "Contenuti",
      priority: topic.pages.length > 1 ? "Alta" : "Media",
      text: tr("Il competitor copre \"{topic}\" ({n} pagine) e tu no: crea una pagina su questo argomento.", { topic: topic.label.join(", "), n: topic.pages.length }),
    });
  if (m.citability !== null && t.citability !== null && behind(m.citability, t.citability, 5))
    out.push({ area: "GEO", priority: "Media", text: tr("Citabilità AI {m} contro {t}: apri le pagine con una risposta breve e usa sottotitoli a domanda, liste e dati.", { m: m.citability, t: t.citability }) });
  if (behind(m.withAuthor, t.withAuthor, 0.15) || behind(m.withDate, t.withDate, 0.15))
    out.push({ area: "GEO", priority: "Media", text: tr("Il competitor indica autore e data su più pagine ({ta} / {td} contro {ma} / {md}): aggiungili, le AI preferiscono fonti attribuibili e aggiornate.", { ta: p(t.withAuthor), td: p(t.withDate), ma: p(m.withAuthor), md: p(m.withDate) }) });
  if (behind(m.withSchema, t.withSchema, 0.15))
    out.push({ area: "SEO", priority: "Media", text: tr("Dati strutturati sul {t} delle pagine del competitor contro il tuo {m}: aggiungi Organization, Article, FAQ o Product dove servono.", { t: p(t.withSchema), m: p(m.withSchema) }) });
  for (const d of gap?.deeper.slice(0, 3) ?? [])
    out.push({ area: "Contenuti", priority: "Media", text: tr("Approfondisci {mine}: il competitor tratta lo stesso argomento con {t} parole contro le tue {m}.", { mine: d.mine, t: num(d.theirs_words), m: num(d.mine_words) }) });
  if (behind(m.withMeta, t.withMeta, 0.15))
    out.push({ area: "SEO", priority: "Bassa", text: tr("Meta description sul {m} delle pagine contro il {t} del competitor: scrivile per le pagine principali.", { m: p(m.withMeta), t: p(t.withMeta) }) });
  if (m.medianMs !== null && t.medianMs !== null && m.medianMs > t.medianMs * 1.3)
    out.push({ area: "SEO", priority: "Bassa", text: tr("Il tuo server risponde in {m} ms contro {t} ms: attiva la cache o valuta un hosting più veloce.", { m: num(m.medianMs), t: num(t.medianMs) }) });
  if (!m.llms && t.llms)
    out.push({ area: "GEO", priority: "Bassa", text: tr("Il competitor ha un llms.txt e tu no: puoi generarlo dal crawl.") });
  const rank = { Alta: 0, Media: 1, Bassa: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/** Prompt for an AI plan to overtake the competitor, built from the comparison only. */
export function competitorPrompt(m: SiteSummary, t: SiteSummary, gap: ContentGap | null, actions: Action[]): string {
  const rows = metricRows(m, t).map((r) => `- ${r.label}: ${m.host} ${r.mine} | ${t.host} ${r.theirs}`);
  const gaps = (gap?.gaps ?? []).slice(0, 10).map((g) => `- ${g.label.join(", ")}: ${g.pages.map((p) => p.title ?? p.url).join(" | ")}`);
  const strengths = (gap?.strengths ?? []).slice(0, 5).map((g) => `- ${g.label.join(", ")}`);
  return [
    `Write a plan for ${m.host} to overtake its competitor ${t.host} in Google and in AI answers (ChatGPT, Claude, Perplexity).`,
    "Use only the data below. Group steps into: this month, next month, later. For each: what to do, which pages or topics, why it beats the competitor, effort.",
    "",
    "Side by side:",
    ...rows,
    "",
    "Topics the competitor covers and we don't:",
    ...(gaps.length ? gaps : ["- none"]),
    "",
    "Topics only we cover (keep and strengthen):",
    ...(strengths.length ? strengths : ["- none"]),
    "",
    "Steps already identified:",
    ...actions.map((a) => `- [${a.area}, ${a.priority}] ${a.text}`),
  ].join("\n");
}


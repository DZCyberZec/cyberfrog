// AI visibility tracker: for the questions people ask, does an AI answer with web search cite your
// site, where, and which sites does it cite instead? History is kept per site.

/** Mirrors `ai::SearchAnswer`. */
export type SearchAnswer = { answer: string; cited: string[]; results: string[] };

export type TrackerRun = {
  query: string;
  /** ms since epoch */
  at: number;
  engine: string;
  /** 1-based position of your site among the cited sources, null when not cited. */
  position: number | null;
  /** Your site was among the pages the search found, cited or not. */
  found: boolean;
  /** Cited hosts in order, at most MAX_SOURCES. */
  sources: string[];
  /** Start of the answer, for context. */
  excerpt: string;
};
export type TrackerSite = { queries: string[]; runs: TrackerRun[] };
/** Shape of ai_tracker.json: sites by host. */
export type TrackerData = { sites?: Record<string, TrackerSite> };

export const MAX_QUERIES = 20;
const MAX_SOURCES = 10;
const MAX_RUNS_PER_QUERY = 50;
const EXCERPT = 600;

const bare = (h: string) => h.replace(/^www\./, "").toLowerCase();

export function hostOfUrl(url: string): string {
  try {
    return bare(new URL(url).hostname);
  } catch {
    return "";
  }
}

/** Same site: the host itself or any subdomain of it. */
export const sameSite = (host: string, site: string) => {
  const [h, s] = [bare(host), bare(site)];
  return h === s || h.endsWith(`.${s}`);
};

/** Where `site` stands in one answer. */
export function evaluate(site: string, a: SearchAnswer, query: string, engine: string, at: number): TrackerRun {
  const sources = [...new Set(a.cited.map(hostOfUrl).filter(Boolean))];
  const index = sources.findIndex((h) => sameSite(h, site));
  return {
    query,
    at,
    engine,
    position: index < 0 ? null : index + 1,
    found: [...a.cited, ...a.results].some((u) => sameSite(hostOfUrl(u), site)),
    sources: sources.slice(0, MAX_SOURCES),
    excerpt: a.answer.slice(0, EXCERPT),
  };
}

/** Questions from the text box: one per line, trimmed, unique, capped. */
export function parseQueries(text: string): string[] {
  return [...new Set(text.split("\n").map((q) => q.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
}

/** Adds new runs and keeps the most recent MAX_RUNS_PER_QUERY of each question. */
export function addRuns(site: TrackerSite, runs: TrackerRun[]): TrackerSite {
  const all = [...site.runs, ...runs].sort((a, b) => b.at - a.at);
  const kept: TrackerRun[] = [];
  const per = new Map<string, number>();
  for (const r of all) {
    const n = per.get(r.query) ?? 0;
    if (n < MAX_RUNS_PER_QUERY) kept.push(r);
    per.set(r.query, n + 1);
  }
  return { ...site, runs: kept };
}

/** Newest first, per question. */
export function history(site: TrackerSite, query: string): TrackerRun[] {
  return site.runs.filter((r) => r.query === query).sort((a, b) => b.at - a.at);
}

/** Sites the latest answers cite most, besides yours: who the AI recommends instead of you. */
export function citedInstead(site: TrackerSite, host: string): { host: string; answers: number }[] {
  const counts = new Map<string, number>();
  for (const q of site.queries) {
    const last = history(site, q)[0];
    for (const h of last?.sources ?? []) if (!sameSite(h, host)) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts].map(([h, answers]) => ({ host: h, answers })).sort((a, b) => b.answers - a.answers || a.host.localeCompare(b.host));
}

/** Share of questions whose latest answer cites you, 0–1, or null before any check. */
export function visibility(site: TrackerSite): number | null {
  const lasts = site.queries.map((q) => history(site, q)[0]).filter(Boolean);
  return lasts.length ? lasts.filter((r) => r.position !== null).length / lasts.length : null;
}

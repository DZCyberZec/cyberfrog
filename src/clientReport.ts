// Client-ready report: one self-contained HTML file (print it to PDF from any browser), branded
// "Powered by Daniele Zecca – CyberZec". Every crawled string is escaped: pages are untrusted input.
import { LANG, LOCALE, tr } from "./i18n.ts";
import { botState } from "./geo.ts";
import type { Issue, StatusKind } from "./pages.ts";
import type { CrawlData } from "./crawl.ts";

export type ReportInput = {
  crawl: CrawlData;
  host: string;
  health: number;
  citability: number | null;
  indexable: number;
  htmlPages: number;
  medianMs: number | null;
  counts: Record<StatusKind, number>;
  issues: Issue[];
  /** data: URI of the CyberZec shield, so the file needs nothing else. */
  logo: string;
  date: Date;
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const PRIORITY_CLASS: Record<string, string> = { Alta: "high", Media: "medium", Bassa: "low" };
const MAX_ISSUES = 25;
const MAX_ROWS = 10;
const kind = (score: number) => (score >= 80 ? "good" : score >= 50 ? "fair" : "poor");

export function buildClientReport(r: ReportInput): string {
  const n = (v: number) => v.toLocaleString(LOCALE);
  const date = new Intl.DateTimeFormat(LOCALE, { dateStyle: "long" }).format(r.date);
  const errors = r.counts.client + r.counts.server;
  const { geo, topics } = r.crawl;
  const kpis: [string, string][] = [
    [tr("URL analizzati"), n(r.crawl.pages.length)],
    [tr("Indicizzabili"), n(r.indexable)],
    [tr("Errori 4xx/5xx"), n(errors)],
    [tr("Link rotti"), n(r.crawl.broken.length)],
    [tr("Tempo mediano"), r.medianMs === null ? "–" : `${n(r.medianMs)} ms`],
    [tr("Citabilità AI"), r.citability === null ? "–" : `${r.citability}/100`],
  ];
  const issueRows = r.issues
    .slice(0, MAX_ISSUES)
    .map(
      (i) =>
        `<tr><td><span class="pill ${PRIORITY_CLASS[i.priority]}">${esc(tr(i.priority))}</span></td><td><strong>${esc(i.label)}</strong><br><small>${esc(i.fix)}</small></td><td class="num">${n(i.count)}</td></tr>`,
    )
    .join("");
  const bots = geo.bots
    .map((b) => {
      const s = botState(b, r.htmlPages);
      const label = s === "open" ? tr("Aperto") : s === "closed" ? tr("Chiuso") : tr("Chiuso su {n} pagine", { n: b.blocked_pages });
      return `<li><i class="dot ${s}"></i>${esc(b.token)} <small>${esc(label)}</small></li>`;
    })
    .join("");
  const cannibal = topics.cannibal
    .slice(0, MAX_ROWS)
    .map((c) => `<li>${esc(c.a)}<br><small>↔ ${esc(c.b)}</small></li>`)
    .join("");
  const links = topics.suggestions
    .slice(0, MAX_ROWS)
    .map((s) => `<li>${esc(s.from)}<br><small>→ ${esc(s.to)} · “${esc(s.anchor)}”</small></li>`)
    .join("");

  return `<!doctype html>
<html lang="${LANG}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tr("Report SEO e GEO"))} · ${esc(r.host)}</title>
<style>
  :root { --text: #1b1f1c; --muted: #646b66; --border: #e3e5e1; --good: #17784a; --fair: #8a5a00; --poor: #b42318; --bg: #f6f7f5; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: var(--text); background: var(--bg); }
  main { max-width: 860px; margin: 0 auto; padding: 40px 32px; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid var(--text); padding-bottom: 16px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
  h2 { margin: 32px 0 12px; font-size: 17px; }
  small, .muted { color: var(--muted); }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); text-align: right; }
  .brand img { width: 28px; height: 28px; }
  .score { display: flex; align-items: center; gap: 20px; margin-top: 24px; }
  .ring { width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; font-size: 30px; font-weight: 700; border: 8px solid; }
  .ring.good { border-color: var(--good); color: var(--good); } .ring.fair { border-color: var(--fair); color: var(--fair); } .ring.poor { border-color: var(--poor); color: var(--poor); }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
  .kpi { padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; }
  .kpi strong { display: block; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 6px; border-top: 1px solid var(--border); vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.high { color: var(--poor); background: #fde8e6; } .pill.medium { color: var(--fair); background: #fbf0d9; } .pill.low { color: #4a5562; background: #e9edf1; }
  ul { margin: 0; padding-left: 0; list-style: none; }
  li { padding: 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
  .bots { columns: 2; } .bots li { border: 0; padding: 2px 0; }
  .dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: var(--poor); }
  .dot.open { background: var(--good); } .dot.partial { background: var(--fair); }
  footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
  @media print { body { background: #fff; } main { padding: 0; } h2 { break-after: avoid; } tr, li { break-inside: avoid; } }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>${esc(tr("Report SEO e GEO"))}</h1>
      <div class="muted">${esc(r.host)} · ${esc(date)}</div>
    </div>
    <div class="brand"><span>Powered by<br><strong>Daniele Zecca – CyberZec</strong></span><img src="${esc(r.logo)}" alt=""></div>
  </header>

  <section class="score">
    <div class="ring ${kind(r.health)}">${r.health}</div>
    <div>
      <strong>${esc(tr("Salute SEO"))}: ${r.health}/100</strong><br>
      <span class="muted">${esc(tr("{n} tipi di problema trovati su {p} pagine", { n: r.issues.length, p: n(r.crawl.pages.length) }))}</span>
    </div>
  </section>
  <section class="kpis">${kpis.map(([l, v]) => `<div class="kpi"><small>${esc(l)}</small><strong>${esc(v)}</strong></div>`).join("")}</section>

  <h2>${esc(tr("Cosa sistemare"))}</h2>
  ${issueRows ? `<table>${issueRows}</table>` : `<p class="muted">${esc(tr("Nessun problema: ottimo lavoro."))}</p>`}

  <h2>${esc(tr("Visibilità nelle AI (GEO)"))}</h2>
  <p>${esc(tr("Citabilità AI"))}: <strong>${r.citability === null ? "–" : `${r.citability}/100`}</strong> · llms.txt: <strong>${geo.llms?.check ? esc(tr("Presente")) : esc(tr("Assente"))}</strong></p>
  ${bots ? `<ul class="bots">${bots}</ul>` : ""}

  <h2>${esc(tr("Argomenti e link"))}</h2>
  <p>${esc(tr("{c} cluster di argomenti, {k} coppie in cannibalizzazione, {l} link interni da aggiungere.", { c: topics.clusters.length, k: topics.cannibal.length, l: topics.suggestions.length }))}</p>
  ${cannibal ? `<h3>${esc(tr("Pagine in cannibalizzazione"))}</h3><ul>${cannibal}</ul>` : ""}
  ${links ? `<h3>${esc(tr("Link interni da aggiungere"))}</h3><ul>${links}</ul>` : ""}

  <footer>${esc(tr("Report generato con CyberFrog – Another SEO Tool"))} · Powered by Daniele Zecca – CyberZec · cyberzec.it</footer>
</main>
</body>
</html>
`;
}

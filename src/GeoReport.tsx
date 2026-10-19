import { useMemo, useState } from "react";
import { DataTable, helperFor } from "./DataTable";
import { LOCALE, tr } from "./i18n";
import { botState, geoFilters, PURPOSE_LABEL, type GeoData, type GeoRow } from "./geo";

const row = helperFor<GeoRow>();
const COLLAPSED_KEY = "cyberfrog.geo.collapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};
const scoreKind = (n: number) => (n >= 70 ? "ok" : n >= 50 ? "redirect" : "client");
const columns = row.columns([
  row.accessor("url", { header: "URL", size: 420 }),
  row.accessor("score", {
    header: tr("Citabilità"),
    size: 100,
    cell: (c) => <span className={`badge ${scoreKind(c.getValue())}`}>{c.getValue()}</span>,
  }),
  row.accessor((r) => r.blocked_bots.length, {
    id: "blocked",
    header: tr("Bot AI bloccati"),
    size: 130,
    cell: (c) => <span title={c.row.original.blocked_bots.join(", ")}>{c.getValue() || ""}</span>,
  }),
  row.accessor((r) => (r.js_invisible ? tr("Sì") : ""), { id: "js", header: tr("Invisibile ai bot AI"), size: 140 }),
  row.accessor((r) => r.missing.join(" · "), { id: "missing", header: tr("Da migliorare"), size: 520 }),
]);

type Props = {
  geo: GeoData;
  rows: GeoRow[];
  htmlPages: number;
  initialFilter?: string;
  exportName: string;
  onGenerateLlms: () => void;
  onRowClick: (r: GeoRow) => void;
  isSelected: (r: GeoRow) => boolean;
};

/** GEO report: what AI answer engines may read on the whole site, then each page's citability. */
export function GeoReport({ geo, rows, htmlPages, onGenerateLlms, ...table }: Props) {
  const filters = useMemo(() => geoFilters(geo), [geo]);
  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  function toggle() {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {
      // not remembered, still works
    }
  }
  if (geo.bots.length === 0) {
    return <p className="empty">{tr("Questo crawl è stato fatto con una versione precedente: avvia un nuovo crawl per l'analisi GEO.")}</p>;
  }
  const scoreBadge =
    average === null ? "–" : <span className={`badge ${scoreKind(average)}`}>{average} / 100</span>;
  if (collapsed) {
    const open = geo.bots.filter((b) => botState(b, htmlPages) === "open").length;
    return (
      <div className="geo">
        <section className="geo-strip" aria-label={tr("Sito")}>
          <span>
            {tr("Citabilità media")} {scoreBadge}
          </span>
          <span>{tr("Crawler AI aperti: {n} su {total}", { n: open, total: geo.bots.length })}</span>
          <span>
            llms.txt{" "}
            {geo.llms?.check ? (
              <span className={`badge ${geo.llms.check.issues.length ? "redirect" : "ok"}`}>{tr("Presente")}</span>
            ) : (
              <span className="badge blocked">{tr("Assente")}</span>
            )}
          </span>
          <span>Content-Signal: {geo.content_signals.length ? tr("Dichiarato") : tr("Non dichiarato")}</span>
          <span className="spacer" />
          <button type="button" className="geo-toggle" onClick={toggle} aria-expanded={false}>
            {tr("Mostra riepilogo")} <span aria-hidden>▾</span>
          </button>
        </section>
        <DataTable data={rows} columns={columns} filters={filters} {...table} />
      </div>
    );
  }
  return (
    <div className="geo">
      <section className="geo-site" aria-label={tr("Sito")}>
        <div className="geo-site-head">
          <h2>{tr("Riepilogo del sito")}</h2>
          <button type="button" className="geo-toggle" onClick={toggle} aria-expanded>
            {tr("Comprimi riepilogo")} <span aria-hidden>▴</span>
          </button>
        </div>
        <div className="geo-card">
          <h3>{tr("Citabilità media")}</h3>
          <p className="geo-big">{scoreBadge}</p>
          <small>{tr("Su {n} pagine indicizzabili. Clic su una pagina per i dettagli.", { n: rows.length.toLocaleString(LOCALE) })}</small>
        </div>
        <div className="geo-card wide">
          <h3>{tr("Crawler AI in robots.txt")}</h3>
          <ul className="bots">
            {geo.bots.map((b) => {
              const state = botState(b, htmlPages);
              return (
                <li key={b.token} title={`${b.owner} · ${PURPOSE_LABEL[b.purpose]}`}>
                  <span className={`dot ${state}`} aria-hidden />
                  <span className="bot-name">{b.token}</span>
                  <span className="muted">
                    {state === "open"
                      ? tr("Aperto")
                      : state === "closed"
                        ? tr("Chiuso")
                        : tr("Chiuso su {n} pagine", { n: b.blocked_pages })}
                  </span>
                </li>
              );
            })}
          </ul>
          <small>{tr("Verde: può leggere il sito. I bot di ricerca e su richiesta servono per comparire nelle risposte AI; quelli di addestramento si possono chiudere senza perdere visibilità.")}</small>
        </div>
        <div className="geo-card">
          <h3>llms.txt</h3>
          {geo.llms?.check ? (
            <>
              <p>
                <span className={`badge ${geo.llms.check.issues.length ? "redirect" : "ok"}`}>
                  {geo.llms.check.issues.length ? tr("Presente, da sistemare") : tr("Presente")}
                </span>{" "}
                <small>{tr("{n} link", { n: geo.llms.check.links })}</small>
              </p>
              {geo.llms.check.issues.map((i) => (
                <small key={i} className="block">
                  {tr(i)}
                </small>
              ))}
            </>
          ) : (
            <p>
              <span className="badge blocked">{tr("Assente")}</span>
            </p>
          )}
          <small className="block">{tr("Facoltativo: Google lo ignora, alcuni assistenti AI lo leggono.")}</small>
          <button type="button" className="secondary gen-btn" onClick={onGenerateLlms}>
            {tr("Genera llms.txt")}
          </button>
        </div>
        <div className="geo-card">
          <h3>Content-Signal</h3>
          {geo.content_signals.length ? (
            geo.content_signals.map((c) => (
              <code key={c} className="block">
                {c}
              </code>
            ))
          ) : (
            <p className="muted">{tr("Non dichiarato")}</p>
          )}
          <small className="block">{tr("Preferenze in robots.txt per ricerca, risposte AI e addestramento.")}</small>
        </div>
      </section>
      <DataTable data={rows} columns={columns} filters={filters} {...table} />
    </div>
  );
}

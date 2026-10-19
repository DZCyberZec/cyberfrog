// Search Console report: real clicks and impressions next to the crawl, to see which pages lose traffic and why.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AiOutput, NO_KEY_TEXT, useAi } from "./AiAssist";
import { DataTable, helperFor } from "./DataTable";
import { LOCALE, tr, trError } from "./i18n";
import {
  GSC_FILTERS,
  ctrCandidates,
  ctrPrompt,
  defaultRange,
  gscRows,
  gscSummary,
  matchProperty,
  queryCannibalization,
  type CannibalQuery,
  type GscData,
  type GscRow,
  type GscSite,
  type GscSites,
  type GscStatus,
} from "./gsc";
import type { Page } from "./pages";
import type { AiEngine } from "./settings";

type Props = {
  pages: Page[];
  host: string;
  aiEngine: AiEngine;
  aiReady: boolean;
  onOpenSettings: () => void;
  /** True while the settings dialog is open; the connection is read again when it closes. */
  settingsOpen: boolean;
};

const int = new Intl.NumberFormat(LOCALE);
const pct1 = new Intl.NumberFormat(LOCALE, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pos1 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numCell = (text: string) => <span className="num">{text}</span>;

const row = helperFor<GscRow>();
const pageColumns = row.columns([
  row.accessor("url", { header: "URL", size: 420 }),
  row.accessor("clicks", { header: tr("Clic"), size: 80, cell: (c) => numCell(int.format(c.getValue())) }),
  row.accessor("impressions", { header: tr("Impressioni"), size: 110, cell: (c) => numCell(int.format(c.getValue())) }),
  row.accessor("ctr", { header: "CTR", size: 80, cell: (c) => (c.row.original.impressions ? numCell(pct1.format(c.getValue())) : "") }),
  row.accessor("position", { header: tr("Posizione"), size: 95, cell: (c) => (c.row.original.impressions ? numCell(pos1.format(c.getValue())) : "") }),
  row.accessor((r) => (r.inCrawl ? tr("Sì") : tr("No")), {
    id: "in_crawl",
    header: tr("Nel crawl"),
    size: 100,
    cell: (c) => <span className={`badge ${c.row.original.inCrawl ? "ok" : "redirect"}`}>{c.getValue()}</span>,
  }),
  row.accessor((r) => (r.indexable === null ? "" : r.indexable ? tr("Sì") : tr("No")), {
    id: "indexable",
    header: tr("Indicizzabile"),
    size: 115,
    cell: (c) => (c.getValue() ? <span className={`badge ${c.row.original.indexable ? "ok" : "client"}`}>{c.getValue()}</span> : ""),
  }),
]);

const cannibal = helperFor<CannibalQuery>();
const cannibalColumns = cannibal.columns([
  cannibal.accessor("query", { header: tr("Query"), size: 280 }),
  cannibal.accessor((r) => r.pages.length, { id: "pages", header: tr("Pagine"), size: 80, cell: (c) => numCell(String(c.getValue())) }),
  cannibal.accessor("impressions", { header: tr("Impressioni"), size: 110, cell: (c) => numCell(int.format(c.getValue())) }),
  cannibal.accessor("clicks", { header: tr("Clic"), size: 80, cell: (c) => numCell(int.format(c.getValue())) }),
  cannibal.accessor((r) => r.pages.map((p) => `${p.page} (${pos1.format(p.position)})`).join("  ·  "), {
    id: "competing",
    header: tr("Pagine in competizione (posizione)"),
    size: 760,
  }),
]);

type View = "pages" | "queries";

// a property is picked together with the account that reads it; ids are hex, so "|" splits them safely
const siteKey = (s: GscSite) => `${s.account}|${s.site_url}`;
const splitKey = (key: string) => {
  const i = key.indexOf("|");
  return { account: key.slice(0, i), site: key.slice(i + 1) };
};

export function SearchConsoleReport({ pages, host, aiEngine, aiReady, onOpenSettings, settingsOpen }: Props) {
  const [status, setStatus] = useState<GscStatus | null>(null);
  const [sites, setSites] = useState<GscSite[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [site, setSite] = useState("");
  const [range, setRange] = useState(() => defaultRange(new Date()));
  const [data, setData] = useState<GscData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("pages");
  const seq = useRef(0);
  const ai = useAi(aiEngine);
  const resetAi = ai.reset;

  const refresh = useCallback(() => {
    invoke<GscStatus>("gsc_status").then(setStatus, () => setStatus(null));
  }, []);
  useEffect(() => {
    if (!settingsOpen) refresh();
  }, [settingsOpen, refresh]);

  // read the properties again whenever an account is added or removed
  const accountIds = status?.accounts.map((a) => a.id).join(",") ?? "";
  const connected = accountIds !== "";
  const manyAccounts = (status?.accounts.length ?? 0) > 1;
  useEffect(() => {
    if (!accountIds) return;
    let alive = true;
    invoke<GscSites>("gsc_sites").then(
      ({ sites: list, failed }) => {
        if (!alive) return;
        setSites(list);
        setFailed(failed);
        setSite((cur) => {
          if (cur && list.some((s) => siteKey(s) === cur)) return cur;
          const url = matchProperty(list, host);
          const hit = url ? list.find((s) => s.site_url === url) : undefined;
          return hit ? siteKey(hit) : "";
        });
      },
      (e) => alive && setError(trError(String(e))),
    );
    return () => {
      alive = false;
    };
  }, [accountIds, host]);

  // numbers fetched for another crawl or property would be matched against the wrong pages
  useEffect(() => {
    seq.current++;
    setData(null);
    setLoading(false);
    resetAi();
  }, [pages, site, resetAi]);

  function load() {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    invoke<GscData>("gsc_query", { ...splitKey(site), start: range.start, end: range.end }).then(
      (d) => {
        if (mine !== seq.current) return;
        setData(d);
        setLoading(false);
      },
      (e) => {
        if (mine !== seq.current) return;
        setError(trError(String(e)));
        setLoading(false);
      },
    );
  }

  const rows = useMemo(() => (data ? gscRows(pages, data) : []), [pages, data]);
  const summary = useMemo(() => (data ? gscSummary(data.pages) : null), [data]);
  const cannibals = useMemo(() => (data ? queryCannibalization(data.queries) : []), [data]);
  const candidates = useMemo(() => (data ? ctrCandidates(rows, data.queries) : []), [rows, data]);

  if (!connected) {
    return (
      <div className="gsc">
        <section className="comp-card gsc-connect">
          <h2>{tr("Search Console")}</h2>
          <p className="muted">
            {tr("Collega Google Search Console per vedere clic, impressioni e posizione di ogni pagina accanto ai dati del crawl.")}
          </p>
          <div className="gsc-actions">
            <button type="button" className="go" onClick={onOpenSettings}>
              {tr("Apri Impostazioni")}
            </button>
            <button type="button" className="link" onClick={refresh}>
              {tr("Ricontrolla connessione")}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    );
  }

  const views: { id: View; label: string; count: number }[] = [
    { id: "pages", label: tr("Pagine"), count: rows.length },
    { id: "queries", label: tr("Query in cannibalizzazione"), count: cannibals.length },
  ];
  return (
    <div className="gsc">
      <section className="comp-card">
        <div className="gsc-form">
          <label>
            {tr("Proprietà")}
            <select value={site} onChange={(e) => setSite(e.currentTarget.value)}>
              <option value="">{tr("Scegli una proprietà…")}</option>
              {sites.map((s) => (
                <option key={siteKey(s)} value={siteKey(s)}>
                  {manyAccounts ? `${s.site_url} — ${s.email ?? "Google"}` : s.site_url}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("Dal")}
            <input type="date" value={range.start} max={range.end} onChange={(e) => setRange({ ...range, start: e.currentTarget.value })} />
          </label>
          <label>
            {tr("Al")}
            <input type="date" value={range.end} min={range.start} onChange={(e) => setRange({ ...range, end: e.currentTarget.value })} />
          </label>
          <button type="button" className="go" onClick={load} disabled={!site || !range.start || !range.end || loading}>
            {loading ? tr("Carico…") : tr("Carica dati")}
          </button>
        </div>
        {sites.length > 0 && !matchProperty(sites, host) && !site && (
          <small className="muted">{tr("Nessuna proprietà corrisponde a {host}: scegline una.", { host })}</small>
        )}
        {error && <p className="error">{error}</p>}
        {failed.map((f) => (
          <p key={f} className="error">
            {tr("Account non leggibile, ricollegalo nelle Impostazioni: {err}", { err: f })}
          </p>
        ))}
      </section>

      {data && summary && (
        <>
          <div className="gsc-summary">
            <div className="comp-card">
              <small className="muted">{tr("Clic")}</small>
              <strong>{int.format(summary.clicks)}</strong>
            </div>
            <div className="comp-card">
              <small className="muted">{tr("Impressioni")}</small>
              <strong>{int.format(summary.impressions)}</strong>
            </div>
            <div className="comp-card">
              <small className="muted">{tr("CTR medio")}</small>
              <strong>{pct1.format(summary.ctr)}</strong>
            </div>
            <div className="comp-card">
              <small className="muted">{tr("Posizione media")}</small>
              <strong>{pos1.format(summary.position)}</strong>
            </div>
          </div>

          <div className="gsc-bar">
            <div className="segmented" role="tablist" aria-label={tr("Vista")}>
              {views.map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={view === v.id} aria-checked={view === v.id} onClick={() => setView(v.id)}>
                  {v.label} <span className="count">{v.count}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              disabled={!aiReady || candidates.length === 0 || ai.state.status === "loading"}
              title={aiReady ? undefined : tr(NO_KEY_TEXT)}
              onClick={() => ai.run(ctrPrompt(host, candidates))}
            >
              {tr("Riscrivi title e meta con AI")}
            </button>
          </div>
          {ai.state.status !== "idle" && (
            <section className="comp-card">
              <AiOutput state={ai.state} />
            </section>
          )}

          <div className="gsc-table">
            {view === "pages" && <DataTable key="pages" data={rows} columns={pageColumns} filters={GSC_FILTERS} exportName={`${host}-search-console`} />}
            {view === "queries" && (
              <DataTable
                key="queries"
                data={cannibals}
                columns={cannibalColumns}
                exportName={`${host}-search-console-cannibalizzazione`}
                emptyText={tr("Nessuna query porta impressioni a più di una pagina.")}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

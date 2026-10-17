// The report area: the table (or view) of the chosen report, and the detail panel of the selected URL.
import { useEffect, useMemo, useState } from "react";
import { DataTable, helperFor } from "./DataTable";
import { DetailPanel } from "./DetailPanel";
import { ImagePanel } from "./ImagePanel";
import { GeoReport } from "./GeoReport";
import { TopicsReport } from "./TopicsReport";
import { SiteStructure } from "./SiteStructure";
import { Overview } from "./Overview";
import { AiOutput, NO_KEY_TEXT, useAi } from "./AiAssist";
import { planPrompt } from "./ai";
import type { AiEngine } from "./settings";
import type { CrawlData, CrawlSummary } from "./crawl";
import type { Analysis } from "./useAnalysis";
import type { Tab } from "./nav";
import { LOCALE, tr } from "./i18n";
import {
  EXTERNAL_FILTERS,
  badLinkColumns,
  brokenColumns,
  changeColumns,
  codeColumns,
  dupColumns,
  externalColumns,
  hreflangColumns,
  imageColumns,
  indexColumns,
  internalColumns,
  issueColumns,
  jsColumns,
  metaTabs,
  num,
  perfColumns,
  redirectColumns,
  schemaColumns,
  sitemapColumns,
} from "./columns";
import {
  BAD_LINK_FILTERS,
  BROKEN_FILTERS,
  CHANGE_FILTERS,
  CODE_FILTERS,
  DUP_FILTERS,
  HREFLANG_FILTERS,
  IMAGE_FILTERS,
  JS_FILTERS,
  PERF_FILTERS,
  REDIRECT_FILTERS,
  SITEMAP_FILTERS,
  compareCrawls,
  customFilters,
  customRows,
  hreflangPages,
  indexFilters,
  metaRows,
  pageIssues,
  redirectChains,
  schemaFilters,
  schemaPages,
  withExamples,
  type CrawlSnapshot,
  type CustomRow,
} from "./pages";

/** Set by clicking a problem: open that report with that filter. `seq` remounts the table. */
export type Jump = { tab: string | null; filter: string | null; seq: number };

type Props = {
  tab: Tab;
  jump: Jump;
  go: (tab: Tab, filter?: string | null) => void;
  crawl: CrawlData;
  a: Analysis;
  selected: string | null;
  select: (url: string | null) => void;
  baseline: string | null;
  baselineData: CrawlSnapshot | null;
  setBaseline: (path: string | null) => void;
  recent: CrawlSummary[];
  aiEngine: AiEngine;
  aiReady: boolean;
  onSaveSitemap: () => void;
};

const when = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

export function Reports(p: Props) {
  const { tab, jump, crawl, a, selected, select } = p;
  const { pages, path } = crawl;
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const plan = useAi(p.aiEngine);
  const resetPlan = plan.reset;
  useEffect(resetPlan, [pages, resetPlan]); // a plan belongs to the crawl it was written for
  useEffect(() => setSelectedImage(null), [pages]);

  /** Filter to open with: the one a problem pointed at, if it was for this report. */
  const initial = (t: string) => (jump.tab === t ? (jump.filter ?? undefined) : undefined);
  const k = (t: string) => `${t}-${jump.seq}`;
  const byUrl = {
    onRowClick: (r: { url: string }) => select(r.url),
    isSelected: (r: { url: string }) => r.url === selected,
  };
  const name = (suffix: string) => `${a.host}-${suffix}`;

  const metaTab = metaTabs.find((t) => t.check.field === tab);
  const metaTable = useMemo(() => (metaTab ? metaRows(pages, metaTab.check.field) : []), [pages, metaTab]);
  const hreflangRows = useMemo(() => hreflangPages(pages, crawl.hreflang), [pages, crawl.hreflang]);
  const schemaRows = useMemo(() => schemaPages(pages, crawl.structured), [pages, crawl.structured]);
  const schemaTabFilters = useMemo(() => schemaFilters(schemaRows), [schemaRows]);
  const indexTabFilters = useMemo(() => indexFilters(pages), [pages]);
  const redirectRows = useMemo(() => redirectChains(pages), [pages]);
  const changes = useMemo(
    () => (tab === "compare" && p.baselineData ? compareCrawls(p.baselineData, a.snapshot) : []),
    [tab, p.baselineData, a.snapshot],
  );
  const customTable = useMemo(() => {
    const cust = helperFor<CustomRow>();
    const { custom } = crawl;
    return {
      rows: custom.rules.length ? customRows(pages, custom) : [],
      filters: customFilters(custom.rules),
      columns: cust.columns([
        cust.accessor("url", { header: "URL", size: 420 }),
        ...custom.rules.map((r) =>
          r.kind === "search"
            ? cust.accessor((row) => Number(row.values[r.name]?.[0] ?? 0), {
                id: `rule:${r.name}`,
                header: r.name,
                size: 140,
                cell: (c) => num(c.getValue()),
              })
            : cust.accessor((row) => (row.values[r.name] ?? []).join(" | "), {
                id: `rule:${r.name}`,
                header: r.name,
                size: 280,
              }),
        ),
      ]),
    };
  }, [pages, crawl]);
  const selectedPage = useMemo(() => pages.find((pg) => pg.url === selected), [pages, selected]);
  const selectedIssues = useMemo(
    () => (selected ? pageIssues(selected, a.snapshot, a.dupRows) : []),
    [selected, a.snapshot, a.dupRows],
  );

  return (
    <div className="workspace">
      {tab === "overview" && <Overview crawl={crawl} a={a} go={p.go} />}
      {tab === "issues" && plan.state.status !== "idle" && (
        <section className="ai-plan" aria-label={tr("Piano d'azione AI")}>
          <header>
            <h2>{tr("Piano d'azione AI")}</h2>
            <button type="button" className="close" onClick={plan.reset} aria-label={tr("Chiudi piano")}>
              ✕
            </button>
          </header>
          <AiOutput state={plan.state} />
        </section>
      )}
      {tab === "issues" && (
        <DataTable
          key="issues"
          data={a.issues}
          columns={issueColumns}
          exportName={name("problemi")}
          actions={
            <button
              type="button"
              className="secondary"
              disabled={!p.aiReady || a.issues.length === 0 || plan.state.status === "loading"}
              title={p.aiReady ? undefined : tr(NO_KEY_TEXT)}
              onClick={() => plan.run(planPrompt(a.host, pages, withExamples(a.issues, a.snapshot, a.dupRows)))}
            >
              {tr("Piano d'azione AI")}
            </button>
          }
          onRowClick={(i) => p.go(i.tab as Tab, i.filter)}
        />
      )}
      {tab === "internal" && (
        <DataTable key={k("internal")} initialFilter={initial("internal")} data={pages} columns={internalColumns} exportName={name("interni")} {...byUrl} />
      )}
      {tab === "codes" && (
        <DataTable key={k("codes")} initialFilter={initial("codes")} data={pages} columns={codeColumns} filters={CODE_FILTERS} exportName={name("codici-risposta")} {...byUrl} />
      )}
      {tab === "index" && (
        <DataTable key={k("index")} initialFilter={initial("index")} data={pages} columns={indexColumns} filters={indexTabFilters} exportName={name("indicizzabilita")} {...byUrl} />
      )}
      {tab === "external" && (
        <DataTable key={k("external")} initialFilter={initial("external")} data={crawl.external} columns={externalColumns} filters={EXTERNAL_FILTERS} exportName={name("link-esterni")} />
      )}
      {tab === "broken" && (
        <DataTable
          key={k("broken")}
          initialFilter={initial("broken")}
          data={crawl.broken}
          columns={brokenColumns}
          filters={BROKEN_FILTERS}
          exportName={name("link-rotti")}
          onRowClick={(b) => select(b.source)}
          isSelected={(b) => b.source === selected}
        />
      )}
      {metaTab && (
        <DataTable
          key={k(tab)}
          initialFilter={initial(tab)}
          data={metaTable}
          columns={metaTab.columns}
          filters={metaTab.filters}
          exportName={name(tab.replace("_", "-"))}
          {...byUrl}
        />
      )}
      {tab === "compare" &&
        (p.baseline && !p.baselineData ? (
          <p className="empty">{tr("Carico il confronto…")}</p>
        ) : (
          <DataTable
            key={`compare-${p.baseline}-${jump.seq}`}
            data={changes}
            columns={changeColumns}
            filters={CHANGE_FILTERS}
            exportName={name("confronto")}
            emptyText={p.baseline ? undefined : tr("Nessun crawl precedente da confrontare. Scegline uno dal menu.")}
            onRowClick={(c) => c.kind !== "issue" && c.kind !== "removed" && select(c.key)}
            isSelected={(c) => c.key === selected}
            actions={
              <label className="compare-pick">
                {tr("Confronta con")}
                <select value={p.baseline ?? ""} onChange={(e) => p.setBaseline(e.currentTarget.value || null)}>
                  <option value="">{tr("Nessun confronto")}</option>
                  {p.recent
                    .filter((c) => c.path !== path)
                    .map((c) => (
                      <option key={c.path} value={c.path}>
                        {(c.start_url ?? tr("Crawl vuoto")) + " · " + when.format(new Date(c.modified_ms))}
                      </option>
                    ))}
                </select>
              </label>
            }
          />
        ))}
      {tab === "structure" && (
        <div className="table-pane">
          <SiteStructure pages={pages} selected={selected} onSelect={select} />
        </div>
      )}
      {tab === "redirects" && (
        <DataTable key={k("redirects")} initialFilter={initial("redirects")} data={redirectRows} columns={redirectColumns} filters={REDIRECT_FILTERS} exportName={name("redirect")} {...byUrl} />
      )}
      {tab === "custom" && (
        <DataTable
          key={`custom-${path}-${jump.seq}`}
          data={customTable.rows}
          columns={customTable.columns}
          filters={customTable.filters}
          exportName={name("personalizzati")}
          emptyText={
            crawl.custom.rules.length ? undefined : tr("Nessuna regola personalizzata. Aggiungine una in Impostazioni → Estrazione e ricerca.")
          }
          {...byUrl}
        />
      )}
      {tab === "badlinks" && (
        <DataTable
          key={k("badlinks")}
          initialFilter={initial("badlinks")}
          data={crawl.bad_links}
          columns={badLinkColumns}
          filters={BAD_LINK_FILTERS}
          exportName={name("link-non-scansionabili")}
          onRowClick={(b) => select(b.page)}
          isSelected={(b) => b.page === selected}
        />
      )}
      {tab === "sitemap" && (
        <DataTable
          key={k("sitemap")}
          initialFilter={initial("sitemap")}
          data={pages}
          columns={sitemapColumns}
          filters={SITEMAP_FILTERS}
          exportName={name("sitemap")}
          actions={
            <button type="button" className="secondary" onClick={p.onSaveSitemap}>
              {tr("Genera sitemap XML")}
            </button>
          }
          {...byUrl}
        />
      )}
      {tab === "duplicates" && (
        <DataTable key={k("duplicates")} initialFilter={initial("duplicates")} data={a.dupRows} columns={dupColumns} filters={DUP_FILTERS} exportName={name("duplicati")} {...byUrl} />
      )}
      {tab === "schema" && (
        <DataTable key={k("schema")} initialFilter={initial("schema")} data={schemaRows} columns={schemaColumns} filters={schemaTabFilters} exportName={name("dati-strutturati")} {...byUrl} />
      )}
      {tab === "hreflang" && (
        <DataTable key={k("hreflang")} initialFilter={initial("hreflang")} data={hreflangRows} columns={hreflangColumns} filters={HREFLANG_FILTERS} exportName={name("hreflang")} {...byUrl} />
      )}
      {tab === "perf" && (
        <DataTable key={k("perf")} initialFilter={initial("perf")} data={pages} columns={perfColumns} filters={PERF_FILTERS} exportName={name("prestazioni")} {...byUrl} />
      )}
      {tab === "geo" && (
        <GeoReport
          key={k("geo")}
          initialFilter={initial("geo")}
          geo={crawl.geo}
          rows={a.geoTable}
          htmlPages={a.htmlPages}
          exportName={name("geo")}
          {...byUrl}
        />
      )}
      {tab === "topics" && (
        <TopicsReport key={k("topics")} initialFilter={initial("topics")} topics={crawl.topics} exportName={name("argomenti")} selected={selected} select={select} />
      )}
      {tab === "js" && (
        <DataTable
          key={k("js")}
          initialFilter={initial("js")}
          data={pages}
          columns={jsColumns}
          filters={JS_FILTERS}
          emptyText={
            pages.some((pg) => pg.rendered || pg.render_error !== null)
              ? undefined
              : tr("Attiva Rendering JavaScript nelle Impostazioni e avvia un nuovo crawl.")
          }
          exportName={name("javascript")}
          {...byUrl}
        />
      )}
      {tab === "images" && (
        <DataTable
          key={k("images")}
          initialFilter={initial("images")}
          data={crawl.images}
          columns={imageColumns}
          filters={IMAGE_FILTERS}
          exportName={name("immagini")}
          onRowClick={(i) => setSelectedImage(i.src)}
          isSelected={(i) => i.src === selectedImage}
        />
      )}
      {tab === "images" && selectedImage && path && (
        <ImagePanel
          crawlPath={path}
          src={selectedImage}
          onClose={() => setSelectedImage(null)}
          onOpenPage={(page) => {
            select(page);
            p.go("internal");
          }}
        />
      )}
      {tab !== "images" && tab !== "overview" && selected && path && (
        <DetailPanel
          crawlPath={path}
          url={selected}
          page={selectedPage}
          issues={selectedIssues}
          aiEngine={p.aiEngine}
          aiReady={p.aiReady}
          onClose={() => select(null)}
          onNavigate={select}
        />
      )}
    </div>
  );
}

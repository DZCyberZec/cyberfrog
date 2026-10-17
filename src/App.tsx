import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { DataTable, helperFor } from "./DataTable";
import { DetailPanel } from "./DetailPanel";
import { ImagePanel } from "./ImagePanel";
import { SettingsDialog } from "./SettingsDialog";
import { loadSettings, saveSettings, type Settings } from "./settings";
import {
  BROKEN_FILTERS,
  CHECKS,
  CODE_FILTERS,
  IMAGE_FILTERS,
  LARGE_IMAGE_BYTES,
  SITEMAP_FILTERS,
  buildSitemapXml,
  codeLabel,
  formatBytes,
  kindOf,
  statusFilters,
  indexFilters,
  metaFilters,
  nonIndexableReason,
  metaRows,
  statusKind,
  statusLabel,
  type BrokenLink,
  type Check,
  type ExternalLink,
  type ImageRow,
  type MetaRow,
  type Page,
} from "./pages";
import "./App.css";

const num = (v: number | null) => <span className="num">{v ?? ""}</span>;

const page = helperFor<Page>();
const statusColumn = page.accessor(statusLabel, {
  id: "status",
  header: "Stato",
  size: 150,
  cell: (c) => <span className={`badge ${statusKind(c.row.original)}`}>{c.getValue()}</span>,
});
const indexableColumn = page.accessor((p) => (nonIndexableReason(p) === null ? "Sì" : "No"), {
  id: "indexable",
  header: "Indicizzabile",
  size: 115,
  cell: (c) => <span className={`badge ${c.getValue() === "Sì" ? "ok" : "client"}`}>{c.getValue()}</span>,
});
const reasonColumn = page.accessor((p) => nonIndexableReason(p) ?? "", {
  id: "reason",
  header: "Motivo",
  size: 190,
});
const internalColumns = page.columns([
  page.accessor("url", { header: "URL", size: 420 }),
  statusColumn,
  indexableColumn,
  reasonColumn,
  page.accessor("title", { header: "Title", size: 280 }),
  page.accessor("meta_description", { header: "Meta description", size: 300 }),
  page.accessor("h1", { header: "H1", size: 240 }),
  page.accessor("canonical", { header: "Canonical", size: 300 }),
  page.accessor("meta_robots", { header: "Meta robots", size: 140 }),
  page.accessor("x_robots_tag", { header: "X-Robots-Tag", size: 160 }),
  page.accessor("word_count", { header: "Parole", size: 80, cell: (c) => num(c.getValue()) }),
  page.accessor("depth", { header: "Profondità", size: 95, cell: (c) => num(c.getValue()) }),
  page.accessor("inlinks", { header: "Inlink", size: 75, cell: (c) => num(c.getValue()) }),
  page.accessor("outlinks", { header: "Outlink", size: 85, cell: (c) => num(c.getValue()) }),
  page.accessor("external_outlinks", { header: "Outlink esterni", size: 125, cell: (c) => num(c.getValue()) }),
  page.accessor("content_type", { header: "Content type", size: 180 }),
  page.accessor("redirect_to", { header: "Redirect a", size: 300 }),
]);
const codeColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  page.accessor("redirect_to", { header: "Redirect a", size: 360 }),
  page.accessor("content_type", { header: "Content type", size: 180 }),
  page.accessor("inlinks", { header: "Inlink", size: 75, cell: (c) => num(c.getValue()) }),
]);

const sitemapColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  indexableColumn,
  page.accessor((p) => (p.in_sitemap ? "Sì" : "No"), { id: "in_sitemap", header: "Nella sitemap", size: 120 }),
  page.accessor("inlinks", { header: "Inlink", size: 75, cell: (c) => num(c.getValue()) }),
  page.accessor("depth", { header: "Profondità", size: 95, cell: (c) => num(c.getValue()) }),
]);

const indexColumns = page.columns([
  page.accessor("url", { header: "URL", size: 420 }),
  statusColumn,
  indexableColumn,
  reasonColumn,
  page.accessor("meta_robots", { header: "Meta robots", size: 170 }),
  page.accessor("x_robots_tag", { header: "X-Robots-Tag", size: 170 }),
  page.accessor("canonical", { header: "Canonical", size: 380 }),
]);

/** Status badge for rows that carry only a code and maybe an error. */
const codeCell = (status: number | null, error: string | null) => (
  <span className={`badge ${kindOf(status)}`}>{codeLabel(status, error)}</span>
);

const ext = helperFor<ExternalLink>();
const externalColumns = ext.columns([
  ext.accessor("url", { header: "URL", size: 520 }),
  ext.accessor((e) => codeLabel(e.status, e.error), {
    id: "status",
    header: "Stato",
    size: 170,
    cell: (c) => codeCell(c.row.original.status, c.row.original.error),
  }),
  ext.accessor("content_type", { header: "Content type", size: 200 }),
  ext.accessor("inlinks", { header: "Inlink", size: 75, cell: (c) => num(c.getValue()) }),
]);
const EXTERNAL_FILTERS = statusFilters<ExternalLink>();

const broke = helperFor<BrokenLink>();
const brokenColumns = broke.columns([
  broke.accessor("source", { header: "Pagina di origine", size: 380 }),
  broke.accessor("target", { header: "Link rotto", size: 380 }),
  broke.accessor("anchor", { header: "Anchor text", size: 220 }),
  broke.accessor((b) => codeLabel(b.status, b.error), {
    id: "status",
    header: "Stato",
    size: 170,
    cell: (c) => codeCell(c.row.original.status, c.row.original.error),
  }),
  broke.accessor((b) => (b.external ? "Esterno" : "Interno"), { id: "kind", header: "Tipo", size: 90 }),
]);

const img = helperFor<ImageRow>();
const imageColumns = img.columns([
  img.accessor("src", { header: "Immagine", size: 460 }),
  img.accessor((i) => codeLabel(i.status, i.error), {
    id: "status",
    header: "Stato",
    size: 130,
    cell: (c) => codeCell(c.row.original.status, c.row.original.error),
  }),
  img.accessor("bytes", {
    header: "Peso (byte)",
    size: 110,
    cell: (c) => (
      <span className={`num${(c.getValue() ?? 0) > LARGE_IMAGE_BYTES ? " heavy" : ""}`}>{formatBytes(c.getValue())}</span>
    ),
  }),
  img.accessor("alt", { header: "Alt text", size: 260 }),
  img.accessor("pages", { header: "Pagine", size: 80, cell: (c) => num(c.getValue()) }),
  img.accessor("missing_alt", { header: "Alt mancante", size: 115, cell: (c) => num(c.getValue()) }),
  img.accessor("missing_size", { header: "Senza dimensioni", size: 140, cell: (c) => num(c.getValue()) }),
  img.accessor("content_type", { header: "Content type", size: 140 }),
]);

const meta = helperFor<MetaRow>();
const metaTabs = CHECKS.map((check) => ({
  check,
  filters: metaFilters(check),
  columns: meta.columns([
    meta.accessor("url", { header: "URL", size: 420 }),
    meta.accessor("value", { header: check.label, size: 460 }),
    meta.accessor("length", { header: "Lunghezza", size: 95, cell: (c) => num(c.getValue()) }),
    meta.accessor("occurrences", { header: "Occorrenze", size: 105, cell: (c) => num(c.getValue()) }),
  ]),
}));

type Tab = "internal" | "codes" | "index" | "external" | "broken" | "images" | "sitemap" | Check["field"];
const TABS: { id: Tab; label: string }[] = [
  { id: "internal", label: "Interni" },
  { id: "codes", label: "Codici di risposta" },
  { id: "index", label: "Indicizzabilità" },
  { id: "external", label: "Link esterni" },
  { id: "broken", label: "Link rotti" },
  { id: "images", label: "Immagini" },
  { id: "sitemap", label: "Sitemap" },
  ...CHECKS.map((c) => ({ id: c.field, label: c.label })),
];

const fmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const when = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });

/** Mirror the Rust structs in src-tauri/src/lib.rs and crawler.rs. */
type CrawlData = {
  path: string;
  pages: Page[];
  external: ExternalLink[];
  broken: BrokenLink[];
  images: ImageRow[];
};
type CrawlSummary = { path: string; start_url: string | null; pages: number; modified_ms: number };
type Progress = { stage: "pages" | "external" | "images"; done: number; pending: number };
const STAGE_LABEL: Record<Progress["stage"], string> = {
  pages: "URL analizzati",
  external: "Link esterni verificati",
  images: "Immagini verificate",
};

const SQLITE_FILTER = [{ name: "Crawl CyberFrog", extensions: ["sqlite"] }];

export default function App() {
  const [url, setUrl] = useState("https://");
  const [pages, setPages] = useState<Page[]>([]);
  const [external, setExternal] = useState<ExternalLink[]>([]);
  const [broken, setBroken] = useState<BrokenLink[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [crawlPath, setCrawlPath] = useState<string | null>(null);
  const [recent, setRecent] = useState<CrawlSummary[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("internal");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshRecent = useCallback(() => {
    invoke<CrawlSummary[]>("list_crawls").then(setRecent, () => setRecent([]));
  }, []);
  useEffect(refreshRecent, [refreshRecent]);

  function show(data: CrawlData) {
    setPages(data.pages);
    setExternal(data.external);
    setBroken(data.broken);
    setImages(data.images);
    setSelected(null);
    setSelectedImage(null);
    setCrawlPath(data.path);
    if (data.pages[0]) setUrl(data.pages[0].url);
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setNotice(null);
    setElapsed(null);
    setProgress({ stage: "pages", done: 0, pending: 1 });
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = setProgress;
    const t0 = performance.now();
    try {
      show(await invoke<CrawlData>("start_crawl", { url, settings, onProgress }));
      setElapsed((performance.now() - t0) / 1000);
      refreshRecent();
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function openCrawl(path?: string) {
    setError(null);
    setNotice(null);
    const picked = path ?? (await open({ multiple: false, directory: false, filters: SQLITE_FILTER }));
    if (typeof picked !== "string") return;
    try {
      show(await invoke<CrawlData>("open_crawl", { path: picked }));
      setElapsed(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveSitemap() {
    setError(null);
    setNotice(null);
    const to = await save({ defaultPath: "sitemap.xml", filters: [{ name: "Sitemap XML", extensions: ["xml"] }] });
    if (!to) return;
    try {
      await invoke("write_text_file", { path: to, contents: buildSitemapXml(pages) });
      setNotice(`Sitemap salvata in ${to}`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function saveCrawlAs() {
    if (!crawlPath) return;
    setError(null);
    setNotice(null);
    const to = await save({ defaultPath: `${host}.sqlite`, filters: SQLITE_FILTER });
    if (!to) return;
    try {
      await invoke("save_crawl_as", { from: crawlPath, to });
      setNotice(`Crawl salvato in ${to}`);
    } catch (err) {
      setError(String(err));
    }
  }

  const counts = useMemo(() => {
    const c = { ok: 0, redirect: 0, client: 0, server: 0, blocked: 0, none: 0 };
    for (const p of pages) c[statusKind(p)]++;
    return c;
  }, [pages]);

  const indexable = useMemo(() => pages.filter((p) => nonIndexableReason(p) === null).length, [pages]);
  const indexTabFilters = useMemo(() => indexFilters(pages), [pages]);
  const metaTab = metaTabs.find((t) => t.check.field === tab);
  const rows = useMemo(() => (metaTab ? metaRows(pages, metaTab.check.field) : []), [pages, metaTab]);
  const host = pages[0] ? new URL(pages[0].url).hostname : "crawl";
  /** Row selection for tables whose rows carry a crawled `url`: opens the detail panel. */
  const selectByUrl = {
    onRowClick: (r: { url: string }) => setSelected(r.url),
    isSelected: (r: { url: string }) => r.url === selected,
  };

  return (
    <main className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          CyberFrog
        </div>
        <form onSubmit={start}>
          <label htmlFor="start-url" className="visually-hidden">
            URL di partenza
          </label>
          <input
            id="start-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            placeholder="https://esempio.it"
            disabled={running}
          />
          <button type="submit" disabled={running}>
            {running ? "Scansione…" : "Avvia"}
          </button>
        </form>
        <div className="file-actions">
          <button type="button" className="ghost" onClick={() => setSettingsOpen(true)} disabled={running}>
            Impostazioni
          </button>
          <button type="button" className="ghost" onClick={() => openCrawl()} disabled={running}>
            Apri…
          </button>
          <button type="button" className="ghost" onClick={saveCrawlAs} disabled={running || !crawlPath}>
            Salva come…
          </button>
        </div>
      </header>
      <div className={`progress ${running ? "on" : ""}`} aria-hidden />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {running ? (
        <section className="hero" aria-live="polite">
          <h1>Scansione in corso…</h1>
          <p className="big-number">{(progress?.done ?? 0).toLocaleString("it-IT")}</p>
          <p>
            {STAGE_LABEL[progress?.stage ?? "pages"]}
            {progress && progress.pending > 0 && ` · ${progress.pending.toLocaleString("it-IT")} in coda`}
          </p>
        </section>
      ) : pages.length === 0 ? (
        <section className="hero">
          <h1>Scansiona un sito</h1>
          <p>Inserisci un URL e premi Avvia. CyberFrog segue i link dello stesso dominio e rispetta robots.txt.</p>
          {recent.length > 0 && (
            <div className="recent">
              <h2>Crawl recenti</h2>
              <ul>
                {recent.map((c) => (
                  <li key={c.path}>
                    <button type="button" onClick={() => openCrawl(c.path)}>
                      <span className="recent-url">{c.start_url ?? "Crawl vuoto"}</span>
                      <span className="recent-meta">
                        {c.pages.toLocaleString("it-IT")} URL · {when.format(new Date(c.modified_ms))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="stats" role="status">
            <Stat label="URL" value={pages.length} />
            <Stat label="Indicizzabili" value={indexable} kind="ok" />
            <Stat label="2xx" value={counts.ok} kind="ok" />
            <Stat label="3xx" value={counts.redirect} kind="redirect" />
            <Stat label="4xx" value={counts.client} kind="client" />
            <Stat label="5xx" value={counts.server} kind="server" />
            <Stat label="Bloccati" value={counts.blocked} kind="blocked" />
            <Stat label="Link rotti" value={broken.length} kind={broken.length ? "client" : undefined} />
            {elapsed !== null && <span className="time">{fmt.format(elapsed)} s</span>}
          </div>

          <nav className="tabs" role="tablist" aria-label="Report">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === "broken" && broken.length > 0 && <span className="count">{broken.length}</span>}
              </button>
            ))}
          </nav>

          <div className="workspace">
            {tab === "internal" && (
              <DataTable
                key="internal"
                data={pages}
                columns={internalColumns}
                exportName={`${host}-interni`}
                {...selectByUrl}
              />
            )}
            {tab === "codes" && (
              <DataTable
                key="codes"
                data={pages}
                columns={codeColumns}
                filters={CODE_FILTERS}
                exportName={`${host}-codici-risposta`}
                {...selectByUrl}
              />
            )}
            {tab === "index" && (
              <DataTable
                key="index"
                data={pages}
                columns={indexColumns}
                filters={indexTabFilters}
                exportName={`${host}-indicizzabilita`}
                {...selectByUrl}
              />
            )}
            {tab === "external" && (
              <DataTable
                key="external"
                data={external}
                columns={externalColumns}
                filters={EXTERNAL_FILTERS}
                exportName={`${host}-link-esterni`}
              />
            )}
            {tab === "broken" && (
              <DataTable
                key="broken"
                data={broken}
                columns={brokenColumns}
                filters={BROKEN_FILTERS}
                exportName={`${host}-link-rotti`}
                onRowClick={(b) => setSelected(b.source)}
                isSelected={(b) => b.source === selected}
              />
            )}
            {metaTab && (
              <DataTable
                key={tab}
                data={rows}
                columns={metaTab.columns}
                filters={metaTab.filters}
                exportName={`${host}-${tab.replace("_", "-")}`}
                {...selectByUrl}
              />
            )}
            {tab === "sitemap" && (
              <DataTable
                key="sitemap"
                data={pages}
                columns={sitemapColumns}
                filters={SITEMAP_FILTERS}
                exportName={`${host}-sitemap`}
                actions={
                  <button type="button" className="secondary" onClick={saveSitemap}>
                    Genera sitemap XML
                  </button>
                }
                {...selectByUrl}
              />
            )}
            {tab === "images" && (
              <DataTable
                key="images"
                data={images}
                columns={imageColumns}
                filters={IMAGE_FILTERS}
                exportName={`${host}-immagini`}
                onRowClick={(i) => setSelectedImage(i.src)}
                isSelected={(i) => i.src === selectedImage}
              />
            )}
            {tab === "images" && selectedImage && crawlPath && (
              <ImagePanel
                crawlPath={crawlPath}
                src={selectedImage}
                onClose={() => setSelectedImage(null)}
                onOpenPage={(page) => {
                  setSelected(page);
                  setTab("internal");
                }}
              />
            )}
            {tab !== "images" && selected && crawlPath && (
              <DetailPanel
                crawlPath={crawlPath}
                url={selected}
                onClose={() => setSelected(null)}
                onNavigate={setSelected}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, kind }: { label: string; value: number; kind?: string }) {
  return (
    <span className={`stat ${kind ?? ""}`}>
      <strong>{value.toLocaleString("it-IT")}</strong> {label}
    </span>
  );
}

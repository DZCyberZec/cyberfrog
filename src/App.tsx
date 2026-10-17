import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import cyberzecShield from "./assets/cyberzec-shield.png";
import cyberfrogLogo from "./assets/cyberfrog-logo.png";
import { DataTable, helperFor } from "./DataTable";
import { DetailPanel } from "./DetailPanel";
import { ImagePanel } from "./ImagePanel";
import { SettingsDialog } from "./SettingsDialog";
import { ListDialog, countUrls } from "./ListDialog";
import { SchedulesDialog } from "./SchedulesDialog";
import { AiOutput, NO_KEY_TEXT, useAi } from "./AiAssist";
import { isAiReady, type AiStatus } from "./AiSettings";
import { planPrompt } from "./ai";
import { SiteStructure } from "./SiteStructure";
import { loadSettings, saveSettings, type Settings } from "./settings";
import {
  BROKEN_FILTERS,
  CHECKS,
  CODE_FILTERS,
  IMAGE_FILTERS,
  LARGE_IMAGE_BYTES,
  SITEMAP_FILTERS,
  PERF_FILTERS,
  JS_FILTERS,
  jsLinks,
  jsWords,
  SLOW_MS,
  HREFLANG_FILTERS,
  hreflangIssues,
  hreflangPages,
  schemaFilters,
  schemaPages,
  DUP_FILTERS,
  dupPages,
  allIssues,
  pageIssues,
  withExamples,
  compareCrawls,
  CHANGE_FILTERS,
  CHANGE_LABEL,
  type Change,
  type CrawlSnapshot,
  BAD_LINK_FILTERS,
  badLinkReason,
  customFilters,
  customRows,
  REDIRECT_FILTERS,
  redirectChains,
  type RedirectChain,
  type CustomData,
  type CustomRow,
  type BadLinkRow,
  type Issue,
  buildSitemapXml,
  medianMs,
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
  type HreflangPage,
  type HreflangRow,
  type SchemaPage,
  type DupPage,
  type StructuredRow,
  type ImageRow,
  type MetaRow,
  type Page,
} from "./pages";
import "./App.css";
import { LANG, LOCALE, setLang, tr, trError } from "./i18n";

const num = (v: number | null) => <span className="num">{v ?? ""}</span>;
const ms = (v: number | null) => <span className={`num${(v ?? 0) > SLOW_MS ? " heavy" : ""}`}>{v ?? ""}</span>;

const page = helperFor<Page>();
const statusColumn = page.accessor(statusLabel, {
  id: "status",
  header: tr("Stato"),
  size: 150,
  cell: (c) => <span className={`badge ${statusKind(c.row.original)}`}>{c.getValue()}</span>,
});
const indexableColumn = page.accessor((p) => (nonIndexableReason(p) === null ? tr("Sì") : tr("No")), {
  id: "indexable",
  header: tr("Indicizzabile"),
  size: 115,
  cell: (c) => <span className={`badge ${c.getValue() === tr("Sì") ? "ok" : "client"}`}>{c.getValue()}</span>,
});
const reasonColumn = page.accessor((p) => nonIndexableReason(p) ?? "", {
  id: "reason",
  header: tr("Motivo"),
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
  page.accessor("word_count", { header: tr("Parole"), size: 80, cell: (c) => num(c.getValue()) }),
  page.accessor("depth", { header: tr("Profondità"), size: 95, cell: (c) => num(c.getValue()) }),
  page.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
  page.accessor("link_score", { header: tr("Link Score"), size: 95, cell: (c) => num(c.getValue()) }),
  page.accessor("outlinks", { header: tr("Outlink"), size: 85, cell: (c) => num(c.getValue()) }),
  page.accessor("external_outlinks", { header: tr("Outlink esterni"), size: 125, cell: (c) => num(c.getValue()) }),
  page.accessor("response_ms", { header: tr("Tempo (ms)"), size: 100, cell: (c) => ms(c.getValue()) }),
  page.accessor("size_bytes", { header: tr("Peso"), size: 90, cell: (c) => <span className="num">{formatBytes(c.getValue())}</span> }),
  page.accessor("content_type", { header: "Content type", size: 180 }),
  page.accessor("redirect_to", { header: tr("Redirect a"), size: 300 }),
]);
const perfColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  page.accessor("response_ms", { header: tr("Tempo (ms)"), size: 110, cell: (c) => ms(c.getValue()) }),
  page.accessor("size_bytes", { header: tr("Peso"), size: 100, cell: (c) => <span className="num">{formatBytes(c.getValue())}</span> }),
  page.accessor("content_type", { header: "Content type", size: 200 }),
  page.accessor("word_count", { header: tr("Parole"), size: 80, cell: (c) => num(c.getValue()) }),
]);
const jsColumns = page.columns([
  page.accessor("url", { header: "URL", size: 420 }),
  statusColumn,
  page.accessor("raw_word_count", { header: tr("Parole HTML"), size: 105, cell: (c) => num(c.getValue()) }),
  page.accessor("word_count", { header: tr("Parole renderizzate"), size: 150, cell: (c) => num(c.getValue()) }),
  page.accessor(jsWords, { id: "js_words", header: tr("Parole da JS"), size: 110, cell: (c) => num(c.getValue()) }),
  page.accessor("raw_links", { header: tr("Link HTML"), size: 95, cell: (c) => num(c.getValue()) }),
  page.accessor((p) => p.outlinks + p.external_outlinks, { id: "rendered_links", header: tr("Link renderizzati"), size: 135, cell: (c) => num(c.getValue()) }),
  page.accessor(jsLinks, { id: "js_links", header: tr("Link da JS"), size: 95, cell: (c) => num(c.getValue()) }),
  page.accessor("render_error", { header: tr("Errore di rendering"), size: 260 }),
]);
const codeColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  page.accessor("redirect_to", { header: tr("Redirect a"), size: 360 }),
  page.accessor("content_type", { header: "Content type", size: 180 }),
  page.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
]);

const sitemapColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  indexableColumn,
  page.accessor((p) => (p.in_sitemap ? tr("Sì") : tr("No")), { id: "in_sitemap", header: tr("Nella sitemap"), size: 120 }),
  page.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
  page.accessor("depth", { header: tr("Profondità"), size: 95, cell: (c) => num(c.getValue()) }),
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
    header: tr("Stato"),
    size: 170,
    cell: (c) => codeCell(c.row.original.status, c.row.original.error),
  }),
  ext.accessor("content_type", { header: "Content type", size: 200 }),
  ext.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
]);
const EXTERNAL_FILTERS = statusFilters<ExternalLink>();

const broke = helperFor<BrokenLink>();
const brokenColumns = broke.columns([
  broke.accessor("source", { header: tr("Pagina di origine"), size: 380 }),
  broke.accessor("target", { header: tr("Link rotto"), size: 380 }),
  broke.accessor("anchor", { header: "Anchor text", size: 220 }),
  broke.accessor((b) => codeLabel(b.status, b.error), {
    id: "status",
    header: tr("Stato"),
    size: 170,
    cell: (c) => codeCell(c.row.original.status, c.row.original.error),
  }),
  broke.accessor((b) => (b.external ? tr("Esterno") : tr("Interno")), { id: "kind", header: tr("Tipo"), size: 90 }),
]);

const img = helperFor<ImageRow>();
const imageColumns = img.columns([
  img.accessor("src", { header: tr("Immagine"), size: 460 }),
  img.accessor((i) => codeLabel(i.status, i.error), {
    id: "status",
    header: tr("Stato"),
    size: 130,
    cell: (c) => codeCell(c.row.original.status, c.row.original.error),
  }),
  img.accessor("bytes", {
    header: tr("Peso (byte)"),
    size: 110,
    cell: (c) => (
      <span className={`num${(c.getValue() ?? 0) > LARGE_IMAGE_BYTES ? " heavy" : ""}`}>{formatBytes(c.getValue())}</span>
    ),
  }),
  img.accessor("alt", { header: "Alt text", size: 260 }),
  img.accessor("pages", { header: tr("Pagine"), size: 80, cell: (c) => num(c.getValue()) }),
  img.accessor("missing_alt", { header: tr("Alt mancante"), size: 115, cell: (c) => num(c.getValue()) }),
  img.accessor("missing_size", { header: tr("Senza dimensioni"), size: 140, cell: (c) => num(c.getValue()) }),
  img.accessor("content_type", { header: "Content type", size: 140 }),
]);

const hl = helperFor<HreflangPage>();
const hreflangColumns = hl.columns([
  hl.accessor("url", { header: "URL", size: 420 }),
  hl.accessor("langs", { header: tr("Lingue"), size: 240 }),
  hl.accessor("count", { header: tr("Annotazioni"), size: 110, cell: (c) => num(c.getValue()) }),
  hl.accessor(hreflangIssues, {
    id: "issues",
    header: tr("Problemi"),
    size: 420,
    cell: (c) => (c.getValue() ? <span className="issue">{c.getValue()}</span> : <span className="badge ok">OK</span>),
  }),
]);

const sd = helperFor<SchemaPage>();
const schemaColumns = sd.columns([
  sd.accessor("url", { header: "URL", size: 420 }),
  sd.accessor((r) => r.types.join(", "), { id: "types", header: tr("Tipi schema.org"), size: 300 }),
  sd.accessor("formats", { header: tr("Formato"), size: 140 }),
  sd.accessor("issues", {
    header: tr("Problemi"),
    size: 400,
    cell: (c) => (c.getValue() ? <span className="issue">{c.getValue()}</span> : ""),
  }),
]);

const pct = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });
const dup = helperFor<DupPage>();
const dupColumns = dup.columns([
  dup.accessor("url", { header: "URL", size: 420 }),
  dup.accessor("word_count", { header: tr("Parole"), size: 80, cell: (c) => num(c.getValue()) }),
  dup.accessor("exact", { header: tr("Duplicati esatti"), size: 130, cell: (c) => num(c.getValue()) }),
  dup.accessor("near", { header: tr("Quasi duplicati"), size: 130, cell: (c) => num(c.getValue()) }),
  dup.accessor("similarity", {
    header: tr("Similarità max"),
    size: 125,
    cell: (c) => {
      const v = c.getValue();
      return <span className={`num${v !== null && v >= 0.9 ? " heavy" : ""}`}>{v === null ? "" : pct.format(v)}</span>;
    },
  }),
  dup.accessor("closest", { header: tr("Pagina più simile"), size: 380 }),
]);

const PRIORITY_BADGE: Record<Issue["priority"], string> = { Alta: "client", Media: "redirect", Bassa: "blocked" };
const iss = helperFor<Issue>();
const issueColumns = iss.columns([
  iss.accessor("priority", {
    header: tr("Priorità"),
    size: 95,
    cell: (c) => <span className={`badge ${PRIORITY_BADGE[c.getValue()]}`}>{tr(c.getValue())}</span>,
  }),
  iss.accessor("label", { header: tr("Problema"), size: 320 }),
  iss.accessor("count", { header: "URL", size: 70, cell: (c) => num(c.getValue()) }),
  iss.accessor((i) => TABS.find((t) => t.id === i.tab)?.label ?? i.tab, { id: "report", header: tr("Report"), size: 150 }),
  iss.accessor("fix", { header: tr("Cosa fare"), size: 520 }),
]);

const CHANGE_BADGE: Record<Change["kind"], string> = {
  added: "ok",
  removed: "client",
  status: "redirect",
  indexability: "redirect",
  title: "blocked",
  meta_description: "blocked",
  h1: "blocked",
  canonical: "blocked",
  issue: "server",
};
const chg = helperFor<Change>();
const changeColumns = chg.columns([
  chg.accessor((c) => CHANGE_LABEL[c.kind], {
    id: "kind",
    header: tr("Cambiamento"),
    size: 200,
    cell: (c) => <span className={`badge ${CHANGE_BADGE[c.row.original.kind]}`}>{c.getValue()}</span>,
  }),
  chg.accessor("key", { header: tr("URL o problema"), size: 440 }),
  chg.accessor("before", { header: tr("Prima"), size: 300 }),
  chg.accessor("after", { header: tr("Dopo"), size: 300 }),
]);

const rdr = helperFor<RedirectChain>();
const redirectColumns = rdr.columns([
  rdr.accessor("url", { header: "URL", size: 380 }),
  rdr.accessor("hops", { header: tr("Hop"), size: 70, cell: (c) => num(c.getValue()) }),
  rdr.accessor((r) => r.chain.join("  →  "), { id: "chain", header: tr("Catena"), size: 520 }),
  rdr.accessor("final", { header: tr("Destinazione finale"), size: 360 }),
  rdr.accessor("finalStatus", {
    header: tr("Stato finale"),
    size: 120,
    cell: (c) => {
      const r = c.row.original;
      const kind = r.loop || r.finalStatus.startsWith("4") || r.finalStatus.startsWith("5") ? "client" : r.finalStatus === "200" ? "ok" : "blocked";
      return c.getValue() ? <span className={`badge ${kind}`}>{c.getValue()}</span> : "";
    },
  }),
  rdr.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
]);

const bad = helperFor<BadLinkRow>();
const badLinkColumns = bad.columns([
  bad.accessor("page", { header: tr("Pagina"), size: 400 }),
  bad.accessor("raw", { header: tr("Link"), size: 340 }),
  bad.accessor((b) => badLinkReason(b.reason), { id: "reason", header: tr("Motivo"), size: 320 }),
  bad.accessor((b) => (b.kind === "invalid" ? tr("URL non validi") : tr("Non scansionabili")), {
    id: "kind",
    header: tr("Tipo"),
    size: 150,
  }),
]);

const meta = helperFor<MetaRow>();
const metaTabs = CHECKS.map((check) => ({
  check,
  filters: metaFilters(check),
  columns: meta.columns([
    meta.accessor("url", { header: "URL", size: 420 }),
    meta.accessor("value", { header: check.label, size: 460 }),
    meta.accessor("length", { header: tr("Lunghezza"), size: 95, cell: (c) => num(c.getValue()) }),
    meta.accessor("occurrences", { header: tr("Occorrenze"), size: 105, cell: (c) => num(c.getValue()) }),
  ]),
}));

type Tab =
  | "issues"
  | "compare"
  | "internal"
  | "codes"
  | "index"
  | "external"
  | "broken"
  | "badlinks"
  | "redirects"
  | "structure"
  | "custom"
  | "images"
  | "sitemap"
  | "perf"
  | "js"
  | "hreflang"
  | "schema"
  | "duplicates"
  | Check["field"];
/** Reports grouped as in the sidebar. */
const GROUPS: { label: string; items: { id: Tab; label: string }[] }[] = [
  {
    label: tr("Panoramica"),
    items: [
      { id: "issues", label: tr("Problemi") },
      { id: "compare", label: tr("Confronto") },
    ],
  },
  {
    label: tr("Pagine"),
    items: [
      { id: "internal", label: tr("Interni") },
      { id: "structure", label: tr("Struttura") },
      { id: "codes", label: tr("Codici di risposta") },
      { id: "redirects", label: tr("Redirect") },
      { id: "index", label: tr("Indicizzabilità") },
      { id: "perf", label: tr("Prestazioni") },
      { id: "js", label: "JavaScript" },
      { id: "duplicates", label: tr("Duplicati") },
    ],
  },
  {
    label: tr("Contenuti"),
    items: [
      ...CHECKS.map((c) => ({ id: c.field, label: c.label })),
      { id: "schema", label: tr("Dati strutturati") },
      { id: "hreflang", label: tr("Hreflang") },
    ],
  },
  {
    label: tr("Link"),
    items: [
      { id: "external", label: tr("Link esterni") },
      { id: "broken", label: tr("Link rotti") },
      { id: "badlinks", label: tr("Link non scansionabili") },
    ],
  },
  {
    label: tr("Risorse"),
    items: [
      { id: "images", label: tr("Immagini") },
      { id: "sitemap", label: tr("Sitemap") },
      { id: "custom", label: tr("Personalizzati") },
    ],
  },
];
const TABS = GROUPS.flatMap((g) => g.items);

/** Number of issue types in a report, coloured by the worst priority among them. */
function issueBadge(list: Issue[]): { count: number; kind: string } | null {
  if (list.length === 0) return null;
  const kind = list.some((i) => i.priority === "Alta") ? "client" : list.some((i) => i.priority === "Media") ? "redirect" : "blocked";
  return { count: list.length, kind };
}

const fmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const when = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

/** Mirror the Rust structs in src-tauri/src/lib.rs and crawler.rs. */
type CrawlData = {
  path: string;
  pages: Page[];
  external: ExternalLink[];
  broken: BrokenLink[];
  images: ImageRow[];
  hreflang: HreflangRow[];
  structured: StructuredRow[];
  bad_links: BadLinkRow[];
  custom: CustomData;
};
/** Crawls listed on the start screen; older ones stay reachable with Apri… */
const RECENT_SHOWN = 5;
type CrawlSummary = { path: string; start_url: string | null; pages: number; modified_ms: number };
type Progress = { stage: "pages" | "external" | "images"; done: number; pending: number };
const STAGE_LABEL: Record<Progress["stage"], string> = {
  pages: tr("URL analizzati"),
  external: tr("Link esterni verificati"),
  images: tr("Immagini verificate"),
};

const SQLITE_FILTER = [{ name: "Crawl CyberFrog", extensions: ["sqlite"] }];

export default function App() {
  const [url, setUrl] = useState("https://");
  const [pages, setPages] = useState<Page[]>([]);
  const [external, setExternal] = useState<ExternalLink[]>([]);
  const [broken, setBroken] = useState<BrokenLink[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [hreflang, setHreflang] = useState<HreflangRow[]>([]);
  const [structured, setStructured] = useState<StructuredRow[]>([]);
  const [badLinks, setBadLinks] = useState<BadLinkRow[]>([]);
  const [custom, setCustom] = useState<CustomData>({ rules: [], values: [] });
  /** Crawl file the current crawl is compared with, and its loaded data. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [baselineData, setBaselineData] = useState<CrawlSnapshot | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [crawlPath, setCrawlPath] = useState<string | null>(null);
  const [recent, setRecent] = useState<CrawlSummary[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** The user pressed Stop during the last crawl. */
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("issues");
  /** Set by clicking a problem: open that report with that filter. `seq` remounts the table. */
  const [jump, setJump] = useState<{ tab: string | null; filter: string | null; seq: number }>({
    tab: null,
    filter: null,
    seq: 0,
  });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // list mode crawls only pasted URLs instead of following links from one
  const [mode, setMode] = useState<"spider" | "list">("spider");
  const [listText, setListText] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const listCount = countUrls(listText);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ has_key: false, claude_code: null });
  const refreshAi = useCallback(() => {
    invoke<AiStatus>("ai_status").then(setAiStatus, () => setAiStatus({ has_key: false, claude_code: null }));
  }, []);
  useEffect(refreshAi, [refreshAi]);
  const aiReady = isAiReady(settings.ai_engine, aiStatus);
  const plan = useAi(settings.ai_engine);
  const resetPlan = plan.reset;
  useEffect(resetPlan, [pages, resetPlan]); // a plan belongs to the crawl it was written for

  const refreshRecent = useCallback(() => {
    invoke<CrawlSummary[]>("list_crawls").then(setRecent, () => setRecent([]));
  }, []);
  useEffect(refreshRecent, [refreshRecent]);

  function show(data: CrawlData) {
    setPages(data.pages);
    setExternal(data.external);
    setBroken(data.broken);
    setImages(data.images);
    setHreflang(data.hreflang);
    setStructured(data.structured);
    setBadLinks(data.bad_links);
    setCustom(data.custom);
    setSelected(null);
    setSelectedImage(null);
    setCrawlPath(data.path);
    if (data.pages[0]) setUrl(data.pages[0].url);
    pickBaseline(data);
  }

  /** Compare with the latest earlier crawl of the same host, like an automatic crawl comparison. */
  function pickBaseline(data: CrawlData) {
    setBaseline(null);
    const host = data.pages[0] ? new URL(data.pages[0].url).hostname : null;
    invoke<CrawlSummary[]>("list_crawls").then((list) => {
      setRecent(list);
      const self = list.find((c) => c.path === data.path);
      const earlier = list.find(
        (c) =>
          c.path !== data.path &&
          c.start_url !== null &&
          new URL(c.start_url).hostname === host &&
          (!self || c.modified_ms < self.modified_ms),
      );
      setBaseline(earlier?.path ?? null);
    }, () => setRecent([]));
  }

  useEffect(() => {
    setBaselineData(null);
    if (!baseline) return;
    let current = true; // a newer choice may land first
    invoke<CrawlData>("open_crawl", { path: baseline }).then(
      (d) => current && setBaselineData(d),
      (err) => current && setError(trError(String(err))),
    );
    return () => {
      current = false;
    };
  }, [baseline]);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (mode === "list" && listCount === 0) {
      setListOpen(true);
      return;
    }
    setRunning(true);
    setError(null);
    setNotice(null);
    setElapsed(null);
    setStopped(false);
    setProgress({ stage: "pages", done: 0, pending: 1 });
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = setProgress;
    const t0 = performance.now();
    try {
      const list = mode === "list" ? listText : null;
      const data = await invoke<CrawlData>("start_crawl", { url, settings, list, onProgress });
      show(data);
      setElapsed((performance.now() - t0) / 1000);
      // a low limit saved by mistake looks like a broken crawl, so say why it stopped
      if (data.pages.length >= settings.max_urls)
        setNotice(tr("Crawl fermato al limite di {n} URL impostato: puoi alzarlo in Impostazioni.", { n: settings.max_urls.toLocaleString(LOCALE) }));
      refreshRecent();
    } catch (err) {
      setError(trError(String(err)));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function stopCrawl() {
    setStopped(true);
    invoke("stop_crawl").catch((err) => setError(trError(String(err))));
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
      setError(trError(String(err)));
    }
  }

  async function saveSitemap() {
    setError(null);
    setNotice(null);
    const to = await save({ defaultPath: "sitemap.xml", filters: [{ name: "Sitemap XML", extensions: ["xml"] }] });
    if (!to) return;
    try {
      await invoke("write_text_file", { path: to, contents: buildSitemapXml(pages) });
      setNotice(tr("Sitemap salvata in {path}", { path: to }));
    } catch (err) {
      setError(trError(String(err)));
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
      setNotice(tr("Crawl salvato in {path}", { path: to }));
    } catch (err) {
      setError(trError(String(err)));
    }
  }

  const counts = useMemo(() => {
    const c = { ok: 0, redirect: 0, client: 0, server: 0, blocked: 0, none: 0 };
    for (const p of pages) c[statusKind(p)]++;
    return c;
  }, [pages]);

  const hreflangRows = useMemo(() => hreflangPages(pages, hreflang), [pages, hreflang]);
  // only computed while the tab is open: it compares every pair of pages
  const needsDups = tab === "duplicates" || tab === "issues";
  const dupRows = useMemo(() => (needsDups ? dupPages(pages) : []), [pages, needsDups]);
  const schemaRows = useMemo(() => schemaPages(pages, structured), [pages, structured]);
  const schemaTabFilters = useMemo(() => schemaFilters(schemaRows), [schemaRows]);
  const median = useMemo(() => medianMs(pages), [pages]);
  const indexable = useMemo(() => pages.filter((p) => nonIndexableReason(p) === null).length, [pages]);
  const indexTabFilters = useMemo(() => indexFilters(pages), [pages]);
  const metaTab = metaTabs.find((t) => t.check.field === tab);
  const rows = useMemo(() => (metaTab ? metaRows(pages, metaTab.check.field) : []), [pages, metaTab]);
  // duplicates are only analysed on their tab and here; they never rank Alta, so the badge stays right
  const snapshot = useMemo(
    (): CrawlSnapshot => ({ pages, broken, images, hreflang, structured, bad_links: badLinks }),
    [pages, broken, images, hreflang, structured, badLinks],
  );
  const issues = useMemo(() => allIssues(snapshot, dupRows), [snapshot, dupRows]);
  const redirectRows = useMemo(() => redirectChains(pages), [pages]);
  const selectedPage = useMemo(() => pages.find((p) => p.url === selected), [pages, selected]);
  const selectedIssues = useMemo(
    () => (selected ? pageIssues(selected, snapshot, dupRows) : []),
    [selected, snapshot, dupRows],
  );
  const customTable = useMemo(() => {
    const cust = helperFor<CustomRow>();
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
  }, [pages, custom]);
  const changes = useMemo(
    (): Change[] => (tab === "compare" && baselineData ? compareCrawls(baselineData, snapshot) : []),
    [tab, baselineData, snapshot],
  );
  const host = pages[0] ? new URL(pages[0].url).hostname : "crawl";
  const statusText = running
    ? `${STAGE_LABEL[progress?.stage ?? "pages"]}: ${(progress?.done ?? 0).toLocaleString(LOCALE)}` +
      (progress && progress.pending > 0 ? tr(" · {n} in coda", { n: progress.pending.toLocaleString(LOCALE) }) : "")
    : pages.length > 0
      ? tr("{n} URL · {host}", { n: pages.length.toLocaleString(LOCALE), host }) +
        (elapsed !== null
          ? tr(stopped ? " · interrotto dopo {s} s" : " · completato in {s} s", { s: fmt.format(elapsed) })
          : "")
      : "Pronto";
  /** Row selection for tables whose rows carry a crawled `url`: opens the detail panel. */
  const selectByUrl = {
    onRowClick: (r: { url: string }) => setSelected(r.url),
    isSelected: (r: { url: string }) => r.url === selected,
  };

  return (
    <main className="app">
      <header className="toolbar">
        <div className="brand">
          <img className="logo" src={cyberfrogLogo} alt="" width={32} height={32} />
          <span className="brand-text">
            CyberFrog
            <small>Another SEO Tool</small>
          </span>
        </div>
        <form onSubmit={start}>
          <label htmlFor="start-url" className="visually-hidden">
            {tr("URL di partenza")}
          </label>
          <select
            className="mode"
            value={mode}
            onChange={(e) => setMode(e.currentTarget.value as "spider" | "list")}
            disabled={running}
            aria-label={tr("Modalità")}
          >
            <option value="spider">{tr("Sito")}</option>
            <option value="list">{tr("Lista URL")}</option>
          </select>
          {mode === "spider" ? (
            <input
              id="start-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              placeholder={tr("https://esempio.it")}
              disabled={running}
            />
          ) : (
            <button type="button" className="list-pick" onClick={() => setListOpen(true)} disabled={running}>
              {listCount ? tr("{n} URL in lista · modifica", { n: listCount }) : tr("Incolla gli URL…")}
            </button>
          )}
          {running ? (
            <button type="button" className="stop" onClick={stopCrawl} disabled={stopped}>
              {stopped ? tr("Interruzione…") : tr("Stop")}
            </button>
          ) : (
            <button type="submit">{tr("Avvia")}</button>
          )}
        </form>
        <div className="file-actions">
          <button
            type="button"
            className="ghost lang"
            onClick={() => setLang(LANG === "it" ? "en" : "it")}
            disabled={running}
            title={tr("Lingua")}
            aria-label={`${tr("Lingua")}: ${LANG === "it" ? "English" : "Italiano"}`}
          >
            {LANG === "it" ? "EN" : "IT"}
          </button>
          <button type="button" className="ghost" onClick={() => setSettingsOpen(true)} disabled={running}>
            {tr("Impostazioni")}
          </button>
          <button type="button" className="ghost" onClick={() => setSchedulesOpen(true)}>
            {tr("Pianifica")}
          </button>
          <button type="button" className="ghost" onClick={() => openCrawl()} disabled={running}>
            {tr("Apri…")}
          </button>
          <button type="button" className="ghost" onClick={saveCrawlAs} disabled={running || !crawlPath}>
            {tr("Salva come…")}
          </button>
        </div>
      </header>
      <div className={`progress ${running ? "on" : ""}`} aria-hidden />
      <SchedulesDialog open={schedulesOpen} url={url} settings={settings} onClose={() => setSchedulesOpen(false)} />
      <ListDialog
        open={listOpen}
        text={listText}
        onSave={(t) => {
          setListText(t);
          setListOpen(false);
        }}
        onClose={() => setListOpen(false)}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
        aiStatus={aiStatus}
        onAiStatusChange={refreshAi}
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
          <h1>{tr("Scansione in corso…")}</h1>
          <p className="big-number">{(progress?.done ?? 0).toLocaleString(LOCALE)}</p>
          <p>
            {STAGE_LABEL[progress?.stage ?? "pages"]}
            {progress && progress.pending > 0 && tr(" · {n} in coda", { n: progress.pending.toLocaleString(LOCALE) })}
          </p>
        </section>
      ) : pages.length === 0 ? (
        <section className="hero">
          <h1>{tr("Scansiona un sito")}</h1>
          <p>{tr("Inserisci un URL e premi Avvia. CyberFrog segue i link dello stesso dominio e rispetta robots.txt.")}</p>
          {recent.length > 0 && (
            <div className="recent">
              <h2>{tr("Crawl recenti")}</h2>
              <ul>
                {recent.slice(0, RECENT_SHOWN).map((c) => (
                  <li key={c.path}>
                    <button type="button" onClick={() => openCrawl(c.path)}>
                      <span className="recent-url">{c.start_url ?? tr("Crawl vuoto")}</span>
                      <span className="recent-meta">
                        {tr("{n} URL · {date}", {
                          n: c.pages.toLocaleString(LOCALE),
                          date: when.format(new Date(c.modified_ms)),
                        })}
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
            <Stat label={tr("Indicizzabili")} value={indexable} kind="ok" />
            <Stat label="2xx" value={counts.ok} kind="ok" />
            <Stat label="3xx" value={counts.redirect} kind="redirect" />
            <Stat label="4xx" value={counts.client} kind="client" />
            <Stat label="5xx" value={counts.server} kind="server" />
            <Stat label={tr("Bloccati")} value={counts.blocked} kind="blocked" />
            <Stat label={tr("Link rotti")} value={broken.length} kind={broken.length ? "client" : undefined} />
            {median !== null && (
              <span className="stat">
                <strong>{median.toLocaleString(LOCALE)} ms</strong> {tr("tempo mediano")}
              </span>
            )}
            {elapsed !== null && <span className="time">{fmt.format(elapsed)} s</span>}
          </div>

          <div className="main">
            <nav className="sidebar" aria-label={tr("Report")}>
              {GROUPS.map((g) => (
                <div key={g.label} className="nav-group">
                  <h3>{g.label}</h3>
                  {g.items.map((t) => {
                    const badge = t.id === "issues" ? issueBadge(issues) : issueBadge(issues.filter((i) => i.tab === t.id));
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-current={tab === t.id ? "page" : undefined}
                        onClick={() => {
                          setTab(t.id);
                          setJump((j) => ({ tab: null, filter: null, seq: j.seq + 1 }));
                        }}
                      >
                        <span className="nav-label">{t.label}</span>
                        {badge && (
                          <span className={`nav-badge ${badge.kind}`} title={tr("Problemi")}>
                            {badge.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="workspace">
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
                  data={issues}
                  columns={issueColumns}
                  exportName={`${host}-problemi`}
                  actions={
                    <button
                      type="button"
                      className="secondary"
                      disabled={!aiReady || issues.length === 0 || plan.state.status === "loading"}
                      title={aiReady ? undefined : tr(NO_KEY_TEXT)}
                      onClick={() => plan.run(planPrompt(host, pages, withExamples(issues, snapshot, dupRows)))}
                    >
                      {tr("Piano d'azione AI")}
                    </button>
                  }
                  onRowClick={(i) => {
                    setTab(i.tab as Tab);
                    setJump((j) => ({ tab: i.tab, filter: i.filter, seq: j.seq + 1 }));
                  }}
                />
              )}
              {tab === "internal" && (
                <DataTable
                  key={`internal-${jump.seq}`}
                  initialFilter={jump.tab === "internal" ? jump.filter ?? undefined : undefined}
                  data={pages}
                  columns={internalColumns}
                  exportName={`${host}-interni`}
                  {...selectByUrl}
                />
              )}
              {tab === "codes" && (
                <DataTable
                  key={`codes-${jump.seq}`}
                  initialFilter={jump.tab === "codes" ? jump.filter ?? undefined : undefined}
                  data={pages}
                  columns={codeColumns}
                  filters={CODE_FILTERS}
                  exportName={`${host}-codici-risposta`}
                  {...selectByUrl}
                />
              )}
              {tab === "index" && (
                <DataTable
                  key={`index-${jump.seq}`}
                  initialFilter={jump.tab === "index" ? jump.filter ?? undefined : undefined}
                  data={pages}
                  columns={indexColumns}
                  filters={indexTabFilters}
                  exportName={`${host}-indicizzabilita`}
                  {...selectByUrl}
                />
              )}
              {tab === "external" && (
                <DataTable
                  key={`external-${jump.seq}`}
                  initialFilter={jump.tab === "external" ? jump.filter ?? undefined : undefined}
                  data={external}
                  columns={externalColumns}
                  filters={EXTERNAL_FILTERS}
                  exportName={`${host}-link-esterni`}
                />
              )}
              {tab === "broken" && (
                <DataTable
                  key={`broken-${jump.seq}`}
                  initialFilter={jump.tab === "broken" ? jump.filter ?? undefined : undefined}
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
                  key={`${tab}-${jump.seq}`}
                  initialFilter={jump.tab === tab ? jump.filter ?? undefined : undefined}
                  data={rows}
                  columns={metaTab.columns}
                  filters={metaTab.filters}
                  exportName={`${host}-${tab.replace("_", "-")}`}
                  {...selectByUrl}
                />
              )}
              {tab === "compare" &&
                (baseline && !baselineData ? (
                  <p className="empty">{tr("Carico il confronto…")}</p>
                ) : (
                  <DataTable
                    key={`compare-${baseline}-${jump.seq}`}
                    data={changes}
                    columns={changeColumns}
                    filters={CHANGE_FILTERS}
                    exportName={`${host}-confronto`}
                    emptyText={baseline ? undefined : tr("Nessun crawl precedente da confrontare. Scegline uno dal menu.")}
                    onRowClick={(c) => c.kind !== "issue" && c.kind !== "removed" && setSelected(c.key)}
                    isSelected={(c) => c.key === selected}
                    actions={
                      <label className="compare-pick">
                        {tr("Confronta con")}
                        <select value={baseline ?? ""} onChange={(e) => setBaseline(e.currentTarget.value || null)}>
                          <option value="">{tr("Nessun confronto")}</option>
                          {recent
                            .filter((c) => c.path !== crawlPath)
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
                <SiteStructure pages={pages} selected={selected} onSelect={setSelected} />
              </div>
            )}
            {tab === "redirects" && (
                <DataTable
                  key={`redirects-${jump.seq}`}
                  initialFilter={jump.tab === "redirects" ? (jump.filter ?? undefined) : undefined}
                  data={redirectRows}
                  columns={redirectColumns}
                  filters={REDIRECT_FILTERS}
                  exportName={`${host}-redirect`}
                  {...selectByUrl}
                />
              )}
              {tab === "custom" && (
                <DataTable
                  key={`custom-${crawlPath}-${jump.seq}`}
                  data={customTable.rows}
                  columns={customTable.columns}
                  filters={customTable.filters}
                  exportName={`${host}-personalizzati`}
                  emptyText={
                    custom.rules.length
                      ? undefined
                      : tr("Nessuna regola personalizzata. Aggiungine una in Impostazioni → Estrazione e ricerca.")
                  }
                  {...selectByUrl}
                />
              )}
              {tab === "badlinks" && (
                <DataTable
                  key={`badlinks-${jump.seq}`}
                  initialFilter={jump.tab === "badlinks" ? (jump.filter ?? undefined) : undefined}
                  data={badLinks}
                  columns={badLinkColumns}
                  filters={BAD_LINK_FILTERS}
                  exportName={`${host}-link-non-scansionabili`}
                  onRowClick={(b) => setSelected(b.page)}
                  isSelected={(b) => b.page === selected}
                />
              )}
              {tab === "sitemap" && (
                <DataTable
                  key={`sitemap-${jump.seq}`}
                  initialFilter={jump.tab === "sitemap" ? jump.filter ?? undefined : undefined}
                  data={pages}
                  columns={sitemapColumns}
                  filters={SITEMAP_FILTERS}
                  exportName={`${host}-sitemap`}
                  actions={
                    <button type="button" className="secondary" onClick={saveSitemap}>
                      {tr("Genera sitemap XML")}
                    </button>
                  }
                  {...selectByUrl}
                />
              )}
              {tab === "duplicates" && (
                <DataTable
                  key={`duplicates-${jump.seq}`}
                  initialFilter={jump.tab === "duplicates" ? jump.filter ?? undefined : undefined}
                  data={dupRows}
                  columns={dupColumns}
                  filters={DUP_FILTERS}
                  exportName={`${host}-duplicati`}
                  {...selectByUrl}
                />
              )}
              {tab === "schema" && (
                <DataTable
                  key={`schema-${jump.seq}`}
                  initialFilter={jump.tab === "schema" ? jump.filter ?? undefined : undefined}
                  data={schemaRows}
                  columns={schemaColumns}
                  filters={schemaTabFilters}
                  exportName={`${host}-dati-strutturati`}
                  {...selectByUrl}
                />
              )}
              {tab === "hreflang" && (
                <DataTable
                  key={`hreflang-${jump.seq}`}
                  initialFilter={jump.tab === "hreflang" ? jump.filter ?? undefined : undefined}
                  data={hreflangRows}
                  columns={hreflangColumns}
                  filters={HREFLANG_FILTERS}
                  exportName={`${host}-hreflang`}
                  {...selectByUrl}
                />
              )}
              {tab === "perf" && (
                <DataTable
                  key={`perf-${jump.seq}`}
                  initialFilter={jump.tab === "perf" ? jump.filter ?? undefined : undefined}
                  data={pages}
                  columns={perfColumns}
                  filters={PERF_FILTERS}
                  exportName={`${host}-prestazioni`}
                  {...selectByUrl}
                />
              )}
              {tab === "js" && (
                <DataTable
                  key={`js-${jump.seq}`}
                  initialFilter={jump.tab === "js" ? jump.filter ?? undefined : undefined}
                  data={pages}
                  columns={jsColumns}
                  filters={JS_FILTERS}
                  emptyText={
                    pages.some((p) => p.rendered || p.render_error !== null)
                      ? undefined
                      : tr("Attiva Rendering JavaScript nelle Impostazioni e avvia un nuovo crawl.")
                  }
                  exportName={`${host}-javascript`}
                  {...selectByUrl}
                />
              )}
              {tab === "images" && (
                <DataTable
                  key={`images-${jump.seq}`}
                  initialFilter={jump.tab === "images" ? jump.filter ?? undefined : undefined}
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
                  page={selectedPage}
                  issues={selectedIssues}
                  aiEngine={settings.ai_engine}
                  aiReady={aiReady}
                  onClose={() => setSelected(null)}
                  onNavigate={setSelected}
                />
              )}
            </div>
          </div>
        </>
      )}
      <footer className="statusbar">
        <span role="status">{statusText}</span>
        <button type="button" className="powered" onClick={() => openUrl("https://cyberzec.it")}>
          {tr("Powered by")}
          <img src={cyberzecShield} alt="" width={18} height={18} />
          <strong>Daniele Zecca – CyberZec</strong>
        </button>
      </footer>
    </main>
  );
}

function Stat({ label, value, kind }: { label: string; value: number; kind?: string }) {
  return (
    <span className={`stat ${kind ?? ""}`}>
      <strong>{value.toLocaleString(LOCALE)}</strong> {label}
    </span>
  );
}

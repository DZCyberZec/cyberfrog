// Column definitions of every report table.
import { helperFor } from "./DataTable";
import { TABS } from "./nav";
import { LOCALE, tr } from "./i18n";
import {
  CHANGE_LABEL,
  CHECKS,
  LARGE_IMAGE_BYTES,
  SLOW_MS,
  badLinkReason,
  codeLabel,
  formatBytes,
  hreflangIssues,
  jsLinks,
  jsWords,
  kindOf,
  metaFilters,
  nonIndexableReason,
  statusFilters,
  statusKind,
  statusLabel,
  type BadLinkRow,
  type BrokenLink,
  type Change,
  type DupPage,
  type ExternalLink,
  type HreflangPage,
  type ImageRow,
  type Issue,
  type MetaRow,
  type Page,
  type RedirectChain,
  type SchemaPage,
} from "./pages";

export const num = (v: number | null) => <span className="num">{v ?? ""}</span>;
export const ms = (v: number | null) => <span className={`num${(v ?? 0) > SLOW_MS ? " heavy" : ""}`}>{v ?? ""}</span>;

export const page = helperFor<Page>();
export const statusColumn = page.accessor(statusLabel, {
  id: "status",
  header: tr("Stato"),
  size: 150,
  cell: (c) => <span className={`badge ${statusKind(c.row.original)}`}>{c.getValue()}</span>,
});
export const indexableColumn = page.accessor((p) => (nonIndexableReason(p) === null ? tr("Sì") : tr("No")), {
  id: "indexable",
  header: tr("Indicizzabile"),
  size: 115,
  cell: (c) => <span className={`badge ${c.getValue() === tr("Sì") ? "ok" : "client"}`}>{c.getValue()}</span>,
});
export const reasonColumn = page.accessor((p) => nonIndexableReason(p) ?? "", {
  id: "reason",
  header: tr("Motivo"),
  size: 190,
});
export const internalColumns = page.columns([
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
export const perfColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  page.accessor("response_ms", { header: tr("Tempo (ms)"), size: 110, cell: (c) => ms(c.getValue()) }),
  page.accessor("size_bytes", { header: tr("Peso"), size: 100, cell: (c) => <span className="num">{formatBytes(c.getValue())}</span> }),
  page.accessor("content_type", { header: "Content type", size: 200 }),
  page.accessor("word_count", { header: tr("Parole"), size: 80, cell: (c) => num(c.getValue()) }),
]);
export const jsColumns = page.columns([
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
export const codeColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  page.accessor("redirect_to", { header: tr("Redirect a"), size: 360 }),
  page.accessor("content_type", { header: "Content type", size: 180 }),
  page.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
]);

export const sitemapColumns = page.columns([
  page.accessor("url", { header: "URL", size: 460 }),
  statusColumn,
  indexableColumn,
  page.accessor((p) => (p.in_sitemap ? tr("Sì") : tr("No")), { id: "in_sitemap", header: tr("Nella sitemap"), size: 120 }),
  page.accessor("inlinks", { header: tr("Inlink"), size: 75, cell: (c) => num(c.getValue()) }),
  page.accessor("depth", { header: tr("Profondità"), size: 95, cell: (c) => num(c.getValue()) }),
]);

export const indexColumns = page.columns([
  page.accessor("url", { header: "URL", size: 420 }),
  statusColumn,
  indexableColumn,
  reasonColumn,
  page.accessor("meta_robots", { header: "Meta robots", size: 170 }),
  page.accessor("x_robots_tag", { header: "X-Robots-Tag", size: 170 }),
  page.accessor("canonical", { header: "Canonical", size: 380 }),
]);

/** Status badge for rows that carry only a code and maybe an error. */
export const codeCell = (status: number | null, error: string | null) => (
  <span className={`badge ${kindOf(status)}`}>{codeLabel(status, error)}</span>
);

export const ext = helperFor<ExternalLink>();
export const externalColumns = ext.columns([
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
export const EXTERNAL_FILTERS = statusFilters<ExternalLink>();

export const broke = helperFor<BrokenLink>();
export const brokenColumns = broke.columns([
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

export const img = helperFor<ImageRow>();
export const imageColumns = img.columns([
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

export const hl = helperFor<HreflangPage>();
export const hreflangColumns = hl.columns([
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

export const sd = helperFor<SchemaPage>();
export const schemaColumns = sd.columns([
  sd.accessor("url", { header: "URL", size: 420 }),
  sd.accessor((r) => r.types.join(", "), { id: "types", header: tr("Tipi schema.org"), size: 300 }),
  sd.accessor("formats", { header: tr("Formato"), size: 140 }),
  sd.accessor("issues", {
    header: tr("Problemi"),
    size: 400,
    cell: (c) => (c.getValue() ? <span className="issue">{c.getValue()}</span> : ""),
  }),
]);

export const pct = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });
export const dup = helperFor<DupPage>();
export const dupColumns = dup.columns([
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

export const PRIORITY_BADGE: Record<Issue["priority"], string> = { Alta: "client", Media: "redirect", Bassa: "blocked" };
export const iss = helperFor<Issue>();
export const issueColumns = iss.columns([
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

export const CHANGE_BADGE: Record<Change["kind"], string> = {
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
export const chg = helperFor<Change>();
export const changeColumns = chg.columns([
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

export const rdr = helperFor<RedirectChain>();
export const redirectColumns = rdr.columns([
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

export const bad = helperFor<BadLinkRow>();
export const badLinkColumns = bad.columns([
  bad.accessor("page", { header: tr("Pagina"), size: 400 }),
  bad.accessor("raw", { header: tr("Link"), size: 340 }),
  bad.accessor((b) => badLinkReason(b.reason), { id: "reason", header: tr("Motivo"), size: 320 }),
  bad.accessor((b) => (b.kind === "invalid" ? tr("URL non validi") : tr("Non scansionabili")), {
    id: "kind",
    header: tr("Tipo"),
    size: 150,
  }),
]);

export const meta = helperFor<MetaRow>();
export const metaTabs = CHECKS.map((check) => ({
  check,
  filters: metaFilters(check),
  columns: meta.columns([
    meta.accessor("url", { header: "URL", size: 420 }),
    meta.accessor("value", { header: check.label, size: 460 }),
    meta.accessor("length", { header: tr("Lunghezza"), size: 95, cell: (c) => num(c.getValue()) }),
    meta.accessor("occurrences", { header: tr("Occorrenze"), size: 105, cell: (c) => num(c.getValue()) }),
  ]),
}));

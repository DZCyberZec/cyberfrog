// "Topics & links" report: clusters around hub pages, cannibalizing pairs, internal links to add.
import { useState } from "react";
import { DataTable, helperFor } from "./DataTable";
import { LOCALE, tr } from "./i18n";
import { REASON_LABEL, type Cannibal, type Cluster, type LinkSuggestion, type TopicsData } from "./topics";

type View = "clusters" | "cannibal" | "links";

const pct = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });
const percent = (v: number) => <span className="num">{pct.format(v)}</span>;

const cl = helperFor<Cluster>();
const clusterColumns = cl.columns([
  cl.accessor((c) => c.label.join(" · "), { id: "label", header: tr("Argomento"), size: 240 }),
  cl.accessor("hub", { header: tr("Pagina hub"), size: 380 }),
  cl.accessor((c) => c.pages.length, { id: "size", header: tr("Pagine"), size: 80, cell: (c) => <span className="num">{c.getValue()}</span> }),
  cl.accessor((c) => c.pages.filter((p) => p !== c.hub).join("  ·  "), { id: "pages", header: tr("Altre pagine del cluster"), size: 640 }),
]);

const ca = helperFor<Cannibal>();
const cannibalColumns = ca.columns([
  ca.accessor("a", { header: tr("Pagina A"), size: 360 }),
  ca.accessor("b", { header: tr("Pagina B"), size: 360 }),
  ca.accessor("title_similarity", { header: tr("Title/H1 simili"), size: 120, cell: (c) => percent(c.getValue()) }),
  ca.accessor("similarity", { header: tr("Contenuto simile"), size: 130, cell: (c) => percent(c.getValue()) }),
  ca.accessor((c) => c.shared.join(", "), { id: "shared", header: tr("Parole in comune"), size: 260 }),
]);

const ls = helperFor<LinkSuggestion>();
const linkColumns = ls.columns([
  ls.accessor("from", { header: tr("Aggiungi un link in"), size: 360 }),
  ls.accessor("to", { header: tr("Verso"), size: 360 }),
  ls.accessor("anchor", { header: tr("Testo del link suggerito"), size: 260 }),
  ls.accessor((s) => REASON_LABEL[s.reason], { id: "reason", header: tr("Perché"), size: 280 }),
  ls.accessor("similarity", { header: tr("Similarità"), size: 100, cell: (c) => percent(c.getValue()) }),
]);

type Props = {
  topics: TopicsData;
  /** Problem filter the report was opened with: "cannibal" or "links" picks that view. */
  initialFilter?: string;
  exportName: string;
  selected: string | null;
  select: (url: string) => void;
};

export function TopicsReport({ topics, initialFilter, exportName, selected, select }: Props) {
  const [view, setView] = useState<View>(initialFilter === "cannibal" || initialFilter === "links" ? initialFilter : "clusters");
  if (topics.analysed === 0) {
    return <p className="empty">{tr("Nessuna pagina indicizzabile da analizzare.")}</p>;
  }
  const views: { id: View; label: string; count: number }[] = [
    { id: "clusters", label: tr("Cluster"), count: topics.clusters.length },
    { id: "cannibal", label: tr("Cannibalizzazione"), count: topics.cannibal.length },
    { id: "links", label: tr("Link da aggiungere"), count: topics.suggestions.length },
  ];
  const intro: Record<View, string> = {
    clusters: tr("Pagine sullo stesso argomento, raggruppate attorno alla più forte (hub). Calcolato su {n} pagine indicizzabili da title, H1 e testo.", {
      n: topics.analysed,
    }),
    cannibal: tr("Coppie di pagine con title e contenuto sullo stesso argomento: Google può alternarle e nessuna si posiziona bene."),
    links: tr("Link interni che mancano tra pagine dello stesso argomento, con il testo da usare."),
  };
  return (
    <div className="topics">
      <div className="topics-head">
        <div className="segmented" role="tablist" aria-label={tr("Vista")}>
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} aria-checked={view === v.id} onClick={() => setView(v.id)}>
              {v.label} <span className="count">{v.count}</span>
            </button>
          ))}
        </div>
        <small className="muted">{intro[view]}</small>
      </div>
      {view === "clusters" && (
        <DataTable
          key="clusters"
          data={topics.clusters}
          columns={clusterColumns}
          exportName={`${exportName}-cluster`}
          emptyText={tr("Nessun gruppo di pagine sullo stesso argomento.")}
          onRowClick={(c) => select(c.hub)}
          isSelected={(c) => c.hub === selected}
        />
      )}
      {view === "cannibal" && (
        <DataTable
          key="cannibal"
          data={topics.cannibal}
          columns={cannibalColumns}
          exportName={`${exportName}-cannibalizzazione`}
          emptyText={tr("Nessuna cannibalizzazione: ogni argomento ha la sua pagina.")}
          onRowClick={(c) => select(c.a)}
          isSelected={(c) => c.a === selected}
        />
      )}
      {view === "links" && (
        <DataTable
          key="links"
          data={topics.suggestions}
          columns={linkColumns}
          exportName={`${exportName}-link-da-aggiungere`}
          emptyText={tr("Nessun link mancante tra pagine dello stesso argomento.")}
          onRowClick={(s) => select(s.from)}
          isSelected={(s) => s.from === selected}
        />
      )}
    </div>
  );
}

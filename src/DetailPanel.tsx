import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DataTable, helperFor } from "./DataTable";
import { codeLabel, kindOf, type LinkRow, type PageLinks } from "./pages";

const link = helperFor<LinkRow>();
const columns = link.columns([
  link.accessor("url", { header: "URL", size: 460 }),
  link.accessor("anchor", { header: "Anchor text", size: 300 }),
  link.accessor((r) => codeLabel(r.status, null), {
    id: "status",
    header: "Stato",
    size: 130,
    cell: (c) => <span className={`badge ${kindOf(c.row.original.status)}`}>{c.getValue()}</span>,
  }),
  link.accessor((r) => (r.external ? "Esterno" : "Interno"), { id: "kind", header: "Tipo", size: 90 }),
]);

type Props = {
  crawlPath: string;
  url: string;
  onClose: () => void;
  /** Called with a same-site URL the user picked inside the panel. */
  onNavigate: (url: string) => void;
};

/** Inlinks and outlinks of one crawled URL, loaded on demand from the crawl file. */
export function DetailPanel({ crawlPath, url, onClose, onNavigate }: Props) {
  const [links, setLinks] = useState<PageLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"inlinks" | "outlinks">("inlinks");

  useEffect(() => {
    let current = true; // ignore answers for a URL the user already left
    setLinks(null);
    setError(null);
    invoke<PageLinks>("page_links", { path: crawlPath, url }).then(
      (l) => current && setLinks(l),
      (e) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [crawlPath, url]);

  const slug = new URL(url).pathname.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home";

  return (
    <section className="detail" aria-label={`Dettaglio di ${url}`}>
      <header className="detail-head">
        <nav className="tabs" role="tablist" aria-label="Link della pagina">
          <button type="button" role="tab" aria-selected={view === "inlinks"} onClick={() => setView("inlinks")}>
            Inlink {links && <span className="count">{links.inlinks.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === "outlinks"} onClick={() => setView("outlinks")}>
            Outlink {links && <span className="count">{links.outlinks.length}</span>}
          </button>
        </nav>
        <span className="detail-url" title={url}>
          {url}
        </span>
        <button type="button" className="close" onClick={onClose} aria-label="Chiudi dettaglio">
          ✕
        </button>
      </header>
      {error ? (
        <p className="empty">{error}</p>
      ) : !links ? (
        <p className="empty">Carico i link…</p>
      ) : (
        <DataTable
          key={`${url}-${view}`}
          data={links[view]}
          columns={columns}
          exportName={`${view}-${slug}`}
          onRowClick={(r) => !r.external && onNavigate(r.url)}
        />
      )}
    </section>
  );
}

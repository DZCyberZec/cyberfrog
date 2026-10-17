import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DataTable, helperFor } from "./DataTable";
import { codeLabel, kindOf, type IssueDef, type LinkRow, type Page, type PageLinks } from "./pages";
import { tr, trError } from "./i18n";
import { AiOutput, NO_KEY_TEXT, useAi } from "./AiAssist";
import { explainPrompt, metaPrompt } from "./ai";
import { FaqSchema } from "./FaqSchema";
import type { AiEngine } from "./settings";

const link = helperFor<LinkRow>();
const columns = link.columns([
  link.accessor("url", { header: "URL", size: 460 }),
  link.accessor("anchor", { header: "Anchor text", size: 300 }),
  link.accessor((r) => codeLabel(r.status, null), {
    id: "status",
    header: tr("Stato"),
    size: 130,
    cell: (c) => <span className={`badge ${kindOf(c.row.original.status)}`}>{c.getValue()}</span>,
  }),
  link.accessor((r) => (r.external ? tr("Esterno") : tr("Interno")), { id: "kind", header: tr("Tipo"), size: 90 }),
]);

type Props = {
  crawlPath: string;
  url: string;
  /** The crawled page behind `url`, when there is one; the AI view needs it. */
  page: Page | undefined;
  issues: IssueDef[];
  aiEngine: AiEngine;
  /** The chosen engine is set up (Claude Code installed, or an API key stored). */
  aiReady: boolean;
  onClose: () => void;
  /** Called with a same-site URL the user picked inside the panel. */
  onNavigate: (url: string) => void;
};

/** Inlinks and outlinks of one crawled URL, loaded on demand from the crawl file. */
export function DetailPanel({ crawlPath, url, page, issues, aiEngine, aiReady, onClose, onNavigate }: Props) {
  const [links, setLinks] = useState<PageLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"inlinks" | "outlinks" | "ai">("inlinks");
  const ai = useAi(aiEngine);
  const { reset } = ai;
  useEffect(reset, [url, reset]); // an answer is about one page

  useEffect(() => {
    let current = true; // ignore answers for a URL the user already left
    setLinks(null);
    setError(null);
    invoke<PageLinks>("page_links", { path: crawlPath, url }).then(
      (l) => current && setLinks(l),
      (e) => current && setError(trError(String(e))),
    );
    return () => {
      current = false;
    };
  }, [crawlPath, url]);

  const slug = new URL(url).pathname.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home";

  return (
    <section className="detail" aria-label={tr("Dettaglio di {url}", { url })}>
      <header className="detail-head">
        <nav className="tabs" role="tablist" aria-label={tr("Link della pagina")}>
          <button type="button" role="tab" aria-selected={view === "inlinks"} onClick={() => setView("inlinks")}>
            {tr("Inlink")} {links && <span className="count">{links.inlinks.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === "outlinks"} onClick={() => setView("outlinks")}>
            {tr("Outlink")} {links && <span className="count">{links.outlinks.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === "ai"} onClick={() => setView("ai")}>
            {tr("Assistente AI")}
          </button>
        </nav>
        <span className="detail-url" title={url}>
          {url}
        </span>
        <button type="button" className="close" onClick={onClose} aria-label={tr("Chiudi dettaglio")}>
          ✕
        </button>
      </header>
      {view === "ai" ? (
        <div className="ai-view">
          <FaqSchema key={url} url={url} />
          {!page ? (
            <p className="empty">{tr("Questo URL non è stato scansionato.")}</p>
          ) : !aiReady ? (
            <p className="empty">{tr(NO_KEY_TEXT)}</p>
          ) : (
            <>
              <div className="ai-actions">
                <button type="button" onClick={() => ai.run(metaPrompt(page))} disabled={ai.state.status === "loading"}>
                  {tr("Suggerisci title e meta description")}
                </button>
                <button type="button" onClick={() => ai.run(explainPrompt(page, issues))} disabled={ai.state.status === "loading"}>
                  {issues.length ? tr("Spiega i problemi ({n})", { n: issues.length }) : tr("Come migliorarla")}
                </button>
              </div>
              <AiOutput state={ai.state} />
            </>
          )}
        </div>
      ) : error ? (
        <p className="empty">{error}</p>
      ) : !links ? (
        <p className="empty">{tr("Carico i link…")}</p>
      ) : (
        <DataTable
          key={`${url}-${view}`}
          data={links[view as "inlinks" | "outlinks"]}
          columns={columns}
          exportName={`${view}-${slug}`}
          onRowClick={(r) => !r.external && onNavigate(r.url)}
        />
      )}
    </section>
  );
}

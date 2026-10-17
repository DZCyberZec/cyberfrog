import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DataTable, helperFor } from "./DataTable";
import type { ImageUse } from "./pages";
import { tr, trError } from "./i18n";

const use = helperFor<ImageUse>();
const columns = use.columns([
  use.accessor("page", { header: tr("Pagina"), size: 460 }),
  use.accessor((u) => (u.alt === null ? tr("(mancante)") : u.alt === "" ? tr('(vuoto: alt="")') : u.alt), {
    id: "alt",
    header: "Alt text",
    size: 320,
    cell: (c) => {
      const missing = c.row.original.alt === null;
      return <span className={missing ? "badge client" : undefined}>{c.getValue()}</span>;
    },
  }),
  use.accessor((u) => (u.has_size ? tr("Sì") : tr("No")), { id: "size", header: tr("Width/height"), size: 120 }),
]);

type Props = {
  crawlPath: string;
  src: string;
  onClose: () => void;
  /** Called with a page the user picked, to show its links. */
  onOpenPage: (url: string) => void;
};

/** The pages that show one image, with the alt text each of them uses. */
export function ImagePanel({ crawlPath, src, onClose, onOpenPage }: Props) {
  const [uses, setUses] = useState<ImageUse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setUses(null);
    setError(null);
    invoke<ImageUse[]>("image_pages", { path: crawlPath, src }).then(
      (u) => current && setUses(u),
      (e) => current && setError(trError(String(e))),
    );
    return () => {
      current = false;
    };
  }, [crawlPath, src]);

  const file = src.split("/").pop()?.split("?")[0] || "immagine";

  return (
    <section className="detail" aria-label={tr("Pagine che usano {src}", { src })}>
      <header className="detail-head">
        <nav className="tabs" aria-label={tr("Uso dell'immagine")}>
          <span className="tab-static">
            {tr("Pagine")} {uses && <span className="count">{uses.length}</span>}
          </span>
        </nav>
        <span className="detail-url" title={src}>
          {src}
        </span>
        <button type="button" className="close" onClick={onClose} aria-label={tr("Chiudi dettaglio")}>
          ✕
        </button>
      </header>
      {error ? (
        <p className="empty">{error}</p>
      ) : !uses ? (
        <p className="empty">{tr("Carico le pagine…")}</p>
      ) : (
        <DataTable key={src} data={uses} columns={columns} exportName={`pagine-${file}`} onRowClick={(u) => onOpenPage(u.page)} />
      )}
    </section>
  );
}

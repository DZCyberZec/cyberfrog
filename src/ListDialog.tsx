import { useEffect, useRef, useState } from "react";
import { tr } from "./i18n";

type Props = {
  open: boolean;
  text: string;
  onSave: (text: string) => void;
  onClose: () => void;
};

/** URLs for list mode: one per line, as pasted from a spreadsheet or a migration plan. */
export function countUrls(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function ListDialog({ open, text, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(text);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(text);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, text]);

  const n = countUrls(draft);
  return (
    <dialog ref={ref} className="settings list-dialog" onClose={onClose} aria-labelledby="list-title">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <h2 id="list-title">{tr("Lista URL")}</h2>
        <small>{tr("Incolla gli URL da analizzare, uno per riga. CyberFrog analizza solo questi e dove reindirizzano, senza seguire i link.")}</small>
        <textarea
          rows={14}
          aria-label={tr("Lista URL")}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={"https://esempio.it/pagina-1\nhttps://esempio.it/pagina-2"}
          spellCheck={false}
          autoFocus
        />
        <footer>
          <small>{tr("{n} URL", { n })}</small>
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            {tr("Annulla")}
          </button>
          <button type="submit" className="primary" disabled={n === 0}>
            {tr("Usa questa lista")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

// ⌘K: type to jump to any report, problem or action. Arrows move, Enter runs, Escape closes.
import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "./i18n";
import { SearchIcon } from "./icons";

export type Command = { id: string; label: string; group: string; hint?: string; run: () => void };

/** Matches every word of the query, in any order, ignoring case and accents. */
export function matches(text: string, query: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const t = norm(text);
  return norm(query).split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => commands.filter((c) => matches(`${c.group} ${c.label} ${c.hint ?? ""}`, query)).slice(0, 50), [commands, query]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    ref.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <dialog
      ref={ref}
      className="palette"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={tr("Cerca report e azioni")}
    >
      <div className="palette-input">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={tr("Cerca report, problemi e azioni…")}
          aria-label={tr("Cerca report e azioni")}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, shown.length - 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter") run(shown[active]);
            else return;
            e.preventDefault();
          }}
        />
      </div>
      <ul role="listbox">
        {shown.length === 0 && <li className="none">{tr("Nessun risultato")}</li>}
        {shown.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === active} data-index={i}>
            <button type="button" onMouseEnter={() => setActive(i)} onClick={() => run(c)}>
              <span className="pal-group">{c.group}</span>
              <span className="pal-label">{c.label}</span>
              {c.hint && <span className="pal-hint">{c.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}

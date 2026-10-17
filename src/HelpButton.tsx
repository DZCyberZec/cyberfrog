// A floating "?" that explains the current report: what it shows, how to read it, what to do.
// Closes on outside click or Escape, like Menu.
import { useEffect, useRef, useState } from "react";
import { HELP } from "./help";
import { TABS } from "./nav";
import { tr } from "./i18n";

export function HelpButton({ tab }: { tab: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const help = HELP[tab];
  if (!help) return null;
  const label = TABS.find((t) => t.id === tab)?.label ?? tab;
  const sections = [
    [tr("Cosa mostra"), help.what],
    [tr("Come leggerlo"), help.read],
    [tr("Cosa fare"), help.act],
  ];
  return (
    <div className="help" ref={ref}>
      {open && (
        <div className="help-pop" role="dialog" aria-label={label}>
          <header>
            <h2>{label}</h2>
            <button type="button" className="close" onClick={() => setOpen(false)} aria-label={tr("Chiudi la guida")}>
              ✕
            </button>
          </header>
          {sections.map(([title, text]) => (
            <section key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </section>
          ))}
        </div>
      )}
      <button type="button" className="help-btn" aria-label={tr("Come funziona")} title={tr("Come funziona")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ?
      </button>
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS, USER_AGENTS, type Settings } from "./settings";

type Props = {
  open: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
};

const CUSTOM = "custom";

/** Modal form for crawl settings; edits apply only on Salva. */
export function SettingsDialog({ open, settings, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  const preset = USER_AGENTS.find((u) => u.value === draft.user_agent)?.id ?? CUSTOM;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(settings);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, settings]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(draft);
  }

  return (
    <dialog ref={ref} className="settings" onClose={onClose} aria-labelledby="settings-title">
      <form onSubmit={submit}>
        <h2 id="settings-title">Impostazioni crawl</h2>

        <fieldset>
          <legend>Limiti</legend>
          <label>
            Numero massimo di URL
            <input
              type="number"
              min={1}
              max={100000}
              required
              value={draft.max_urls}
              onChange={(e) => set("max_urls", e.currentTarget.valueAsNumber || 1)}
            />
          </label>
          <label>
            Richieste in parallelo
            <input
              type="number"
              min={1}
              max={32}
              required
              value={draft.concurrency}
              onChange={(e) => set("concurrency", e.currentTarget.valueAsNumber || 1)}
            />
            <small>Più alto è più veloce ma pesa di più sul server. 8 va bene per quasi tutti i siti.</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>User agent</legend>
          <label>
            Identità del crawler
            <select
              value={preset}
              onChange={(e) => {
                const ua = USER_AGENTS.find((u) => u.id === e.currentTarget.value);
                set("user_agent", ua ? ua.value : "");
              }}
            >
              {USER_AGENTS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
              <option value={CUSTOM}>Personalizzato…</option>
            </select>
          </label>
          {preset === CUSTOM && (
            <label>
              User agent personalizzato
              <input
                type="text"
                value={draft.user_agent}
                onChange={(e) => set("user_agent", e.currentTarget.value)}
                placeholder="MioCrawler/1.0"
              />
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>Cosa analizzare</legend>
          <Check label="Rispetta robots.txt" checked={draft.respect_robots} onChange={(v) => set("respect_robots", v)} />
          <Check label="Verifica i link esterni" checked={draft.check_external} onChange={(v) => set("check_external", v)} />
          <Check label="Verifica peso e stato delle immagini" checked={draft.check_images} onChange={(v) => set("check_images", v)} />
          <Check label="Leggi le sitemap XML" checked={draft.use_sitemaps} onChange={(v) => set("use_sitemaps", v)} />
        </fieldset>

        <fieldset>
          <legend>Escludi URL</legend>
          <label>
            Un'espressione regolare per riga
            <textarea
              rows={4}
              value={draft.exclude.join("\n")}
              onChange={(e) => set("exclude", e.currentTarget.value.split("\n"))}
              placeholder={"/tag/\n\\?replytocom="}
              spellCheck={false}
            />
          </label>
        </fieldset>

        <footer>
          <button type="button" className="link" onClick={() => setDraft(DEFAULT_SETTINGS)}>
            Ripristina predefinite
          </button>
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            Annulla
          </button>
          <button type="submit" className="primary">
            Salva
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      {label}
    </label>
  );
}

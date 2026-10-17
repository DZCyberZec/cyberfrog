import { useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS, USER_AGENTS, type RuleSpec, type Settings } from "./settings";
import { tr } from "./i18n";

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
        <h2 id="settings-title">{tr("Impostazioni crawl")}</h2>

        <fieldset>
          <legend>{tr("Limiti")}</legend>
          <label>
            {tr("Numero massimo di URL")}
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
            {tr("Richieste in parallelo")}
            <input
              type="number"
              min={1}
              max={32}
              required
              value={draft.concurrency}
              onChange={(e) => set("concurrency", e.currentTarget.valueAsNumber || 1)}
            />
            <small>{tr("Più alto è più veloce ma pesa di più sul server. 8 va bene per quasi tutti i siti.")}</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>{tr("User agent")}</legend>
          <label>
            {tr("Identità del crawler")}
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
              <option value={CUSTOM}>{tr("Personalizzato…")}</option>
            </select>
          </label>
          {preset === CUSTOM && (
            <label>
              {tr("User agent personalizzato")}
              <input
                type="text"
                value={draft.user_agent}
                onChange={(e) => set("user_agent", e.currentTarget.value)}
                placeholder={tr("MioCrawler/1.0")}
              />
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>{tr("Cosa analizzare")}</legend>
          <Check label={tr("Rispetta robots.txt")} checked={draft.respect_robots} onChange={(v) => set("respect_robots", v)} />
          <Check label={tr("Verifica i link esterni")} checked={draft.check_external} onChange={(v) => set("check_external", v)} />
          <Check label={tr("Verifica peso e stato delle immagini")} checked={draft.check_images} onChange={(v) => set("check_images", v)} />
          <Check label={tr("Leggi le sitemap XML")} checked={draft.use_sitemaps} onChange={(v) => set("use_sitemaps", v)} />
        </fieldset>

        <fieldset>
          <legend>{tr("Escludi URL")}</legend>
          <label>
            {tr("Un'espressione regolare per riga")}
            <textarea
              rows={4}
              value={draft.exclude.join("\n")}
              onChange={(e) => set("exclude", e.currentTarget.value.split("\n"))}
              placeholder={"/tag/\n\\?replytocom="}
              spellCheck={false}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>{tr("Estrazione e ricerca")}</legend>
          <small>{tr("Estrai dati o cerca testo nel sorgente di ogni pagina.")}</small>
          {draft.rules.map((rule, i) => (
            <RuleEditor
              key={i}
              index={i}
              rule={rule}
              onChange={(r) => set("rules", draft.rules.map((old, j) => (j === i ? r : old)))}
              onRemove={() => set("rules", draft.rules.filter((_, j) => j !== i))}
            />
          ))}
          <button
            type="button"
            className="link add-rule"
            onClick={() => set("rules", [...draft.rules, { name: "", kind: "css", expr: "", attr: null }])}
          >
            {tr("+ Aggiungi regola")}
          </button>
        </fieldset>

        <footer>
          <button type="button" className="link" onClick={() => setDraft(DEFAULT_SETTINGS)}>
            {tr("Ripristina predefinite")}
          </button>
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            {tr("Annulla")}
          </button>
          <button type="submit" className="primary">
            {tr("Salva")}
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

const EXAMPLES: Record<RuleSpec["kind"], { expr: string; attr?: string }> = {
  css: { expr: 'meta[property="article:author"]', attr: "content" },
  regex: { expr: "id=(G-[A-Z0-9]+)" },
  search: { expr: "googletagmanager.com" },
};

function RuleEditor({
  index,
  rule,
  onChange,
  onRemove,
}: {
  index: number;
  rule: RuleSpec;
  onChange: (r: RuleSpec) => void;
  onRemove: () => void;
}) {
  const label = tr("Regola {n}", { n: index + 1 });
  return (
    <div className="rule" role="group" aria-label={label}>
      <input
        type="text"
        aria-label={`${label}: ${tr("Nome")}`}
        placeholder={tr("Nome")}
        value={rule.name}
        onChange={(e) => onChange({ ...rule, name: e.currentTarget.value })}
      />
      <select
        aria-label={`${label}: ${tr("Tipo di regola")}`}
        value={rule.kind}
        onChange={(e) => onChange({ ...rule, kind: e.currentTarget.value as RuleSpec["kind"], attr: null })}
      >
        <option value="css">{tr("Selettore CSS")}</option>
        <option value="regex">{tr("Espressione regolare")}</option>
        <option value="search">{tr("Cerca testo")}</option>
      </select>
      <input
        type="text"
        className="expr"
        aria-label={`${label}: ${tr("Espressione")}`}
        placeholder={EXAMPLES[rule.kind].expr}
        value={rule.expr}
        spellCheck={false}
        onChange={(e) => onChange({ ...rule, expr: e.currentTarget.value })}
      />
      {rule.kind !== "css" && <span aria-hidden />}
      {rule.kind === "css" && (
        <input
          type="text"
          aria-label={`${label}: ${tr("Attributo (facoltativo)")}`}
          placeholder={tr("Attributo (facoltativo)")}
          value={rule.attr ?? ""}
          spellCheck={false}
          onChange={(e) => onChange({ ...rule, attr: e.currentTarget.value || null })}
        />
      )}
      <button type="button" className="remove" onClick={onRemove} aria-label={`${tr("Rimuovi regola")} ${index + 1}`}>
        ✕
      </button>
    </div>
  );
}

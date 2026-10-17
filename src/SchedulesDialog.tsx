import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LANG, LOCALE, tr, trError } from "./i18n";
import type { Settings } from "./settings";

/** Mirrors `schedule::Schedule` in src-tauri/src/schedule.rs. */
type Schedule = {
  id: string;
  url: string;
  weekday: number;
  hour: number;
  last_run_ms: number | null;
  last_report: string | null;
};

type Props = {
  open: boolean;
  /** Prefills the URL field. */
  url: string;
  /** Snapshot taken when the schedule is added; later changes to Settings don't affect it. */
  settings: Settings;
  onClose: () => void;
};

const DAYS = ["Ogni giorno", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const when = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

const label = (s: Pick<Schedule, "weekday" | "hour">) =>
  tr("{day} alle {hour}", { day: tr(DAYS[s.weekday]), hour: `${String(s.hour).padStart(2, "0")}:00` });

/** Recurring crawls run by macOS even with the app closed; each one notifies what changed. */
export function SchedulesDialog({ open, url, settings, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState({ url, weekday: 1, hour: 7 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError(null);
      setDraft((d) => ({ ...d, url: url.length > "https://".length ? url : d.url }));
      invoke<Schedule[]>("list_schedules").then(setList, () => setList([]));
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, url]);

  const call = (cmd: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    invoke<Schedule[]>(cmd, args)
      .then(setList, (e) => setError(trError(String(e))))
      .finally(() => setBusy(false));
  };

  return (
    <dialog ref={ref} className="settings schedules" onClose={onClose} aria-labelledby="schedules-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          call("add_schedule", { url: draft.url, settings, weekday: draft.weekday, hour: draft.hour, lang: LANG });
        }}
      >
        <h2 id="schedules-title">{tr("Crawl pianificati")}</h2>
        <small>
          {tr("macOS avvia il crawl all'ora scelta, anche con CyberFrog chiuso, e ti manda una notifica con cosa è cambiato rispetto al giro precedente. Usa le impostazioni attuali.")}
        </small>

        {list.length > 0 && (
          <ul className="schedule-list">
            {list.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.url}</strong>
                  <span>{label(s)}</span>
                  <span className="muted">
                    {s.last_run_ms
                      ? `${when.format(new Date(s.last_run_ms))}: ${s.last_report ?? ""}`
                      : tr("Non ancora eseguito")}
                  </span>
                </div>
                <button type="button" className="link" disabled={busy} onClick={() => call("remove_schedule", { id: s.id })}>
                  {tr("Rimuovi")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <fieldset>
          <legend>{tr("Nuova pianificazione")}</legend>
          <label>
            URL
            <input
              type="text"
              required
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.currentTarget.value })}
              placeholder={tr("https://esempio.it")}
            />
          </label>
          <div className="row">
            <label>
              {tr("Quando")}
              <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.currentTarget.value) })}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {tr(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("Ora")}
              <select value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: Number(e.currentTarget.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        {error && (
          <small className="error" role="alert">
            {error}
          </small>
        )}

        <footer>
          <span className="spacer" />
          <button type="button" className="secondary" onClick={onClose}>
            {tr("Chiudi")}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {tr("Pianifica")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

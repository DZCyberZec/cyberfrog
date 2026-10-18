// AI visibility tracker: questions people ask, whether an AI answer with web search cites the site,
// where, and who it cites instead. Checks run one question at a time; history is saved per site.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NO_KEY_TEXT } from "./AiAssist";
import { LOCALE, tr, trError } from "./i18n";
import type { AiEngine } from "./settings";
import {
  MAX_QUERIES,
  addRuns,
  citedInstead,
  evaluate,
  history,
  parseQueries,
  visibility,
  type SearchAnswer,
  type TrackerData,
  type TrackerRun,
  type TrackerSite,
} from "./tracker";

type Props = { host: string; engine: AiEngine; aiReady: boolean; suggestions: string[] };

const when = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" });
const pct = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });
const EMPTY: TrackerSite = { queries: [], runs: [] };

export function TrackerReport({ host, engine, aiReady, suggestions }: Props) {
  const [data, setData] = useState<TrackerData>({});
  const [draft, setDraft] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const site = data.sites?.[host] ?? EMPTY;

  useEffect(() => {
    invoke<TrackerData>("tracker_load").then(
      (d) => {
        setData(d);
        setDraft((d.sites?.[host]?.queries ?? []).join("\n"));
      },
      () => setData({}),
    );
  }, [host]);

  const store = async (next: TrackerSite) => {
    const all: TrackerData = { ...data, sites: { ...data.sites, [host]: next } };
    setData(all);
    await invoke("tracker_save", { data: all });
  };

  async function check() {
    const queries = parseQueries(draft);
    if (!queries.length) return;
    setError(null);
    let current: TrackerSite = { ...site, queries };
    const runs: TrackerRun[] = [];
    for (const [i, q] of queries.entries()) {
      setProgress({ done: i, total: queries.length });
      try {
        const answer = await invoke<SearchAnswer>("ai_search", { engine, query: q });
        runs.push(evaluate(host, answer, q, engine, Date.now()));
        current = addRuns(current, runs.slice(-1));
        await store(current); // saved after each answer, so a long check isn't lost halfway
      } catch (e) {
        setError(`${q}: ${trError(String(e))}`);
        break;
      }
    }
    setProgress(null);
  }

  const rows = useMemo(() => site.queries.map((q) => ({ q, runs: history(site, q) })), [site]);
  const share = visibility(site);
  const instead = useMemo(() => citedInstead(site, host).slice(0, 8), [site, host]);
  const changed = parseQueries(draft).join("\n") !== site.queries.join("\n");

  return (
    <div className="tracker">
      <section className="tracker-head">
        <div>
          <h2>{tr("Visibilità di {host} nelle risposte AI", { host })}</h2>
          <p className="muted">
            {tr("Per ogni domanda, l'AI scelta in Impostazioni risponde usando la ricerca web: vedi se cita il tuo sito, in che posizione e chi cita al posto tuo. Ogni domanda usa una richiesta AI.")}
          </p>
        </div>
        {share !== null && (
          <div className="tracker-score">
            <strong>{pct.format(share)}</strong>
            <small>{tr("delle risposte ti citano")}</small>
          </div>
        )}
      </section>

      <div className="comp-grid">
        <section className="comp-card">
          <h3>{tr("Domande da seguire")}</h3>
          <textarea
            rows={7}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            placeholder={suggestions.length ? suggestions.join("\n") : tr("Una domanda per riga, come la scriverebbe un cliente")}
            aria-label={tr("Domande da seguire")}
          />
          <div className="tracker-actions">
            <small className="muted">{tr("Una per riga, al massimo {n}.", { n: MAX_QUERIES })}</small>
            {!draft.trim() && suggestions.length > 0 && (
              <button type="button" className="link" onClick={() => setDraft(suggestions.join("\n"))}>
                {tr("Usa i suggerimenti")}
              </button>
            )}
            <span className="spacer" />
            {changed && (
              <button type="button" className="secondary" onClick={() => store({ ...site, queries: parseQueries(draft) })}>
                {tr("Salva")}
              </button>
            )}
            <button
              type="button"
              className="go"
              onClick={check}
              disabled={!aiReady || !!progress || !parseQueries(draft).length}
              title={aiReady ? undefined : tr(NO_KEY_TEXT)}
            >
              {progress ? tr("Verifica {d}/{t}…", { d: progress.done + 1, t: progress.total }) : tr("Verifica ora")}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>

        <section className="comp-card">
          <h3>{tr("Chi viene citato al posto tuo")}</h3>
          {instead.length === 0 ? (
            <p className="muted">{tr("Ancora nessun dato: avvia una verifica.")}</p>
          ) : (
            <ul className="instead">
              {instead.map((s) => (
                <li key={s.host}>
                  <span>{s.host}</span>
                  <small className="muted">{tr("{n} risposte", { n: s.answers })}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {rows.length > 0 && (
        <section className="comp-card">
          <h3>{tr("Risultati")}</h3>
          <table className="comp-table tracker-table">
            <thead>
              <tr>
                <th>{tr("Domanda")}</th>
                <th>{tr("Ti cita?")}</th>
                <th>{tr("Siti citati")}</th>
                <th>{tr("Andamento")}</th>
                <th>{tr("Ultima verifica")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ q, runs }) => {
                const last = runs[0];
                return (
                  <tr key={q} className="clickable" onClick={() => setOpen(open === q ? null : q)}>
                    <td>{q}</td>
                    <td>
                      {!last ? (
                        <span className="muted">–</span>
                      ) : last.position ? (
                        <span className="badge ok">{tr("Sì, #{n}", { n: last.position })}</span>
                      ) : last.found ? (
                        <span className="badge redirect">{tr("Trovato, non citato")}</span>
                      ) : (
                        <span className="badge client">{tr("No")}</span>
                      )}
                    </td>
                    <td className="sources">{last?.sources.slice(0, 3).join(", ")}</td>
                    <td className="trend" aria-label={tr("Andamento")}>
                      {runs
                        .slice(0, 8)
                        .reverse()
                        .map((r) => (
                          <i key={r.at} className={r.position ? "yes" : "no"} title={when.format(new Date(r.at))} />
                        ))}
                    </td>
                    <td>{last ? when.format(new Date(last.at)) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {open && history(site, open)[0] && (
            <div className="ai-out tracker-answer">
              <div className="ai-text">{history(site, open)[0].excerpt}…</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

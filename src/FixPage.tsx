// "Risolvi con AI": pick an issue, see exactly what would be sent and roughly how many tokens it
// costs, choose the pages, and only then start the request.
import { useEffect, useMemo, useState } from "react";
import { AiOutput, ENGINE_LABEL, NO_KEY_TEXT, costText, type AiState } from "./AiAssist";
import { FIX_ITEMS, estimateTokens, fixPrompt, systemPrompt } from "./ai";
import { LOCALE, tr } from "./i18n";
import { issueRows, rowDetail, rowLabel, type CrawlSnapshot, type DupPage, type Issue, type Page } from "./pages";
import type { AiEngine } from "./settings";

/** Rows listed to pick from; the rest wait for a later round. */
const LISTED = 50;
/** Rough answer size per page plus a closing note, for the estimate. */
const ANSWER_PER_ITEM = 180;
const ANSWER_BASE = 150;

export const issueKey = (i: Pick<Issue, "tab" | "filter">) => `${i.tab}:${i.filter}`;

type Props = {
  issues: Issue[];
  snapshot: CrawlSnapshot;
  dupRows: DupPage[];
  pages: Page[];
  host: string;
  engine: AiEngine;
  aiReady: boolean;
  /** Issue chosen in the Issues tab, if any. */
  initial: string | null;
  ai: { state: AiState; start: (prompt: string) => void };
};

export function FixPage({ issues, snapshot, dupRows, pages, host, engine, aiReady, initial, ai }: Props) {
  const [key, setKey] = useState(() => initial ?? (issues[0] ? issueKey(issues[0]) : ""));
  useEffect(() => {
    if (initial) setKey(initial);
  }, [initial]);
  const issue = issues.find((i) => issueKey(i) === key);
  const rows = useMemo(() => (issue ? issueRows(issue, snapshot, dupRows) : []), [issue, snapshot, dupRows]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  // a new issue starts with its first pages ticked, up to the per-request limit
  useEffect(() => setChosen(new Set(rows.slice(0, FIX_ITEMS).map((_, i) => i))), [rows]);
  const [ranFor, setRanFor] = useState("");

  const selected = useMemo(() => rows.filter((_, i) => chosen.has(i)), [rows, chosen]);
  const prompt = useMemo(() => (issue && selected.length ? fixPrompt(host, issue, selected, pages) : ""), [host, issue, selected, pages]);
  const sent = prompt ? estimateTokens(systemPrompt() + prompt) : 0;
  const answer = selected.length ? selected.length * ANSWER_PER_ITEM + ANSWER_BASE : 0;
  const n = (v: number) => v.toLocaleString(LOCALE);

  function toggle(i: number) {
    const next = new Set(chosen);
    if (next.has(i)) next.delete(i);
    else if (next.size < FIX_ITEMS) next.add(i);
    setChosen(next);
  }

  if (issues.length === 0) {
    return (
      <div className="competitor fix">
        <p className="empty">{tr("Nessun problema da risolvere in questo crawl.")}</p>
      </div>
    );
  }

  const running = ai.state.status === "loading";
  return (
    <div className="competitor fix">
      <section className="comp-card">
        <h2>{tr("Risolvi con AI")}</h2>
        <p className="muted">
          {tr("Scegli un problema e le pagine: prima di avviare vedi cosa viene inviato all'AI e una stima dei token. Niente viene modificato sul sito: ricevi le correzioni da copiare.")}
        </p>
        <label className="fix-pick">
          {tr("Problema")}
          <select value={key} onChange={(e) => setKey(e.currentTarget.value)}>
            {issues.map((i) => (
              <option key={issueKey(i)} value={issueKey(i)}>
                [{tr(i.priority)}] {i.label} ({n(i.count)})
              </option>
            ))}
          </select>
        </label>
      </section>

      {issue && (
        <>
          <div className="fix-grid">
            <section className="comp-card">
              <h3>{tr("Cosa farà")}</h3>
              <ol className="fix-steps">
                <li>{tr("Invia a {engine} i dati del crawl delle {n} pagine scelte (title, meta, H1, parole, link, stato).", { engine: ENGINE_LABEL[engine], n: selected.length })}</li>
                <li>{tr("Chiede per ognuna la correzione pronta da incollare. Suggerimento del report: {fix}", { fix: issue.fix })}</li>
                <li>{tr("Ti mostra il risultato qui sotto da copiare: il sito non viene toccato.")}</li>
              </ol>
            </section>
            <section className="comp-card">
              <h3>{tr("Stima")}</h3>
              <dl className="fix-est">
                <dt>{tr("Token inviati")}</dt>
                <dd>≈ {n(sent)}</dd>
                <dt>{tr("Token in risposta")}</dt>
                <dd>≈ {n(answer)}</dd>
                <dt>{tr("Motore")}</dt>
                <dd>{ENGINE_LABEL[engine]}</dd>
                <dt>{tr("Costo")}</dt>
                <dd>{costText(engine)}</dd>
              </dl>
              <small className="muted">{tr("Stima indicativa: il conteggio reale dipende dal modello e dalla lunghezza della risposta.")}</small>
            </section>
          </div>

          <section className="comp-card">
            <h3>
              {tr("Pagine da inviare")} <span className="muted">{tr("{n} di {max} per richiesta", { n: selected.length, max: FIX_ITEMS })}</span>
            </h3>
            {rows.length > LISTED && (
              <small className="muted">{tr("Mostrate le prime {n} di {total}: le altre puoi risolverle in un secondo giro.", { n: LISTED, total: n(rows.length) })}</small>
            )}
            <ul className="fix-items">
              {rows.slice(0, LISTED).map((r, i) => (
                <li key={i}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={chosen.has(i)}
                      disabled={!chosen.has(i) && chosen.size >= FIX_ITEMS}
                      onChange={() => toggle(i)}
                    />
                    <span className="fix-url">{rowLabel(r)}</span>
                    <span className="muted fix-detail">{rowDetail(r)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <details>
              <summary>{tr("Mostra la richiesta completa")}</summary>
              <pre className="fix-prompt">{prompt}</pre>
            </details>
            <div className="fix-actions">
              <button
                type="button"
                className="go"
                disabled={!aiReady || selected.length === 0 || running}
                onClick={() => {
                  setRanFor(issue.label);
                  ai.start(prompt); // this page is the preview
                }}
              >
                {running ? tr("Claude sta scrivendo…") : tr("Avvia la correzione")}
              </button>
              {!aiReady && <small className="muted">{tr(NO_KEY_TEXT)}</small>}
            </div>
          </section>
        </>
      )}

      {ai.state.status !== "idle" && (
        <section className="comp-card">
          <h3>{tr("Risultato: {issue}", { issue: ranFor })}</h3>
          <AiOutput state={ai.state} />
        </section>
      )}
    </div>
  );
}

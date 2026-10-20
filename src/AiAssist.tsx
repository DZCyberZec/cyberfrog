import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LOCALE, tr, trError } from "./i18n";
import { estimateTokens, systemPrompt } from "./ai";
import type { AiEngine } from "./settings";

export type AiState =
  | { status: "idle" }
  /** Waiting for the user to confirm: nothing has been sent yet. */
  | { status: "preview"; prompt: string; engine: AiEngine; start: () => void; cancel: () => void }
  | { status: "loading" }
  | { status: "done"; text: string }
  | { status: "error"; text: string };

export const ENGINE_LABEL: Record<AiEngine, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  api: tr("API Anthropic"),
};

export const costText = (engine: AiEngine) =>
  engine === "api" ? tr("A consumo sulla tua chiave API Anthropic") : tr("Incluso nell'abbonamento: usa la quota del piano");

/**
 * One Claude request at a time; an answer that arrives after a newer request (or unmount) is dropped.
 * `run` first shows a preview of the request and its cost; `start` sends it at once (for pages that
 * already showed their own preview).
 */
export function useAi(engine: AiEngine) {
  const [state, setState] = useState<AiState>({ status: "idle" });
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);
  const start = useCallback((prompt: string) => {
    const mine = ++seq.current;
    setState({ status: "loading" });
    invoke<string>("ai_complete", { engine, system: systemPrompt(), prompt }).then(
      (text) => mine === seq.current && setState({ status: "done", text }),
      (e) => mine === seq.current && setState({ status: "error", text: trError(String(e)) }),
    );
  }, [engine]);
  const reset = useCallback(() => {
    seq.current++;
    setState({ status: "idle" });
  }, []);
  const run = useCallback((prompt: string) => {
    seq.current++; // an answer still on its way belongs to the previous request
    setState({ status: "preview", prompt, engine, start: () => start(prompt), cancel: reset });
  }, [engine, start, reset]);
  return { state, run, start, reset };
}

/** What a request will send and roughly cost, with the buttons to start or drop it. */
function AiPreview({ state }: { state: Extract<AiState, { status: "preview" }> }) {
  const tokens = estimateTokens(systemPrompt() + state.prompt);
  return (
    <div className="ai-out ai-preview" aria-live="polite">
      <strong>{tr("Prima di avviare")}</strong>
      <dl className="fix-est">
        <dt>{tr("Motore")}</dt>
        <dd>{ENGINE_LABEL[state.engine]}</dd>
        <dt>{tr("Token inviati")}</dt>
        <dd>≈ {tokens.toLocaleString(LOCALE)}</dd>
        <dt>{tr("Costo")}</dt>
        <dd>{costText(state.engine)}</dd>
      </dl>
      <small className="muted">{tr("Vengono inviati solo i dati del crawl mostrati nella richiesta; il sito non viene modificato. La risposta aggiunge altri token.")}</small>
      <details>
        <summary>{tr("Mostra la richiesta completa")}</summary>
        <pre className="fix-prompt">{state.prompt}</pre>
      </details>
      <div className="fix-actions">
        <button type="button" className="go" onClick={state.start}>
          {tr("Avvia la richiesta")}
        </button>
        <button type="button" className="link" onClick={state.cancel}>
          {tr("Annulla")}
        </button>
      </div>
    </div>
  );
}

/** Claude's answer, or its preview, progress or error, with a copy button. */
export function AiOutput({ state }: { state: AiState }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [state]);
  if (state.status === "idle") return null;
  if (state.status === "preview") return <AiPreview state={state} />;
  if (state.status === "loading") return <p className="ai-out muted" aria-live="polite">{tr("Claude sta scrivendo…")}</p>;
  if (state.status === "error") return <p className="ai-out error" role="alert">{state.text}</p>;
  return (
    <div className="ai-out" aria-live="polite">
      <button
        type="button"
        className="ghost copy"
        onClick={() =>
          navigator.clipboard.writeText(state.text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? tr("Copiato") : tr("Copia")}
      </button>
      <div className="ai-text">{state.text}</div>
    </div>
  );
}

export const NO_KEY_TEXT = "Configura l'assistente AI in Impostazioni: Claude Code oppure una chiave API.";

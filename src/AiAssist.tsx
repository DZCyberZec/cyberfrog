import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, trError } from "./i18n";
import { systemPrompt } from "./ai";

export type AiState = { status: "idle" } | { status: "loading" } | { status: "done"; text: string } | { status: "error"; text: string };

/** One Claude request at a time; an answer that arrives after a newer request (or unmount) is dropped. */
export function useAi() {
  const [state, setState] = useState<AiState>({ status: "idle" });
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);
  const run = useCallback((prompt: string) => {
    const mine = ++seq.current;
    setState({ status: "loading" });
    invoke<string>("ai_complete", { system: systemPrompt(), prompt }).then(
      (text) => mine === seq.current && setState({ status: "done", text }),
      (e) => mine === seq.current && setState({ status: "error", text: trError(String(e)) }),
    );
  }, []);
  const reset = useCallback(() => {
    seq.current++;
    setState({ status: "idle" });
  }, []);
  return { state, run, reset };
}

/** Claude's answer, or its progress or error, with a copy button. */
export function AiOutput({ state }: { state: AiState }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [state]);
  if (state.status === "idle") return null;
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

export const NO_KEY_TEXT = "Aggiungi la tua chiave API Anthropic in Impostazioni per usare l'assistente AI.";

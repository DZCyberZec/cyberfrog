import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, trError } from "./i18n";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; text: string } | { status: "done"; text: string };

/** FAQPage JSON-LD for one page, built by the backend from its question headings. */
export function FaqSchema({ url }: { url: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  function generate() {
    setState({ status: "loading" });
    setCopied(false);
    invoke<string>("faq_schema", { url }).then(
      (text) => setState({ status: "done", text }),
      (e) => setState({ status: "error", text: trError(String(e)) }),
    );
  }

  return (
    <section className="faq-schema" aria-label={tr("Schema FAQ per questa pagina")}>
      <div className="ai-actions">
        <button type="button" onClick={generate} disabled={state.status === "loading"}>
          {tr("Genera schema FAQ")}
        </button>
      </div>
      <small className="muted">{tr("Usa i sottotitoli a domanda della pagina e il testo che li segue. Incolla il blocco nell'HTML della pagina.")}</small>
      {state.status === "loading" && (
        <p className="ai-out muted" aria-live="polite">
          {tr("Leggo la pagina…")}
        </p>
      )}
      {state.status === "error" && (
        <p className="ai-out error" role="alert">
          {state.text}
        </p>
      )}
      {state.status === "done" && (
        <div className="ai-out">
          <button
            type="button"
            className="ghost copy"
            onClick={() => navigator.clipboard.writeText(state.text).then(() => setCopied(true), () => setCopied(false))}
          >
            {copied ? tr("Copiato") : tr("Copia")}
          </button>
          <pre className="faq-pre">{state.text}</pre>
        </div>
      )}
    </section>
  );
}

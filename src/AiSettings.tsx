import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LOCALE, tr, trError } from "./i18n";
import { systemPrompt } from "./ai";
import type { AiEngine } from "./settings";

/** Mirrors `ai::Status` in src-tauri/src/ai/mod.rs. */
export type AiStatus = {
  has_key: boolean;
  claude_code: string | null;
  claude_code_ready: boolean;
  codex: string | null;
  codex_ready: boolean;
};
export const NO_AI: AiStatus = { has_key: false, claude_code: null, claude_code_ready: false, codex: null, codex_ready: false };

export const isAiReady = (engine: AiEngine, s: AiStatus) =>
  engine === "claude-code" ? s.claude_code_ready : engine === "codex" ? s.codex_ready : s.has_key;

type State = "ready" | "login" | "missing";

type Props = {
  engine: AiEngine;
  onEngine: (e: AiEngine) => void;
  status: AiStatus;
  /** Reads the engines' status again (after a login or a new key). */
  onRefresh: () => void;
};

/** Settings fieldset: which engine answers, whether each one is connected, and how to connect it. */
export function AiSettings({ engine, onEngine, status, onRefresh }: Props) {
  const [test, setTest] = useState<{ ok: boolean; text: string } | "running" | null>(null);
  const engines: { id: AiEngine; label: string; state: State; steps: string[] }[] = [
    {
      id: "claude-code",
      label: tr("Claude Code (abbonamento Claude, nessun costo API)"),
      state: status.claude_code_ready ? "ready" : status.claude_code ? "login" : "missing",
      steps: [
        tr("Installa Claude Code da claude.com/code."),
        tr("Apri il Terminale ed esegui: claude"),
        tr("Scrivi /login e accedi con il tuo account Claude."),
        tr("Torna qui e premi Verifica connessione."),
      ],
    },
    {
      id: "codex",
      label: tr("Codex (abbonamento ChatGPT, nessun costo API)"),
      state: status.codex_ready ? "ready" : status.codex ? "login" : "missing",
      steps: [
        tr("Installa l'app ChatGPT per Mac (include Codex) oppure la CLI Codex."),
        tr("Apri il Terminale ed esegui: codex login"),
        tr("Accedi con il tuo account ChatGPT."),
        tr("Torna qui e premi Verifica connessione."),
      ],
    },
    {
      id: "api",
      label: tr("Chiave API Anthropic (a consumo)"),
      state: status.has_key ? "ready" : "login",
      steps: [tr("Crea una chiave su console.anthropic.com e incollala qui sotto: resta nel Portachiavi di macOS.")],
    },
  ];
  const STATE_LABEL: Record<State, string> = {
    ready: tr("Connesso"),
    login: tr("Da collegare"),
    missing: tr("Non installato"),
  };
  const STATE_BADGE: Record<State, string> = { ready: "ok", login: "redirect", missing: "blocked" };

  async function verify() {
    setTest("running");
    onRefresh();
    const t0 = performance.now();
    try {
      await invoke<string>("ai_complete", { engine, system: systemPrompt(), prompt: "Reply with the single word OK." });
      const s = ((performance.now() - t0) / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 });
      setTest({ ok: true, text: tr("Connesso: ha risposto in {s} s.", { s }) });
    } catch (e) {
      setTest({ ok: false, text: trError(String(e)) });
    }
  }

  return (
    <fieldset>
      <legend>{tr("Assistente AI")}</legend>
      <small>
        {tr("Claude suggerisce title e meta description, spiega i problemi, scrive piani d'azione e tiene traccia della tua visibilità nelle risposte AI. I dati delle pagine analizzate vengono inviati al servizio scelto.")}
      </small>
      {engines.map((e) => (
        <div key={e.id} className={`engine${engine === e.id ? " chosen" : ""}`}>
          <label className="check">
            <input
              type="radio"
              name="ai-engine"
              checked={engine === e.id}
              onChange={() => {
                onEngine(e.id);
                setTest(null);
              }}
            />
            <span className="engine-label">{e.label}</span>
            <span className={`badge ${STATE_BADGE[e.state]}`}>{STATE_LABEL[e.state]}</span>
          </label>
          {engine === e.id && e.state !== "ready" && (
            <ol className="steps">
              {e.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {engine === e.id && e.id === "api" && <KeyField hasKey={status.has_key} onChange={onRefresh} />}
        </div>
      ))}
      <div className="key-row">
        <button type="button" className="secondary" onClick={verify} disabled={test === "running"}>
          {test === "running" ? tr("Verifica in corso…") : tr("Verifica connessione")}
        </button>
        {test && test !== "running" && (
          <small className={test.ok ? "ok-text" : "error"} role="status">
            {test.text}
          </small>
        )}
      </div>
    </fieldset>
  );
}

/** The key is saved straight to the macOS Keychain, on its own, not with the settings. */
function KeyField({ hasKey, onChange }: { hasKey: boolean; onChange: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const store = (value: string) =>
    invoke("ai_set_key", { key: value }).then(
      () => {
        setKey("");
        setError(null);
        onChange();
      },
      (e) => setError(trError(String(e))),
    );
  return (
    <>
      {hasKey ? (
        <div className="key-row">
          <span>{tr("Chiave salvata nel Portachiavi di macOS.")}</span>
          <button type="button" className="link" onClick={() => store("")}>
            {tr("Rimuovi chiave")}
          </button>
        </div>
      ) : (
        <div className="key-row">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Enter would submit the settings form and drop the key
              if (e.key === "Enter") {
                e.preventDefault();
                if (key.trim()) store(key);
              }
            }}
            placeholder="sk-ant-…"
            aria-label={tr("Chiave API Anthropic")}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="secondary" onClick={() => store(key)} disabled={!key.trim()}>
            {tr("Salva chiave")}
          </button>
        </div>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </>
  );
}

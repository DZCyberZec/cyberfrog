import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, trError } from "./i18n";
import type { AiEngine } from "./settings";

/** Mirrors `ai::Status` in src-tauri/src/ai/mod.rs. */
export type AiStatus = { has_key: boolean; claude_code: string | null };

export const isAiReady = (engine: AiEngine, s: AiStatus) => (engine === "claude-code" ? s.claude_code !== null : s.has_key);

type Props = {
  engine: AiEngine;
  onEngine: (e: AiEngine) => void;
  status: AiStatus;
  onKeyChange: () => void;
};

/** Settings fieldset: which engine answers, and the API key when that engine is chosen. */
export function AiSettings({ engine, onEngine, status, onKeyChange }: Props) {
  return (
    <fieldset>
      <legend>{tr("Assistente AI")}</legend>
      <small>
        {tr("Claude suggerisce title e meta description, spiega i problemi e scrive un piano d'azione. I dati delle pagine analizzate vengono inviati ad Anthropic.")}
      </small>
      <label className="check">
        <input type="radio" name="ai-engine" checked={engine === "claude-code"} onChange={() => onEngine("claude-code")} />
        {tr("Claude Code (il tuo abbonamento Claude, nessun costo API)")}
      </label>
      {engine === "claude-code" && (
        <small className={status.claude_code ? undefined : "error"}>
          {status.claude_code
            ? tr("Trovato in {path}. Se chiede il login: apri il Terminale, esegui claude e poi /login.", { path: status.claude_code })
            : tr("Claude Code non è installato: installalo da claude.com/code oppure usa una chiave API.")}
        </small>
      )}
      <label className="check">
        <input type="radio" name="ai-engine" checked={engine === "api"} onChange={() => onEngine("api")} />
        {tr("Chiave API Anthropic (a consumo)")}
      </label>
      {engine === "api" && <KeyField hasKey={status.has_key} onChange={onKeyChange} />}
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

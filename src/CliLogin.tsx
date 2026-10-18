// "Sign in" for Claude Code and Codex from inside CyberFrog. Both usually finish by themselves in the
// browser; Claude Code may instead show a code, which can be pasted here.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tr, trError } from "./i18n";

type Started = { url: string | null; needs_code: boolean };
type Props = { engine: "claude-code" | "codex"; onDone: () => void };
type Status = { claude_code_ready: boolean; codex_ready: boolean };

/** How often to look whether the browser sign-in has finished. */
const POLL_MS = 2500;

export function CliLogin({ engine, onDone }: Props) {
  const [phase, setPhase] = useState<"idle" | "starting" | "code" | "browser" | "sending">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = engine === "codex" ? "Codex" : "Claude";

  // the CLI usually completes on its own once the browser sign-in is done: watch for it
  useEffect(() => {
    if (phase !== "code") return;
    const timer = setInterval(() => {
      invoke<Status>("ai_status").then((s) => {
        if (engine === "codex" ? s.codex_ready : s.claude_code_ready) {
          invoke("ai_login_cancel").catch(() => {});
          setPhase("idle");
          onDone();
        }
      }, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, engine, onDone]);

  async function start() {
    setError(null);
    setPhase(engine === "codex" ? "browser" : "starting");
    try {
      const s = await invoke<Started>("ai_login", { engine });
      if (s.needs_code) {
        setUrl(s.url);
        setPhase("code");
      } else {
        setPhase("idle");
        onDone();
      }
    } catch (e) {
      setError(trError(String(e)));
      setPhase("idle");
    }
  }

  async function send() {
    setError(null);
    setPhase("sending");
    try {
      const ok = await invoke<boolean>("ai_login_code", { code });
      if (!ok) throw tr("Accesso non riuscito: riprova");
      setCode("");
      setPhase("idle");
      onDone();
    } catch (e) {
      setError(trError(String(e)));
      setPhase("idle");
    }
  }

  function cancel() {
    invoke("ai_login_cancel").catch(() => {});
    setPhase("idle");
    setCode("");
  }

  return (
    <div className="cli-login">
      {phase === "idle" || phase === "starting" ? (
        <button type="button" className="primary" onClick={start} disabled={phase === "starting"}>
          {phase === "starting" ? tr("Avvio…") : tr("Accedi a {name}", { name })}
        </button>
      ) : phase === "browser" ? (
        <small>{tr("Accedi nel browser che si è aperto: CyberFrog si aggiorna da solo quando hai finito.")}</small>
      ) : (
        <>
          <small>{tr("Accedi nel browser che si è aperto: CyberFrog si aggiorna da solo quando hai finito. Se invece Claude ti mostra un codice, incollalo qui.")}</small>
          <div className="key-row">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter would submit the settings form
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (code.trim()) send();
                }
              }}
              placeholder={tr("Codice di accesso")}
              aria-label={tr("Codice di accesso")}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button type="button" className="primary" onClick={send} disabled={!code.trim() || phase === "sending"}>
              {phase === "sending" ? tr("Verifica in corso…") : tr("Conferma")}
            </button>
            <button type="button" className="link" onClick={cancel}>
              {tr("Annulla")}
            </button>
          </div>
          {url && (
            <button type="button" className="link" onClick={() => openUrl(url)}>
              {tr("Il browser non si è aperto? Apri la pagina di accesso")}
            </button>
          )}
        </>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

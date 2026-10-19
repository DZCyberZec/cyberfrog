import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { tr, trError } from "./i18n";
import type { GscStatus } from "./gsc";

type Busy = "login" | "client" | "service" | null;

/** Settings fieldset: connect Search Console by Google sign-in, or with your own OAuth client or a service account. */
export function GscSettings({ open }: { open: boolean }) {
  const [status, setStatus] = useState<GscStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const clientFile = useRef<HTMLInputElement>(null);
  const serviceFile = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    invoke<GscStatus>("gsc_status").then(setStatus, () => setStatus(null));
  }, []);
  useEffect(() => {
    if (open) refresh(); // a sign-in done meanwhile shows up at once
  }, [open, refresh]);

  /** Runs one command; the message is shown whether it works or not. */
  async function run(kind: Exclude<Busy, null>, job: () => Promise<unknown>, done?: string) {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      await job();
      setNote(done ?? null);
    } catch (e) {
      setError(trError(String(e)));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  /** The file is read in the webview and passed on as text; nothing else touches the disk from here. */
  const importFile = (input: HTMLInputElement | null, kind: "client" | "service") => {
    const file = input?.files?.[0];
    if (!input || !file) return;
    input.value = ""; // choosing the same file again must still fire onChange
    run(
      kind,
      async () => {
        const json = await file.text();
        await (kind === "client" ? invoke("gsc_set_client", { json }) : invoke("gsc_set_service_account", { json }));
      },
      kind === "client"
        ? tr("Client OAuth importato: ora puoi accedere con Google.")
        : tr("Service account importato. Aggiungi l'email del service account come utente della proprietà in Search Console ed elimina il file JSON scaricato."),
    );
  };

  const accounts = status?.accounts ?? [];
  const connected = accounts.length > 0;
  return (
    <fieldset>
      <legend>Google Search Console</legend>
      <small>
        {tr("Mostra clic, impressioni e posizione di ogni pagina accanto al crawl. L'accesso è di sola lettura e puoi revocarlo in ogni momento dal tuo account Google.")}
      </small>
      {connected ? (
        <ul className="gsc-accounts">
          {accounts.map((a) => (
            <li key={a.id}>
              <span className="badge ok">{a.method === "service_account" ? tr("Service account") : "Google"}</span>
              <span className="gsc-email">{a.email ?? tr("Account Google")}</span>
              <button
                type="button"
                className="link"
                onClick={() => run("login", () => invoke("gsc_logout", { account: a.id }))}
                disabled={busy !== null}
              >
                {tr("Rimuovi")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="key-row">
          <span className="badge blocked">{tr("Non collegato")}</span>
        </div>
      )}
      <div className="key-row">
        <button
          type="button"
          className="secondary"
          onClick={() => run("login", () => invoke("gsc_login"))}
          disabled={busy !== null || !status?.client}
          title={status?.client ? undefined : tr("Importa prima un client OAuth (vedi i passi qui sotto)")}
        >
          {busy === "login"
            ? tr("Attendo l'accesso nel browser…")
            : connected
              ? tr("Aggiungi un altro account Google")
              : tr("Accedi con Google")}
        </button>
        {connected && <small>{tr("Ogni proprietà usa l'account che può leggerla.")}</small>}
      </div>
      {!connected && status && !status.client && (
        <ol className="steps">
          <li>{tr("Su console.cloud.google.com crea un progetto e abilita la Google Search Console API.")}</li>
          <li>{tr("In Google Auth Platform: compila Branding, scegli Pubblico «Esterno» e aggiungi il tuo account tra gli utenti di test.")}</li>
          <li>{tr("In Accesso ai dati aggiungi l'ambito webmasters.readonly.")}</li>
          <li>{tr("In Client crea un client di tipo «App desktop» e scarica il file JSON.")}</li>
          <li>{tr("Importalo qui sotto in Avanzate, poi premi Accedi con Google.")}</li>
        </ol>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
      {note && (
        <small className="ok-text" role="status">
          {note}
        </small>
      )}
      <details>
        <summary>{tr("Avanzate")}</summary>
        <div className="gsc-advanced">
          <div className="key-row">
            <span className="engine-label">
              {tr("Usa un tuo client OAuth (file JSON)")}
              {status?.client === "custom" && <span className="badge ok">{tr("Importato")}</span>}
            </span>
            <input ref={clientFile} type="file" accept="application/json,.json" hidden onChange={() => importFile(clientFile.current, "client")} />
            <button type="button" className="secondary" onClick={() => clientFile.current?.click()} disabled={busy !== null}>
              {tr("Scegli file…")}
            </button>
          </div>
          <div className="key-row">
            <span className="engine-label">{tr("Aggiungi un service account (file JSON)")}</span>
            <input ref={serviceFile} type="file" accept="application/json,.json" hidden onChange={() => importFile(serviceFile.current, "service")} />
            <button type="button" className="secondary" onClick={() => serviceFile.current?.click()} disabled={busy !== null}>
              {tr("Scegli file…")}
            </button>
          </div>
        </div>
      </details>
    </fieldset>
  );
}

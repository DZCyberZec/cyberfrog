// Where a crawl starts: website or URL list, the address, and Start/Stop. Large on the start screen,
// compact in the header.
import type { FormEvent } from "react";
import { tr } from "./i18n";
import { GlobeIcon, ListIcon } from "./icons";

export type Mode = "spider" | "list";

type Props = {
  large?: boolean;
  mode: Mode;
  onMode: (m: Mode) => void;
  url: string;
  onUrl: (u: string) => void;
  listCount: number;
  onEditList: () => void;
  running: boolean;
  stopped: boolean;
  onStart: (e: FormEvent) => void;
  onStop: () => void;
};

export function CrawlForm(p: Props) {
  return (
    <form className={`crawl-form${p.large ? " large" : ""}`} onSubmit={p.onStart}>
      <div className="segmented" role="radiogroup" aria-label={tr("Modalità")}>
        <button type="button" role="radio" aria-checked={p.mode === "spider"} onClick={() => p.onMode("spider")} disabled={p.running}>
          <GlobeIcon size={14} /> {tr("Sito")}
        </button>
        <button type="button" role="radio" aria-checked={p.mode === "list"} onClick={() => p.onMode("list")} disabled={p.running}>
          <ListIcon size={14} /> {tr("Lista URL")}
        </button>
      </div>
      {p.mode === "spider" ? (
        <input
          type="url"
          required
          value={p.url}
          onChange={(e) => p.onUrl(e.currentTarget.value)}
          placeholder={tr("https://esempio.it")}
          aria-label={tr("URL di partenza")}
          disabled={p.running}
          autoFocus={p.large}
        />
      ) : (
        <button type="button" className="list-pick" onClick={p.onEditList} disabled={p.running}>
          {p.listCount ? tr("{n} URL in lista · modifica", { n: p.listCount }) : tr("Incolla gli URL…")}
        </button>
      )}
      {p.running ? (
        <button type="button" className="go stop" onClick={p.onStop} disabled={p.stopped}>
          {p.stopped ? tr("Interruzione…") : tr("Stop")}
        </button>
      ) : (
        <button type="submit" className="go">
          {tr("Avvia")}
        </button>
      )}
    </form>
  );
}

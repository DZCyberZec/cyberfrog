// The screens shown when no crawl is open: the start page, and progress while a crawl runs.
import type { ComponentProps } from "react";
import { CrawlForm } from "./CrawlForm";
import { LOCALE, tr } from "./i18n";
import { RECENT_SHOWN, STAGE_LABEL, hostOf, type CrawlSummary, type Progress } from "./crawl";

const when = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

type Props = {
  form: ComponentProps<typeof CrawlForm>;
  recent: CrawlSummary[];
  onOpen: (path: string) => void;
  onBrowse: () => void;
};

const FEATURES = ["SEO tecnica", "Contenuti", "Visibilità nelle AI (GEO)", "JavaScript", "Assistente AI"];

export function StartScreen({ form, recent, onOpen, onBrowse }: Props) {
  return (
    <section className="start">
      <h1>{tr("Che sito analizziamo?")}</h1>
      <p className="muted">{tr("CyberFrog segue i link del sito, rispetta robots.txt e ti dice cosa sistemare per Google e per le AI.")}</p>
      <CrawlForm {...form} large />
      <p className="chips">
        {FEATURES.map((f) => (
          <span key={f}>{tr(f)}</span>
        ))}
      </p>
      <div className="recent">
        <header>
          <h2>{tr("Crawl recenti")}</h2>
          <button type="button" className="link" onClick={onBrowse}>
            {tr("Apri un file…")}
          </button>
        </header>
        {recent.length === 0 ? (
          <p className="muted">{tr("Ancora nessun crawl.")}</p>
        ) : (
          <ul>
            {recent.slice(0, RECENT_SHOWN).map((c) => (
              <li key={c.path}>
                <button type="button" onClick={() => onOpen(c.path)}>
                  <span className="recent-host">{hostOf(c.start_url) || tr("Crawl vuoto")}</span>
                  <span className="recent-meta">
                    {tr("{n} URL · {date}", { n: c.pages.toLocaleString(LOCALE), date: when.format(new Date(c.modified_ms)) })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function RunningScreen({ progress }: { progress: Progress | null }) {
  return (
    <section className="start running" aria-live="polite">
      <h1>{tr("Scansione in corso…")}</h1>
      <p className="big-number">{(progress?.done ?? 0).toLocaleString(LOCALE)}</p>
      <p className="muted">
        {STAGE_LABEL[progress?.stage ?? "pages"]}
        {progress && progress.pending > 0 && tr(" · {n} in coda", { n: progress.pending.toLocaleString(LOCALE) })}
      </p>
    </section>
  );
}

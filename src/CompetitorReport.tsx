// Competitor report: crawl (or pick) a competitor, compare both sites, and list how to overtake it.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { AiOutput, NO_KEY_TEXT, useAi } from "./AiAssist";
import { LOCALE, tr, trError } from "./i18n";
import { hostOf, type CrawlData, type CrawlSummary, type Progress } from "./crawl";
import { competitorActions, competitorPrompt, metricRows, summarize, type ContentGap, type GapTopic } from "./competitor";
import type { Settings } from "./settings";

type Props = {
  crawl: CrawlData;
  recent: CrawlSummary[];
  settings: Settings;
  aiReady: boolean;
  onOpenPage: (url: string) => void;
};

/** Remembers each site's competitor crawl between sessions; storage may be unavailable. */
const key = (host: string) => `cyberfrog.competitor.${host}`;
const remembered = (host: string) => {
  try {
    return localStorage.getItem(key(host));
  } catch {
    return null;
  }
};
const remember = (host: string, path: string | null) => {
  try {
    if (path) localStorage.setItem(key(host), path);
    else localStorage.removeItem(key(host));
  } catch {
    // not persisted; the comparison still works now
  }
};

const AREA_BADGE = { SEO: "redirect", GEO: "ok", Contenuti: "server" } as const;
const PRIORITY_BADGE = { Alta: "client", Media: "redirect", Bassa: "blocked" } as const;

export function CompetitorReport({ crawl, recent, settings, aiReady, onOpenPage }: Props) {
  const host = hostOf(crawl.pages[0]?.url);
  const [theirs, setTheirs] = useState<CrawlData | null>(null);
  const [gap, setGap] = useState<ContentGap | null>(null);
  const [url, setUrl] = useState("https://");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = useAi(settings.ai_engine);

  const load = (path: string) => {
    setError(null);
    invoke<CrawlData>("open_crawl", { path }).then(
      (d) => {
        setTheirs(d);
        remember(host, path);
      },
      () => remember(host, null), // the file was deleted or moved: start over
    );
  };
  useEffect(() => {
    setTheirs(null);
    setGap(null);
    const path = remembered(host);
    if (path) load(path);
  }, [crawl.path, host]); // load() only reads host, already a dependency
  useEffect(() => {
    setGap(null);
    if (!theirs) return;
    let current = true;
    invoke<ContentGap>("content_gap", { mine: crawl.path, theirs: theirs.path }).then(
      (g) => current && setGap(g),
      (e) => current && setError(trError(String(e))),
    );
    return () => {
      current = false;
    };
  }, [crawl.path, theirs]);

  async function crawlCompetitor(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setProgress({ stage: "pages", done: 0, pending: 1 });
    const onProgress = new Channel<Progress>();
    onProgress.onmessage = setProgress;
    try {
      // same settings as your crawl, so the numbers compare like for like
      const d = await invoke<CrawlData>("start_crawl", { url, settings, list: null, onProgress });
      setTheirs(d);
      remember(host, d.path);
    } catch (err) {
      setError(trError(String(err)));
    } finally {
      setProgress(null);
    }
  }

  const mine = useMemo(() => summarize(crawl), [crawl]);
  const other = useMemo(() => (theirs ? summarize(theirs) : null), [theirs]);
  const rows = useMemo(() => (other ? metricRows(mine, other) : []), [mine, other]);
  const actions = useMemo(() => (other ? competitorActions(mine, other, gap) : []), [mine, other, gap]);
  const others = recent.filter((c) => c.path !== crawl.path && hostOf(c.start_url) && hostOf(c.start_url) !== host);
  const wins = rows.filter((r) => r.winner === "mine").length;
  const losses = rows.filter((r) => r.winner === "theirs").length;

  if (!theirs || !other) {
    return (
      <div className="competitor">
        <section className="comp-start">
          <h2>{tr("Confronta {host} con un competitor", { host })}</h2>
          <p className="muted">
            {tr("CyberFrog analizza il sito del competitor con le tue stesse impostazioni, poi confronta SEO, GEO e argomenti e ti dice cosa fare per superarlo.")}
          </p>
          <form className="comp-form" onSubmit={crawlCompetitor}>
            <input type="url" required value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://competitor.it" aria-label={tr("URL del competitor")} disabled={!!progress} />
            <button type="submit" className="go" disabled={!!progress}>
              {progress ? tr("Analisi… {n} URL", { n: progress.done.toLocaleString(LOCALE) }) : tr("Analizza il competitor")}
            </button>
          </form>
          {others.length > 0 && (
            <p className="muted">
              {tr("Oppure usa un crawl già fatto:")}{" "}
              {others.slice(0, 6).map((c) => (
                <button key={c.path} type="button" className="chip" onClick={() => load(c.path)}>
                  {hostOf(c.start_url)}
                </button>
              ))}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="competitor">
      <section className="comp-head">
        <div>
          <h2>
            {mine.host} <span className="muted">vs</span> {other.host}
          </h2>
          <p className="muted">
            {tr("Sei avanti su {w} indicatori su {n}, indietro su {l}.", { w: wins, n: rows.length, l: losses })}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setTheirs(null);
            remember(host, null);
          }}
        >
          {tr("Cambia competitor")}
        </button>
      </section>

      <div className="comp-grid">
        <section className="comp-card">
          <h3>{tr("Confronto")}</h3>
          <table className="comp-table">
            <thead>
              <tr>
                <th />
                <th>{mine.host}</th>
                <th>{other.host}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className={r.winner === "mine" ? "win" : r.winner === "theirs" ? "lose" : ""}>{r.mine}</td>
                  <td className={r.winner === "theirs" ? "win" : ""}>{r.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="comp-card">
          <header className="comp-card-head">
            <h3>{tr("Cosa fare per superarlo")}</h3>
            <button
              type="button"
              className="secondary"
              disabled={!aiReady || plan.state.status === "loading"}
              title={aiReady ? undefined : tr(NO_KEY_TEXT)}
              onClick={() => plan.run(competitorPrompt(mine, other, gap, actions))}
            >
              {tr("Piano AI")}
            </button>
          </header>
          {actions.length === 0 ? (
            <p className="muted">{tr("Sei avanti su tutto: mantieni il vantaggio e presidia i tuoi argomenti esclusivi.")}</p>
          ) : (
            <ul className="actions">
              {actions.map((a) => (
                <li key={a.text}>
                  <span className={`badge ${PRIORITY_BADGE[a.priority]}`}>{tr(a.priority)}</span>
                  <span className={`badge ${AREA_BADGE[a.area]}`}>{a.area === "Contenuti" ? tr("Contenuti") : a.area}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          )}
          <AiOutput state={plan.state} />
        </section>
      </div>

      <div className="comp-grid">
        <TopicList
          title={tr("Argomenti che il competitor copre e tu no")}
          empty={gap ? tr("Nessuno: copri tutti i suoi argomenti.") : tr("Calcolo…")}
          topics={gap?.gaps ?? []}
        />
        <TopicList
          title={tr("I tuoi argomenti esclusivi")}
          empty={gap ? tr("Nessuno: il competitor copre tutti i tuoi argomenti.") : tr("Calcolo…")}
          topics={gap?.strengths ?? []}
          onOpenPage={onOpenPage}
        />
      </div>
      {gap && gap.deeper.length > 0 && (
        <section className="comp-card">
          <h3>{tr("Dove il competitor è più approfondito")}</h3>
          <ul className="topic-list">
            {gap.deeper.map((d) => (
              <li key={d.theirs}>
                <button type="button" className="link" onClick={() => onOpenPage(d.mine)}>
                  {d.mine}
                </button>
                <small className="muted">
                  {tr("{m} parole contro {t} di {url}", { m: d.mine_words.toLocaleString(LOCALE), t: d.theirs_words.toLocaleString(LOCALE), url: d.theirs })}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function TopicList({ title, empty, topics, onOpenPage }: { title: string; empty: string; topics: GapTopic[]; onOpenPage?: (url: string) => void }) {
  return (
    <section className="comp-card">
      <h3>
        {title} {topics.length > 0 && <span className="count">{topics.length}</span>}
      </h3>
      {topics.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="topic-list">
          {topics.map((t) => (
            <li key={t.pages[0].url}>
              <strong>{t.label.join(" · ")}</strong>
              {t.pages.map((p) =>
                onOpenPage ? (
                  <button key={p.url} type="button" className="link" onClick={() => onOpenPage(p.url)} title={p.url}>
                    {p.title ?? p.url}
                  </button>
                ) : (
                  <small key={p.url} title={p.url}>
                    {p.title ?? p.url}
                  </small>
                ),
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

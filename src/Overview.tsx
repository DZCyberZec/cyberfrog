// First view after a crawl: how healthy the site is, what to fix first, and the key numbers.
import type { CSSProperties } from "react";
import { LOCALE, tr } from "./i18n";
import { healthKind } from "./health";
import type { CrawlData } from "./crawl";
import type { Analysis } from "./useAnalysis";
import type { Tab } from "./nav";
import type { Priority } from "./pages";

type Props = { crawl: CrawlData; a: Analysis; go: (tab: Tab, filter?: string | null) => void };

const PRIORITY_BADGE: Record<Priority, string> = { Alta: "client", Media: "redirect", Bassa: "blocked" };
const n = (v: number) => v.toLocaleString(LOCALE);

export function Overview({ crawl, a, go }: Props) {
  const total = crawl.pages.length;
  const errors = a.counts.client + a.counts.server;
  const top = a.issues.slice(0, 6);
  const bars: { kind: string; label: string; value: number }[] = [
    { kind: "ok", label: "2xx", value: a.counts.ok },
    { kind: "redirect", label: "3xx", value: a.counts.redirect },
    { kind: "client", label: "4xx", value: a.counts.client },
    { kind: "server", label: "5xx", value: a.counts.server },
    { kind: "blocked", label: tr("Bloccati"), value: a.counts.blocked + a.counts.none },
  ];
  const kpis: { label: string; value: string; tab: Tab; filter?: string; kind?: string }[] = [
    { label: tr("URL analizzati"), value: n(total), tab: "internal" },
    { label: tr("Indicizzabili"), value: n(a.indexable), tab: "index" },
    { label: tr("Errori 4xx/5xx"), value: n(errors), tab: "codes", filter: errors ? "client" : undefined, kind: errors ? "client" : undefined },
    { label: tr("Link rotti"), value: n(crawl.broken.length), tab: "broken", kind: crawl.broken.length ? "client" : undefined },
    { label: tr("Tempo mediano"), value: a.median === null ? "–" : `${n(a.median)} ms`, tab: "perf" },
    {
      label: tr("Citabilità AI"),
      value: a.citability === null ? "–" : `${a.citability}/100`,
      tab: "geo",
      kind: a.citability === null ? undefined : healthKind(a.citability),
    },
  ];

  return (
    <div className="overview">
      <section className="ov-hero">
        <div className={`score-ring ${healthKind(a.health)}`} style={{ "--p": a.health } as CSSProperties}>
          <span>{a.health}</span>
        </div>
        <div>
          <h2>{a.host}</h2>
          <p className="muted">
            {a.issues.length
              ? tr("Salute SEO {score}/100 · {n} tipi di problema trovati", { score: a.health, n: a.issues.length })
              : tr("Salute SEO {score}/100 · nessun problema trovato", { score: a.health })}
          </p>
          <div className="status-bar" aria-label={tr("Codici di risposta")}>
            {bars
              .filter((b) => b.value > 0)
              .map((b) => (
                <span key={b.kind} className={b.kind} style={{ flexGrow: b.value }} title={`${b.label}: ${n(b.value)}`} />
              ))}
          </div>
          <p className="legend">
            {bars
              .filter((b) => b.value > 0)
              .map((b) => (
                <span key={b.kind}>
                  <i className={b.kind} /> {b.label} {n(b.value)}
                </span>
              ))}
          </p>
        </div>
      </section>

      <section className="kpis">
        {kpis.map((k) => (
          <button key={k.label} type="button" className="kpi" onClick={() => go(k.tab, k.filter)}>
            <span className="kpi-label">{k.label}</span>
            <strong className={k.kind}>{k.value}</strong>
          </button>
        ))}
      </section>

      <section className="todo">
        <header>
          <h3>{tr("Da sistemare per primo")}</h3>
          {a.issues.length > top.length && (
            <button type="button" className="link" onClick={() => go("issues")}>
              {tr("Tutti i problemi ({n})", { n: a.issues.length })}
            </button>
          )}
        </header>
        {top.length === 0 ? (
          <p className="muted">{tr("Nessun problema: ottimo lavoro.")}</p>
        ) : (
          <ul>
            {top.map((i) => (
              <li key={`${i.tab}-${i.filter}`}>
                <button type="button" onClick={() => go(i.tab as Tab, i.filter)}>
                  <span className={`badge ${PRIORITY_BADGE[i.priority]}`}>{tr(i.priority)}</span>
                  <span className="todo-label">
                    <strong>{i.label}</strong>
                    <small>{i.fix}</small>
                  </span>
                  <span className="todo-count">{tr("{n} URL", { n: n(i.count) })}</span>
                  <span className="chev" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

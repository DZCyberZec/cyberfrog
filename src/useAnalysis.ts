// Everything derived from a crawl that more than one view needs: issues, counts, GEO rows.
import { useMemo } from "react";
import { hostOf, type CrawlData } from "./crawl";
import { geoRows } from "./geo";
import { healthScore } from "./health";
import {
  allIssues,
  dupPages,
  isHtmlPage,
  medianMs,
  nonIndexableReason,
  statusKind,
  type CrawlSnapshot,
  type StatusKind,
} from "./pages";

export type Analysis = ReturnType<typeof useAnalysis>;

/** `withDups` turns on the pairwise duplicate check, which is costly on big crawls. */
export function useAnalysis(crawl: CrawlData, withDups: boolean) {
  const { pages, broken, images, hreflang, structured, bad_links, geo, topics } = crawl;
  const snapshot = useMemo(
    (): CrawlSnapshot => ({ pages, broken, images, hreflang, structured, bad_links, geo, topics }),
    [pages, broken, images, hreflang, structured, bad_links, geo, topics],
  );
  const dupRows = useMemo(() => (withDups ? dupPages(pages) : []), [pages, withDups]);
  const issues = useMemo(() => allIssues(snapshot, dupRows), [snapshot, dupRows]);
  const counts = useMemo(() => {
    const c: Record<StatusKind, number> = { ok: 0, redirect: 0, client: 0, server: 0, blocked: 0, none: 0 };
    for (const p of pages) c[statusKind(p)]++;
    return c;
  }, [pages]);
  const htmlPages = useMemo(() => pages.filter(isHtmlPage).length, [pages]);
  const geoTable = useMemo(() => geoRows(pages, geo, structured), [pages, geo, structured]);
  return {
    host: hostOf(pages[0]?.url) || "crawl",
    snapshot,
    dupRows,
    issues,
    counts,
    htmlPages,
    geoTable,
    indexable: useMemo(() => pages.filter((p) => nonIndexableReason(p) === null).length, [pages]),
    median: useMemo(() => medianMs(pages), [pages]),
    health: useMemo(() => healthScore(issues, Math.max(htmlPages, 1)), [issues, htmlPages]),
    citability: geoTable.length ? Math.round(geoTable.reduce((s, r) => s + r.score, 0) / geoTable.length) : null,
  };
}

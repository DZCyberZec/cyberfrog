// llms.txt (llmstxt.org) built from a crawl: site name, summary, then links grouped by topic cluster.
import { tr } from "./i18n.ts";
import type { CrawlData } from "./crawl.ts";
import { isHtmlPage, nonIndexableReason, type Page } from "./pages.ts";

/** Lines in the closing "other pages" section; the file is meant to be short. */
const OTHER_MAX = 50;

// crawl.ts has a value import without extension that node's script check can't load, so no hostOf here
const host = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
};
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const mdText = (s: string) => oneLine(s).replace(/([[\]\\])/g, "\\$1");
const mdUrl = (s: string) => s.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Brand | Tagline" and "Brand - Tagline" both read as "Brand". */
const siteName = (title: string) => oneLine(title).split(/\s+[|\-–—]\s+/)[0];

function line(p: Page): string {
  const title = mdText(p.title ?? p.h1 ?? p.url);
  const note = p.meta_description ? `: ${oneLine(p.meta_description)}` : "";
  return `- [${title}](${mdUrl(p.url)})${note}`;
}

export function buildLlmsTxt(crawl: CrawlData): string {
  const pages = crawl.pages.filter((p) => isHtmlPage(p) && nonIndexableReason(p) === null);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const home = pages.find((p) => p.depth === 0) ?? pages[0];
  const name = (home?.title && siteName(home.title)) || host(home?.url) || host(crawl.pages[0]?.url) || "Site";
  const summary = oneLine(home?.meta_description ?? home?.h1 ?? "");

  const out = [`# ${mdText(name)}`, ""];
  if (summary) out.push(`> ${summary}`, "");

  const listed = new Set<string>();
  for (const c of crawl.topics.clusters) {
    // hub first, then the rest in cluster order
    const members = [c.hub, ...c.pages]
      .filter((u, i, all) => all.indexOf(u) === i && byUrl.has(u) && !listed.has(u))
      .map((u) => byUrl.get(u)!);
    if (members.length === 0 || c.label.length === 0) continue;
    members.forEach((p) => listed.add(p.url));
    out.push(`## ${mdText(capitalise(c.label.join(" ")))}`, "", ...members.map(line), "");
  }

  const rest = pages.filter((p) => !listed.has(p.url)).slice(0, OTHER_MAX);
  if (rest.length) out.push(`## ${tr("Altre pagine")}`, "", ...rest.map(line), "");
  return out.join("\n");
}

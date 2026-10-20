import { LANG } from "./i18n.ts";
import { nonIndexableReason, type Issue, type IssueDef, type Page } from "./pages.ts";

/** Instructions shared by every request; the crawl data goes in the user prompt. */
export function systemPrompt(): string {
  return [
    "You are a senior technical SEO consultant helping the owner of a website fix what the CyberFrog crawler found.",
    `Write in ${LANG === "en" ? "English" : "Italian"}.`,
    "Be concrete and brief: name the page or element, say what to change and why it matters.",
    "Base every statement on the data provided; if something can't be judged from it, say so instead of guessing.",
    "Output plain text for a narrow panel: short paragraphs and numbered lists, no Markdown symbols (#, **, tables).",
  ].join("\n");
}

const field = (label: string, value: string | number | null | undefined) =>
  `${label}: ${value === null || value === undefined || value === "" ? "(none)" : value}`;

/** What we know about one page, as the model reads it. */
function pageFacts(p: Page): string {
  return [
    field("URL", p.url),
    field("HTTP status", p.status),
    field("Indexable", nonIndexableReason(p) ?? "yes"),
    field("Title", p.title),
    field("Title length", p.title?.length),
    field("Meta description", p.meta_description),
    field("Meta description length", p.meta_description?.length),
    field("H1", p.h1),
    field("Canonical", p.canonical),
    field("Meta robots", p.meta_robots),
    field("Words of main content", p.word_count),
    field("Click depth from the home page", p.depth),
    field("Internal inlinks", p.inlinks),
    field("Link Score (internal PageRank, 0-100)", p.link_score),
    field("Response time (ms)", p.response_ms),
    p.rendered ? field("Words before JavaScript rendering", p.raw_word_count) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Asks for a better title and meta description for one page. */
export function metaPrompt(p: Page): string {
  return [
    "Suggest a better title tag and meta description for this page.",
    "Give 3 title options (50-60 characters) and 2 meta description options (120-155 characters), each with its character count,",
    "in the page's own language, keeping the main topic and any brand already in the title. Then one line on why.",
    "",
    pageFacts(p),
  ].join("\n");
}

/** Asks why a page's issues matter and how to fix them, most important first. */
export function explainPrompt(p: Page, issues: IssueDef[]): string {
  const list = issues.length
    ? issues.map((i) => `- [${i.priority}] ${i.label}`).join("\n")
    : "- none found by the crawler";
  return [
    "Explain the SEO issues of this page to the site owner: for each, why it matters for this page and the exact fix.",
    "Most important first. If there are no issues, point out the one improvement with the biggest impact based on the data.",
    "",
    pageFacts(p),
    "",
    "Issues found by the crawler (priority Alta = high, Media = medium, Bassa = low):",
    list,
  ].join("\n");
}

/** Example URLs per issue, so the plan can name pages; kept short to bound the prompt. */
const EXAMPLES = 5;

/** Asks for a prioritised action plan for the whole crawl. */
export function planPrompt(host: string, pages: Page[], issues: (Issue & { examples: string[] })[]): string {
  const html = pages.filter((p) => p.content_type?.includes("html"));
  const indexable = pages.filter((p) => nonIndexableReason(p) === null).length;
  return [
    `Write an SEO action plan for ${host} based on this crawl.`,
    "Group the work into: 1) fix this week, 2) next, 3) when there is time. For each step: what to do, which pages, expected impact,",
    "and a rough effort (minutes, hours or days). Merge issues that share one fix. Finish with the single first action to take today.",
    "",
    `Crawled URLs: ${pages.length}, HTML pages: ${html.length}, indexable: ${indexable}.`,
    "",
    "Issues (priority Alta = high, Media = medium, Bassa = low; count = number of URLs):",
    ...issues.map(
      (i) =>
        `- [${i.priority}] ${i.label}: ${i.count}. Suggested fix: ${i.fix}` +
        (i.examples.length ? ` Examples: ${i.examples.slice(0, EXAMPLES).join(", ")}` : ""),
    ),
  ].join("\n");
}

/** Items sent with one "fix it" request, and how much of each non-page row; bounds the prompt. */
export const FIX_ITEMS = 15;
const ROW_CHARS = 600;

/** Asks for the ready-to-use fix of one issue, item by item. */
export function fixPrompt(host: string, issue: Issue, rows: Record<string, unknown>[], pages: Page[]): string {
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const items = rows.slice(0, FIX_ITEMS).map((r, i) => {
    const url = r.url ?? r.page ?? r.source ?? r.src;
    const page = typeof url === "string" ? byUrl.get(url) : undefined;
    // rows that are pages already say everything in pageFacts
    const extra = page === r ? "" : `Row data: ${JSON.stringify(r).slice(0, ROW_CHARS)}`;
    return [`Item ${i + 1}`, page ? pageFacts(page) : "", extra].filter(Boolean).join("\n");
  });
  return [
    `Fix this SEO issue on ${host}: "${issue.label}" (priority ${issue.priority}, ${issue.count} URLs). Suggested fix: ${issue.fix}`,
    "For each item, write the fix ready to use: the exact new text or code to paste (a rewritten title or meta description with its",
    "character count, alt text, H1, redirect rule, JSON-LD, an internal link with its anchor text and where to put it, and so on).",
    "When the fix can't be written as text (compressing an image, a server setting), give the exact steps.",
    "Write in the language of each page's own content for any text meant for the page.",
    items.length < issue.count ? `Only ${items.length} of ${issue.count} items are listed: end with how to apply the same fix to the rest.` : "",
    "",
    ...items.flatMap((t) => [t, ""]),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/** Rough token count of a text, for the estimate shown before a request: ~3.5 characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

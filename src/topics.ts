// Topic clusters, cannibalization and internal link gaps, as computed in src-tauri/src/topics/.
import { tr } from "./i18n.ts";
import type { FilterDef } from "./pages.ts";

/** Mirrors `topics::Cluster`. */
export type Cluster = { label: string[]; hub: string; pages: string[] };
/** Mirrors `topics::Cannibal`. */
export type Cannibal = { a: string; b: string; similarity: number; title_similarity: number; shared: string[] };
export type LinkReason = "hub" | "to-hub" | "related";
/** Mirrors `topics::LinkSuggestion`. */
export type LinkSuggestion = { from: string; to: string; similarity: number; anchor: string; reason: LinkReason };
/** Mirrors `topics::TopicsData`. */
export type TopicsData = { clusters: Cluster[]; cannibal: Cannibal[]; suggestions: LinkSuggestion[]; analysed: number };

export const EMPTY_TOPICS: TopicsData = { clusters: [], cannibal: [], suggestions: [], analysed: 0 };

export const REASON_LABEL: Record<LinkReason, string> = {
  hub: tr("Dall'hub alla pagina del suo argomento"),
  "to-hub": tr("Dalla pagina al suo hub"),
  related: tr("Da una pagina forte e simile a una debole"),
};

/** One row per finding, so the Issues report can count them and find the pages involved. */
export type TopicFinding = { url: string; kind: "cannibal" | "links" };

/** Pages in cannibal pairs count once each, however many pairs they're in; link gaps count by suggestion. */
export function topicFindings(t: TopicsData): TopicFinding[] {
  const cannibal = [...new Set(t.cannibal.flatMap((c) => [c.a, c.b]))];
  return [
    ...cannibal.map((url) => ({ url, kind: "cannibal" as const })),
    ...t.suggestions.map((s) => ({ url: s.to, kind: "links" as const })),
  ];
}

export const TOPIC_FILTERS: FilterDef<TopicFinding>[] = [
  { id: "cannibal", label: tr("Cannibalizzazione"), test: (f) => f.kind === "cannibal" },
  { id: "links", label: tr("Link da aggiungere"), test: (f) => f.kind === "links" },
];

// Reports, their grouping in the sidebar, and the issue badge each one shows.
import { tr } from "./i18n";
import { CHECKS, type Check, type Issue } from "./pages";

export type Tab =
  | "overview"
  | "issues"
  | "compare"
  | "internal"
  | "codes"
  | "index"
  | "external"
  | "broken"
  | "badlinks"
  | "redirects"
  | "structure"
  | "custom"
  | "images"
  | "sitemap"
  | "perf"
  | "geo"
  | "js"
  | "hreflang"
  | "schema"
  | "duplicates"
  | Check["field"];
/** Reports grouped as in the sidebar. */
export const GROUPS: { label: string; items: { id: Tab; label: string }[] }[] = [
  {
    label: tr("Panoramica"),
    items: [
      { id: "overview", label: tr("Riepilogo") },
      { id: "issues", label: tr("Problemi") },
      { id: "compare", label: tr("Confronto") },
    ],
  },
  {
    label: tr("Pagine"),
    items: [
      { id: "internal", label: tr("Interni") },
      { id: "structure", label: tr("Struttura") },
      { id: "codes", label: tr("Codici di risposta") },
      { id: "redirects", label: tr("Redirect") },
      { id: "index", label: tr("Indicizzabilità") },
      { id: "perf", label: tr("Prestazioni") },
      { id: "js", label: "JavaScript" },
      { id: "duplicates", label: tr("Duplicati") },
    ],
  },
  {
    label: tr("AI e GEO"),
    items: [{ id: "geo", label: tr("Visibilità nelle AI") }],
  },
  {
    label: tr("Contenuti"),
    items: [
      ...CHECKS.map((c) => ({ id: c.field, label: c.label })),
      { id: "schema", label: tr("Dati strutturati") },
      { id: "hreflang", label: tr("Hreflang") },
    ],
  },
  {
    label: tr("Link"),
    items: [
      { id: "external", label: tr("Link esterni") },
      { id: "broken", label: tr("Link rotti") },
      { id: "badlinks", label: tr("Link non scansionabili") },
    ],
  },
  {
    label: tr("Risorse"),
    items: [
      { id: "images", label: tr("Immagini") },
      { id: "sitemap", label: tr("Sitemap") },
      { id: "custom", label: tr("Personalizzati") },
    ],
  },
];
export const TABS = GROUPS.flatMap((g) => g.items);

/** Number of issue types in a report, coloured by the worst priority among them. */
export function issueBadge(list: Issue[]): { count: number; kind: string } | null {
  if (list.length === 0) return null;
  const kind = list.some((i) => i.priority === "Alta") ? "client" : list.some((i) => i.priority === "Media") ? "redirect" : "blocked";
  return { count: list.length, kind };
}

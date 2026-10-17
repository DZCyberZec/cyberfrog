// The crawl as the backend returns it, plus the progress and history types around it.
import { tr } from "./i18n";
import { EMPTY_GEO, type GeoData } from "./geo";
import { EMPTY_TOPICS, type TopicsData } from "./topics";
import type {
  BadLinkRow,
  BrokenLink,
  CustomData,
  ExternalLink,
  HreflangRow,
  ImageRow,
  Page,
  StructuredRow,
} from "./pages";

/** Mirrors `CrawlData` in src-tauri/src/lib.rs. */
export type CrawlData = {
  path: string;
  pages: Page[];
  external: ExternalLink[];
  broken: BrokenLink[];
  images: ImageRow[];
  hreflang: HreflangRow[];
  structured: StructuredRow[];
  bad_links: BadLinkRow[];
  custom: CustomData;
  geo: GeoData;
  topics: TopicsData;
};

/** No crawl loaded: the start screen shows. */
export const EMPTY_CRAWL: CrawlData = {
  path: "",
  pages: [],
  external: [],
  broken: [],
  images: [],
  hreflang: [],
  structured: [],
  bad_links: [],
  custom: { rules: [], values: [] },
  geo: EMPTY_GEO,
  topics: EMPTY_TOPICS,
};

/** Mirrors `CrawlSummary` in src-tauri/src/lib.rs. */
export type CrawlSummary = { path: string; start_url: string | null; pages: number; modified_ms: number };

export type Progress = { stage: "pages" | "external" | "images"; done: number; pending: number };
export const STAGE_LABEL: Record<Progress["stage"], string> = {
  pages: tr("URL analizzati"),
  external: tr("Link esterni verificati"),
  images: tr("Immagini verificate"),
};

/** Crawls listed on the start screen; older ones open with Apri… */
export const RECENT_SHOWN = 5;

export const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
};

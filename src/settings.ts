/** Crawl settings; mirrors `Settings` in src-tauri/src/lib.rs, which clamps and validates them. */
export type Settings = {
  max_urls: number;
  concurrency: number;
  user_agent: string;
  respect_robots: boolean;
  check_external: boolean;
  check_images: boolean;
  use_sitemaps: boolean;
  /** Regular expressions; URLs matching any of them are not crawled. */
  exclude: string[];
  /** Custom extraction and search rules, applied to every HTML page. */
  rules: RuleSpec[];
  /** Analyse pages after JavaScript rendering in a local headless browser. */
  render_js: boolean;
  /** Who answers the AI assistant: the user's Claude Code CLI or the Messages API with their key. */
  ai_engine: AiEngine;
};

export type AiEngine = "claude-code" | "api";

/** Mirrors `RuleSpec` in src-tauri/src/lib.rs. */
export type RuleSpec = {
  name: string;
  /** css: element text or `attr`; regex: first group or whole match; search: count of a literal text. */
  kind: "css" | "regex" | "search";
  expr: string;
  attr: string | null;
};

export const USER_AGENTS: { id: string; label: string; value: string }[] = [
  { id: "cyberfrog", label: "CyberFrog", value: "CyberFrog/0.1" },
  {
    id: "googlebot-mobile",
    label: "Googlebot smartphone",
    value:
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    id: "googlebot-desktop",
    label: "Googlebot desktop",
    value: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  { id: "bingbot", label: "Bingbot", value: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
];

export const DEFAULT_SETTINGS: Settings = {
  max_urls: 10_000,
  concurrency: 8,
  user_agent: USER_AGENTS[0].value,
  respect_robots: true,
  check_external: true,
  check_images: true,
  use_sitemaps: true,
  exclude: [],
  rules: [],
  render_js: false,
  ai_engine: "claude-code",
};

const KEY = "cyberfrog.settings";

/** Saved settings merged over the defaults; storage may be unavailable, which just means defaults. */
export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // not persisted; the settings still apply to this session
  }
}

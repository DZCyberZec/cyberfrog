// One number for the state of the site, so the overview can say "how are we doing" at a glance.
import type { Issue, Priority } from "./pages";

const WEIGHT: Record<Priority, number> = { Alta: 30, Media: 12, Bassa: 4 };

/**
 * 100 minus a penalty per issue: its priority weight times the square root of the share of pages it
 * touches (capped at 1), so a problem on a few pages still costs something and one on every page
 * costs its full weight.
 */
export function healthScore(issues: Issue[], pages: number): number {
  if (pages === 0) return 0;
  const penalty = issues.reduce((sum, i) => sum + WEIGHT[i.priority] * Math.sqrt(Math.min(1, i.count / pages)), 0);
  return Math.max(0, Math.round(100 - penalty));
}

export const healthKind = (score: number) => (score >= 80 ? "ok" : score >= 50 ? "redirect" : "client");

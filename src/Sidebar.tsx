// Report navigation, grouped, with a badge for how many issue types each report holds.
import { tr } from "./i18n";
import { GROUPS, issueBadge, type Tab } from "./nav";
import type { Issue } from "./pages";

export function Sidebar({ tab, issues, onSelect }: { tab: Tab; issues: Issue[]; onSelect: (t: Tab) => void }) {
  return (
    <nav className="sidebar" aria-label={tr("Report")}>
      {GROUPS.map((g) => (
        <div key={g.label} className="nav-group">
          <h3>{g.label}</h3>
          {g.items.map((t) => {
            const badge = t.id === "overview" ? null : issueBadge(t.id === "issues" ? issues : issues.filter((i) => i.tab === t.id));
            return (
              <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}>
                <span className="nav-label">{t.label}</span>
                {badge && (
                  <span className={`nav-badge ${badge.kind}`} title={tr("Problemi")}>
                    {badge.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

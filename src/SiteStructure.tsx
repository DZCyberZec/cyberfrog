import { useMemo, useState } from "react";
import { LOCALE, tr } from "./i18n";
import { depthCounts, siteTree, type DirNode, type Page } from "./pages";

type Props = {
  pages: Page[];
  selected: string | null;
  onSelect: (url: string) => void;
};

/** Crawl depth distribution and the site's folder tree with URL counts and Link Score. */
export function SiteStructure({ pages, selected, onSelect }: Props) {
  const tree = useMemo(() => siteTree(pages), [pages]);
  const depths = useMemo(() => depthCounts(pages), [pages]);
  const maxCount = Math.max(1, ...depths.map((d) => d.count));
  // the first level starts open so the tree isn't a single line
  const [open, setOpen] = useState<Set<string>>(() => new Set(["/"]));
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const rows: { node: DirNode; level: number }[] = [];
  const walk = (node: DirNode, level: number) => {
    rows.push({ node, level });
    if (open.has(node.path)) node.children.forEach((c) => walk(c, level + 1));
  };
  walk(tree, 0);

  return (
    <div className="structure">
      <section className="depths" aria-label={tr("URL per profondità")}>
        <h2>{tr("URL per profondità")}</h2>
        {depths.map((d) => (
          <div className="depth-row" key={String(d.depth)}>
            <span className="depth-label">{d.depth === null ? tr("Solo sitemap") : tr("Livello {n}", { n: d.depth })}</span>
            <span className="depth-bar" style={{ width: `${(d.count / maxCount) * 100}%` }} />
            <span className="num">{d.count.toLocaleString(LOCALE)}</span>
          </div>
        ))}
      </section>

      <table className="tree">
        <thead>
          <tr>
            <th>{tr("Cartella")}</th>
            <th className="num">URL</th>
            <th className="num">{tr("Indicizzabili")}</th>
            <th className="num">{tr("Link Score max")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, level }) => {
            const expandable = node.children.length > 0;
            const isOpen = open.has(node.path);
            return (
              <tr key={node.path} className={node.page && node.page.url === selected ? "selected" : undefined}>
                <td style={{ paddingLeft: 10 + level * 18 }}>
                  {expandable ? (
                    <button
                      type="button"
                      className="twisty"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? tr("Chiudi") : tr("Apri")} ${node.path}`}
                      onClick={() => toggle(node.path)}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className="twisty" aria-hidden />
                  )}
                  {node.page ? (
                    <button type="button" className="node-link" onClick={() => onSelect(node.page!.url)} title={node.page.url}>
                      {level === 0 ? node.name : `${node.name}/`}
                    </button>
                  ) : (
                    <span className="node-name">{`${node.name}/`}</span>
                  )}
                </td>
                <td className="num">{node.urls.toLocaleString(LOCALE)}</td>
                <td className="num">{node.indexable.toLocaleString(LOCALE)}</td>
                <td className="num">{node.maxScore}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

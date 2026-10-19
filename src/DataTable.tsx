import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toCsv, type FilterDef } from "./pages";
import { tr } from "./i18n";

const ROW_HEIGHT = 30;
/** Bounds for a column the user widens or auto-fits. */
const MIN_WIDTH = 60;
const MAX_WIDTH = 1600;
/** Rows looked at when auto-fitting a column: enough for a fair width, cheap on big crawls. */
const FIT_SAMPLE = 3000;

type Sizes = Record<string, number>;

// Widths are remembered per set of columns, so each report keeps the layout the user chose.
const sizesKey = (ids: string[]) => `cyberfrog.columns.${ids.join(",")}`;
function loadSizes(key: string): Sizes {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function saveSizes(key: string, sizes: Sizes) {
  try {
    localStorage.setItem(key, JSON.stringify(sizes));
  } catch {
    // storage full or blocked: widths simply aren't remembered
  }
}

/** Width that shows the longest text in the column, measured with the table's font. */
export function fitWidth(texts: string[], font: string): number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return MIN_WIDTH;
  ctx.font = font;
  let widest = 0;
  for (const t of texts) widest = Math.max(widest, ctx.measureText(t).width);
  // cell padding (2 × 10px) plus room for a badge's own padding
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(widest) + 36));
}

export const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export const helperFor = <T extends RowData>() => createColumnHelper<typeof features, T>();

type Columns<T extends RowData> = ReadonlyArray<ColumnDef<typeof features, T, any>>;

type Props<T extends RowData> = {
  data: T[];
  columns: Columns<T>;
  filters?: FilterDef<T>[];
  /** File name suggested by the CSV export, without extension. */
  exportName: string;
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  /** Extra buttons shown next to the CSV export. */
  actions?: ReactNode;
  /** Filter selected when the table mounts; defaults to the first one. */
  initialFilter?: string;
  /** Shown instead of the generic message when there are no rows. */
  emptyText?: string;
};

/** Filter chips, CSV export and a sortable, virtualized table. Give it a `key` per report. */
export function DataTable<T extends RowData>({
  data,
  columns,
  filters,
  exportName,
  onRowClick,
  isSelected,
  actions,
  initialFilter,
  emptyText,
}: Props<T>) {
  const [filterId, setFilterId] = useState(initialFilter ?? filters?.[0]?.id);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const active = filters?.find((f) => f.id === filterId);
  const shown = useMemo(() => (active ? data.filter(active.test) : data), [data, active]);

  const key = sizesKey(columns.map((c) => String(c.id ?? (c as { accessorKey?: string }).accessorKey ?? c.header)));
  const table = useTable({
    features,
    columns,
    data: shown,
    columnResizeMode: "onChange",
    initialState: { columnSizing: loadSizes(key) },
  });
  const rows = table.getRowModel().rows;
  const sizing = table.state.columnSizing;
  useEffect(() => saveSizes(key, sizing), [key, sizing]);

  function fit(columnId: string) {
    const column = table.getColumn(columnId);
    const cell = scrollRef.current?.querySelector("td, th");
    if (!column || !cell) return;
    const texts = rows.slice(0, FIT_SAMPLE).map((r) => String(r.getValue(columnId) ?? ""));
    texts.push(String(column.columnDef.header ?? ""));
    const width = fitWidth(texts, getComputedStyle(cell).font);
    table.setColumnSizing((s) => ({ ...s, [columnId]: width }));
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);

  async function exportCsv() {
    setExportMsg(null);
    const suffix = active && active.id !== "all" ? `-${active.id}` : "";
    const path = await save({
      defaultPath: `${exportName}${suffix}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    const header = table.getAllLeafColumns().map((c) => String(c.columnDef.header ?? c.id));
    const body = rows.map((r) => r.getAllCells().map((c) => c.getValue()));
    try {
      await invoke("write_text_file", { path, contents: toCsv(header, body) });
      setExportMsg(rows.length === 1 ? tr("Esportata 1 riga") : tr("Esportate {n} righe", { n: rows.length }));
    } catch (err) {
      setExportMsg(tr("Esportazione non riuscita: {err}", { err: String(err) }));
    }
  }

  return (
    <div className="table-pane">
      <div className="filters">
        {filters?.map((f) => (
          <button key={f.id} type="button" aria-pressed={f.id === filterId} onClick={() => setFilterId(f.id)}>
            {f.label} <span className="count">{data.filter(f.test).length}</span>
          </button>
        ))}
        <span className="spacer" />
        {exportMsg && (
          <span className="export-msg" role="status">
            {exportMsg}
          </span>
        )}
        {actions}
        <button type="button" className="secondary" onClick={exportCsv} disabled={rows.length === 0}>
          {tr("Esporta CSV")}
        </button>
      </div>

      <div className="grid" ref={scrollRef}>
        <table style={{ width: table.getTotalSize() }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} style={{ width: h.getSize() }} aria-sort={ariaSort(h.column.getIsSorted())}>
                    <button type="button" onClick={h.column.getToggleSortingHandler()}>
                      <table.FlexRender header={h} />
                      <span className="sort" aria-hidden>
                        {{ asc: "▲", desc: "▼" }[h.column.getIsSorted() as string] ?? ""}
                      </span>
                    </button>
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={tr("Trascina per allargare la colonna, doppio clic per adattarla al contenuto")}
                      title={tr("Trascina per allargare la colonna, doppio clic per adattarla al contenuto")}
                      className={`resizer${h.column.getIsResizing() ? " resizing" : ""}`}
                      onMouseDown={h.getResizeHandler()}
                      onTouchStart={h.getResizeHandler()}
                      onDoubleClick={() => fit(h.column.id)}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {padTop > 0 && <tr style={{ height: padTop }} />}
            {items.map((vi) => {
              const row = rows[vi.index];
              return (
                <tr
                key={row.id}
                style={{ height: ROW_HEIGHT }}
                className={onRowClick ? `clickable${isSelected?.(row.original) ? " selected" : ""}` : undefined}
                onClick={onRowClick && (() => onRowClick(row.original))}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick && ((e) => e.key === "Enter" && onRowClick(row.original))}
                aria-selected={onRowClick ? (isSelected?.(row.original) ?? false) : undefined}
              >
                  {row.getAllCells().map((cell) => {
                    const value = cell.getValue();
                    return (
                      <td key={cell.id} title={typeof value === "string" ? value : undefined}>
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {padBottom > 0 && <tr style={{ height: padBottom }} />}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">{emptyText ?? tr("Nessun URL in questa vista.")}</p>}
      </div>
    </div>
  );
}

function ariaSort(s: false | "asc" | "desc") {
  return s === "asc" ? "ascending" : s === "desc" ? "descending" : undefined;
}

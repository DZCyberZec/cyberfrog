import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
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

const ROW_HEIGHT = 30;

export const features = tableFeatures({
  columnSizingFeature,
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
};

/** Filter chips, CSV export and a sortable, virtualized table. Give it a `key` per report. */
export function DataTable<T extends RowData>({
  data,
  columns,
  filters,
  exportName,
  onRowClick,
  isSelected,
}: Props<T>) {
  const [filterId, setFilterId] = useState(filters?.[0]?.id);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const active = filters?.find((f) => f.id === filterId);
  const shown = useMemo(() => (active ? data.filter(active.test) : data), [data, active]);

  const table = useTable({ features, columns, data: shown });
  const rows = table.getRowModel().rows;

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
      setExportMsg(rows.length === 1 ? "Esportata 1 riga" : `Esportate ${rows.length} righe`);
    } catch (err) {
      setExportMsg(`Esportazione non riuscita: ${err}`);
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
        <button type="button" className="secondary" onClick={exportCsv} disabled={rows.length === 0}>
          Esporta CSV
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
        {rows.length === 0 && <p className="empty">Nessun URL in questa vista.</p>}
      </div>
    </div>
  );
}

function ariaSort(s: false | "asc" | "desc") {
  return s === "asc" ? "ascending" : s === "desc" ? "descending" : undefined;
}

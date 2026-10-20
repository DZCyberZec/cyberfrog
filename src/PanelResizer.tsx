// Lets the user drag the detail panel's top edge to give it more or less of the window.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { tr } from "./i18n";

const KEY = "cyberfrog.detail.height";
/** Smallest panel, and the least room always left to the table above it. */
const MIN = 120;
const STEP = 24;

function saved(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= MIN ? n : null;
  } catch {
    return null;
  }
}

/** Height (remembered across panels and launches) and the drag handle to put inside the panel. */
export function usePanelHeight() {
  const [height, setHeight] = useState<number | null>(saved);
  const ref = useRef<HTMLElement>(null);

  function set(h: number | null) {
    const max = (ref.current?.parentElement?.clientHeight ?? 800) - MIN;
    const value = h === null ? null : Math.round(Math.max(MIN, Math.min(max, h)));
    setHeight(value);
    try {
      if (value === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(value));
    } catch {
      // not remembered, still resizes
    }
  }
  const current = () => ref.current?.getBoundingClientRect().height ?? MIN;

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const start = current();
    const move = (ev: globalThis.PointerEvent) => set(start + startY - ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      set(current() + (e.key === "ArrowUp" ? STEP : -STEP));
    }
  }

  const label = tr("Trascina per allargare il pannello, doppio clic per la misura iniziale");
  const handle = (
    <div
      className="detail-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(null)}
    />
  );
  return { ref, style: height === null ? undefined : { height }, handle };
}

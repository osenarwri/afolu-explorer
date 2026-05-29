"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { TooltipRow, TooltipState } from "@/lib/tooltip";

function formatNumber(value: number, signed: boolean | undefined) {
  const sign = signed && value > 0 ? "+" : value < 0 ? "−" : "";
  return { sign, abs: Math.abs(value).toFixed(2) };
}

function Row({ row, primary }: { row: TooltipRow; primary?: boolean }) {
  let displayValue: string;
  if (row.valueText != null) {
    displayValue = row.valueText;
  } else if (row.value != null) {
    const { sign, abs } = formatNumber(row.value, row.signed);
    displayValue = `${sign}${abs}`;
  } else {
    displayValue = "";
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        fontSize: primary ? "0.78rem" : "0.72rem",
      }}
    >
      <span style={{ color: "var(--color-text-soft)" }}>{row.label}</span>
      <span style={{ textAlign: "right" }}>
        <span
          style={{
            color: row.color ?? "var(--color-teal)",
            fontWeight: primary ? 600 : 500,
          }}
        >
          {displayValue}
        </span>
        {row.units && (
          <>
            {" "}
            <span style={{ color: "var(--color-text-mute)" }}>{row.units}</span>
          </>
        )}
      </span>
    </div>
  );
}

const CURSOR_OFFSET = 14;
const VIEWPORT_MARGIN = 8;

export function Tooltip({ state }: { state: TooltipState }) {
  const ref = useRef<HTMLDivElement>(null);
  // Position state mirrors `state.x/y` but is adjusted post-measurement so the
  // tooltip stays inside the viewport (flips left/up when near the edges).
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: state.x + CURSOR_OFFSET,
    top: state.y + CURSOR_OFFSET,
  });

  useLayoutEffect(() => {
    if (!state.data || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = state.x + CURSOR_OFFSET;
    let top = state.y + CURSOR_OFFSET;
    // Flip horizontally if the tooltip would overflow the right edge
    if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = state.x - CURSOR_OFFSET - rect.width;
    }
    // Flip vertically if it would overflow the bottom edge
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = state.y - CURSOR_OFFSET - rect.height;
    }
    // Clamp to viewport so neither edge goes off-screen
    left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(left, window.innerWidth - rect.width - VIEWPORT_MARGIN)
    );
    top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(top, window.innerHeight - rect.height - VIEWPORT_MARGIN)
    );
    setPos({ left, top });
  }, [state.x, state.y, state.data]);

  if (!state.data) return null;
  const d = state.data;

  const accentColor = d.accent ?? "var(--color-teal)";

  // Build rows: prefer `rows` if provided, else synthesize from cards-style fields.
  const rows: TooltipRow[] = [];
  if (d.rows) {
    rows.push(...d.rows);
  } else if (d.label != null && d.value != null) {
    rows.push({
      label: d.label,
      value: d.value,
      units: d.units,
      color: d.accent ?? "var(--color-teal)",
      signed: d.kind === "flux",
    });
  }

  // Cards-style extras
  const extras: TooltipRow[] = [];
  if (d.totalStocks != null) {
    extras.push({
      label: "Total stocks",
      value: d.totalStocks,
      units: d.totalStocksUnits,
      color: "var(--color-teal)",
    });
  }
  if (d.netFlux != null) {
    extras.push({
      label: "Net flux",
      value: d.netFlux,
      units: d.netFluxUnits,
      color:
        d.netFlux >= 0 ? "var(--color-pink)" : "var(--color-teal)",
      signed: true,
    });
  }

  return (
    <div
      ref={ref}
      role="tooltip"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 1000,
        padding: "10px 14px",
        background: "var(--color-purple-deep)",
        border: `1.5px solid ${accentColor}`,
        borderRadius: 8,
        color: "var(--color-text)",
        fontSize: "0.78rem",
        lineHeight: 1.4,
        pointerEvents: "none",
        maxWidth: 260,
        minWidth: 180,
        boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
      }}
    >
      <div
        style={{
          fontSize: "0.62rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-text-soft)",
          marginBottom: d.categoricals && d.categoricals.length ? 2 : 6,
        }}
      >
        {d.hexId}
      </div>

      {d.categoricals && d.categoricals.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {d.categoricals.map((c, i) => (
            <div
              key={i}
              style={{
                fontSize: "0.74rem",
                color: "var(--color-text)",
                fontWeight: i === 0 ? 500 : 400,
              }}
            >
              {c.value}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r, i) => (
          <Row key={`r-${i}`} row={r} primary={i === 0 && extras.length > 0} />
        ))}
      </div>

      {extras.length > 0 && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {extras.map((r, i) => (
            <Row key={`e-${i}`} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

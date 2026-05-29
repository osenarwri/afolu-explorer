"use client";

import { useMemo, useState } from "react";
import type { Dataset } from "@/lib/schema";
import type { AppState } from "@/lib/ui-state";
import { StockCubeIcon, FluxHouseIcon } from "../icons";
import {
  FILTER_ALL,
  aggregateBy,
  applyCountryFilter,
  fluxRange,
  fluxTotal,
  maxStock,
  stocksTotal,
} from "@/lib/data";

function CaretToggle({
  expanded,
  onClick,
  ariaLabel,
}: {
  expanded: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        marginLeft: 10,
        color: "var(--color-teal)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <svg
        width={11}
        height={11}
        viewBox="0 0 11 11"
        style={{
          transform: expanded ? "rotate(180deg)" : "rotate(0)",
          transition: "transform 200ms ease",
        }}
      >
        <path d="M3 2 L8 5.5 L3 9 Z" fill="currentColor" />
      </svg>
    </button>
  );
}

export function TableView({
  data,
  state,
}: {
  data: Dataset;
  state: AppState;
}) {
  const { manifest } = data;
  // Default: one row per COUNTRY. When a country is selected, drill into it:
  // one row per ADMIN1 within that country.
  const aggregatingByAdmin1 = state.filter !== FILTER_ALL;
  const hexes = useMemo(() => {
    const filtered = applyCountryFilter(data.hexes, state.filter);
    const attr = aggregatingByAdmin1 ? "admin1" : "country";
    return aggregateBy(filtered, attr, manifest.stocks, manifest.fluxes);
  }, [data.hexes, state.filter, aggregatingByAdmin1, manifest.stocks, manifest.fluxes]);
  // Start expanded so all columns are visible by default; user can collapse.
  const [stocksExpanded, setStocksExpanded] = useState(true);
  const [fluxesExpanded, setFluxesExpanded] = useState(true);

  const rows = useMemo(() => {
    const arr = [...hexes];
    if (state.sort === "stocks_total")
      arr.sort(
        (a, b) =>
          stocksTotal(b, manifest.stocks) - stocksTotal(a, manifest.stocks)
      );
    if (state.sort === "fluxes_total")
      arr.sort(
        (a, b) =>
          Math.abs(fluxTotal(b, manifest.fluxes)) -
          Math.abs(fluxTotal(a, manifest.fluxes))
      );
    if (state.sort === "fluxes_net")
      arr.sort(
        (a, b) => fluxTotal(b, manifest.fluxes) - fluxTotal(a, manifest.fluxes)
      );
    return arr.slice(0, 300);
  }, [hexes, manifest, state.sort]);

  const stockPools = manifest.stocks;
  // Flux components = emissions + removals (the "fractions" that net flux is composed of).
  const fluxComponents = useMemo(
    () => manifest.fluxes.filter((l) => l.group !== "net"),
    [manifest.fluxes]
  );

  // Per-column maxes so icon sizes can be normalised relative to each column.
  const maxTotalStocks = useMemo(() => {
    let m = 0;
    for (const h of hexes) {
      const v = stocksTotal(h, manifest.stocks);
      if (v > m) m = v;
    }
    return m;
  }, [hexes, manifest.stocks]);
  const maxPerPool = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of stockPools) map[p.key] = maxStock(hexes, p.key);
    return map;
  }, [hexes, stockPools]);
  const maxNetFluxAbs = useMemo(
    () => fluxRange(hexes, "net_flux").absMax,
    [hexes]
  );
  const maxPerFluxComp = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of fluxComponents) map[p.key] = fluxRange(hexes, p.key).absMax;
    return map;
  }, [hexes, fluxComponents]);

  const stickyHeaderBase: React.CSSProperties = {
    position: "sticky",
    top: 0,
    background: "var(--color-purple)",
    zIndex: 2,
  };
  const sectionHeaderStyle: React.CSSProperties = {
    ...stickyHeaderBase,
    fontSize: "1.05rem",
    fontWeight: 400,
    letterSpacing: "0.06em",
    color: "var(--color-text)",
    textTransform: "uppercase",
  };
  const subHeaderStyle: React.CSSProperties = {
    ...stickyHeaderBase,
    fontSize: "0.7rem",
    fontWeight: 400,
    letterSpacing: "0.04em",
    color: "var(--color-text-soft)",
  };
  const dividerStyle: React.CSSProperties = {
    borderLeft: "1px solid rgba(255,255,255,0.28)",
  };

  return (
    <div className="overflow-auto px-6 py-2" style={{ height: "100%" }}>
      <table
        className="w-full text-sm tabular-nums"
        style={{ color: "var(--color-text-soft)" }}
      >
        <thead>
          <tr>
            <th
              className="text-left pb-3 pr-6"
              style={sectionHeaderStyle}
            >
              {aggregatingByAdmin1 ? "Region" : "Country"}
            </th>

            <th
              className="text-left pb-3 pr-2 pl-4"
              style={{ ...sectionHeaderStyle, ...dividerStyle }}
            >
              <span style={{ whiteSpace: "nowrap" }}>
                Total stocks
                <CaretToggle
                  expanded={stocksExpanded}
                  onClick={() => setStocksExpanded((v) => !v)}
                  ariaLabel={
                    stocksExpanded
                      ? "Collapse stock pools"
                      : "Expand stock pools"
                  }
                />
              </span>
            </th>

            {stocksExpanded &&
              stockPools.map((p) => (
                <th
                  key={p.key}
                  className="text-left pb-3 pl-4 pr-2"
                  style={subHeaderStyle}
                >
                  {p.label}
                </th>
              ))}

            <th
              className="text-left pb-3 pl-4 pr-2"
              style={{ ...sectionHeaderStyle, ...dividerStyle }}
            >
              <span style={{ whiteSpace: "nowrap" }}>
                Net flux
                <CaretToggle
                  expanded={fluxesExpanded}
                  onClick={() => setFluxesExpanded((v) => !v)}
                  ariaLabel={
                    fluxesExpanded
                      ? "Collapse flux components"
                      : "Expand flux components"
                  }
                />
              </span>
            </th>

            {fluxesExpanded &&
              fluxComponents.map((p) => (
                <th
                  key={p.key}
                  className="text-left pb-3 pl-4 pr-2"
                  style={subHeaderStyle}
                >
                  {p.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((hex) => {
            const stockTot = stocksTotal(hex, manifest.stocks);
            const fluxTot = fluxTotal(hex, manifest.fluxes);
            const isSource = fluxTot >= 0;
            return (
              <tr
                key={hex.hex_id}
                className="border-t border-white/5 hover:bg-white/[0.05]"
              >
                <td className="py-2.5 pr-6 align-middle">{hex.hex_id}</td>

                <td className="py-2.5 pl-4 pr-2 align-middle" style={dividerStyle}>
                  <div className="flex items-center gap-3">
                    <StockCubeIcon
                      width={26}
                      valueRatio={
                        maxTotalStocks > 0 ? stockTot / maxTotalStocks : 0
                      }
                    />
                    <span style={{ color: "var(--color-text)" }}>
                      {stockTot.toFixed(2)}
                    </span>
                  </div>
                </td>

                {stocksExpanded &&
                  stockPools.map((p) => {
                    const v = hex.stocks[p.key] ?? 0;
                    const m = maxPerPool[p.key] ?? 0;
                    return (
                      <td key={p.key} className="py-2.5 pl-4 pr-2 align-middle">
                        <div className="flex items-center gap-2">
                          <StockCubeIcon
                            width={18}
                            strokeWidth={1.25}
                            valueRatio={m > 0 ? v / m : 0}
                          />
                          <span>{v.toFixed(2)}</span>
                        </div>
                      </td>
                    );
                  })}

                <td className="py-2.5 pl-4 pr-2 align-middle" style={dividerStyle}>
                  <div className="flex items-center gap-3">
                    <FluxHouseIcon
                      width={26}
                      direction={isSource ? "up" : "down"}
                      filled
                      valueRatio={
                        maxNetFluxAbs > 0
                          ? Math.abs(fluxTot) / maxNetFluxAbs
                          : 0
                      }
                    />
                    <span
                      style={{
                        color: isSource
                          ? "var(--color-pink)"
                          : "var(--color-teal)",
                      }}
                    >
                      {isSource ? "+" : "−"}
                      {Math.abs(fluxTot).toFixed(2)}
                    </span>
                  </div>
                </td>

                {fluxesExpanded &&
                  fluxComponents.map((p) => {
                    const v = hex.fluxes[p.key] ?? 0;
                    const sign = v > 0 ? "+" : v < 0 ? "−" : "";
                    const direction: "up" | "down" =
                      p.group === "emissions" ? "up" : "down";
                    const valueColor =
                      direction === "up"
                        ? "var(--color-pink)"
                        : "var(--color-teal)";
                    const m = maxPerFluxComp[p.key] ?? 0;
                    return (
                      <td key={p.key} className="py-2.5 pl-4 pr-2 align-middle">
                        <div className="flex items-center gap-2">
                          <FluxHouseIcon
                            width={18}
                            strokeWidth={1.25}
                            direction={direction}
                            valueRatio={m > 0 ? Math.abs(v) / m : 0}
                          />
                          <span style={{ color: valueColor }}>
                            {sign}
                            {Math.abs(v).toFixed(2)}
                          </span>
                        </div>
                      </td>
                    );
                  })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

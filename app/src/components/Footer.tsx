"use client";

import { useMemo, useState } from "react";
import { hexbin as d3Hexbin } from "d3-hexbin";
import { scaleSqrt } from "d3-scale";
import type { AppState } from "@/lib/ui-state";
import type { HexFeature, LayerDef } from "@/lib/schema";
import {
  STOCKS_TOTAL_KEY,
  applyCountryFilter,
  colorClips,
  sizeBinRange,
  stocksTotal,
} from "@/lib/data";
import {
  NUM_LEGEND_BINS,
  fluxBinColor,
  fluxBinRange,
  type ColorRampMode,
} from "@/lib/color";
import { DOT_MIN, DOT_MAX } from "./views/MapChartView";
import { Pill, PillGroup, PillSelect } from "./Pill";

const HEX = d3Hexbin<unknown>().radius(1).hexagon();
const LAYOUT_R = DOT_MAX; // common spacing radius so legends line up
const PITCH = LAYOUT_R * 2 + 3;
const N = NUM_LEGEND_BINS;

type Swatch = { r: number; fill: string; stroke?: string };

function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

// An interactive row of hexagons rendered at their true map radii. Clicking a
// swatch toggles it in the selection (selected stay bright, unselected dim);
// hovering shows the value range that bucket covers. A transparent hit-rect
// over each swatch makes the tiny hexes easy to click/hover.
function HexRow({
  items,
  selected,
  onItemClick,
  ranges,
}: {
  items: Swatch[];
  selected?: number[];
  onItemClick?: (i: number) => void;
  ranges?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = !!onItemClick;
  const hasSelection = (selected?.length ?? 0) > 0;
  const cx = (i: number) => LAYOUT_R + i * PITCH;
  const w = cx(items.length - 1) + LAYOUT_R + 2;
  const h = LAYOUT_R * 2 + 4;
  const cy = h / 2;
  return (
    <div style={{ position: "relative" }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        {items.map((it, i) => {
          const isSel = selected?.includes(i);
          const dim = hasSelection && !isSel;
          return (
            <g key={i}>
              <path
                d={HEX}
                transform={`translate(${cx(i)}, ${cy}) scale(${it.r})`}
                fill={it.fill}
                fillOpacity={dim ? 0.22 : 1}
                stroke={isSel ? "var(--color-teal)" : it.stroke ?? "rgba(255,255,255,0.3)"}
                strokeOpacity={dim ? 0.3 : 1}
                strokeWidth={isSel ? 1.4 : 0.7}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={cx(i) - PITCH / 2}
                y={0}
                width={PITCH}
                height={h}
                fill="transparent"
                style={{ cursor: interactive ? "pointer" : "default" }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((p) => (p === i ? null : p))}
                onClick={interactive ? () => onItemClick?.(i) : undefined}
              />
            </g>
          );
        })}
      </svg>
      {hover != null && ranges?.[hover] && (
        <div
          style={{
            position: "absolute",
            left: cx(hover),
            bottom: "calc(100% + 8px)",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            background: "var(--color-purple-deep)",
            border: "1px solid var(--color-teal)",
            borderRadius: 6,
            padding: "3px 7px",
            fontSize: "0.62rem",
            color: "var(--color-text)",
            pointerEvents: "none",
            zIndex: 60,
            boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
          }}
        >
          {ranges[hover]}
        </div>
      )}
    </div>
  );
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.72rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-text-soft)",
};

// Year "slider": a teal track with five hexagons, the last (2024) selected.
// Visual only for now — switching years isn't wired up yet.
function YearSlider() {
  const count = 5;
  const r = 4;
  const pitch = 18;
  const cx = (i: number) => r + i * pitch;
  const w = cx(count - 1) + r + 2;
  const h = r * 2 + 4;
  const cy = h / 2;
  return (
    <div className="flex items-center gap-2">
      <span style={LABEL_STYLE}>Year</span>
      <svg width={w} height={h} style={{ display: "block" }}>
        <line
          x1={cx(0)}
          x2={cx(count - 1)}
          y1={cy}
          y2={cy}
          stroke="var(--color-teal)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {Array.from({ length: count }).map((_, i) => {
          const selected = i === count - 1;
          return (
            <path
              key={i}
              d={HEX}
              transform={`translate(${cx(i)}, ${cy}) scale(${r})`}
              fill={selected ? "var(--color-teal)" : "var(--color-purple-deep)"}
              stroke="var(--color-teal)"
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <span
        style={{ color: "var(--color-teal)", fontWeight: 600, fontSize: "0.78rem" }}
      >
        2024
      </span>
    </div>
  );
}

export function Footer({
  state,
  hexes,
  stocks,
  fluxes,
}: {
  state: AppState;
  hexes: HexFeature[];
  stocks: LayerDef[];
  fluxes: LayerDef[];
}) {
  const isMap = state.view === "map";
  const isScatter = state.view === "scatter";
  const isHistogram = state.view === "histogram";
  // Density mode replaces individual dots with binned hexes, so the per-dot
  // size/color encodings (and their legend) no longer apply.
  const isDensity = isScatter && state.scatterMode === "density";
  const showFixedKeys = (isScatter || isHistogram) && !isDensity;

  const filtered = useMemo(
    () => applyCountryFilter(hexes, state.filter),
    [hexes, state.filter]
  );

  // ----- Size legend (matches the map's dot-size scale) -----
  // Map: the selected Size layer. Chart/Histogram: total stocks (fixed).
  const sizeKey = isMap ? state.stocksKey : STOCKS_TOTAL_KEY;
  const sizeUnits = stocks[0]?.units ?? "";
  const sizeMax = useMemo(() => {
    let m = 0;
    for (const h of filtered) {
      const v =
        sizeKey === STOCKS_TOTAL_KEY
          ? stocksTotal(h, stocks)
          : h.stocks[sizeKey] ?? 0;
      if (v > m) m = v;
    }
    return m;
  }, [filtered, sizeKey, stocks]);
  const sizeItems: Swatch[] = useMemo(() => {
    const scale = scaleSqrt().domain([0, sizeMax || 1]).range([DOT_MIN, DOT_MAX]);
    return Array.from({ length: N }, (_, i) => ({
      r: scale(((i + 0.5) / N) * sizeMax),
      fill: "#ffffff",
      stroke: "rgba(255,255,255,0.45)",
    }));
  }, [sizeMax]);
  const sizeRanges = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const [lo, hi] = sizeBinRange(i, sizeMax, N);
        return `${fmtNum(lo)} – ${fmtNum(hi)} ${sizeUnits}`;
      }),
    [sizeMax, sizeUnits]
  );

  // ----- Color legend (matches the map's marker ramp) -----
  // Map: the selected Color layer; emissions → pink side, removals → teal side,
  // net → diverging. Chart/Histogram: net flux (diverging, fixed).
  const colorKey = isMap ? state.fluxesKey : "net_flux";
  const colorLayer = fluxes.find((l) => l.key === colorKey);
  const colorUnits = colorLayer?.units ?? "";
  const colorMode: ColorRampMode = !isMap
    ? "diverging"
    : colorLayer?.group === "emissions"
    ? "source"
    : colorLayer?.group === "removals"
    ? "sink"
    : "diverging";
  const clips = useMemo(
    () => colorClips(filtered, colorKey),
    [filtered, colorKey]
  );
  const colorItems: Swatch[] = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => ({
        r: DOT_MAX,
        fill: fluxBinColor(i, clips.posMax, clips.negMax, colorMode, N),
      })),
    [clips, colorMode]
  );
  const colorRanges = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const [lo, hi] = fluxBinRange(i, clips.posMax, clips.negMax, colorMode, N);
        return `${fmtNum(lo)} – ${fmtNum(hi)} ${colorUnits}`;
      }),
    [clips, colorMode, colorUnits]
  );

  // Histogram metric options, grouped: "Total stocks" / "Net flux" act as
  // capitalised headers (still selectable aggregates); the individual pools and
  // flux components sit indented beneath, sorted alphabetically.
  const byLabel = (a: { label: string }, b: { label: string }) =>
    a.label.localeCompare(b.label);
  const netLayer = fluxes.find((l) => l.group === "net");
  const histogramOptions = [
    { value: STOCKS_TOTAL_KEY, label: "Total stocks", strong: true },
    ...stocks
      .map((l) => ({ value: l.key, label: l.label, indent: true }))
      .sort(byLabel),
    ...(netLayer
      ? [{ value: netLayer.key, label: netLayer.label, strong: true }]
      : []),
    ...fluxes
      .filter((l) => l.group !== "net")
      .map((l) => ({ value: l.key, label: l.label, indent: true }))
      .sort(byLabel),
  ];

  return (
    <footer className="flex items-center justify-between px-6 py-4 gap-6">
      {/* Left: per-view metric selectors (+ inline legends on the map) */}
      <div className="flex items-center gap-4">
        {isMap && (
          <>
            <div className="flex items-center gap-2">
              <PillSelect
                label="Size:"
                value={state.stocksKey}
                onChange={state.setStocksKey}
                options={[
                  { value: STOCKS_TOTAL_KEY, label: "Total stocks" },
                  ...stocks.map((l) => ({ value: l.key, label: l.label })),
                ]}
              />
              <HexRow
                items={sizeItems}
                selected={state.sizeBins}
                onItemClick={state.toggleSizeBin}
                ranges={sizeRanges}
              />
            </div>
            <div className="flex items-center gap-2">
              <PillSelect
                label="Color:"
                value={state.fluxesKey}
                onChange={state.setFluxesKey}
                options={fluxes.map((l) => ({ value: l.key, label: l.label }))}
              />
              <HexRow
                items={colorItems}
                selected={state.colorBins}
                onItemClick={state.toggleColorBin}
                ranges={colorRanges}
              />
            </div>
          </>
        )}
        {isScatter && (
          <>
            <PillSelect
              label="X axis:"
              value={state.stocksKey}
              onChange={state.setStocksKey}
              options={[
                { value: STOCKS_TOTAL_KEY, label: "Total stocks" },
                ...stocks.map((l) => ({ value: l.key, label: l.label })),
              ]}
            />
            <PillSelect
              label="Y axis:"
              value={state.fluxesKey}
              onChange={state.setFluxesKey}
              options={fluxes.map((l) => ({ value: l.key, label: l.label }))}
            />
          </>
        )}
        {isHistogram && (
          <PillSelect
            label="Metric:"
            value={state.histogramMetricKey}
            onChange={state.setHistogramMetricKey}
            options={histogramOptions}
          />
        )}
      </div>

      {/* Right: fixed (interactive) size/color keys for chart/histogram, then
          data + year. */}
      <div className="flex items-center gap-4">
        {showFixedKeys && (
          <>
            <div className="flex items-center gap-2">
              <span style={LABEL_STYLE}>Total stocks</span>
              <HexRow
                items={sizeItems}
                selected={state.sizeBins}
                onItemClick={state.toggleSizeBin}
                ranges={sizeRanges}
              />
            </div>
            <div className="flex items-center gap-2">
              <span style={LABEL_STYLE}>Net flux</span>
              <HexRow
                items={colorItems}
                selected={state.colorBins}
                onItemClick={state.toggleColorBin}
                ranges={colorRanges}
              />
            </div>
          </>
        )}
        <PillGroup>
          <Pill
            active={state.dataMode === "real"}
            onClick={() => state.setDataMode("real")}
          >
            Real
          </Pill>
          <Pill
            active={state.dataMode === "mock"}
            onClick={() => state.setDataMode("mock")}
          >
            Mock
          </Pill>
        </PillGroup>
        <YearSlider />
      </div>
    </footer>
  );
}

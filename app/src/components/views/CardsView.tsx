"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dataset, HexFeature } from "@/lib/schema";
import type { AppState } from "@/lib/ui-state";
import { StocksTotem } from "../totems/StocksTotem";
import { FluxesTotem } from "../totems/FluxesTotem";
import {
  FILTER_ALL,
  absMaxFluxAcrossAll,
  aggregateBy,
  applyCountryFilter,
  fluxRange,
  fluxTotal,
  maxStockAcrossAll,
  stocksTotal,
} from "@/lib/data";
import type { PieceTooltip } from "@/lib/tooltip";
import { useTooltip } from "@/lib/tooltip";
import { Tooltip } from "../Tooltip";
import { HexDetailBox } from "../HexDetailBox";

// Layout constants — proportions of totem width that determine heights.
// (Mirrored in StocksTotem / FluxesTotem; kept here so we can pre-compute
// the max heights for the grid layout without rendering all cards twice.)
// Smaller top skew → less tapering at cube peaks → more flat-W body content,
// which reads visually closer to the flux house's flat-W base. Pushed down to
// 0.14 to bring stock visual width up to match the pentagon-shaped flux pieces.
const STOCK_TOP_SKEW_RATIO = 0.14;
// With partial-overlap stacking, gap is the extra offset beyond the natural
// share-the-interface position. Small positive value = pieces overlap but
// their corner vertices no longer coincide (slight visible separation).
const STOCK_GAP_RATIO = 0.12;
const FLUX_PEAK_RATIO = 0.22;
const FLUX_GAP_RATIO = 0.18;
const FLUX_PIECE_GAP_RATIO = 0.08; // gap between consecutive flux pieces
const STROKE_PX = 2;
const LABEL_COL_WIDTH = 120;
// Extra padding between the bottom of the stocks totem and the first label row
const STOCKS_BOTTOM_PADDING = 36;

const TARGET_VIEW_FRACTION = 0.94;
// Fixed middle-row heights (value+units take two lines; area name up to two).
const ROW_TOTAL_POOL = 38; // stocks value + units
const ROW_AREA = 34; // country / region name (≤ 2 lines, ellipsis)
const ROW_NET_FLUX = 38; // net flux value + units
const ROW_FLUXES_LABEL = 24;
// Sum of fixed middle rows + padding between stocks totem and the labels.
const LABELS_HEIGHT =
  ROW_TOTAL_POOL + ROW_AREA + ROW_NET_FLUX + ROW_FLUXES_LABEL + 36;
const MIN_WIDTH = 64;
const MAX_WIDTH = 180;

export function CardsView({
  data,
  state,
}: {
  data: Dataset;
  state: AppState;
}) {
  const { manifest } = data;
  // Default: one card per COUNTRY. When a country is selected in the filter,
  // drill into it: one card per ADMIN1 within that country.
  const hexes = useMemo(() => {
    const filtered = applyCountryFilter(data.hexes, state.filter);
    const attr = state.filter === FILTER_ALL ? "country" : "admin1";
    return aggregateBy(filtered, attr, manifest.stocks, manifest.fluxes);
  }, [data.hexes, state.filter, manifest.stocks, manifest.fluxes]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(720);
  const [selectedHex, setSelectedHex] = useState<HexFeature | null>(null);
  const tooltip = useTooltip();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setContainerHeight(e.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nStocks = manifest.stocks.length;
  const nEmissions = manifest.fluxes.filter((l) => l.group === "emissions").length;
  const nRemovals = manifest.fluxes.filter((l) => l.group === "removals").length;

  // Solve totem width so combined max heights + labels ≈ TARGET_VIEW_FRACTION of container.
  //
  // Stocks (partial-overlap stacking): yTop increments by bodyHeight + gap.
  //   stocks_max = (N−1) * (bodyMax + gap) + 2*topSkew + bodyMax
  //              = N*W − 2*(N−1)*topSkew + (N−1)*gap   (using bodyMax = W − 2*topSkew)
  //              = W * (N − 2*(N−1)*topSkewRatio + (N−1)*gapRatio)
  //
  // Fluxes (house + chevron-bands, gap between emission/removal stacks):
  //   total = (N_e + N_r) * (W/2 − 2*stroke) + 2*peakRatio*W + gapRatio*W
  const totemWidth = useMemo(() => {
    const sCoef =
      nStocks +
      Math.max(0, nStocks - 1) * (STOCK_GAP_RATIO - 2 * STOCK_TOP_SKEW_RATIO);
    const fCoef =
      (nEmissions + nRemovals) * 0.5 +
      2 * FLUX_PEAK_RATIO +
      FLUX_GAP_RATIO +
      Math.max(0, nEmissions - 1 + nRemovals - 1) * FLUX_PIECE_GAP_RATIO;
    const fConst = -(nEmissions + nRemovals) * 2 * STROKE_PX;
    const target = TARGET_VIEW_FRACTION * containerHeight - LABELS_HEIGHT - fConst;
    const w = target / (sCoef + fCoef);
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
  }, [containerHeight, nStocks, nEmissions, nRemovals]);

  // Single global maxes for normalisation
  const globalMaxStock = useMemo(
    () => maxStockAcrossAll(hexes, manifest.stocks.map((l) => l.key)),
    [hexes, manifest.stocks]
  );
  const globalAbsMaxFluxComponent = useMemo(
    () =>
      absMaxFluxAcrossAll(
        hexes,
        manifest.fluxes.filter((l) => l.group !== "net").map((l) => l.key)
      ),
    [hexes, manifest.fluxes]
  );
  const globalAbsMaxNet = useMemo(() => {
    const netLayer = manifest.fluxes.find((l) => l.group === "net");
    return netLayer ? fluxRange(hexes, netLayer.key).absMax : 0;
  }, [hexes, manifest.fluxes]);

  // Buffer row above the flux totem. Size it to the ACTUAL tallest emission
  // stack across the data (not the theoretical "every piece maxed" height,
  // which would leave a big empty gap on most cards), then add the same
  // padding the stocks side uses — so the largest flux totem sits exactly
  // STOCKS_BOTTOM_PADDING below the labels (symmetric with the stocks gap),
  // and nothing overlaps.
  const cornerRadius = Math.max(2, totemWidth * 0.06);
  const svgPad = STROKE_PX + cornerRadius;
  const maxEmissionsHeight = useMemo(() => {
    const maxPiece = totemWidth / 2 - 2 * STROKE_PX;
    const peak = totemWidth * FLUX_PEAK_RATIO;
    const pieceGap = totemWidth * FLUX_PIECE_GAP_RATIO;
    const emissionLayers = manifest.fluxes.filter(
      (l) => l.group === "emissions"
    );
    const nE = emissionLayers.length;
    let maxStack = 0;
    for (const h of hexes) {
      let thicknessSum = 0;
      for (const l of emissionLayers) {
        const t = Math.min(
          1,
          Math.abs(h.fluxes[l.key] ?? 0) / (globalAbsMaxFluxComponent || 1)
        );
        thicknessSum += t * maxPiece;
      }
      const stack = thicknessSum + Math.max(0, nE - 1) * pieceGap + peak;
      if (stack > maxStack) maxStack = stack;
    }
    return maxStack + STOCKS_BOTTOM_PADDING + svgPad;
  }, [hexes, totemWidth, manifest.fluxes, globalAbsMaxFluxComponent, svgPad]);

  const sorted = useMemo(() => {
    const arr = [...hexes];
    switch (state.sort) {
      case "stocks_total":
        arr.sort(
          (a, b) =>
            stocksTotal(b, manifest.stocks) - stocksTotal(a, manifest.stocks)
        );
        break;
      case "fluxes_total":
        arr.sort(
          (a, b) =>
            Math.abs(fluxTotal(b, manifest.fluxes)) -
            Math.abs(fluxTotal(a, manifest.fluxes))
        );
        break;
      case "fluxes_net":
        arr.sort(
          (a, b) => fluxTotal(b, manifest.fluxes) - fluxTotal(a, manifest.fluxes)
        );
        break;
    }
    return arr.slice(0, 400);
  }, [hexes, state.sort, manifest.stocks, manifest.fluxes]);

  const cardWidth = totemWidth + 20; // small breathing room around totem
  const gapBetween = 8;

  // Shared row template — used by BOTH the label column and the card track so
  // their rows align horizontally without relying on grid auto-sizing matching
  // between the two grids.
  const rowsTemplate =
    `minmax(0, 1fr) ${ROW_TOTAL_POOL}px ${ROW_AREA}px ${ROW_NET_FLUX}px ` +
    `${ROW_FLUXES_LABEL}px ${maxEmissionsHeight}px minmax(0, 1fr)`;

  return (
    <div ref={containerRef} className="h-full w-full flex">
      {/* Sticky label column — a separate grid outside the scroll container */}
      <div
        className="flex-shrink-0 h-full"
        style={{
          width: LABEL_COL_WIDTH,
          background: "var(--color-purple)",
          boxShadow: "8px 0 14px -10px rgba(0,0,0,0.35)",
          zIndex: 2,
        }}
      >
        <div
          className="h-full grid"
          style={{
            gridTemplateRows: rowsTemplate,
            padding: "16px 0 16px 24px",
          }}
        >
          <LabelCells
            areaLabel={state.filter === FILTER_ALL ? "Country" : "Region"}
          />
        </div>
      </div>

      {/* Scrolling card track */}
      <div
        ref={scrollRef}
        className="flex-1 min-w-0 h-full overflow-x-auto overflow-y-hidden no-scrollbar"
      >
        <div
          className="h-full grid"
          style={{
            gridTemplateRows: rowsTemplate,
            gridAutoFlow: "column",
            gridAutoColumns: `${cardWidth}px`,
            columnGap: `${gapBetween}px`,
            padding: `16px 24px 16px 8px`,
            alignItems: "stretch",
          }}
        >
          {sorted.map((hex) => (
            <CardCells
              key={hex.hex_id}
              hex={hex}
              stockLayers={manifest.stocks}
              fluxLayers={manifest.fluxes}
              globalMaxStock={globalMaxStock}
              globalAbsMaxFluxComponent={globalAbsMaxFluxComponent}
              globalAbsMaxNet={globalAbsMaxNet}
              totemWidth={totemWidth}
              cornerRadius={cornerRadius}
              scrollRef={scrollRef}
              onPieceHover={tooltip.show}
              onPieceLeave={tooltip.hide}
              onSelect={setSelectedHex}
            />
          ))}
        </div>
      </div>

      <Tooltip state={tooltip.state} />
      {selectedHex && (
        <HexDetailBox
          hex={selectedHex}
          manifest={manifest}
          globalMaxStock={globalMaxStock}
          globalAbsMaxFluxComponent={globalAbsMaxFluxComponent}
          globalAbsMaxNet={globalAbsMaxNet}
          onClose={() => setSelectedHex(null)}
          onPieceHover={tooltip.show}
          onPieceLeave={tooltip.hide}
        />
      )}
    </div>
  );
}

function LabelCells({ areaLabel }: { areaLabel: string }) {
  const sectionStyle: React.CSSProperties = {
    color: "var(--color-text)",
    fontSize: "0.7rem",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    fontWeight: 500,
  };
  const valueLabelStyle: React.CSSProperties = {
    color: "var(--color-text-soft)",
    fontSize: "0.6rem",
    letterSpacing: "0.1em",
  };
  return (
    <>
      {/* Row 1 — Stocks section header, bottom-anchored to match cube baseline.
          Matching the stocks-cell padding-bottom so the label aligns with the
          totem rather than sitting all the way at the row's edge. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          paddingBottom: STOCKS_BOTTOM_PADDING,
        }}
      >
        <span style={sectionStyle}>Stocks</span>
      </div>
      {/* Rows 2-4 vertically centred to match the value+units cells. */}
      <div style={{ ...valueLabelStyle, display: "flex", alignItems: "center" }}>
        Total stocks
      </div>
      <div style={{ ...valueLabelStyle, display: "flex", alignItems: "center" }}>
        {areaLabel}
      </div>
      <div style={{ ...valueLabelStyle, display: "flex", alignItems: "center" }}>
        Net flux
      </div>
      {/* Row 5 — Fluxes section header (right below Net flux) */}
      <div style={{ ...sectionStyle, display: "flex", alignItems: "center" }}>
        Fluxes
      </div>
      {/* Row 6 — emissions buffer (empty in label column) */}
      <div />
      {/* Row 7 — flux body+removals (empty in label column) */}
      <div />
    </>
  );
}

function CardCells({
  hex,
  stockLayers,
  fluxLayers,
  globalMaxStock,
  globalAbsMaxFluxComponent,
  globalAbsMaxNet,
  totemWidth,
  cornerRadius,
  scrollRef,
  onPieceHover,
  onPieceLeave,
  onSelect,
}: {
  hex: HexFeature;
  stockLayers: Dataset["manifest"]["stocks"];
  fluxLayers: Dataset["manifest"]["fluxes"];
  globalMaxStock: number;
  globalAbsMaxFluxComponent: number;
  globalAbsMaxNet: number;
  totemWidth: number;
  cornerRadius: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPieceHover: ReturnType<typeof useTooltip>["show"];
  onPieceLeave: ReturnType<typeof useTooltip>["hide"];
  onSelect: (hex: HexFeature) => void;
}) {
  const stockTot = stocksTotal(hex, stockLayers);
  const fluxTot = fluxTotal(hex, fluxLayers);
  const sign = fluxTot >= 0 ? "+" : "−";

  // Enrich every piece tooltip with this card's total stocks and net flux so
  // hovering any piece also surfaces the card-level context.
  const stocksUnits = stockLayers[0]?.units ?? "";
  const netLayer = fluxLayers.find((l) => l.group === "net");
  const fluxUnits = netLayer?.units ?? fluxLayers[0]?.units ?? "";
  const enrichedHover = useCallback(
    (t: PieceTooltip, e: React.MouseEvent) => {
      // Show stocks total only on stock pieces; net flux only on flux pieces.
      const extras =
        t.kind === "stock"
          ? { totalStocks: stockTot, totalStocksUnits: stocksUnits }
          : { netFlux: fluxTot, netFluxUnits: fluxUnits };
      onPieceHover({ ...t, ...extras }, e);
    },
    [onPieceHover, stockTot, stocksUnits, fluxTot, fluxUnits]
  );

  // Animate totems on first time the card scrolls into view. Once flagged
  // animated, we leave it that way (no re-animation on subsequent scrolls).
  const stocksCellRef = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    if (animated) return;
    const target = stocksCellRef.current;
    const root = scrollRef.current;
    if (!target) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setAnimated(true);
          obs.disconnect();
        }
      },
      { root: root ?? null, threshold: 0.05 }
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [animated, scrollRef]);

  return (
    <>
      {/* Row 1: stocks totem, bottom-anchored with extra padding so there's
          breathing room between the totem and the labels below */}
      <div
        ref={stocksCellRef}
        className="flex flex-col items-center justify-end min-h-0"
        style={{ paddingBottom: STOCKS_BOTTOM_PADDING }}
      >
        <StocksTotem
          hex={hex}
          layers={stockLayers}
          globalMax={globalMaxStock}
          width={totemWidth}
          topSkewRatio={STOCK_TOP_SKEW_RATIO}
          gapRatio={STOCK_GAP_RATIO}
          strokeWidth={STROKE_PX}
          cornerRadius={cornerRadius}
          animated={animated}
          onPieceHover={enrichedHover}
          onPieceLeave={onPieceLeave}
        />
      </div>

      {/* Row 2: stocks total value + units */}
      <div
        className="flex flex-col items-center justify-center leading-tight overflow-hidden"
      >
        <span
          className="text-[0.82rem]"
          style={{ color: "var(--color-text)", fontWeight: 500 }}
        >
          {stockTot.toFixed(2)}
        </span>
        <span
          className="text-[0.56rem]"
          style={{ color: "var(--color-text-mute)" }}
        >
          {stocksUnits}
        </span>
      </div>

      {/* Row 3: area name — clamp to 2 lines with ellipsis so long country /
          region names never bleed into the net-flux value below. Click to open
          the detail card for this area. */}
      <button
        type="button"
        onClick={() => onSelect(hex)}
        className="text-center text-[0.6rem] tracking-[0.1em] uppercase px-1 overflow-hidden"
        style={{
          color: "var(--color-text-soft)",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          lineHeight: 1.1,
          alignSelf: "center",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.56rem",
        }}
        title={`${hex.hex_id} — open details`}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--color-teal)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--color-text-soft)")
        }
      >
        {hex.hex_id}
      </button>

      {/* Row 4: net flux value + units */}
      <div className="flex flex-col items-center justify-center leading-tight overflow-hidden">
        <span
          className="text-[0.82rem]"
          style={{
            color: fluxTot >= 0 ? "var(--color-pink)" : "var(--color-teal)",
            fontWeight: 500,
          }}
        >
          {sign}
          {Math.abs(fluxTot).toFixed(2)}
        </span>
        <span
          className="text-[0.56rem]"
          style={{ color: "var(--color-text-mute)" }}
        >
          {fluxUnits}
        </span>
      </div>

      {/* Row 5: empty in cards (FLUXES section header lives in the sticky label column) */}
      <div />

      {/* Row 6: emissions buffer — empty cell. The flux SVG in Row 7 has
          overflow-visible and a negative top margin equal to its emissions
          height, so emissions render up INTO this row. */}
      <div />

      {/* Row 7: flux body + removals (top-anchored at zero line) */}
      <div
        className="flex flex-col items-center justify-start min-h-0"
        style={{ overflow: "visible" }}
      >
        <FluxesTotem
          hex={hex}
          layers={fluxLayers}
          globalAbsMax={globalAbsMaxFluxComponent}
          globalAbsMaxNet={globalAbsMaxNet}
          width={totemWidth}
          peakRatio={FLUX_PEAK_RATIO}
          gapRatio={FLUX_GAP_RATIO}
          strokeWidth={STROKE_PX}
          cornerRadius={cornerRadius}
          animated={animated}
          onPieceHover={enrichedHover}
          onPieceLeave={onPieceLeave}
        />
      </div>
    </>
  );
}

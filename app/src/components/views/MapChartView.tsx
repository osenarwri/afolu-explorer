"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { hexbin as d3Hexbin } from "d3-hexbin";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { OrthographicView } from "@deck.gl/core";
import { IconLayer } from "@deck.gl/layers";
import type { Dataset, HexFeature } from "@/lib/schema";
import type { AppState, ViewKind } from "@/lib/ui-state";
import {
  STOCKS_TOTAL_KEY,
  absMaxFluxAcrossAll,
  applyCountryFilter,
  colorClips,
  fluxRange,
  getStockValue,
  maxStockAcrossAll,
  sizeBin,
  stocksTotal,
} from "@/lib/data";
import { fluxColorBin, fluxColorClipped, fluxColorSided } from "@/lib/color";
import { useTooltip, type PieceTooltip } from "@/lib/tooltip";
import { Tooltip } from "../Tooltip";
import { HexDetailBox } from "../HexDetailBox";

// Unified component for Map, Chart (scatter/density) and Histogram. Markers are
// drawn by a single GPU deck.gl IconLayer (hexagon icon) whose position / size /
// color are interpolated on the GPU when switching layouts; the SVG above only
// draws the lightweight chrome (axes, ticks, density bins, labels).

// deck.gl renders a WebGL canvas — load it client-side only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DeckGL = dynamic(() => import("@deck.gl/react").then((m) => m.default), {
  ssr: false,
}) as any;

const PAD = { top: 48, right: 48, bottom: 48, left: 48 };
const HEX_PATH = d3Hexbin<unknown>().radius(1).hexagon();
export const DOT_MIN = 1.5;
export const DOT_MAX = 5;
const NUM_BINS = 22;
const INTER_BAR_GAP_IN_PITCH = 2;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// Parse a CSS color ("#rrggbb" or "rgb(r, g, b)") to an [r,g,b] byte triple.
function cssToRGB(css: string): [number, number, number] {
  if (css[0] === "#") {
    const m = css.slice(1);
    return [
      parseInt(m.slice(0, 2), 16),
      parseInt(m.slice(2, 4), 16),
      parseInt(m.slice(4, 6), 16),
    ];
  }
  const nums = css.match(/[\d.]+/g);
  if (nums && nums.length >= 3)
    return [Math.round(+nums[0]), Math.round(+nums[1]), Math.round(+nums[2])];
  return [255, 255, 255];
}

interface Point {
  hex: HexFeature;
  hex_id: string;
  totalStocks: number;
  netFlux: number;
  mapX: number;
  mapY: number;
  chartX: number;
  chartY: number;
  histX: number;
  histY: number;
  xValue: number;
  yValue: number;
  histValue: number;
  sizeValue: number;
  colorValue: number;
}

export function MapChartView({
  data,
  state,
}: {
  data: Dataset;
  state: AppState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1024, h: 640 });
  const tooltip = useTooltip();
  const [selectedHex, setSelectedHex] = useState<HexFeature | null>(null);
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);

  // Apply the global country filter — when a country is selected, every view
  // shows only that country's hexes (the map re-fits to it).
  const hexes = useMemo(
    () => applyCountryFilter(data.hexes, state.filter),
    [data.hexes, state.filter]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0];
      setSize({ w: r.contentRect.width, h: r.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // This component stays mounted even on the non-marker views (table/cards) so
  // markers can animate OUT when leaving. `active` = a marker view is showing.
  // While inactive we keep using the LAST marker layout (so markers fly out
  // from where they were) via a render-time ref.
  const isMarkerView =
    state.view === "map" ||
    state.view === "scatter" ||
    state.view === "histogram";
  const lastMarkerView = useRef<ViewKind>("map");
  if (isMarkerView) lastMarkerView.current = state.view;
  const layoutView = isMarkerView ? state.view : lastMarkerView.current;
  const active = isMarkerView;

  const isMap = layoutView === "map";
  const isDensity = layoutView === "scatter" && state.scatterMode === "density";
  const isHistogram = layoutView === "histogram";

  // Fly-in / fly-out: when active, markers settle to their real positions; when
  // inactive they park on a circle outside the viewport. The deck.gl transition
  // carries them in/out. `deckReady` (set on the deck canvas's onLoad) gates the
  // first un-park so the parked frame is actually rendered before we animate —
  // otherwise on a cold landing the deck chunk loads after the un-park and the
  // markers just appear in place.
  const [parked, setParked] = useState(true);
  const [deckReady, setDeckReady] = useState(false);
  useEffect(() => {
    if (!active) {
      setParked(true);
      return;
    }
    if (!deckReady) return; // wait until deck has rendered the parked frame
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setParked(false));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [active, deckReady]);

  // Layer labels for the current selection
  const stocksLayerLabel = useMemo(() => {
    if (state.stocksKey === STOCKS_TOTAL_KEY) return "Total stocks";
    return (
      data.manifest.stocks.find((l) => l.key === state.stocksKey)?.label ??
      state.stocksKey
    );
  }, [state.stocksKey, data.manifest.stocks]);
  const stocksUnits = data.manifest.stocks[0]?.units ?? "";
  const fluxLayer = useMemo(
    () => data.manifest.fluxes.find((l) => l.key === state.fluxesKey),
    [state.fluxesKey, data.manifest.fluxes]
  );
  // Which side of the diverging ramp the map's Color encoding uses:
  //   emissions → always SOURCE (white→pink), removals → always SINK
  //   (white→teal); everything else (net flux) stays diverging.
  const colorMode: "source" | "sink" | "diverging" = useMemo(() => {
    if (fluxLayer?.group === "emissions") return "source";
    if (fluxLayer?.group === "removals") return "sink";
    return "diverging";
  }, [fluxLayer]);

  // Map projection bounds (Robinson rx/ry when available, else lon/lat).
  const useRobinson = hexes.length > 0 && hexes[0].rx != null;
  const mapBounds = useMemo(() => {
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const h of hexes) {
      const x = useRobinson ? (h.rx as number) : h.lon;
      const y = useRobinson ? (h.ry as number) : h.lat;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    if (!isFinite(xMin)) {
      xMin = -180;
      xMax = 180;
      yMin = -60;
      yMax = 80;
    }
    return { xMin, xMax, yMin, yMax };
  }, [hexes, useRobinson]);

  // Global maxes / color clips
  const fluxAbsMax = useMemo(
    () => fluxRange(hexes, "net_flux").absMax,
    [hexes]
  );
  const netFluxClips = useMemo(() => colorClips(hexes, "net_flux"), [hexes]);
  const colorLayerClips = useMemo(
    () => colorClips(hexes, state.fluxesKey),
    [hexes, state.fluxesKey]
  );
  const stocksMax = useMemo(
    () => maxStockAcrossAll(hexes, data.manifest.stocks.map((l) => l.key)),
    [hexes, data.manifest.stocks]
  );
  const totalStocksMax = useMemo(() => {
    let m = 0;
    for (const h of hexes) {
      const v = stocksTotal(h, data.manifest.stocks);
      if (v > m) m = v;
    }
    return m;
  }, [hexes, data.manifest.stocks]);
  const globalAbsMaxFluxComponent = useMemo(
    () =>
      absMaxFluxAcrossAll(
        hexes,
        data.manifest.fluxes.filter((l) => l.group !== "net").map((l) => l.key)
      ),
    [hexes, data.manifest.fluxes]
  );

  // Chart axis stats
  const chartStats = useMemo(() => {
    if (hexes.length === 0)
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, xMedian: 0 };
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    const xs: number[] = [];
    for (const h of hexes) {
      const x = getStockValue(h, state.stocksKey, data.manifest.stocks);
      const y = h.fluxes[state.fluxesKey] ?? 0;
      xs.push(x);
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    xs.sort((a, b) => a - b);
    return {
      xMin,
      xMax,
      yMin,
      yMax,
      xMedian: xs[Math.floor(xs.length / 2)],
    };
  }, [hexes, data.manifest.stocks, state.stocksKey, state.fluxesKey]);

  const yIsSigned = chartStats.yMin < 0;
  const innerW = size.w - PAD.left - PAD.right;
  const innerH = size.h - PAD.top - PAD.bottom;

  const xScale = useMemo(
    () =>
      scaleLinear()
        .domain([chartStats.xMin, chartStats.xMax || 1])
        .range([PAD.left, PAD.left + innerW]),
    [chartStats.xMin, chartStats.xMax, innerW]
  );
  const yScale = useMemo(() => {
    const domain = yIsSigned
      ? (() => {
          const m = Math.max(Math.abs(chartStats.yMin), chartStats.yMax) || 1;
          return [-m, m] as [number, number];
        })()
      : ([chartStats.yMin, chartStats.yMax || 1] as [number, number]);
    return scaleLinear()
      .domain(domain)
      .range([PAD.top + innerH, PAD.top]);
  }, [chartStats.yMin, chartStats.yMax, innerH, yIsSigned]);

  // Map dot size (Size selector) + color
  const sizeMax = useMemo(() => {
    if (isMap) {
      if (state.stocksKey === STOCKS_TOTAL_KEY) return totalStocksMax;
      let m = 0;
      for (const h of hexes) {
        const v = h.stocks[state.stocksKey] ?? 0;
        if (v > m) m = v;
      }
      return m;
    }
    return totalStocksMax;
  }, [isMap, state.stocksKey, totalStocksMax, hexes]);
  const sizeScale = useMemo(
    () =>
      scaleSqrt()
        .domain([0, sizeMax || 1])
        .range([DOT_MIN, DOT_MAX]),
    [sizeMax]
  );

  // ----- Histogram binning -----
  function getMetricValue(h: HexFeature, key: string): number {
    if (key === STOCKS_TOTAL_KEY) return stocksTotal(h, data.manifest.stocks);
    if (h.stocks[key] != null) return h.stocks[key];
    return h.fluxes[key] ?? 0;
  }

  const histogram = useMemo(() => {
    const key = state.histogramMetricKey;
    const values = hexes.map((h) => getMetricValue(h, key));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!isFinite(lo) || !isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (hi === lo) hi = lo + 1;
    const signed = lo < 0;
    let domainMin = lo;
    let domainMax = hi;
    if (signed) {
      const m = Math.max(Math.abs(lo), Math.abs(hi));
      domainMin = -m;
      domainMax = m;
    }
    const span = domainMax - domainMin || 1;
    const binSize = span / NUM_BINS;
    const totalStocksPerHex = hexes.map((h) =>
      stocksTotal(h, data.manifest.stocks)
    );
    // Legend filter: only PACK dots that pass the active color/size selection,
    // so the remaining ones stay densely stacked (no holes). Hidden dots get
    // slot −1 and are not rendered.
    const colorSel = state.colorBins;
    const sizeSel = state.sizeBins;
    const isVisible = (i: number) => {
      const cOk =
        colorSel.length === 0 ||
        colorSel.includes(
          fluxColorBin(
            hexes[i].fluxes["net_flux"] ?? 0,
            netFluxClips.posMax,
            netFluxClips.negMax,
            "diverging"
          )
        );
      const sOk =
        sizeSel.length === 0 ||
        sizeSel.includes(sizeBin(totalStocksPerHex[i], totalStocksMax));
      return cOk && sOk;
    };
    const bins = new Array(values.length).fill(0);
    const binGroups: number[][] = Array.from({ length: NUM_BINS }, () => []);
    for (let i = 0; i < values.length; i++) {
      let b = Math.floor((values[i] - domainMin) / binSize);
      if (b >= NUM_BINS) b = NUM_BINS - 1;
      if (b < 0) b = 0;
      bins[i] = b;
      if (isVisible(i)) binGroups[b].push(i);
    }
    const slotInBin = new Array(values.length).fill(-1);
    for (const group of binGroups) {
      group.sort((a, b) => totalStocksPerHex[b] - totalStocksPerHex[a]);
      for (let s = 0; s < group.length; s++) slotInBin[group[s]] = s;
    }
    const counts = binGroups.map((g) => g.length);
    const maxCount = counts.reduce((m, c) => Math.max(m, c), 1);
    const binCenters = new Array(NUM_BINS)
      .fill(0)
      .map((_, b) => domainMin + (b + 0.5) * binSize);
    return {
      values,
      bins,
      slotInBin,
      counts,
      maxCount,
      domainMin,
      domainMax,
      binSize,
      binCenters,
      signed,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hexes,
    data.manifest.stocks,
    state.histogramMetricKey,
    state.colorBins,
    state.sizeBins,
    netFluxClips,
    totalStocksMax,
  ]);

  const histogramMetricLabel = useMemo(() => {
    const k = state.histogramMetricKey;
    if (k === STOCKS_TOTAL_KEY) return "Total stocks";
    return (
      data.manifest.stocks.find((l) => l.key === k)?.label ??
      data.manifest.fluxes.find((l) => l.key === k)?.label ??
      k
    );
  }, [state.histogramMetricKey, data.manifest.stocks, data.manifest.fluxes]);

  const histogramMetricUnits = useMemo(() => {
    const k = state.histogramMetricKey;
    if (k === STOCKS_TOTAL_KEY) return data.manifest.stocks[0]?.units ?? "";
    return (
      data.manifest.stocks.find((l) => l.key === k)?.units ??
      data.manifest.fluxes.find((l) => l.key === k)?.units ??
      ""
    );
  }, [state.histogramMetricKey, data.manifest.stocks, data.manifest.fluxes]);

  // Histogram layout: pick columns_per_bin + pitch so inter-bar gap is
  // INTER_BAR_GAP_IN_PITCH × pitch and everything fits, maximising dot size.
  // Bars are spaced on a pitch-derived `barSlot` (not the raw slotWidth), so
  // the gap stays exactly INTER_BAR_GAP_IN_PITCH × pitch even when the dot size
  // is limited by vertical space; the whole ensemble is then centered.
  const histogramLayout = useMemo(() => {
    const histInnerW = size.w - PAD.left - PAD.right;
    const histInnerH = size.h - PAD.top - PAD.bottom - 56;
    const slotWidth = histInnerW / NUM_BINS;
    let bestCols = 1;
    let bestPitch = 0;
    for (let cols = 1; cols <= 12; cols++) {
      const horizPitch = slotWidth / (cols + INTER_BAR_GAP_IN_PITCH);
      const rows = Math.ceil(histogram.maxCount / cols);
      const vertPitch = histInnerH / rows;
      const p = Math.min(horizPitch, vertPitch);
      if (p > bestPitch) {
        bestPitch = p;
        bestCols = cols;
      }
    }
    const pitch = Math.max(3, bestPitch);
    const barSlot = (bestCols + INTER_BAR_GAP_IN_PITCH) * pitch;
    const totalW = NUM_BINS * barSlot;
    const histStartX = PAD.left + Math.max(0, (histInnerW - totalW) / 2);
    return {
      pitch,
      columnsPerBin: bestCols,
      maxRows: Math.ceil(histogram.maxCount / bestCols),
      barSlot,
      histStartX,
      histInnerH,
    };
  }, [size.w, size.h, histogram.maxCount]);
  const histogramPitch = histogramLayout.pitch;

  // ----- Project points for all three layouts -----
  const points: Point[] = useMemo(() => {
    const mapInnerW = size.w - PAD.left - PAD.right;
    const mapInnerH = size.h - PAD.top - PAD.bottom;
    const xSpan = mapBounds.xMax - mapBounds.xMin || 1;
    const ySpan = mapBounds.yMax - mapBounds.yMin || 1;
    const ppu = Math.min(mapInnerW / xSpan, mapInnerH / ySpan);
    const mapOffsetX = PAD.left + (mapInnerW - xSpan * ppu) / 2;
    const mapOffsetY = PAD.top + (mapInnerH - ySpan * ppu) / 2;

    const { pitch, columnsPerBin, histInnerH, barSlot, histStartX } =
      histogramLayout;
    const leadGap = (INTER_BAR_GAP_IN_PITCH / 2) * pitch;

    return hexes.map((h, i) => {
      const xValue = getStockValue(h, state.stocksKey, data.manifest.stocks);
      const yValue = h.fluxes[state.fluxesKey] ?? 0;
      const total = stocksTotal(h, data.manifest.stocks);

      const bin = histogram.bins[i];
      const slot = histogram.slotInBin[i];
      const contentLeft = histStartX + bin * barSlot + leadGap;
      // slot < 0 means filtered out of the histogram — park at the baseline
      // (it's rendered invisible anyway).
      const col = slot < 0 ? 0 : slot % columnsPerBin;
      const row = slot < 0 ? 0 : Math.floor(slot / columnsPerBin);
      const histX = contentLeft + (col + 0.5) * pitch;
      const histY =
        slot < 0
          ? PAD.top + histInnerH
          : PAD.top + histInnerH - (row + 0.5) * pitch;

      return {
        hex: h,
        hex_id: h.hex_id,
        totalStocks: total,
        netFlux: h.fluxes["net_flux"] ?? 0,
        mapX:
          mapOffsetX +
          ((useRobinson ? (h.rx as number) : h.lon) - mapBounds.xMin) * ppu,
        mapY:
          mapOffsetY +
          (mapBounds.yMax - (useRobinson ? (h.ry as number) : h.lat)) * ppu,
        chartX: xScale(xValue),
        chartY: yScale(yValue),
        histX,
        histY,
        xValue,
        yValue,
        histValue: histogram.values[i],
        sizeValue: isMap
          ? getStockValue(h, state.stocksKey, data.manifest.stocks)
          : total,
        colorValue: isMap
          ? h.fluxes[state.fluxesKey] ?? 0
          : h.fluxes["net_flux"] ?? 0,
      };
    });
  }, [
    hexes,
    data.manifest.stocks,
    state.stocksKey,
    state.fluxesKey,
    size.w,
    size.h,
    xScale,
    yScale,
    isMap,
    histogram,
    histogramLayout,
    mapBounds,
    useRobinson,
  ]);

  // Categorical attributes (country, admin1, …) shown under the name.
  const hexCategoricals = (h: HexFeature) => {
    const out: { label: string; value: string }[] = [];
    if (h.country) out.push({ label: "Country", value: h.country });
    if (h.admin1 && h.admin1 !== "—")
      out.push({ label: "Admin 1", value: h.admin1 });
    return out;
  };

  const buildHover = (p: Point): PieceTooltip => {
    const categoricals = hexCategoricals(p.hex);
    if (isMap) {
      const colorSigned =
        colorMode === "diverging" && fluxRange(hexes, state.fluxesKey).min < 0;
      // Accent / flux-row colour follows the same side rule as the markers:
      // emissions → pink, removals → teal, net → by sign.
      const fluxColorVar =
        colorMode === "source"
          ? "var(--color-pink)"
          : colorMode === "sink"
          ? "var(--color-teal)"
          : p.colorValue > 0
          ? "var(--color-pink)"
          : p.colorValue < 0
          ? "var(--color-teal)"
          : "var(--color-text-soft)";
      return {
        hexId: p.hex_id,
        categoricals,
        accent: fluxColorVar,
        rows: [
          {
            label: stocksLayerLabel,
            value: p.sizeValue,
            units: stocksUnits,
            color: "var(--color-teal)",
          },
          {
            label: fluxLayer?.label ?? state.fluxesKey,
            value: p.colorValue,
            units: fluxLayer?.units,
            color: fluxColorVar,
            signed: colorSigned,
          },
        ],
      };
    }
    if (isHistogram) {
      return {
        hexId: p.hex_id,
        categoricals,
        accent:
          p.netFlux > 0
            ? "var(--color-pink)"
            : p.netFlux < 0
            ? "var(--color-teal)"
            : "var(--color-text-soft)",
        rows: [
          {
            label: histogramMetricLabel,
            value: p.histValue,
            units: histogramMetricUnits,
            color: "var(--color-teal)",
            signed: histogram.signed,
          },
          {
            label: "Total stocks",
            value: p.totalStocks,
            units: stocksUnits,
            color: "var(--color-teal)",
          },
          {
            label: "Net flux",
            value: p.netFlux,
            units: fluxLayer?.units,
            color: p.netFlux >= 0 ? "var(--color-pink)" : "var(--color-teal)",
            signed: true,
          },
        ],
      };
    }
    return {
      hexId: p.hex_id,
      categoricals,
      accent:
        p.netFlux > 0
          ? "var(--color-pink)"
          : p.netFlux < 0
          ? "var(--color-teal)"
          : "var(--color-text-soft)",
      rows: [
        {
          label: stocksLayerLabel,
          value: p.xValue,
          units: stocksUnits,
          color: "var(--color-teal)",
        },
        {
          label: fluxLayer?.label ?? state.fluxesKey,
          value: p.yValue,
          units: fluxLayer?.units,
          color: p.yValue >= 0 ? "var(--color-pink)" : "var(--color-teal)",
          signed: yIsSigned,
        },
      ],
    };
  };

  // Density bins
  const densityBins = useMemo(() => {
    if (!isDensity) return [];
    const hb = d3Hexbin<Point>()
      .x((d) => d.chartX)
      .y((d) => d.chartY)
      .radius(7)
      .extent([
        [PAD.left, PAD.top],
        [PAD.left + innerW, PAD.top + innerH],
      ]);
    return hb(points);
  }, [isDensity, points, innerW, innerH]);
  const densityMaxBin = useMemo(
    () => densityBins.reduce((m, b) => Math.max(m, b.length), 1),
    [densityBins]
  );
  const densityHexPath = useMemo(
    () => d3Hexbin<Point>().radius(7).hexagon(),
    []
  );

  const showAxes = layoutView === "scatter";
  const midX = xScale(chartStats.xMedian);
  const midY = yScale(0);

  // Histogram axis layout + per-bar hover. Bars sit on `barSlot` spacing,
  // centered via `histStartX`, so labels/highlight/hover must use the same.
  const histBaselineY = PAD.top + innerH - 56;
  const histBarSlot = histogramLayout.barSlot;
  const histStartX = histogramLayout.histStartX;
  const histMidX = histStartX + (NUM_BINS * histBarSlot) / 2;

  const onHistMouseMove = (e: React.MouseEvent) => {
    if (!isHistogram) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const b = Math.floor((x - histStartX) / histBarSlot);
    if (b >= 0 && b < NUM_BINS) {
      if (hoveredBin !== b) setHoveredBin(b);
    } else if (hoveredBin !== null) {
      setHoveredBin(null);
    }
  };
  const onHistMouseLeave = () => {
    if (hoveredBin !== null) setHoveredBin(null);
  };

  const formatHistTick = (v: number) =>
    Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);

  // ----- deck.gl marker layer -----
  // Mount-gate so no GL/canvas work happens during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A white hexagon icon (the exact marker silhouette), tinted per-instance via
  // getColor (mask). Drawn once onto a canvas atlas.
  const iconAtlas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const S = 64;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.translate(S / 2, S / 2);
    const rr = S / 2 - 2;
    ctx.scale(rr, rr);
    ctx.fill(new Path2D(HEX_PATH as string));
    return c;
  }, []);
  const iconMapping = useMemo(
    () => ({
      hex: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true },
    }),
    []
  );

  // Per-marker target position / radius / RGBA, recomputed per layout. deck.gl
  // GPU-interpolates between successive versions of these (the transitions).
  const visuals = useMemo(() => {
    const n = points.length;
    const targets: [number, number][] = new Array(n);
    const radii: number[] = new Array(n);
    const colors: [number, number, number, number][] = new Array(n);
    const cxc = size.w / 2;
    const cyc = size.h / 2;
    const R = Math.hypot(size.w, size.h) / 2 + 140;
    const histDotMaxR = Math.min(DOT_MAX, histogramPitch * 0.4);
    const histDotMinR = Math.min(DOT_MIN, histDotMaxR);
    const histSizeScale = scaleSqrt()
      .domain([0, totalStocksMax || 1])
      .range([histDotMinR, histDotMaxR]);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const realTx = isMap ? p.mapX : isHistogram ? p.histX : p.chartX;
      const realTy = isMap ? p.mapY : isHistogram ? p.histY : p.chartY;
      let tx = realTx;
      let ty = realTy;
      if (parked) {
        const dx = realTx - cxc;
        const dy = realTy - cyc;
        const len = Math.hypot(dx, dy) || 1;
        tx = cxc + (dx / len) * R;
        ty = cyc + (dy / len) * R;
      }
      targets[i] = [tx, ty];
      radii[i] = isHistogram
        ? histSizeScale(p.totalStocks)
        : sizeScale(p.sizeValue);
      const colorVal = isHistogram ? p.netFlux : p.colorValue;
      const clips = isMap ? colorLayerClips : netFluxClips;
      const effColorMode = isMap ? colorMode : "diverging";
      const colorStr =
        effColorMode !== "diverging"
          ? fluxColorSided(colorVal, clips.posMax, effColorMode)
          : fluxColorClipped(colorVal, clips.posMax, clips.negMax);
      const [r, g, b] = cssToRGB(colorStr);
      let hidden: boolean;
      if (isHistogram) {
        hidden = histogram.slotInBin[i] < 0;
      } else {
        const colorOk =
          state.colorBins.length === 0 ||
          state.colorBins.includes(
            fluxColorBin(colorVal, clips.posMax, clips.negMax, effColorMode)
          );
        const sizeOk =
          state.sizeBins.length === 0 ||
          state.sizeBins.includes(sizeBin(p.sizeValue, sizeMax));
        hidden = !(colorOk && sizeOk);
      }
      colors[i] = [r, g, b, hidden ? 0 : 230];
    }
    return { targets, radii, colors };
  }, [
    points,
    parked,
    size.w,
    size.h,
    isMap,
    isHistogram,
    histogramPitch,
    totalStocksMax,
    sizeScale,
    colorLayerClips,
    netFluxClips,
    colorMode,
    sizeMax,
    histogram,
    state.colorBins,
    state.sizeBins,
  ]);

  const deckLayers = useMemo(() => {
    if (!mounted || !iconAtlas) return [];
    const { targets, radii, colors } = visuals;
    return [
      new IconLayer<HexFeature>({
        id: "markers",
        data: hexes,
        // Runtime accepts a <canvas> atlas; the TS type only lists string|Texture.
        iconAtlas: iconAtlas as unknown as string,
        iconMapping,
        getIcon: () => "hex",
        sizeUnits: "pixels",
        getPosition: (_d: HexFeature, info: { index: number }) =>
          (targets[info.index] ?? [0, 0]) as [number, number],
        getSize: (_d: HexFeature, info: { index: number }) =>
          (radii[info.index] ?? 1) * 2,
        getColor: (_d: HexFeature, info: { index: number }) =>
          (colors[info.index] ?? [255, 255, 255, 0]) as [
            number,
            number,
            number,
            number
          ],
        visible: !isDensity,
        pickable: !isDensity,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 150],
        transitions: {
          getPosition: { duration: 800, easing: easeOutCubic },
          getColor: { duration: 500, easing: easeOutCubic },
          getSize: { duration: 600, easing: easeOutCubic },
        },
        updateTriggers: {
          getPosition: targets,
          getSize: radii,
          getColor: colors,
        },
      }),
    ];
  }, [mounted, iconAtlas, iconMapping, visuals, hexes, isDensity]);

  const deckViews = useMemo(
    () => [new OrthographicView({ id: "ortho", flipY: true })],
    []
  );
  const deckViewState = { target: [size.w / 2, size.h / 2, 0], zoom: 0 };

  // deck.gl picking → reuse the existing tooltip + detail-box flow. Defined in
  // render so they capture fresh `points` / `buildHover`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDeckHover = (info: any) => {
    const idx = info?.index;
    if (idx != null && idx >= 0 && info.layer && visuals.colors[idx]?.[3] > 0) {
      const rect = containerRef.current?.getBoundingClientRect();
      const clientX = (rect?.left ?? 0) + (info.x ?? 0);
      const clientY = (rect?.top ?? 0) + (info.y ?? 0);
      tooltip.show(buildHover(points[idx]), { clientX, clientY } as MouseEvent);
    } else {
      tooltip.hide();
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDeckClick = (info: any) => {
    const idx = info?.index;
    if (idx != null && idx >= 0 && info.layer && visuals.colors[idx]?.[3] > 0) {
      setSelectedHex(points[idx].hex);
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ pointerEvents: active ? "auto" : "none" }}
      onMouseMove={onHistMouseMove}
      onMouseLeave={onHistMouseLeave}
    >
      {/* GPU marker layer (below the SVG chrome) */}
      <DeckGL
        style={{ position: "absolute", inset: 0 }}
        width={size.w}
        height={size.h}
        views={deckViews}
        viewState={deckViewState}
        controller={false}
        layers={deckLayers}
        onLoad={() => setDeckReady(true)}
        onHover={handleDeckHover}
        onClick={handleDeckClick}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getCursor={({ isHovering }: any) => (isHovering ? "pointer" : "default")}
      />
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{
          display: "block",
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        {/* Chart axis lines */}
        <g
          style={{
            opacity: showAxes ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <line
            x1={midX}
            x2={midX}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1}
          />
          {yIsSigned && (
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={midY}
              y2={midY}
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={1}
            />
          )}
        </g>

        {/* Histogram column highlight on hover */}
        {isHistogram && hoveredBin !== null && (
          <rect
            x={histStartX + hoveredBin * histBarSlot}
            y={PAD.top}
            width={histBarSlot}
            height={size.h - PAD.top - PAD.bottom}
            fill="rgba(255, 255, 255, 0.05)"
            pointerEvents="none"
          />
        )}

        {/* Histogram per-bar tick labels + axis title + count label */}
        <g
          style={{
            opacity: isHistogram ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          {histogram.binCenters.map((v, b) => {
            const x = histStartX + (b + 0.5) * histBarSlot;
            return (
              <text
                key={`tick-${b}`}
                x={x}
                y={histBaselineY + 18}
                fill="var(--color-text-soft)"
                fontSize="12"
                textAnchor="middle"
              >
                {formatHistTick(v)}
              </text>
            );
          })}
          <text
            x={histMidX}
            y={histBaselineY + 38}
            fill="var(--color-text)"
            fontSize="12"
            textAnchor="middle"
            style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            {histogramMetricLabel}
            {histogramMetricUnits ? ` (${histogramMetricUnits})` : ""}
          </text>

          {hoveredBin !== null &&
            histogram.counts[hoveredBin] > 0 &&
            (() => {
              const count = histogram.counts[hoveredBin];
              const maxBarTopY =
                histBaselineY -
                histogramLayout.maxRows * histogramLayout.pitch;
              const labelY = Math.max(PAD.top + 14, maxBarTopY - 6);
              const labelX = histStartX + (hoveredBin + 0.5) * histBarSlot;
              return (
                <text
                  x={labelX}
                  y={labelY}
                  fill="var(--color-text)"
                  fontSize="12"
                  fontWeight={600}
                  textAnchor="middle"
                  style={{ pointerEvents: "none" }}
                >
                  {count}
                </text>
              );
            })()}
        </g>

        {/* Density bins */}
        <g
          style={{
            opacity: isDensity ? 1 : 0,
            transition: "opacity 400ms ease",
            pointerEvents: isDensity ? "auto" : "none",
          }}
        >
          {densityBins.map((b, i) => {
            const t = b.length / densityMaxBin;
            const binPoints = b as unknown as Point[];
            let xSum = 0;
            let ySum = 0;
            for (const pt of binPoints) {
              xSum += pt.xValue;
              ySum += pt.yValue;
            }
            const xMean = xSum / binPoints.length;
            const yMean = ySum / binPoints.length;
            const tipData: PieceTooltip = {
              hexId: "Density bin",
              accent: "var(--color-teal)",
              rows: [
                {
                  label: stocksLayerLabel,
                  value: xMean,
                  units: stocksUnits,
                  color: "var(--color-teal)",
                },
                {
                  label: fluxLayer?.label ?? state.fluxesKey,
                  value: yMean,
                  units: fluxLayer?.units,
                  color: yMean >= 0 ? "var(--color-pink)" : "var(--color-teal)",
                  signed: yIsSigned,
                },
                {
                  label: "Data points",
                  valueText: String(binPoints.length),
                  color: "var(--color-text)",
                },
              ],
            };
            return (
              <path
                key={`bin-${i}`}
                d={densityHexPath}
                transform={`translate(${b.x},${b.y})`}
                fill="var(--color-teal)"
                fillOpacity={0.25 + t * 0.65}
                stroke="rgba(126, 62, 159, 0.6)"
                strokeWidth={0.5}
                onMouseEnter={(e) => tooltip.show(tipData, e)}
                onMouseMove={(e) => tooltip.show(tipData, e)}
                onMouseLeave={() => tooltip.hide()}
              />
            );
          })}
        </g>

        {/* Quadrant labels (chart only) */}
        <g
          style={{
            opacity: showAxes ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          {yIsSigned ? (
            <>
              <text x={PAD.left + 8} y={PAD.top + 18} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic">
                Low stocks
              </text>
              <text x={PAD.left + 8} y={PAD.top + 34} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic">
                Net source
              </text>
              <text x={PAD.left + innerW - 8} y={PAD.top + 18} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic" textAnchor="end">
                High stocks
              </text>
              <text x={PAD.left + innerW - 8} y={PAD.top + 34} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic" textAnchor="end">
                Net source
              </text>
              <text x={PAD.left + 8} y={PAD.top + innerH - 22} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic">
                Low stocks
              </text>
              <text x={PAD.left + 8} y={PAD.top + innerH - 6} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic">
                Net sink
              </text>
              <text x={PAD.left + innerW - 8} y={PAD.top + innerH - 22} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic" textAnchor="end">
                High stocks
              </text>
              <text x={PAD.left + innerW - 8} y={PAD.top + innerH - 6} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic" textAnchor="end">
                Net sink
              </text>
            </>
          ) : (
            <>
              <text x={PAD.left + 8} y={PAD.top + 18} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic">
                Low stocks
              </text>
              <text x={PAD.left + innerW - 8} y={PAD.top + 18} fill="var(--color-text-soft)" fontSize="12" fontStyle="italic" textAnchor="end">
                High stocks
              </text>
            </>
          )}
        </g>
      </svg>

      <Tooltip state={tooltip.state} />
      {selectedHex && (
        <HexDetailBox
          hex={selectedHex}
          manifest={data.manifest}
          globalMaxStock={stocksMax}
          globalAbsMaxFluxComponent={globalAbsMaxFluxComponent}
          globalAbsMaxNet={fluxAbsMax}
          onClose={() => setSelectedHex(null)}
        />
      )}
    </div>
  );
}

"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { hexbin as d3Hexbin } from "d3-hexbin";
import { scaleLinear, scaleSqrt } from "d3-scale";
import type { Dataset, HexFeature } from "@/lib/schema";
import type { AppState } from "@/lib/ui-state";
import {
  STOCKS_TOTAL_KEY,
  absMaxFluxAcrossAll,
  fluxRange,
  getStockValue,
  maxStockAcrossAll,
  stocksTotal,
} from "@/lib/data";
import { fluxColor } from "@/lib/color";
import { useTooltip, type PieceTooltip } from "@/lib/tooltip";
import { Tooltip } from "../Tooltip";
import { HexDetailBox } from "../HexDetailBox";

interface Point {
  hex: HexFeature;
  hex_id: string;
  x: number;
  y: number;
  totalStocks: number;
  netFlux: number;
}

export function ScatterView({
  data,
  state,
}: {
  data: Dataset;
  state: AppState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltip = useTooltip();
  const [selectedHex, setSelectedHex] = useState<HexFeature | null>(null);

  const stocksLayerLabel = useMemo(() => {
    if (state.stocksKey === STOCKS_TOTAL_KEY) return "Total stocks";
    return (
      data.manifest.stocks.find((l) => l.key === state.stocksKey)?.label ??
      state.stocksKey
    );
  }, [state.stocksKey, data.manifest.stocks]);

  const stocksUnits = useMemo(
    () => data.manifest.stocks[0]?.units ?? "",
    [data.manifest.stocks]
  );

  const fluxLayer = useMemo(
    () => data.manifest.fluxes.find((l) => l.key === state.fluxesKey),
    [state.fluxesKey, data.manifest.fluxes]
  );

  const points: Point[] = useMemo(() => {
    return data.hexes.map((h) => ({
      hex: h,
      hex_id: h.hex_id,
      x: getStockValue(h, state.stocksKey, data.manifest.stocks),
      y: h.fluxes[state.fluxesKey] ?? 0,
      totalStocks: stocksTotal(h, data.manifest.stocks),
      netFlux: h.fluxes["net_flux"] ?? 0,
    }));
  }, [
    data.hexes,
    data.manifest.stocks,
    state.stocksKey,
    state.fluxesKey,
  ]);

  const stats = useMemo(() => {
    if (points.length === 0)
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, xMedian: 0 };
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const p of points) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const xs = points.map((p) => p.x).sort((a, b) => a - b);
    const xMedian = xs[Math.floor(xs.length / 2)];
    return { xMin, xMax, yMin, yMax, xMedian };
  }, [points]);

  const yIsSigned = stats.yMin < 0;

  const fluxAbsMax = useMemo(
    () => fluxRange(data.hexes, "net_flux").absMax,
    [data.hexes]
  );
  const stocksMax = useMemo(
    () =>
      maxStockAcrossAll(
        data.hexes,
        data.manifest.stocks.map((l) => l.key)
      ),
    [data.hexes, data.manifest.stocks]
  );
  const totalStocksMax = useMemo(() => {
    let m = 0;
    for (const p of points) if (p.totalStocks > m) m = p.totalStocks;
    return m;
  }, [points]);

  // Detail-box global maxes (separate from the scatter scaling).
  const globalAbsMaxFluxComponent = useMemo(
    () =>
      absMaxFluxAcrossAll(
        data.hexes,
        data.manifest.fluxes
          .filter((l) => l.group !== "net")
          .map((l) => l.key)
      ),
    [data.hexes, data.manifest.fluxes]
  );

  // Helper that builds a hover tooltip for a single point.
  const tooltipShow = tooltip.show;
  const tooltipHide = tooltip.hide;
  const buildHoverTooltip = (p: Point): PieceTooltip => ({
    hexId: p.hex_id,
    accent:
      state.scatterMode === "scatter"
        ? p.netFlux > 0
          ? "var(--color-pink)"
          : "var(--color-teal)"
        : undefined,
    rows: [
      {
        label: stocksLayerLabel,
        value: p.x,
        units: stocksUnits,
        color: "var(--color-teal)",
      },
      {
        label: fluxLayer?.label ?? state.fluxesKey,
        value: p.y,
        units: fluxLayer?.units,
        color: p.y >= 0 ? "var(--color-pink)" : "var(--color-teal)",
        signed: yIsSigned,
      },
    ],
  });

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const draw = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

      const pad = { top: 40, right: 40, bottom: 40, left: 40 };
      const innerW = w - pad.left - pad.right;
      const innerH = h - pad.top - pad.bottom;

      const xScale = scaleLinear()
        .domain([stats.xMin, stats.xMax || 1])
        .range([pad.left, pad.left + innerW]);

      const yDomain = yIsSigned
        ? (() => {
            const m = Math.max(Math.abs(stats.yMin), stats.yMax) || 1;
            return [-m, m] as [number, number];
          })()
        : ([stats.yMin, stats.yMax || 1] as [number, number]);
      const yScale = scaleLinear()
        .domain(yDomain)
        .range([pad.top + innerH, pad.top]);

      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const ns = "http://www.w3.org/2000/svg";

      // Crosshair lines
      const midX = xScale(stats.xMedian);
      const vline = document.createElementNS(ns, "line");
      vline.setAttribute("x1", String(midX));
      vline.setAttribute("x2", String(midX));
      vline.setAttribute("y1", String(pad.top));
      vline.setAttribute("y2", String(pad.top + innerH));
      vline.setAttribute("stroke", "rgba(255,255,255,0.5)");
      vline.setAttribute("stroke-width", "1");
      svg.appendChild(vline);

      if (yIsSigned) {
        const midY = yScale(0);
        const hline = document.createElementNS(ns, "line");
        hline.setAttribute("x1", String(pad.left));
        hline.setAttribute("x2", String(pad.left + innerW));
        hline.setAttribute("y1", String(midY));
        hline.setAttribute("y2", String(midY));
        hline.setAttribute("stroke", "rgba(255,255,255,0.5)");
        hline.setAttribute("stroke-width", "1");
        svg.appendChild(hline);
      }

      if (state.scatterMode === "density") {
        const hb = d3Hexbin<Point>()
          .x((d) => xScale(d.x))
          .y((d) => yScale(d.y))
          .radius(7)
          .extent([
            [pad.left, pad.top],
            [pad.left + innerW, pad.top + innerH],
          ]);

        const bins = hb(points);
        const maxBin = bins.reduce((m, b) => Math.max(m, b.length), 1);
        const hexPath = hb.hexagon();

        for (const b of bins) {
          const path = document.createElementNS(ns, "path");
          path.setAttribute("d", hexPath);
          path.setAttribute("transform", `translate(${b.x},${b.y})`);
          const t = b.length / maxBin;
          path.setAttribute("fill", "var(--color-teal)");
          path.setAttribute("fill-opacity", String(0.25 + t * 0.65));
          path.setAttribute("stroke", "rgba(126, 62, 159, 0.6)");
          path.setAttribute("stroke-width", "0.5");
          path.style.cursor = "default";

          // Density hover: show mean x, mean y, and count of points in the bin.
          const binPoints = b as unknown as Point[];
          let xSum = 0;
          let ySum = 0;
          for (const pt of binPoints) {
            xSum += pt.x;
            ySum += pt.y;
          }
          const xMean = xSum / binPoints.length;
          const yMean = ySum / binPoints.length;
          const tooltipData: PieceTooltip = {
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

          path.addEventListener("mouseenter", (e) =>
            tooltipShow(tooltipData, e as MouseEvent)
          );
          path.addEventListener("mousemove", (e) =>
            tooltipShow(tooltipData, e as MouseEvent)
          );
          path.addEventListener("mouseleave", () => tooltipHide());

          svg.appendChild(path);
        }
      } else {
        const maxStocksForScale =
          state.stocksKey === STOCKS_TOTAL_KEY ? totalStocksMax : stocksMax;
        const sizeScale = scaleSqrt()
          .domain([0, maxStocksForScale || 1])
          .range([1.2, 5]);

        const hexUnit = d3Hexbin<Point>().radius(1).hexagon();

        const ordered = [...points].sort(
          (a, b) => b.totalStocks - a.totalStocks
        );

        // No outline by default; show a white outline only while hovered.
        const defaultStroke = "none";
        const hoverStroke = "#ffffff";

        for (const p of ordered) {
          const px = xScale(p.x);
          const py = yScale(p.y);
          const r = sizeScale(p.totalStocks);
          const color = fluxColor(p.netFlux, fluxAbsMax || 1);
          const path = document.createElementNS(ns, "path");
          path.setAttribute("d", hexUnit);
          path.setAttribute(
            "transform",
            `translate(${px},${py}) scale(${r})`
          );
          path.setAttribute("fill", color);
          path.setAttribute("fill-opacity", "0.9");
          path.setAttribute("stroke", defaultStroke);
          path.setAttribute("stroke-width", "0");
          path.setAttribute("vector-effect", "non-scaling-stroke");
          path.style.cursor = "pointer";

          path.addEventListener("mouseenter", (e) => {
            tooltipShow(buildHoverTooltip(p), e as MouseEvent);
            path.setAttribute("stroke", hoverStroke);
            path.setAttribute("stroke-width", "2");
          });
          path.addEventListener("mousemove", (e) =>
            tooltipShow(buildHoverTooltip(p), e as MouseEvent)
          );
          path.addEventListener("mouseleave", () => {
            tooltipHide();
            path.setAttribute("stroke", defaultStroke);
            path.setAttribute("stroke-width", "0");
          });
          path.addEventListener("click", () => setSelectedHex(p.hex));

          svg.appendChild(path);
        }
      }

      // Quadrant labels
      const labels: Array<{
        x: number;
        y: number;
        text: string;
        anchor?: string;
      }> = yIsSigned
        ? [
            { x: pad.left + 8, y: pad.top + 18, text: "Low stocks" },
            { x: pad.left + 8, y: pad.top + 34, text: "Net source" },
            {
              x: pad.left + innerW - 8,
              y: pad.top + 18,
              text: "High stocks",
              anchor: "end",
            },
            {
              x: pad.left + innerW - 8,
              y: pad.top + 34,
              text: "Net source",
              anchor: "end",
            },
            { x: pad.left + 8, y: pad.top + innerH - 22, text: "Low stocks" },
            { x: pad.left + 8, y: pad.top + innerH - 6, text: "Net sink" },
            {
              x: pad.left + innerW - 8,
              y: pad.top + innerH - 22,
              text: "High stocks",
              anchor: "end",
            },
            {
              x: pad.left + innerW - 8,
              y: pad.top + innerH - 6,
              text: "Net sink",
              anchor: "end",
            },
          ]
        : [
            { x: pad.left + 8, y: pad.top + 18, text: "Low stocks" },
            {
              x: pad.left + innerW - 8,
              y: pad.top + 18,
              text: "High stocks",
              anchor: "end",
            },
          ];

      for (const l of labels) {
        const t = document.createElementNS(ns, "text");
        t.setAttribute("x", String(l.x));
        t.setAttribute("y", String(l.y));
        t.setAttribute("fill", "var(--color-text-soft)");
        t.setAttribute("font-size", "12");
        t.setAttribute("font-style", "italic");
        if (l.anchor) t.setAttribute("text-anchor", l.anchor);
        t.textContent = l.text;
        svg.appendChild(t);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
    // buildHoverTooltip is intentionally NOT in the deps — it's recreated each
    // render and capturing it would cause the effect to redraw constantly.
    // The closure captures the current axis labels via points/state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    points,
    stats,
    yIsSigned,
    state.scatterMode,
    state.stocksKey,
    state.fluxesKey,
    fluxAbsMax,
    stocksMax,
    totalStocksMax,
    stocksLayerLabel,
    stocksUnits,
    fluxLayer,
  ]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg ref={svgRef} />
      <Tooltip state={tooltip.state} />
      {selectedHex && (
        <HexDetailBox
          hex={selectedHex}
          manifest={data.manifest}
          globalMaxStock={stocksMax}
          globalAbsMaxFluxComponent={globalAbsMaxFluxComponent}
          globalAbsMaxNet={fluxAbsMax}
          onClose={() => setSelectedHex(null)}
          onPieceHover={tooltip.show}
          onPieceLeave={tooltip.hide}
        />
      )}
    </div>
  );
}

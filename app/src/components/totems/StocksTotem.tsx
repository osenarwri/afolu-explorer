"use client";

import { useId } from "react";
import type { HexFeature, LayerDef } from "@/lib/schema";
import { roundedPolygonPath } from "@/lib/svg-paths";
import type { PieceTooltip } from "@/lib/tooltip";

// Stacked isometric cubes per pool. Each cube:
//   - rounded hex silhouette outlined in teal, filled with the page-background
//     purple so it opaquely hides the cube(s) behind it
//   - 3 internal lines forming the isometric "Y" inside, drawn in teal
// Cubes share their interface face (no gap), and rendering goes bottom→top so
// upper cubes occlude the back-top of lower cubes — a proper stacked look.

interface PieceSize {
  key: string;
  label: string;
  value: number;
  units: string;
  bodyHeight: number;
}

export function StocksTotem({
  hex,
  layers,
  globalMax,
  width = 80,
  minBodyHeight = 0,
  maxBodyHeight,
  topSkewRatio = 0.24,
  gapRatio = 0.18,
  strokeWidth = 2,
  cornerRadius,
  animated = true,
  onPieceHover,
  onPieceLeave,
}: {
  hex: HexFeature;
  layers: LayerDef[];
  globalMax: number;
  width?: number;
  minBodyHeight?: number;
  maxBodyHeight?: number;
  topSkewRatio?: number;
  gapRatio?: number;
  strokeWidth?: number;
  cornerRadius?: number;
  // When false, totem renders collapsed (scaleY 0) so the parent can animate it in
  animated?: boolean;
  onPieceHover?: (t: PieceTooltip, e: React.MouseEvent) => void;
  onPieceLeave?: () => void;
}) {
  const topSkew = width * topSkewRatio;
  const gap = width * gapRatio;
  // bodyHeight at max value ⇒ full cube silhouette ≈ width tall (close to a regular hex)
  const maxBody = maxBodyHeight ?? Math.max(0, width - 2 * topSkew);
  const radius = cornerRadius ?? Math.max(2, width * 0.06);
  const idBase = useId();

  const pieces: PieceSize[] = layers.map((l) => {
    const v = hex.stocks[l.key] ?? 0;
    const t = Math.max(0, Math.min(1, v / (globalMax || 1)));
    return {
      key: l.key,
      label: l.label,
      value: v,
      units: l.units,
      bodyHeight: minBodyHeight + t * (maxBody - minBodyHeight),
    };
  });

  // Partial-overlap stacking. Cube N+1's top peak sits inside cube N's bottom
  // triangle (so the cubes overlap in 2D), but with a small extra offset
  // `gap` so a visible sliver of cube N's bottom peak shows above cube N+1.
  // For two fully-stacked isometric cubes sharing their interface face the
  // increment would be `bodyHeight`; we use `bodyHeight + gap` so the back-top
  // of cube N+1 sits just below the bottom peak of cube N.
  let yCursor = 0;
  const positioned = pieces.map((piece) => {
    const yTop = yCursor;
    yCursor += piece.bodyHeight + gap;
    return { piece, yTop, bodyHeight: piece.bodyHeight };
  });
  // Last cube needs its own full extent (top skew + body + top skew) below
  // its top peak; the loop only advanced by bodyHeight+gap so we add the
  // remaining 2*topSkew and subtract the trailing gap.
  const totalHeight = yCursor - gap + 2 * topSkew;

  const pad = strokeWidth + radius;
  const viewW = width + pad * 2;
  const viewH = totalHeight + pad * 2;
  const stroke = "var(--color-teal)";
  const fill = "var(--color-purple)";

  // Geometry per cube
  const geometry = positioned.map((c) => {
    const cx = width / 2;
    const yTop = c.yTop;
    const bh = c.bodyHeight;
    const topPeak: [number, number] = [cx, yTop];
    const topLeft: [number, number] = [0, yTop + topSkew];
    const topRight: [number, number] = [width, yTop + topSkew];
    const topBottom: [number, number] = [cx, yTop + topSkew * 2];
    const frontLeftBot: [number, number] = [0, yTop + topSkew + bh];
    const frontRightBot: [number, number] = [width, yTop + topSkew + bh];
    const frontMid: [number, number] = [cx, yTop + topSkew * 2 + bh];

    const silhouette: Array<[number, number]> = [
      topPeak,
      topRight,
      frontRightBot,
      frontMid,
      frontLeftBot,
      topLeft,
    ];
    return {
      piece: c.piece,
      silhouettePath: roundedPolygonPath(silhouette, radius),
      topBottom,
      topLeft,
      topRight,
      frontMid,
    };
  });

  // With partial overlap, cube N's silhouette covers the back-top of cube
  // N+1. Render BOTTOM → TOP so each upper cube is drawn over the cubes
  // below it, producing the correct isometric stacking.
  const renderOrder = [...geometry].reverse();

  return (
    <svg
      width={viewW}
      height={viewH}
      viewBox={`${-pad} ${-pad} ${viewW} ${viewH}`}
      style={{
        display: "block",
        transformOrigin: "center bottom",
        transform: animated ? "scaleY(1)" : "scaleY(0)",
        transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <defs>
        {geometry.map((g, i) => (
          <clipPath key={g.piece.key} id={`${idBase}-clip-${i}`}>
            <path d={g.silhouettePath} />
          </clipPath>
        ))}
      </defs>

      {renderOrder.map((g) => {
        const i = geometry.indexOf(g);
        const tooltip: PieceTooltip = {
          hexId: hex.hex_id,
          label: g.piece.label,
          value: g.piece.value,
          units: g.piece.units,
          kind: "stock",
        };
        const handle = onPieceHover
          ? {
              onMouseEnter: (e: React.MouseEvent) => onPieceHover(tooltip, e),
              onMouseMove: (e: React.MouseEvent) => onPieceHover(tooltip, e),
              onMouseLeave: () => onPieceLeave?.(),
            }
          : {};
        return (
          <g key={g.piece.key} {...handle}>
            {/* Silhouette: purple fill (opaque, hides cubes behind), teal stroke */}
            <path
              d={g.silhouettePath}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
            {/* Internal Y lines, clipped to this cube's silhouette so the round
                corners crop them cleanly */}
            <g clipPath={`url(#${idBase}-clip-${i})`}>
              <line
                x1={g.topBottom[0]}
                y1={g.topBottom[1]}
                x2={g.topLeft[0]}
                y2={g.topLeft[1]}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
              <line
                x1={g.topBottom[0]}
                y1={g.topBottom[1]}
                x2={g.topRight[0]}
                y2={g.topRight[1]}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
              <line
                x1={g.topBottom[0]}
                y1={g.topBottom[1]}
                x2={g.frontMid[0]}
                y2={g.frontMid[1]}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

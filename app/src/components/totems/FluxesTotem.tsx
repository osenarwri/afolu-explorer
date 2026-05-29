"use client";

import { useId } from "react";
import type { HexFeature, LayerDef } from "@/lib/schema";
import { roundedPolygonPath } from "@/lib/svg-paths";
import type { PieceTooltip } from "@/lib/tooltip";

// Fluxes totem:
//   • First emission piece = "house" pointing up (rectangle of height
//     proportional to the value, capped by a fixed-height triangle).
//   • First removal piece = mirror house pointing down.
//   • Subsequent emission/removal pieces are chevron-bands ("arrows") that
//     fit on top of the previous piece's chevron edge.
//   • The two stacks are separated by a small gap centred on the zero line
//     (matching the stocks totem gap).
//   • Net flux is rendered as a coloured fill clipped to the union of pieces:
//       positive (source) → pink fill rising from the zero line into the
//                            emission pieces
//       negative (sink)  → teal fill descending from zero into removals
//     Fill extent scales with |net flux|.
//
// The totem reports its zero line (the centre between the two stacks) so the
// parent positions it via a negative top margin and emissions/removals grow
// outward from a Y that's identical across cards.

interface PieceSize {
  key: string;
  label: string;
  value: number;
  units: string;
  thickness: number; // visual height of the rectangular/band portion
}

// House pointing UP. Bottom edge at yBot, rect of height `rect` above that, then a peak.
function housePointsUp(
  yBot: number,
  rect: number,
  peak: number,
  W: number
): Array<[number, number]> {
  return [
    [0, yBot],
    [W, yBot],
    [W, yBot - rect],
    [W / 2, yBot - rect - peak],
    [0, yBot - rect],
  ];
}

function housePointsDown(
  yTop: number,
  rect: number,
  peak: number,
  W: number
): Array<[number, number]> {
  return [
    [0, yTop],
    [W, yTop],
    [W, yTop + rect],
    [W / 2, yTop + rect + peak],
    [0, yTop + rect],
  ];
}

// Chevron-band fitting ABOVE a previous chevron edge.
// (yShoulder, yPeak) describes the bottom chevron (= previous piece's top
// chevron). The band rises by `thickness` to a parallel chevron above.
function chevronBandUp(
  yShoulder: number,
  yPeak: number,
  thickness: number,
  W: number
): Array<[number, number]> {
  return [
    [0, yShoulder],
    [W / 2, yPeak],
    [W, yShoulder],
    [W, yShoulder - thickness],
    [W / 2, yPeak - thickness],
    [0, yShoulder - thickness],
  ];
}

function chevronBandDown(
  yShoulder: number,
  yPeak: number,
  thickness: number,
  W: number
): Array<[number, number]> {
  return [
    [0, yShoulder],
    [W / 2, yPeak],
    [W, yShoulder],
    [W, yShoulder + thickness],
    [W / 2, yPeak + thickness],
    [0, yShoulder + thickness],
  ];
}

export interface FluxesTotemProps {
  hex: HexFeature;
  layers: LayerDef[];
  globalAbsMax: number;
  globalAbsMaxNet: number;
  width?: number;
  peakRatio?: number;
  gapRatio?: number;
  // Gap between consecutive pieces within the emission / removal stacks
  // (fraction of width).
  pieceGapRatio?: number;
  minPieceThickness?: number;
  maxPieceThickness?: number;
  strokeWidth?: number;
  cornerRadius?: number;
  // When false, totem renders collapsed (scaleY 0) about the zero line
  animated?: boolean;
  // Anchor for the zero line.
  //   "top" (default): SVG renders with its zero line at the parent's top edge
  //     via a negative top margin. Emissions overflow upward into preceding space.
  //   "center": SVG is padded symmetrically so the zero line coincides with the
  //     SVG's geometric vertical center. No margin offset — use in a flex
  //     container with `align-items: center` to align zero to container middle.
  zeroAnchor?: "top" | "center";
  onPieceHover?: (t: PieceTooltip, e: React.MouseEvent) => void;
  onPieceLeave?: () => void;
}

export function FluxesTotem({
  hex,
  layers,
  globalAbsMax,
  globalAbsMaxNet,
  width = 80,
  peakRatio = 0.22,
  gapRatio = 0.18,
  pieceGapRatio = 0.08,
  minPieceThickness = 0,
  maxPieceThickness,
  strokeWidth = 2,
  cornerRadius,
  animated = true,
  zeroAnchor = "top",
  onPieceHover,
  onPieceLeave,
}: FluxesTotemProps) {
  const peak = width * peakRatio;
  const gap = width * gapRatio;
  const pieceGap = width * pieceGapRatio;
  const maxPiece = maxPieceThickness ?? width / 2 - 2 * strokeWidth;
  const radius = cornerRadius ?? Math.max(2, width * 0.06);
  const idBase = useId();

  const emissions = layers.filter((l) => l.group === "emissions");
  const removals = layers.filter((l) => l.group === "removals");
  const netLayer = layers.find((l) => l.group === "net");

  function thicknessFor(value: number) {
    const t = Math.max(0, Math.min(1, Math.abs(value) / (globalAbsMax || 1)));
    return minPieceThickness + t * (maxPiece - minPieceThickness);
  }

  const emissionPieces: PieceSize[] = emissions.map((l) => {
    const v = hex.fluxes[l.key] ?? 0;
    return {
      key: l.key,
      label: l.label,
      value: v,
      units: l.units,
      thickness: thicknessFor(v),
    };
  });

  const removalPieces: PieceSize[] = removals.map((l) => {
    const v = hex.fluxes[l.key] ?? 0;
    return {
      key: l.key,
      label: l.label,
      value: v,
      units: l.units,
      thickness: thicknessFor(v),
    };
  });

  // Zero is at local y = 0. Emissions stack upward (negative y), removals downward (positive y).
  // Gap surrounds the zero line.
  const yEmissionBot = -gap / 2;
  const yRemovalTop = gap / 2;

  // Build emission piece paths (top-to-bottom in code, but visually the first
  // piece is at the bottom of the emission stack).
  type Draw = { piece: PieceSize; d: string; points: Array<[number, number]> };
  const emissionDraws: Draw[] = [];
  {
    let yBot = yEmissionBot;
    emissionPieces.forEach((p, idx) => {
      if (idx > 0) yBot -= pieceGap; // visible gap before this piece
      let points: Array<[number, number]>;
      if (idx === 0) {
        points = housePointsUp(yBot, p.thickness, peak, width);
        yBot = yBot - p.thickness; // top of the rectangular base (= shoulder of house top chevron)
      } else {
        // band fits ABOVE the previous piece's top chevron (offset by the gap).
        points = chevronBandUp(yBot, yBot - peak, p.thickness, width);
        yBot = yBot - p.thickness;
      }
      emissionDraws.push({
        piece: p,
        d: roundedPolygonPath(points, radius),
        points,
      });
    });
  }

  const removalDraws: Draw[] = [];
  {
    let yTop = yRemovalTop;
    removalPieces.forEach((p, idx) => {
      if (idx > 0) yTop += pieceGap; // visible gap before this piece
      let points: Array<[number, number]>;
      if (idx === 0) {
        points = housePointsDown(yTop, p.thickness, peak, width);
        yTop = yTop + p.thickness;
      } else {
        points = chevronBandDown(yTop, yTop + peak, p.thickness, width);
        yTop = yTop + p.thickness;
      }
      removalDraws.push({
        piece: p,
        d: roundedPolygonPath(points, radius),
        points,
      });
    });
  }

  const netVal = netLayer ? hex.fluxes[netLayer.key] ?? 0 : 0;
  // Normalise net flux against the SAME scale as the emission/removal pieces
  // (gross flux components). That way the fill is visually proportional to
  // |net flux| in the same units as the pieces — small net fluxes stay much
  // smaller than the surrounding piece, never filling it completely.
  const netT = Math.max(0, Math.min(1, Math.abs(netVal) / (globalAbsMax || 1)));
  const fillRect = netT * maxPiece;
  const fillPathUp = roundedPolygonPath(
    housePointsUp(yEmissionBot, fillRect, peak, width),
    radius
  );
  const fillPathDown = roundedPolygonPath(
    housePointsDown(yRemovalTop, fillRect, peak, width),
    radius
  );

  // Compute totem vertical extent (for SVG sizing) — include inter-piece gaps.
  const emissionGaps = Math.max(0, emissionPieces.length - 1) * pieceGap;
  const removalGaps = Math.max(0, removalPieces.length - 1) * pieceGap;
  const yEmissionTop =
    -gap / 2 -
    emissionPieces.reduce((s, p) => s + p.thickness, 0) -
    emissionGaps -
    peak;
  const yRemovalBot =
    gap / 2 +
    removalPieces.reduce((s, p) => s + p.thickness, 0) +
    removalGaps +
    peak;

  const yZero = 0;
  const pad = strokeWidth + radius;
  const viewW = width + pad * 2;

  // Determine the viewBox vertical range based on zeroAnchor mode.
  let viewMinY: number;
  let viewH: number;
  if (zeroAnchor === "center") {
    const aboveZero = -yEmissionTop; // positive distance from zero up to top of content
    const belowZero = yRemovalBot; // positive distance from zero down to bottom
    const half = Math.max(aboveZero, belowZero);
    viewMinY = -half - pad;
    viewH = 2 * half + pad * 2;
  } else {
    viewMinY = yEmissionTop - pad;
    const viewMaxY = yRemovalBot + pad;
    viewH = viewMaxY - viewMinY;
  }

  const strokeRemoval = "var(--color-teal)";
  const strokeEmission = "var(--color-pink)";
  const emissionsClipId = `${idBase}-clip-emissions`;
  const removalsClipId = `${idBase}-clip-removals`;

  // Zero line in pixel coordinates within the SVG element.
  const zeroLinePx = -viewMinY;

  return (
    <svg
      width={viewW}
      height={viewH}
      viewBox={`${-pad} ${viewMinY} ${viewW} ${viewH}`}
      style={{
        display: "block",
        // In "top" mode, shift the SVG upward so its zero line aligns with the
        // parent's top edge. In "center" mode the viewBox is already padded
        // symmetrically so no offset is needed.
        marginTop:
          zeroAnchor === "top" ? `-${-yEmissionTop + pad}px` : undefined,
        overflow: "visible",
        transformOrigin: `center ${zeroLinePx}px`,
        transform: animated ? "scaleY(1)" : "scaleY(0)",
        transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <defs>
        <clipPath id={emissionsClipId}>
          {emissionDraws.map(({ d, piece }) => (
            <path key={piece.key} d={d} />
          ))}
        </clipPath>
        <clipPath id={removalsClipId}>
          {removalDraws.map(({ d, piece }) => (
            <path key={piece.key} d={d} />
          ))}
        </clipPath>
      </defs>

      {/* Net flux fill — house-shaped (same chevron-top as the pieces), drawn
          underneath the outlines and clipped to the union of relevant pieces */}
      {netLayer && netT > 0 && netVal > 0 && (() => {
        const tooltip: PieceTooltip = {
          hexId: hex.hex_id,
          label: netLayer.label,
          value: netVal,
          units: netLayer.units,
          kind: "flux",
          accent: "var(--color-pink)",
        };
        return (
          <path
            d={fillPathUp}
            fill="var(--color-pink)"
            clipPath={`url(#${emissionsClipId})`}
            onMouseEnter={(e) => onPieceHover?.(tooltip, e)}
            onMouseMove={(e) => onPieceHover?.(tooltip, e)}
            onMouseLeave={() => onPieceLeave?.()}
          />
        );
      })()}
      {netLayer && netT > 0 && netVal < 0 && (() => {
        const tooltip: PieceTooltip = {
          hexId: hex.hex_id,
          label: netLayer.label,
          value: netVal,
          units: netLayer.units,
          kind: "flux",
          accent: "var(--color-teal)",
        };
        return (
          <path
            d={fillPathDown}
            fill="var(--color-teal)"
            clipPath={`url(#${removalsClipId})`}
            onMouseEnter={(e) => onPieceHover?.(tooltip, e)}
            onMouseMove={(e) => onPieceHover?.(tooltip, e)}
            onMouseLeave={() => onPieceLeave?.()}
          />
        );
      })()}

      {/* Emission piece outlines (pink) */}
      {emissionDraws.map(({ piece, d }) => {
        const tooltip: PieceTooltip = {
          hexId: hex.hex_id,
          label: piece.label,
          value: piece.value,
          units: piece.units,
          kind: "flux",
          accent: "var(--color-pink)",
        };
        return (
          <path
            key={piece.key}
            d={d}
            fill="transparent"
            stroke={strokeEmission}
            strokeWidth={strokeWidth}
            onMouseEnter={(e) => onPieceHover?.(tooltip, e)}
            onMouseMove={(e) => onPieceHover?.(tooltip, e)}
            onMouseLeave={() => onPieceLeave?.()}
          />
        );
      })}

      {/* Removal piece outlines (teal) */}
      {removalDraws.map(({ piece, d }) => {
        const tooltip: PieceTooltip = {
          hexId: hex.hex_id,
          label: piece.label,
          value: piece.value,
          units: piece.units,
          kind: "flux",
        };
        return (
          <path
            key={piece.key}
            d={d}
            fill="transparent"
            stroke={strokeRemoval}
            strokeWidth={strokeWidth}
            onMouseEnter={(e) => onPieceHover?.(tooltip, e)}
            onMouseMove={(e) => onPieceHover?.(tooltip, e)}
            onMouseLeave={() => onPieceLeave?.()}
          />
        );
      })}
    </svg>
  );
}

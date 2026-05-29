"use client";

import { roundedPolygonPath } from "@/lib/svg-paths";

// Small inline glyphs that share the visual language of the totems in the
// Cards view: a rounded isometric cube for stocks, and an upward/downward
// "house" for fluxes (source/sink).

export function StockCubeIcon({
  width = 28,
  stroke = "var(--color-teal)",
  fill = "var(--color-purple)",
  strokeWidth = 1.5,
  // 0..1; scales body height so the cube reads proportional to its value.
  // SVG dimensions stay at the max so cells don't reflow.
  valueRatio = 1,
}: {
  width?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  valueRatio?: number;
}) {
  const topSkewRatio = 0.14;
  const topSkew = width * topSkewRatio;
  const fullBody = width - 2 * topSkew;
  const t = Math.max(0, Math.min(1, valueRatio));
  // Minimum body so even a tiny value renders as something readable
  const minBody = Math.max(2, fullBody * 0.08);
  const bodyHeight = minBody + t * (fullBody - minBody);
  const radius = Math.max(1.5, width * 0.08);
  const pad = strokeWidth + radius;

  const cx = width / 2;
  // Anchor the cube to the bottom of the SVG canvas so smaller cubes "sit"
  // at the baseline; row contents align consistently.
  const yTop = fullBody - bodyHeight;
  const topPeak: [number, number] = [cx, yTop];
  const topLeft: [number, number] = [0, yTop + topSkew];
  const topRight: [number, number] = [width, yTop + topSkew];
  const topBottom: [number, number] = [cx, yTop + topSkew * 2];
  const frontLeftBot: [number, number] = [0, yTop + topSkew + bodyHeight];
  const frontRightBot: [number, number] = [width, yTop + topSkew + bodyHeight];
  const frontMid: [number, number] = [cx, yTop + topSkew * 2 + bodyHeight];

  const silhouette: Array<[number, number]> = [
    topPeak,
    topRight,
    frontRightBot,
    frontMid,
    frontLeftBot,
    topLeft,
  ];
  const path = roundedPolygonPath(silhouette, radius);

  // Canvas spans the FULL cube height (independent of valueRatio) so the cube
  // is bottom-anchored within a fixed box — small values render as short cubes
  // sitting at the baseline instead of being clipped out of a shrunken viewBox.
  const totalH = topSkew * 2 + fullBody;
  const viewW = width + pad * 2;
  const viewH = totalH + pad * 2;

  return (
    <svg
      width={viewW}
      height={viewH}
      viewBox={`${-pad} ${-pad} ${viewW} ${viewH}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <line
        x1={topBottom[0]}
        y1={topBottom[1]}
        x2={topLeft[0]}
        y2={topLeft[1]}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <line
        x1={topBottom[0]}
        y1={topBottom[1]}
        x2={topRight[0]}
        y2={topRight[1]}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <line
        x1={topBottom[0]}
        y1={topBottom[1]}
        x2={frontMid[0]}
        y2={frontMid[1]}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FluxHouseIcon({
  width = 28,
  direction,
  strokeWidth = 1.5,
  // 0..1; scales the rectangular base proportionally to the value.
  valueRatio = 1,
  // When true, fills the house with the directional color; otherwise outline only.
  filled = false,
}: {
  width?: number;
  direction: "up" | "down";
  strokeWidth?: number;
  valueRatio?: number;
  filled?: boolean;
}) {
  const peak = width * 0.22;
  const fullRect = width * 0.42;
  const t = Math.max(0, Math.min(1, valueRatio));
  const minRect = Math.max(1.5, fullRect * 0.08);
  const rect = minRect + t * (fullRect - minRect);
  const radius = Math.max(1.5, width * 0.08);
  const pad = strokeWidth + radius;
  const color =
    direction === "up" ? "var(--color-pink)" : "var(--color-teal)";

  // Use the FULL extent for the SVG canvas so row heights don't reflow when
  // the rect shrinks. Position the house at the appropriate baseline so it
  // grows away from the row's edge as the value increases.
  const fullH = fullRect + peak;
  let points: Array<[number, number]>;
  if (direction === "up") {
    // Anchor the bottom edge at y = fullH so smaller houses still sit on the
    // baseline. Build vertices bottom-up from y = fullH.
    const yBot = fullH;
    points = [
      [0, yBot],
      [width, yBot],
      [width, yBot - rect],
      [width / 2, yBot - rect - peak],
      [0, yBot - rect],
    ];
  } else {
    // Anchor the top edge at y = 0; house grows downward.
    const yTop = 0;
    points = [
      [0, yTop],
      [width, yTop],
      [width, yTop + rect],
      [width / 2, yTop + rect + peak],
      [0, yTop + rect],
    ];
  }

  const path = roundedPolygonPath(points, radius);
  const viewW = width + pad * 2;
  const viewH = fullH + pad * 2;

  return (
    <svg
      width={viewW}
      height={viewH}
      viewBox={`${-pad} ${-pad} ${viewW} ${viewH}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <path
        d={path}
        fill={filled ? color : "transparent"}
        fillOpacity={filled ? 0.85 : 0}
        stroke={color}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

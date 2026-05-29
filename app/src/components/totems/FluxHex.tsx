"use client";

// A horizontal hexagon glyph. Two orientations:
// - 'up' (emissions): wide hex pointing up like a chevron
// - 'down' (removals): wide hex pointing down
// Width fixed, height scales with value.

export function FluxHex({
  width = 80,
  bodyHeight = 24,
  orientation = "up",
  fill = "transparent",
  fillOpacity = 0,
  stroke = "var(--color-teal)",
}: {
  width?: number;
  bodyHeight?: number;
  orientation?: "up" | "down";
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
}) {
  const w = width;
  const peak = w * 0.18;
  const h = bodyHeight + peak * 2;

  // Hexagon points: top peak, top-right, bottom-right, bottom peak, bottom-left, top-left
  // For 'up' the visual emphasis is on top peak; for 'down' the bottom peak.
  const cx = w / 2;
  const sideTop = peak;
  const sideBot = peak + bodyHeight;

  const points = [
    [cx, 0], // top peak
    [w, sideTop],
    [w, sideBot],
    [cx, h], // bottom peak
    [0, sideBot],
    [0, sideTop],
  ];

  const pts = points.map((p) => p.join(",")).join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        display: "block",
        transform: orientation === "down" ? "scaleY(-1)" : undefined,
      }}
    >
      <polygon
        points={pts}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

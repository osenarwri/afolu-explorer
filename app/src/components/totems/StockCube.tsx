"use client";

// Isometric cube drawn in SVG. Width is fixed; height scales with the value.
// Outline-only (when filled=false) matches the empty-slot style from the mockup;
// filled with teal for the active/visible portion.

export function StockCube({
  width = 60,
  height = 60,
  fillOpacity = 0,
  stroke = "var(--color-teal)",
}: {
  width?: number;
  height?: number;
  fillOpacity?: number;
  stroke?: string;
}) {
  // Isometric projection: top face = parallelogram, sides as parallelograms
  const w = width;
  const h = height;
  const yOff = w * 0.28; // top-face skew height ~28% of width
  const sideW = w / 2;

  // Top face points
  const topLeft = [0, yOff];
  const topTop = [sideW, 0];
  const topRight = [w, yOff];
  const topBot = [sideW, yOff * 2];

  // Front-left face
  const flTopL = topLeft;
  const flTopR = topBot;
  const flBotL = [0, yOff + h];
  const flBotR = [sideW, yOff * 2 + h];

  // Front-right face
  const frTopL = topBot;
  const frTopR = topRight;
  const frBotL = [sideW, yOff * 2 + h];
  const frBotR = [w, yOff + h];

  const pts = (arr: number[][]) => arr.map((p) => p.join(",")).join(" ");

  return (
    <svg
      width={w}
      height={h + yOff * 2}
      viewBox={`0 0 ${w} ${h + yOff * 2}`}
      style={{ display: "block" }}
    >
      <polygon
        points={pts([topLeft, topTop, topRight, topBot])}
        fill="var(--color-teal)"
        fillOpacity={fillOpacity * 0.85}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <polygon
        points={pts([flTopL, flTopR, flBotR, flBotL])}
        fill="var(--color-teal)"
        fillOpacity={fillOpacity * 0.7}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <polygon
        points={pts([frTopL, frTopR, frBotR, frBotL])}
        fill="var(--color-teal)"
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

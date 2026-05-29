// Color helpers matching the visual system:
// Stocks: sequential teal-on-purple by luminance/opacity.
// Fluxes: diverging teal (sink, negative) ↔ pink (source, positive), zero-centered.

import { interpolateRgb } from "d3-interpolate";

export const COLORS = {
  purple: "#7e3e9f",
  purpleDeep: "#6a3387",
  teal: "#3fd9b4",
  pink: "#ef6aa3",
  white: "#ffffff",
  // Centre of the diverging flux ramp — sits between pink and teal.
  divergentCenter: "#ffffff",
} as const;

const purpleRgb = COLORS.purple;
const tealRgb = COLORS.teal;
const pinkRgb = COLORS.pink;
const divergentCenterRgb = COLORS.divergentCenter;

// Sequential interpolators (using d3-interpolate for proper RGB mixing)
const stockInterp = interpolateRgb(purpleRgb, tealRgb);
// Diverging flux scale through the configured centre colour.
const sinkInterp = interpolateRgb(divergentCenterRgb, tealRgb);
const sourceInterp = interpolateRgb(divergentCenterRgb, pinkRgb);

export function stockColor(value: number, max: number): string {
  if (max <= 0) return purpleRgb;
  const t = Math.max(0, Math.min(1, value / max));
  // Mix purple → teal with a slight floor so smallest values still register
  return stockInterp(0.15 + 0.85 * t);
}

export function fluxColor(value: number, absMax: number): string {
  if (absMax <= 0) return divergentCenterRgb;
  const t = Math.max(-1, Math.min(1, value / absMax));
  // Symmetric diverging scale: 0 → divergentCenter, +1 → pink (source), −1 → teal (sink)
  if (t > 0) return sourceInterp(t);
  if (t < 0) return sinkInterp(-t);
  return divergentCenterRgb;
}

// Diverging scale with asymmetric clip points: full pink is reached at
// `posMax` (e.g. p90 of positive values) and full teal at `negMax` (a
// negative value, e.g. p10 of negative values). Values beyond the clips are
// clamped, so a few outliers don't wash out the rest of the ramp.
export function fluxColorClipped(
  value: number,
  posMax: number,
  negMax: number
): string {
  if (value > 0) {
    const t = Math.min(1, value / (posMax || 1));
    return sourceInterp(t);
  }
  if (value < 0) {
    const t = Math.min(1, value / (negMax || -1)); // both negative → 0..1
    return sinkInterp(t);
  }
  return divergentCenterRgb;
}

// One-sided ramp from the divergent centre toward a single end colour.
// Used when a layer is conceptually one-signed: emissions always read as a
// SOURCE (white→pink) and removals always as a SINK (white→teal), even though
// both are stored as positive magnitudes. `max` is the clip point (full colour).
export function fluxColorSided(
  value: number,
  max: number,
  side: "source" | "sink"
): string {
  const t = Math.max(0, Math.min(1, Math.abs(value) / (max || 1)));
  return side === "source" ? sourceInterp(t) : sinkInterp(t);
}

export type ColorRampMode = "diverging" | "source" | "sink";

// Number of buckets the color/size legends split their range into.
export const NUM_LEGEND_BINS = 7;

// Bucket a flux value into one of `n` legend swatches (indices 0..n-1).
// Diverging: 0 = strong sink … middle = ~zero (white) … n-1 = strong source.
// One-sided (source/sink): 0 = near zero … n-1 = full colour.
export function fluxColorBin(
  value: number,
  posMax: number,
  negMax: number,
  mode: ColorRampMode,
  n: number = NUM_LEGEND_BINS
): number {
  if (mode === "diverging") {
    const denom = value >= 0 ? posMax || 1 : Math.abs(negMax || 1);
    const t = Math.max(-1, Math.min(1, value / denom)); // -1..1
    return Math.max(0, Math.min(n - 1, Math.floor(((t + 1) / 2) * n)));
  }
  const t = Math.max(0, Math.min(1, Math.abs(value) / (posMax || 1)));
  return Math.max(0, Math.min(n - 1, Math.floor(t * n)));
}

// Value at a normalised position `t` on the (possibly asymmetric) ramp.
function fluxValueAtT(t: number, posMax: number, negMax: number): number {
  return t >= 0 ? t * (posMax || 1) : t * Math.abs(negMax || 1);
}

// [lo, hi] value range covered by bucket `i` — used for the legend hover label.
export function fluxBinRange(
  i: number,
  posMax: number,
  negMax: number,
  mode: ColorRampMode,
  n: number = NUM_LEGEND_BINS
): [number, number] {
  if (mode === "diverging") {
    const tLo = -1 + (i * 2) / n;
    const tHi = -1 + ((i + 1) * 2) / n;
    return [
      fluxValueAtT(tLo, posMax, negMax),
      fluxValueAtT(tHi, posMax, negMax),
    ];
  }
  return [(i / n) * (posMax || 1), ((i + 1) / n) * (posMax || 1)];
}

// Swatch colour for bucket `i` (sampled at the bucket midpoint).
export function fluxBinColor(
  i: number,
  posMax: number,
  negMax: number,
  mode: ColorRampMode,
  n: number = NUM_LEGEND_BINS
): string {
  if (mode === "diverging") {
    const t = -1 + ((i + 0.5) * 2) / n;
    return fluxColorClipped(fluxValueAtT(t, posMax, negMax), posMax, negMax);
  }
  const t = (i + 0.5) / n;
  return fluxColorSided(t * (posMax || 1), posMax || 1, mode);
}

export function hexToRgbArray(hex: string): [number, number, number, number] {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return [r, g, b, 255];
}

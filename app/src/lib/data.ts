"use client";

import { useEffect, useState } from "react";
import type { Dataset, HexFeature, LayerDef } from "./schema";

export type DataMode = "real" | "mock";

export function useDataset(mode: DataMode = "real") {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const file = mode === "mock" ? "/data/hexes_mock.json" : "/data/hexes.json";
    fetch(file)
      .then((r) => r.json())
      .then((d: Dataset) => {
        // Keep the previous dataset visible until the new one arrives (no
        // loading flash when toggling); only swap on success.
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  return { data, error };
}

export function hexValue(hex: HexFeature, kind: "stock" | "flux", key: string) {
  return kind === "stock" ? hex.stocks[key] ?? 0 : hex.fluxes[key] ?? 0;
}

// Synthetic key for "sum of all stocks". Lives in the dropdown alongside the
// real layer keys so the user can pick "Total stocks" as a single metric.
export const STOCKS_TOTAL_KEY = "_total_stocks";

// Sorted list of unique country names present in the data.
export function uniqueCountries(hexes: HexFeature[]): string[] {
  const set = new Set<string>();
  for (const h of hexes) if (h.country && h.country !== "—") set.add(h.country);
  return [...set].sort();
}

// Filter constant for "no country selected".
export const FILTER_ALL = "all";

export function applyCountryFilter(
  hexes: HexFeature[],
  filter: string
): HexFeature[] {
  if (!filter || filter === FILTER_ALL) return hexes;
  return hexes.filter((h) => h.country === filter);
}

// Aggregate hexes into one feature per group (by "country" or "admin1"),
// summing each stock + flux layer. Returns HexFeature-compatible objects whose
// hex_id is the group name, so Cards / Table can render with the same machinery.
export function aggregateBy(
  hexes: HexFeature[],
  attr: "country" | "admin1",
  stockLayers: LayerDef[],
  fluxLayers: LayerDef[]
): HexFeature[] {
  const groups = new Map<
    string,
    {
      count: number;
      country?: string;
      stocks: Record<string, number>;
      fluxes: Record<string, number>;
    }
  >();
  for (const h of hexes) {
    const k = (attr === "admin1" ? h.admin1 : h.country) ?? "—";
    let g = groups.get(k);
    if (!g) {
      g = { count: 0, country: h.country, stocks: {}, fluxes: {} };
      groups.set(k, g);
    }
    g.count += 1;
    for (const l of stockLayers)
      g.stocks[l.key] = (g.stocks[l.key] ?? 0) + (h.stocks[l.key] ?? 0);
    for (const l of fluxLayers)
      g.fluxes[l.key] = (g.fluxes[l.key] ?? 0) + (h.fluxes[l.key] ?? 0);
  }
  return [...groups.entries()].map(([name, g]) => ({
    hex_id: name,
    country: attr === "admin1" ? g.country : name,
    admin1: attr === "admin1" ? name : undefined,
    lon: 0,
    lat: 0,
    stocks: g.stocks,
    fluxes: g.fluxes,
  }));
}

// Bucket a size (stock) value into one of `n` legend swatches (0..n-1),
// linearly across [0, max]. Mirrors the color binning for the size legend.
export function sizeBin(value: number, max: number, n: number = 7): number {
  const t = Math.max(0, Math.min(1, value / (max || 1)));
  return Math.max(0, Math.min(n - 1, Math.floor(t * n)));
}

export function sizeBinRange(
  i: number,
  max: number,
  n: number = 7
): [number, number] {
  return [(i / n) * max, ((i + 1) / n) * max];
}

export function getStockValue(
  hex: HexFeature,
  key: string,
  layers: LayerDef[]
) {
  if (key === STOCKS_TOTAL_KEY) return stocksTotal(hex, layers);
  return hex.stocks[key] ?? 0;
}

export function stocksTotal(hex: HexFeature, stockLayers: LayerDef[]) {
  // Use the "primary" pool (first non-soil aggregate) as totem total; sum if multiple.
  // For now: prefer carbon_density_non_soil if present, else sum all pool values.
  const primary = stockLayers.find((l) => l.key === "carbon_density_non_soil");
  if (primary && hex.stocks[primary.key] != null) return hex.stocks[primary.key];
  return stockLayers.reduce((s, l) => s + (hex.stocks[l.key] ?? 0), 0);
}

export function fluxTotal(hex: HexFeature, fluxLayers: LayerDef[]) {
  const net = fluxLayers.find((l) => l.key === "net_flux");
  if (net && hex.fluxes[net.key] != null) return hex.fluxes[net.key];
  // Fallback: emissions - removals
  const em = hex.fluxes["emissions_total"] ?? 0;
  const re = hex.fluxes["removals_total"] ?? 0;
  return em - re;
}

export function maxStock(hexes: HexFeature[], key: string) {
  let max = 0;
  for (const h of hexes) {
    const v = h.stocks[key] ?? 0;
    if (v > max) max = v;
  }
  return max;
}

export function fluxRange(hexes: HexFeature[], key: string) {
  let min = 0;
  let max = 0;
  for (const h of hexes) {
    const v = h.fluxes[key] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, absMax: Math.max(Math.abs(min), Math.abs(max)) };
}

// Global max across ALL stock pools and ALL hexes — single scalar used to
// normalise piece heights so different pools read at visually different sizes
// (a small pool stays small, a large pool stays large).
export function maxStockAcrossAll(hexes: HexFeature[], keys: string[]) {
  let max = 0;
  for (const h of hexes) {
    for (const k of keys) {
      const v = h.stocks[k] ?? 0;
      if (v > max) max = v;
    }
  }
  return max;
}

// Global absolute max across ALL flux components (emissions/removals only,
// excluding net flux which has its own diverging scale) and ALL hexes.
export function absMaxFluxAcrossAll(hexes: HexFeature[], keys: string[]) {
  let max = 0;
  for (const h of hexes) {
    for (const k of keys) {
      const v = Math.abs(h.fluxes[k] ?? 0);
      if (v > max) max = v;
    }
  }
  return max;
}

function quantile(sortedAsc: number[], q: number) {
  if (sortedAsc.length === 0) return 0;
  const idx = q * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (idx - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}

// Clip points for the diverging color scale of a flux layer:
//   posMax = p90 of positive values (full pink at/above this)
//   negMax = p10 of negative values (full teal at/below this; negative number)
export function colorClips(hexes: HexFeature[], key: string) {
  const pos: number[] = [];
  const neg: number[] = [];
  for (const h of hexes) {
    const v = h.fluxes[key] ?? 0;
    if (v > 0) pos.push(v);
    else if (v < 0) neg.push(v);
  }
  pos.sort((a, b) => a - b);
  neg.sort((a, b) => a - b);
  return {
    posMax: pos.length ? quantile(pos, 0.9) : 1,
    negMax: neg.length ? quantile(neg, 0.1) : -1,
  };
}

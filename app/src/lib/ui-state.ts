"use client";

import { useCallback, useState } from "react";
import { STOCKS_TOTAL_KEY, type DataMode } from "./data";

export type ViewKind = "map" | "scatter" | "histogram" | "table" | "cards";

export type SortKind = "stocks_total" | "fluxes_total" | "fluxes_net";

export type ScatterMode = "density" | "scatter";

export interface AppState {
  view: ViewKind;
  setView: (v: ViewKind) => void;
  stocksKey: string;
  setStocksKey: (k: string) => void;
  fluxesKey: string;
  setFluxesKey: (k: string) => void;
  sort: SortKind;
  setSort: (s: SortKind) => void;
  filter: string;
  setFilter: (f: string) => void;
  year: string;
  setYear: (y: string) => void;
  scatterMode: ScatterMode;
  setScatterMode: (m: ScatterMode) => void;
  // Metric used as the histogram's x-axis. Defaults to "net_flux".
  histogramMetricKey: string;
  setHistogramMetricKey: (k: string) => void;
  // Real vs. mock dataset.
  dataMode: DataMode;
  setDataMode: (m: DataMode) => void;
  // Selected legend buckets (indices 0..n-1). Empty = show all. When non-empty,
  // marker views only show markers whose color / size value falls in a selected
  // bucket. Cleared whenever the view or the relevant layer changes.
  colorBins: number[];
  toggleColorBin: (i: number) => void;
  sizeBins: number[];
  toggleSizeBin: (i: number) => void;
}

export function useAppState(): AppState {
  const [view, setView] = useState<ViewKind>("map");
  const [stocksKey, setStocksKeyRaw] = useState<string>(STOCKS_TOTAL_KEY);
  const [fluxesKey, setFluxesKeyRaw] = useState<string>("net_flux");
  const [sort, setSort] = useState<SortKind>("stocks_total");
  const [filter, setFilter] = useState<string>("all");
  const [year, setYear] = useState<string>("2020");
  const [scatterMode, setScatterMode] = useState<ScatterMode>("scatter");
  const [histogramMetricKey, setHistogramMetricKey] =
    useState<string>("net_flux");
  const [dataMode, setDataModeRaw] = useState<DataMode>("real");
  const [colorBins, setColorBins] = useState<number[]>([]);
  const [sizeBins, setSizeBins] = useState<number[]>([]);

  // A legend selection persists across the marker views (map/scatter/histogram)
  // — only the bound layer changing should reset it.
  const setFluxesKey = useCallback((k: string) => {
    setFluxesKeyRaw(k);
    setColorBins([]);
  }, []);
  const setStocksKey = useCallback((k: string) => {
    setStocksKeyRaw(k);
    setSizeBins([]);
  }, []);
  const toggleColorBin = useCallback((i: number) => {
    setColorBins((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  }, []);
  const toggleSizeBin = useCallback((i: number) => {
    setSizeBins((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  }, []);

  // Switching datasets changes the available layers; reset the metric
  // selections to keys present in BOTH datasets so nothing dangles.
  const setDataMode = useCallback((m: DataMode) => {
    setDataModeRaw(m);
    setStocksKeyRaw(STOCKS_TOTAL_KEY);
    setFluxesKeyRaw("net_flux");
    setHistogramMetricKey("net_flux");
    setColorBins([]);
    setSizeBins([]);
  }, []);

  return {
    view,
    setView,
    stocksKey,
    setStocksKey,
    fluxesKey,
    setFluxesKey,
    sort,
    setSort,
    filter,
    setFilter,
    year,
    setYear,
    scatterMode,
    setScatterMode,
    histogramMetricKey,
    setHistogramMetricKey,
    dataMode,
    setDataMode,
    colorBins,
    toggleColorBin,
    sizeBins,
    toggleSizeBin,
  };
}

"use client";

import { useCallback, useState } from "react";

export interface TooltipRow {
  label: string;
  // Either a numeric `value` (auto-formatted) or a pre-formatted `valueText`.
  value?: number;
  valueText?: string;
  units?: string;
  color?: string;
  signed?: boolean;
}

export interface PieceTooltip {
  hexId: string;
  accent?: string;
  // Categorical attributes (country, admin1, …) shown under the name.
  categoricals?: { label: string; value: string }[];
  // EITHER use the row-based generic layout via `rows`,
  // OR the cards-style "piece + context" layout via label/value + extras.
  rows?: TooltipRow[];
  // Cards-style fields (used when `rows` is not provided)
  label?: string;
  value?: number;
  units?: string;
  kind?: "stock" | "flux";
  totalStocks?: number;
  totalStocksUnits?: string;
  netFlux?: number;
  netFluxUnits?: string;
}

export interface TooltipState {
  data: PieceTooltip | null;
  x: number;
  y: number;
}

export function useTooltip() {
  const [state, setState] = useState<TooltipState>({ data: null, x: 0, y: 0 });

  const show = useCallback((data: PieceTooltip, e: React.MouseEvent | MouseEvent) => {
    setState({ data, x: e.clientX, y: e.clientY });
  }, []);
  const hide = useCallback(() => {
    setState((s) => ({ ...s, data: null }));
  }, []);

  return { state, show, hide };
}

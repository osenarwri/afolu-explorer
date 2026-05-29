"use client";

import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Dataset, HexFeature } from "@/lib/schema";
import type { AppState } from "@/lib/ui-state";
import {
  STOCKS_TOTAL_KEY,
  fluxRange,
  getStockValue,
  maxStock,
} from "@/lib/data";
import { fluxColor, hexToRgbArray, stockColor } from "@/lib/color";

// World equirectangular-style view via deck.gl without an underlying basemap.
// Hex centroids rendered as filled circles; the dot density itself reads as a continental outline.

const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 15,
  zoom: 1.4,
  pitch: 0,
  bearing: 0,
};

export function MapView({
  data,
  state,
}: {
  data: Dataset;
  state: AppState;
}) {
  // Determine which layer's value we're encoding. We render two layers
  // simultaneously: one for stocks (size + teal opacity) and one for fluxes (diverging).
  // For v1 we let the user pick which one drives the visual via state.fluxesKey vs state.stocksKey;
  // we show fluxes color on top of stocks size for richer encoding.

  const max = useMemo(() => {
    if (state.stocksKey === STOCKS_TOTAL_KEY) {
      let m = 0;
      for (const h of data.hexes) {
        const v = getStockValue(h, state.stocksKey, data.manifest.stocks);
        if (v > m) m = v;
      }
      return m;
    }
    return maxStock(data.hexes, state.stocksKey);
  }, [data.hexes, data.manifest.stocks, state.stocksKey]);
  const flux = useMemo(
    () => fluxRange(data.hexes, state.fluxesKey),
    [data.hexes, state.fluxesKey]
  );

  const stockLayer = useMemo(
    () =>
      new ScatterplotLayer<HexFeature>({
        id: "hex-stocks",
        data: data.hexes,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => {
          const v = getStockValue(d, state.stocksKey, data.manifest.stocks);
          // Radius in meters: bigger for higher stocks; clamp so very small remain visible
          const t = max > 0 ? Math.max(0.15, v / max) : 0.2;
          return 60000 + t * 75000;
        },
        getFillColor: (d) => {
          const v = d.fluxes[state.fluxesKey] ?? 0;
          const c = fluxColor(v, flux.absMax || 1);
          const rgba = hexToRgbArray(c);
          rgba[3] = 200;
          return rgba;
        },
        getLineColor: (d) => {
          const v = getStockValue(d, state.stocksKey, data.manifest.stocks);
          const c = stockColor(v, max || 1);
          return hexToRgbArray(c);
        },
        lineWidthMinPixels: 0.6,
        stroked: true,
        radiusMinPixels: 2,
        radiusMaxPixels: 14,
        pickable: true,
        updateTriggers: {
          getRadius: [state.stocksKey, max],
          getFillColor: [state.fluxesKey, flux.absMax],
          getLineColor: [state.stocksKey, max],
        },
      }),
    [data.hexes, state.stocksKey, state.fluxesKey, max, flux.absMax]
  );

  return (
    <div className="relative w-full h-full">
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={[stockLayer]}
        style={{
          position: "absolute",
          inset: "0",
          background: "var(--color-purple)",
        }}
        getTooltip={({ object }) => {
          if (!object) return null;
          const h = object as HexFeature;
          const stockVal = h.stocks[state.stocksKey] ?? 0;
          const fluxVal = h.fluxes[state.fluxesKey] ?? 0;
          return {
            html: `<div style="padding:8px 10px; font-size:12px;">
              <div style="opacity:0.7">${h.hex_id}</div>
              <div>stocks: <b>${stockVal.toFixed(2)}</b></div>
              <div>fluxes: <b>${fluxVal.toFixed(2)}</b></div>
            </div>`,
            style: {
              background: "rgba(106, 51, 135, 0.95)",
              color: "white",
              borderRadius: "6px",
              border: "1px solid rgba(63, 217, 180, 0.6)",
            },
          };
        }}
      />
    </div>
  );
}

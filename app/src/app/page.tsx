"use client";

import { useMemo } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CardsView } from "@/components/views/CardsView";
import { TableView } from "@/components/views/TableView";
import { MapChartView } from "@/components/views/MapChartView";
import { uniqueCountries, useDataset } from "@/lib/data";
import { useAppState } from "@/lib/ui-state";

export default function Home() {
  const state = useAppState();
  const { data, error } = useDataset(state.dataMode);
  const countries = useMemo(
    () => (data ? uniqueCountries(data.hexes) : []),
    [data]
  );

  if (error) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-white/80">Failed to load dataset: {error}</div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-white/60 text-sm tracking-widest uppercase">
          Loading AFOLU data…
        </div>
      </main>
    );
  }

  return (
    <>
      <Header state={state} countries={countries} />
      <main className="flex-1 min-h-0 relative">
        {/* MapChartView stays mounted across all views so its markers can fly
            in / out. On table & cards it parks markers off-screen and ignores
            pointer events; the overlay below covers it. */}
        <div className="absolute inset-0">
          <MapChartView data={data} state={state} />
        </div>
        {(state.view === "cards" || state.view === "table") && (
          <div
            className="absolute inset-0"
            style={{
              background: "var(--color-purple)",
              // Stay transparent briefly so the markers' fly-out is visible,
              // then fade in to cover the map.
              animation: "viewFadeIn 700ms ease both",
            }}
          >
            {state.view === "cards" ? (
              <CardsView data={data} state={state} />
            ) : (
              <TableView data={data} state={state} />
            )}
          </div>
        )}
      </main>
      <Footer
        state={state}
        hexes={data.hexes}
        stocks={data.manifest.stocks}
        fluxes={data.manifest.fluxes}
      />
    </>
  );
}

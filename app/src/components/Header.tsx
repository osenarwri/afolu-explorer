"use client";

import type { AppState, ScatterMode, ViewKind } from "@/lib/ui-state";
import { FILTER_ALL } from "@/lib/data";
import { Pill, PillGroup, PillSelect } from "./Pill";

const VIEWS: { key: ViewKind; label: string }[] = [
  { key: "map", label: "Map" },
  { key: "scatter", label: "Chart" },
  { key: "histogram", label: "Histogram" },
  { key: "table", label: "Table" },
  { key: "cards", label: "Cards" },
];

const SCATTER_MODES: { key: ScatterMode; label: string }[] = [
  { key: "scatter", label: "Scatter" },
  { key: "density", label: "Density" },
];

export function Header({
  state,
  countries,
}: {
  state: AppState;
  countries: string[];
}) {
  // Sort applies to list-y views (Cards / Table). Map and Scatter position
  // hexes spatially, so a sort dropdown has no meaning there.
  const showSort = state.view === "cards" || state.view === "table";

  return (
    <header className="flex items-center justify-between px-6 py-4 gap-6">
      <div className="flex items-center gap-3">
        <PillSelect
          label="Country:"
          value={state.filter}
          onChange={state.setFilter}
          options={[
            { value: FILTER_ALL, label: "All countries" },
            ...countries.map((c) => ({ value: c, label: c })),
          ]}
        />
        {showSort && (
          <PillSelect
            label="Sort by:"
            value={state.sort}
            onChange={(v) => state.setSort(v as AppState["sort"])}
            options={[
              { value: "stocks_total", label: "Stocks > Total" },
              { value: "fluxes_total", label: "Fluxes > |Net|" },
              { value: "fluxes_net", label: "Fluxes > Net (signed)" },
            ]}
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        {state.view === "scatter" && (
          <PillGroup>
            {SCATTER_MODES.map((m) => (
              <Pill
                key={m.key}
                active={state.scatterMode === m.key}
                onClick={() => state.setScatterMode(m.key)}
              >
                {m.label}
              </Pill>
            ))}
          </PillGroup>
        )}
        <PillGroup>
          {VIEWS.map((v) => (
            <Pill
              key={v.key}
              active={state.view === v.key}
              onClick={() => state.setView(v.key)}
            >
              {v.label}
            </Pill>
          ))}
        </PillGroup>
      </div>
    </header>
  );
}

# AFOLU Explorer

A prototype web app for exploring **AFOLU** (Agriculture, Forestry and Other Land
Use) carbon **stocks** and **fluxes** on a global hex grid. It visualises the same
underlying data across several coordinated views — a map, a stocks-vs-flux chart,
a histogram, a sortable table, and a "totem" card per country/region — so you can
see where carbon is stored and whether land is acting as a source or a sink.

> Status: prototype / work in progress. The schema is manifest-driven, so adding
> or removing stock pools and flux components flows through every view
> automatically.

## What it shows

- **Stocks** — carbon pools (e.g. aboveground/belowground biomass, deadwood,
  litter, soil), rendered as stacked "cube" totems.
- **Fluxes** — gross emissions (source) and gross removals (sink) components, and
  net flux, rendered as "house/chevron" totems and a diverging pink↔teal scale.
- Aggregation by **country**, drill-down to **admin-1** regions, on-the-fly
  filtering, and interactive legends.

### Views

| View | What it does |
|------|--------------|
| **Map** | Hex markers on a World-Robinson projection; size = a stock layer, color = a flux layer. |
| **Chart** | Stocks (x) vs flux (y) scatter, with a density mode. |
| **Histogram** | Distribution of a chosen metric; dots packed into bars, sized/colored by total stocks / net flux. |
| **Table** | Per-country/region values with inline stock/flux glyphs; expandable pools/components. |
| **Cards** | One totem card per country/region (full stock + flux breakdown). |

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4
- D3 (`d3-scale`, `d3-hexbin`, `d3-interpolate`) for the SVG visualisations
- deck.gl is a dependency and is being introduced for GPU-accelerated markers

## Running the app

```bash
cd app
npm install
npm run dev          # http://localhost:3000  (or: PORT=3210 npm run dev)
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`.

> **The app needs data to render.** Without the data files (see below) it will sit
> on the "Loading AFOLU data…" screen. The data files are intentionally **not**
> committed to this repo.

## Loading the data

The app reads two JSON files at runtime (fetched from `app/public/data/`):

- `app/public/data/hexes.json` — the real dataset
- `app/public/data/hexes_mock.json` — a derived demo dataset with richer pools
  (toggle Real/Mock in the app footer)

Neither file is committed. Generate them with the Python pipeline in `data/`.

### 1. Get the source data

These large source files are **not** in the repo — download them yourself:

- **Rasters** → place in `data/rasters/` (or set `RASTER_DIR`). The pipeline expects
  coarsened (`_0_04deg`) GeoTIFFs from the WRI / Land & Carbon Lab Global Forest
  Watch flux & carbon-density products:
  - `carbon_density_non_soil_2024.tif`
  - `flux_gross_emissions.tif`
  - `flux_gross_removals.tif`
  - `flux_net.tif`
- **GADM** (admin boundaries, from [gadm.org](https://gadm.org)) → place in
  `data/gadm/` (or set `GADM_DIR`):
  - `gadm_410_countries_v2_simp2.geojson` (land filter + country)
  - `gadm_410.gpkg` (admin-1 lookup)

### 2. Build the datasets

The pipeline needs a Python environment with geopandas / rasterio / pyproj:

```bash
cd data
# e.g. with a fresh venv:
python -m venv .venv && source .venv/bin/activate
pip install geopandas rasterio pyproj pandas numpy shapely

# optional overrides if your data lives elsewhere:
# export RASTER_DIR=/path/to/rasters
# export GADM_DIR=/path/to/gadm

python build_hexes.py     # → data/hexes.csv + app/public/data/hexes.json
python build_mock.py      # → app/public/data/hexes_mock.json (derived from the real data)
```

`build_hexes.py` generates a 100 km hex grid in World Robinson, filters to land,
zonal-aggregates each raster into each hex, joins country/admin-1 by centroid,
stores the centroid (dropping the polygon geometry), and writes the app-ready
JSON. `build_mock.py` splits the single real carbon pool into multiple fabricated
pools and flux components so the totems can be demoed with richer structure.

## Project structure

```
afolu-explorer/
├── app/                 # Next.js application
│   ├── src/
│   │   ├── app/         # routes, layout, global styles
│   │   ├── components/  # views (Map/Chart/Histogram, Table, Cards), totems, legends
│   │   └── lib/         # data loading, color/size scales, ui-state, schema
│   └── public/data/     # generated datasets (gitignored)
├── data/                # Python data pipeline
│   ├── build_hexes.py   # rasters + GADM → hexes.json
│   ├── build_mock.py    # real → mock dataset
│   ├── rasters/         # source GeoTIFFs (gitignored)
│   └── gadm/            # GADM vector data (gitignored)
└── visuals/             # design mockups / visual-system references
```

## Notes

- Source rasters and GADM data are **read-only inputs** that you supply locally;
  they are never modified by the pipeline.
- The data files are excluded from version control by design — regenerate them
  with the pipeline above.

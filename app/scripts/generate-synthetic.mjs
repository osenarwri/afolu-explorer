// Generates a synthetic AFOLU hex dataset for the prototype.
// Land-mask approximation via a hand-drawn lat/lon bounding-box union, then
// per-hex values seeded by latitude bands to look plausibly AFOLU-shaped.
//
// Output: public/data/hexes.json  matching the schema in src/lib/schema.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/data/hexes.json");

// Crude land bounding boxes (lon_min, lon_max, lat_min, lat_max). Good enough
// for a synthetic prototype — replaced by real hex centroids in production.
const LAND_BOXES = [
  // North America
  [-168, -52, 25, 72],
  [-118, -82, 14, 32],
  // South America
  [-82, -34, -56, 13],
  // Europe
  [-10, 40, 36, 71],
  // Africa
  [-18, 52, -35, 37],
  // Middle East
  [34, 60, 12, 42],
  // Central + South Asia
  [60, 105, 5, 55],
  // East Asia
  [100, 145, 20, 54],
  // Southeast Asia + Indonesia
  [95, 141, -11, 24],
  // Australia
  [113, 154, -39, -11],
  // New Zealand
  [166, 178, -47, -34],
  // Japan
  [129, 146, 30, 46],
];

function inLand(lon, lat) {
  return LAND_BOXES.some(
    ([lo1, lo2, la1, la2]) => lon >= lo1 && lon <= lo2 && lat >= la1 && lat <= la2
  );
}

// Deterministic-ish PRNG so the dataset is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const jitter = (s) => (rand() - 0.5) * s;

// Latitude-banded biome multiplier: tropics rich, mid-latitudes moderate, boreal high, deserts low.
function biomeProfile(lat, lon) {
  const absLat = Math.abs(lat);
  // Saharan / Arabian / Australian desert dampers
  const isDesert =
    (lat > 12 && lat < 30 && lon > -18 && lon < 50) ||
    (lat > 14 && lat < 32 && lon > 34 && lon < 60) ||
    (lat > -32 && lat < -18 && lon > 113 && lon < 142);

  let forestLike = 0;
  if (absLat < 12) forestLike = 1.0; // tropics
  else if (absLat < 25) forestLike = 0.55;
  else if (absLat < 45) forestLike = 0.45;
  else if (absLat < 60) forestLike = 0.75; // boreal
  else forestLike = 0.15;

  if (isDesert) forestLike *= 0.15;

  // Tropical deforestation hotspots (Amazon, Indonesia, Congo arc)
  const isTropicalDefoArc =
    (lat > -10 && lat < 5 && lon > -75 && lon < -50) ||
    (lat > -5 && lat < 5 && lon > 100 && lon < 130) ||
    (lat > -5 && lat < 7 && lon > 12 && lon < 35);

  return { forestLike, isDesert, isTropicalDefoArc };
}

// Build a coarse global ~3° lon × ~3° lat grid, keep only land cells, render as hex-like centroids.
const hexes = [];
const stepLon = 3.0;
const stepLat = 3.0;
let i = 0;
for (let lat = -55; lat <= 70; lat += stepLat) {
  // Offset every other row a half-step for hex packing
  const offset = (Math.round((lat + 55) / stepLat) % 2) * (stepLon / 2);
  for (let lon = -178 + offset; lon <= 178; lon += stepLon) {
    const jLon = lon + jitter(0.4);
    const jLat = lat + jitter(0.4);
    if (!inLand(jLon, jLat)) continue;

    const { forestLike, isDesert, isTropicalDefoArc } = biomeProfile(jLat, jLon);

    // STOCKS — non-soil carbon density (Mg C / ha) dominated by forests; ~0–220 range.
    const baseDensity = forestLike * (140 + jitter(40));
    const carbon_density_non_soil = Math.max(0, baseDensity + jitter(20));

    // Illustrative pool decomposition — agb ~70%, bgb ~20%, soil ~variable
    const aboveground_biomass = carbon_density_non_soil * (0.65 + jitter(0.08));
    const belowground_biomass = carbon_density_non_soil * (0.22 + jitter(0.04));
    const soil_0_30 = Math.max(
      0,
      (isDesert ? 8 : forestLike > 0.5 ? 75 : 45) + jitter(15)
    );

    // FLUXES — Mg CO₂e / ha / yr
    // Emissions: high in tropical deforestation arcs and ag-cleared mid-latitudes
    const emissions_total = Math.max(
      0,
      (isTropicalDefoArc ? 8.5 : forestLike * 0.6) + Math.abs(jitter(1.4))
    );
    // Removals: high where there's active regrowth/standing forest
    const removals_total = Math.max(
      0,
      forestLike * (isTropicalDefoArc ? 2.5 : 4.2) + Math.abs(jitter(0.8))
    );
    const net_flux = emissions_total - removals_total;

    hexes.push({
      hex_id: `h_${i++}`,
      lon: Number(jLon.toFixed(3)),
      lat: Number(jLat.toFixed(3)),
      total_area_ha: 50000 * 50000 * (Math.sqrt(3) * 1.5) / 10000, // ~50km hex area in ha
      stocks: {
        carbon_density_non_soil: round(carbon_density_non_soil),
        aboveground_biomass: round(aboveground_biomass),
        belowground_biomass: round(belowground_biomass),
        soil_0_30: round(soil_0_30),
      },
      fluxes: {
        emissions_total: round(emissions_total),
        removals_total: round(removals_total),
        net_flux: round(net_flux),
      },
    });
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      manifest: {
        year: "2020",
        stocks: [
          { key: "carbon_density_non_soil", label: "Non-soil carbon density", kind: "stock", units: "Mg C / ha", group: "vegetation" },
          { key: "aboveground_biomass", label: "Aboveground biomass", kind: "stock", units: "Mg C / ha", group: "vegetation" },
          { key: "belowground_biomass", label: "Belowground biomass", kind: "stock", units: "Mg C / ha", group: "vegetation" },
          { key: "soil_0_30", label: "Soil 0–30 cm", kind: "stock", units: "Mg C / ha", group: "soil" },
        ],
        fluxes: [
          { key: "emissions_total", label: "Gross emissions", kind: "flux", units: "Mg CO₂e / ha / yr", group: "emissions" },
          { key: "removals_total", label: "Gross removals", kind: "flux", units: "Mg CO₂e / ha / yr", group: "removals" },
          { key: "net_flux", label: "Net flux", kind: "flux", units: "Mg CO₂e / ha / yr", group: "net" },
        ],
      },
      hexes,
    },
    null,
    0
  )
);

console.log(`Wrote ${hexes.length} hexes to ${OUT}`);

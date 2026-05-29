"""
Build a MOCK dataset derived from the real hexes.json, to demo richer totems.

Stocks: split the real non-soil carbon into AGB / BGB / deadwood / litter
(summing to the real value) and add a fabricated soil-carbon pool. So total
stocks = real non-soil + made-up soil.

Fluxes: removals = real vegetation removals; emissions = real vegetation
emissions + fabricated soil / cropland-management / livestock emissions; net =
total emissions − removals.

All "fabricated" values are deterministic functions of latitude + a per-hex
hash so the totems look varied and plausible (boreal = more soil/litter,
mid-latitudes = more cropland/livestock, etc.).

Run: python build_mock.py
"""

import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
REAL = HERE.parent / "app" / "public" / "data" / "hexes.json"
OUT = HERE.parent / "app" / "public" / "data" / "hexes_mock.json"


def rnd(seed: float, lo: float, hi: float) -> float:
    """Deterministic pseudo-random value in [lo, hi] from a numeric seed."""
    x = math.sin(seed * 12.9898) * 43758.5453
    f = x - math.floor(x)  # 0..1
    return lo + f * (hi - lo)


def main():
    real = json.load(REAL.open())
    hexes = real["hexes"]

    manifest = {
        "year": "2024 (mock)",
        "stocks": [
            {"key": "aboveground_biomass", "label": "Aboveground biomass", "kind": "stock", "units": "Mt C", "group": "vegetation"},
            {"key": "belowground_biomass", "label": "Belowground biomass", "kind": "stock", "units": "Mt C", "group": "vegetation"},
            {"key": "deadwood", "label": "Deadwood", "kind": "stock", "units": "Mt C", "group": "vegetation"},
            {"key": "litter", "label": "Litter", "kind": "stock", "units": "Mt C", "group": "vegetation"},
            {"key": "soil_carbon", "label": "Soil carbon", "kind": "stock", "units": "Mt C", "group": "soil"},
        ],
        "fluxes": [
            {"key": "emissions_vegetation", "label": "Vegetation emissions", "kind": "flux", "units": "Mt CO₂e / yr", "group": "emissions"},
            {"key": "emissions_soil", "label": "Soil emissions", "kind": "flux", "units": "Mt CO₂e / yr", "group": "emissions"},
            {"key": "emissions_cropland", "label": "Cropland mgmt emissions", "kind": "flux", "units": "Mt CO₂e / yr", "group": "emissions"},
            {"key": "emissions_livestock", "label": "Livestock emissions", "kind": "flux", "units": "Mt CO₂e / yr", "group": "emissions"},
            {"key": "removals_vegetation", "label": "Vegetation removals", "kind": "flux", "units": "Mt CO₂e / yr", "group": "removals"},
            {"key": "net_flux", "label": "Net flux", "kind": "flux", "units": "Mt CO₂e / yr", "group": "net"},
        ],
    }

    out = []
    for i, h in enumerate(hexes):
        lat = h["lat"]
        absLat = abs(lat)
        C = h["stocks"].get("carbon_density_non_soil", 0.0)
        E_veg = h["fluxes"].get("emissions_total", 0.0)
        R_veg = h["fluxes"].get("removals_total", 0.0)

        # --- Stock split (first four fractions sum to C) ---
        tropicalness = max(0.0, 1.0 - absLat / 40.0)  # 1 at equator → 0 by 40°
        agbFrac = 0.50 + 0.15 * tropicalness + rnd(i + 1, -0.03, 0.03)
        bgbFrac = 0.22 + rnd(i + 7, -0.02, 0.02)
        rem = max(0.0, 1.0 - agbFrac - bgbFrac)
        deadFrac = rem * (0.40 + rnd(i + 13, -0.08, 0.08))
        litFrac = max(0.0, rem - deadFrac)
        agb, bgb, dead, lit = C * agbFrac, C * bgbFrac, C * deadFrac, C * litFrac

        # --- Soil carbon (fabricated): more at high latitudes (peat/boreal) ---
        soilMult = 0.7 + 1.6 * (absLat / 90.0)
        soil = C * soilMult + rnd(i + 21, 0.0, 6.0)

        # --- Fabricated emission components ---
        temperateness = max(0.0, 1.0 - abs(absLat - 40.0) / 40.0)  # peak ~40°
        emis_soil = E_veg * 0.35 + temperateness * 1.5 + rnd(i + 31, 0.0, 2.0)
        emis_crop = temperateness * 3.0 + rnd(i + 37, 0.0, 1.5)
        emis_live = temperateness * 2.0 + tropicalness * 1.0 + rnd(i + 41, 0.0, 1.0)
        total_emis = E_veg + emis_soil + emis_crop + emis_live
        net = total_emis - R_veg

        out.append(
            {
                "hex_id": h["hex_id"],
                "lon": h["lon"],
                "lat": h["lat"],
                "rx": h.get("rx"),
                "ry": h.get("ry"),
                "country": h.get("country"),
                "admin1": h.get("admin1"),
                "stocks": {
                    "aboveground_biomass": round(agb, 3),
                    "belowground_biomass": round(bgb, 3),
                    "deadwood": round(dead, 3),
                    "litter": round(lit, 3),
                    "soil_carbon": round(soil, 3),
                },
                "fluxes": {
                    "emissions_vegetation": round(E_veg, 3),
                    "emissions_soil": round(emis_soil, 3),
                    "emissions_cropland": round(emis_crop, 3),
                    "emissions_livestock": round(emis_live, 3),
                    "removals_vegetation": round(R_veg, 3),
                    "net_flux": round(net, 3),
                },
            }
        )

    json.dump(
        {"manifest": manifest, "hexes": out}, OUT.open("w"), separators=(",", ":")
    )
    print(f"Wrote {OUT} ({len(out)} hexes, {len(manifest['stocks'])} stocks, "
          f"{len(manifest['fluxes'])} fluxes)")


if __name__ == "__main__":
    main()

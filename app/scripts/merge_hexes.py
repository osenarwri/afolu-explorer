#!/usr/bin/env python3
"""
Merge per-raster hex GeoJSONs (output of global_hex_grid.py) into a single canonical
dataset matching the AFOLU Explorer schema (see app/src/lib/schema.ts).

Usage:
    python merge_hexes.py --manifest manifest.json --out ../public/data/hexes.json

manifest.json format:
    {
      "year": "2020",
      "stocks": [
        {
          "key": "carbon_density_non_soil",
          "label": "Non-soil carbon density",
          "units": "Mg C / ha",
          "group": "vegetation",
          "geojson": "../../data/hex_outputs/carbon_density_non_soil_2020.geojson",
          "stat": "mean"
        }
      ],
      "fluxes": [
        {
          "key": "emissions_total",
          "label": "Total emissions",
          "units": "Mg CO2e / ha / yr",
          "group": "emissions",
          "geojson": "../../data/hex_outputs/emissions_total_2020.geojson",
          "stat": "mean"
        },
        {
          "key": "net_flux",
          "label": "Net flux",
          "units": "Mg CO2e / ha / yr",
          "group": "net",
          "geojson": "../../data/hex_outputs/net_flux_2020.geojson",
          "stat": "mean"
        }
      ]
    }

The `stat` field picks which aggregated column to read from the per-raster GeoJSON
produced by global_hex_grid.py. Valid values: mean, median, sum, min, max,
p5, p25, p75, p95.
"""

import argparse
import json
import sys
from pathlib import Path


STAT_TO_COLUMN = {
    "mean": "value_mean",
    "median": "value_median",
    "sum": "value_sum",
    "min": "value_min",
    "max": "value_max",
    "p5": "value_p5",
    "p25": "value_p25",
    "p75": "value_p75",
    "p95": "value_p95",
}


def load_geojson(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def hex_centroid(geometry: dict) -> tuple[float, float]:
    """Compute the centroid of a hex polygon (avg of unique vertices)."""
    coords = geometry["coordinates"][0]
    # Polygon ring is closed (first == last); drop the duplicate.
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def index_features(geojson: dict, stat_column: str) -> dict[str, dict]:
    """Build a hex_id -> {value, lon, lat, total_area_ha, geometry} index from one GeoJSON."""
    out = {}
    for feat in geojson["features"]:
        props = feat.get("properties", {})
        hex_id = props.get("hex_id")
        if hex_id is None:
            continue
        lon, lat = hex_centroid(feat["geometry"])
        out[hex_id] = {
            "lon": lon,
            "lat": lat,
            "total_area_ha": props.get("total_area_ha", 0.0),
            "value": props.get(stat_column),
            "geometry": feat["geometry"],
        }
    return out


def merge(manifest: dict, manifest_dir: Path) -> dict:
    year = manifest.get("year", "unknown")
    stock_defs = manifest.get("stocks", [])
    flux_defs = manifest.get("fluxes", [])

    # Load each layer's GeoJSON and index by hex_id.
    layers: list[tuple[str, str, dict]] = []  # (kind, key, indexed_features)
    canonical_hexes: dict[str, dict] = {}

    for definition in stock_defs:
        path = (manifest_dir / definition["geojson"]).resolve()
        if not path.exists():
            print(f"  ! missing geojson for {definition['key']}: {path}", file=sys.stderr)
            continue
        stat_col = STAT_TO_COLUMN.get(definition.get("stat", "mean"))
        if stat_col is None:
            print(f"  ! unknown stat {definition.get('stat')} for {definition['key']}", file=sys.stderr)
            continue
        print(f"  loading stock layer {definition['key']} from {path.name}")
        idx = index_features(load_geojson(path), stat_col)
        layers.append(("stock", definition["key"], idx))
        for hex_id, info in idx.items():
            if hex_id not in canonical_hexes:
                canonical_hexes[hex_id] = {
                    "hex_id": hex_id,
                    "lon": info["lon"],
                    "lat": info["lat"],
                    "total_area_ha": info["total_area_ha"],
                    "stocks": {},
                    "fluxes": {},
                }

    for definition in flux_defs:
        path = (manifest_dir / definition["geojson"]).resolve()
        if not path.exists():
            print(f"  ! missing geojson for {definition['key']}: {path}", file=sys.stderr)
            continue
        stat_col = STAT_TO_COLUMN.get(definition.get("stat", "mean"))
        if stat_col is None:
            print(f"  ! unknown stat {definition.get('stat')} for {definition['key']}", file=sys.stderr)
            continue
        print(f"  loading flux layer {definition['key']} from {path.name}")
        idx = index_features(load_geojson(path), stat_col)
        layers.append(("flux", definition["key"], idx))
        for hex_id, info in idx.items():
            if hex_id not in canonical_hexes:
                canonical_hexes[hex_id] = {
                    "hex_id": hex_id,
                    "lon": info["lon"],
                    "lat": info["lat"],
                    "total_area_ha": info["total_area_ha"],
                    "stocks": {},
                    "fluxes": {},
                }

    # Populate stocks/fluxes maps per hex.
    for kind, key, idx in layers:
        bucket = "stocks" if kind == "stock" else "fluxes"
        for hex_id, info in idx.items():
            v = info["value"]
            canonical_hexes[hex_id][bucket][key] = (
                round(float(v), 4) if v is not None else None
            )

    # Build manifest exposed to the frontend (strip filesystem-only fields).
    frontend_manifest = {
        "year": year,
        "stocks": [
            {
                "key": d["key"],
                "label": d.get("label", d["key"]),
                "kind": "stock",
                "units": d.get("units", ""),
                "group": d.get("group", "vegetation"),
            }
            for d in stock_defs
        ],
        "fluxes": [
            {
                "key": d["key"],
                "label": d.get("label", d["key"]),
                "kind": "flux",
                "units": d.get("units", ""),
                "group": d.get("group", "emissions"),
            }
            for d in flux_defs
        ],
    }

    return {
        "manifest": frontend_manifest,
        "hexes": list(canonical_hexes.values()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to manifest.json")
    parser.add_argument("--out", required=True, help="Output path (e.g. public/data/hexes.json)")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    with manifest_path.open() as f:
        manifest = json.load(f)

    print(f"Reading manifest from {manifest_path}")
    out = merge(manifest, manifest_path.parent)

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        json.dump(out, f, separators=(",", ":"))

    n = len(out["hexes"])
    n_stocks = len(out["manifest"]["stocks"])
    n_fluxes = len(out["manifest"]["fluxes"])
    print(f"Wrote {n} hexes ({n_stocks} stock layers, {n_fluxes} flux layers) to {out_path}")


if __name__ == "__main__":
    main()

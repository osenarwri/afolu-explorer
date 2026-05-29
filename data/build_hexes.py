"""
Build the AFOLU Explorer hex dataset from source rasters + GADM.

Pipeline:
  1. Generate a global hex grid (regular hexagons in World Robinson) at a
     chosen radius.
  2. Filter to land using a (simplified) GADM countries layer.
  3. Zonal-aggregate each source raster into each hex (mean for densities,
     sum for per-pixel totals).
  4. Join dominant country (admin0) and admin1 per hex via centroid lookup.
  5. Compute each hex's WGS84 centroid and DROP the polygon geometry.
  6. Write a flat CSV and the app-ready hexes.json.

Run:
  python build_hexes.py
"""

import json
import math
import os
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.mask import mask
from shapely.geometry import Polygon, mapping
import pyproj

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
# Source rasters live in data/rasters/ (download separately — see README).
RASTER_DIR = Path(os.environ.get("RASTER_DIR", str(HERE / "rasters")))
# GADM vector data (download separately — see README). Override with GADM_DIR.
GADM_DIR = Path(os.environ.get("GADM_DIR", str(HERE / "gadm")))
GADM_LAND = GADM_DIR / "gadm_410_countries_v2_simp2.geojson"  # land filter + country
GADM_ADMIN = GADM_DIR / "gadm_410.gpkg"  # admin1 (NAME_1) lookup

HEX_RADIUS_M = 100_000  # 100 km circumradius
WORK_CRS = "ESRI:54030"  # World Robinson — regular hexagons
WGS84 = "EPSG:4326"

OUT_CSV = HERE / "hexes.csv"
OUT_JSON = HERE.parent / "app" / "public" / "data" / "hexes.json"

# Raster layer definitions: (file, semantic key, stat, kind, label, units, group)
# The coarsened (_0_04deg) rasters store per-pixel TOTALS, so everything is
# summed per hex. Values are huge (millions of Mg), so scale to Mt for display.
MT = 1.0e-6

STOCK_LAYERS = [
    {
        "file": "carbon_density_non_soil_2024.tif",
        "key": "carbon_density_non_soil",
        "stat": "sum",  # per-pixel Mg C → sum = total carbon in the hex
        "scale": MT,
        "label": "Non-soil carbon",
        "units": "Mt C",
        "group": "vegetation",
    },
]
FLUX_LAYERS = [
    {
        "file": "flux_gross_emissions.tif",
        "key": "emissions_total",
        "stat": "sum",
        "scale": MT,
        "label": "Gross emissions",
        "units": "Mt CO₂e / yr",
        "group": "emissions",
    },
    {
        "file": "flux_gross_removals.tif",
        "key": "removals_total",
        "stat": "sum",
        "scale": MT,
        # Removals are stored NEGATIVE in the raster; flip to a positive
        # magnitude for display (the down-pointing house already conveys "sink").
        "negate": True,
        "label": "Gross removals",
        "units": "Mt CO₂e / yr",
        "group": "removals",
    },
    {
        "file": "flux_net.tif",
        "key": "net_flux",
        "stat": "sum",
        "scale": MT,
        "label": "Net flux",
        "units": "Mt CO₂e / yr",
        "group": "net",
    },
]


# ----------------------------------------------------------------------------
# 1. Hex grid
# ----------------------------------------------------------------------------
def create_hex_grid(hex_size, output_crs):
    print(f"Generating hex grid (radius {hex_size} m, {output_crs})...")
    transformer = pyproj.Transformer.from_crs(WGS84, output_crs, always_xy=True)
    lat_samples = np.linspace(-85, 85, 20)
    lon_samples = np.linspace(-180, 180, 40)
    edge = []
    for lat in lat_samples:
        edge += [[-180, lat], [180, lat]]
    for lon in lon_samples:
        edge += [[lon, -85], [lon, 85]]
    xs, ys = [], []
    for lon, lat in edge:
        x, y = transformer.transform(lon, lat)
        xs.append(x)
        ys.append(y)
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)

    r = hex_size
    dx = r * math.sqrt(3)
    dy = r * 1.5
    minx -= dx
    maxx += dx
    miny -= dy
    maxy += dy

    hexes = []
    y = miny
    row = 0
    while y < maxy:
        x = minx + (0 if row % 2 == 0 else dx / 2)
        col = 0
        while x < maxx:
            pts = []
            for i in range(6):
                a = i * (math.pi / 3) - math.pi / 2
                pts.append((x + r * math.cos(a), y + r * math.sin(a)))
            hexes.append(
                {"geometry": Polygon(pts), "hex_id": f"{row}_{col}"}
            )
            x += dx
            col += 1
        y += dy
        row += 1
    gdf = gpd.GeoDataFrame(hexes, crs=output_crs)
    print(f"  {len(gdf)} candidate hexes")
    return gdf


def filter_to_land(hex_gdf, gadm_file):
    print(f"Filtering to land using {gadm_file.name}...")
    land = gpd.read_file(gadm_file)
    if land.crs != hex_gdf.crs:
        land = land.to_crs(hex_gdf.crs)
    land.loc[~land.geometry.is_valid, "geometry"] = land.loc[
        ~land.geometry.is_valid, "geometry"
    ].buffer(0)
    joined = gpd.sjoin(hex_gdf, land[["geometry"]], how="inner", predicate="intersects")
    kept = hex_gdf[hex_gdf.index.isin(joined.index.unique())].copy()
    print(f"  kept {len(kept)} land hexes")
    return kept


# ----------------------------------------------------------------------------
# 2. Raster aggregation
# ----------------------------------------------------------------------------
def aggregate(hex_gdf, raster_path, stat):
    print(f"Aggregating {raster_path.name} ({stat})...")
    out = np.full(len(hex_gdf), np.nan)
    with rasterio.open(raster_path) as src:
        raster_crs = src.crs
        hexes = (
            hex_gdf.to_crs(raster_crs) if hex_gdf.crs != raster_crs else hex_gdf
        )
        # All these layers use nodata=0. mask() fills out-of-hex pixels with
        # nodata too, so filtering `!= nodata` drops both out-of-hex pixels and
        # in-hex zeros (acceptable: zeros add nothing to a sum, and give a
        # carbon-bearing mean for densities).
        nodata = src.nodata if src.nodata is not None else 0
        for pos, (_, row) in enumerate(hexes.iterrows()):
            try:
                img, _ = mask(
                    src,
                    [mapping(row.geometry)],
                    crop=True,
                    nodata=nodata,
                    filled=True,
                )
                band = img[0].astype("float64").ravel()
                band = band[~np.isnan(band)]
                band = band[band != nodata]
                if band.size == 0:
                    continue
                out[pos] = band.mean() if stat == "mean" else band.sum()
            except Exception:
                continue
    return out


# ----------------------------------------------------------------------------
# 3. Admin join (country + admin1) via centroid lookup
# ----------------------------------------------------------------------------
def join_admin(centroids_wgs84):
    """centroids_wgs84: GeoDataFrame of POINT geometries (hex centroids)."""
    print("Joining country (admin0)...")
    country = gpd.read_file(GADM_LAND)
    if country.crs is None:
        country.set_crs(WGS84, inplace=True)
    country = country.to_crs(WGS84)
    name0_col = next(
        (c for c in ["COUNTRY", "NAME_0", "GID_0"] if c in country.columns),
        None,
    )
    cj = gpd.sjoin(
        centroids_wgs84,
        country[[name0_col, "geometry"]],
        how="left",
        predicate="within",
    )
    cj = cj[~cj.index.duplicated(keep="first")]
    countries = cj[name0_col].fillna("—").values

    print("Joining admin1 (this can take a moment — large gpkg)...")
    admin1 = None
    try:
        adm = gpd.read_file(
            GADM_ADMIN, columns=["NAME_0", "NAME_1", "geometry"]
        )
        adm = adm.to_crs(WGS84)
        aj = gpd.sjoin(
            centroids_wgs84,
            adm[["NAME_1", "geometry"]],
            how="left",
            predicate="within",
        )
        aj = aj[~aj.index.duplicated(keep="first")]
        admin1 = aj["NAME_1"].fillna("—").values
    except Exception as e:
        print(f"  admin1 join skipped: {e}")
        admin1 = np.array(["—"] * len(centroids_wgs84))

    return countries, admin1


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    grid = create_hex_grid(HEX_RADIUS_M, WORK_CRS)
    grid = filter_to_land(grid, GADM_LAND)
    grid = grid.reset_index(drop=True)

    # Aggregate stocks + fluxes
    for layer in STOCK_LAYERS + FLUX_LAYERS:
        path = RASTER_DIR / layer["file"]
        vals = aggregate(grid, path, layer["stat"])
        if layer.get("negate"):
            vals = -vals
        vals = vals * layer.get("scale", 1.0)
        # Empty hexes (no valid pixels) → 0
        grid[layer["key"]] = np.nan_to_num(vals, nan=0.0)

    # Centroids: keep BOTH the Robinson projected coords (rx, ry — used by the
    # map so the regular hex grid renders undistorted) and lon/lat (for admin
    # joins + reference).
    print("Computing centroids...")
    cent = grid.geometry.centroid  # in the grid CRS (World Robinson)
    grid["rx"] = cent.x.values
    grid["ry"] = cent.y.values
    cent_wgs = gpd.GeoSeries(cent, crs=grid.crs).to_crs(WGS84)
    grid["lon"] = cent_wgs.x.values
    grid["lat"] = cent_wgs.y.values

    centroids_wgs84 = gpd.GeoDataFrame(
        {"hex_id": grid["hex_id"].values},
        geometry=gpd.points_from_xy(grid["lon"], grid["lat"]),
        crs=WGS84,
    )
    countries, admin1 = join_admin(centroids_wgs84)
    grid["country"] = countries
    grid["admin1"] = admin1

    # Drop hexes with no country (offshore slivers) and Antarctica (no AFOLU data)
    before = len(grid)
    grid = grid[
        (grid["country"] != "—") & (grid["country"] != "Antarctica")
    ].reset_index(drop=True)
    print(f"  dropped {before - len(grid)} hexes (no country / Antarctica)")

    # ---- Write CSV ----
    stock_keys = [l["key"] for l in STOCK_LAYERS]
    flux_keys = [l["key"] for l in FLUX_LAYERS]
    cols = (
        ["hex_id", "lon", "lat", "rx", "ry", "country", "admin1"]
        + stock_keys
        + flux_keys
    )
    df = grid[cols].copy()
    for k in stock_keys + flux_keys:
        df[k] = df[k].round(3)
    df["lon"] = df["lon"].round(4)
    df["lat"] = df["lat"].round(4)
    df["rx"] = df["rx"].round(0).astype(int)
    df["ry"] = df["ry"].round(0).astype(int)
    df.to_csv(OUT_CSV, index=False)
    print(f"Wrote {OUT_CSV} ({len(df)} rows)")

    # ---- Write hexes.json for the app ----
    manifest = {
        "year": "2024",
        "stocks": [
            {
                "key": l["key"],
                "label": l["label"],
                "kind": "stock",
                "units": l["units"],
                "group": l["group"],
            }
            for l in STOCK_LAYERS
        ],
        "fluxes": [
            {
                "key": l["key"],
                "label": l["label"],
                "kind": "flux",
                "units": l["units"],
                "group": l["group"],
            }
            for l in FLUX_LAYERS
        ],
    }
    hexes = []
    for _, r in df.iterrows():
        hexes.append(
            {
                "hex_id": r["hex_id"],
                "lon": float(r["lon"]),
                "lat": float(r["lat"]),
                "rx": int(r["rx"]),
                "ry": int(r["ry"]),
                "country": r["country"],
                "admin1": r["admin1"],
                "stocks": {k: float(r[k]) for k in stock_keys},
                "fluxes": {k: float(r[k]) for k in flux_keys},
            }
        )
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSON.open("w") as f:
        json.dump({"manifest": manifest, "hexes": hexes}, f, separators=(",", ":"))
    print(f"Wrote {OUT_JSON} ({len(hexes)} hexes)")


if __name__ == "__main__":
    main()

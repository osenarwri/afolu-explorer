// Canonical data schema for the AFOLU Explorer prototype.
// Pool/component lists are NOT fixed — driven by this manifest, not hard-coded views.

export type LayerKind = "stock" | "flux";

export interface LayerDef {
  key: string;
  label: string;
  kind: LayerKind;
  units: string;
  group?: string;
}

export interface DatasetManifest {
  year: string;
  stocks: LayerDef[];
  fluxes: LayerDef[];
}

export interface HexFeature {
  hex_id: string;
  lon: number;
  lat: number;
  // Robinson projected centroid (meters) — used by the map so the grid that
  // was generated in Robinson renders undistorted. Optional for back-compat
  // with the older synthetic dataset.
  rx?: number;
  ry?: number;
  total_area_ha?: number;
  country?: string;
  admin1?: string;
  stocks: Record<string, number>;
  fluxes: Record<string, number>;
}

export interface Dataset {
  manifest: DatasetManifest;
  hexes: HexFeature[];
}

// Default manifest reflects what the publicly-available AFOLU rasters give us today.
// More layers can be appended without app code changes.
export const DEFAULT_MANIFEST: DatasetManifest = {
  year: "2020",
  stocks: [
    {
      key: "carbon_density_non_soil",
      label: "Non-soil carbon density",
      kind: "stock",
      units: "Mg C / ha",
      group: "vegetation",
    },
    // Placeholder slots — illustrative pools from the mockups. Will be populated
    // when additional rasters arrive (soil pools, AGB/BGB split, etc.)
    {
      key: "aboveground_biomass",
      label: "Aboveground biomass",
      kind: "stock",
      units: "Mg C / ha",
      group: "vegetation",
    },
    {
      key: "belowground_biomass",
      label: "Belowground biomass",
      kind: "stock",
      units: "Mg C / ha",
      group: "vegetation",
    },
    {
      key: "soil_0_30",
      label: "Soil 0–30 cm",
      kind: "stock",
      units: "Mg C / ha",
      group: "soil",
    },
  ],
  fluxes: [
    {
      key: "emissions_total",
      label: "Gross emissions",
      kind: "flux",
      units: "Mg CO₂e / ha / yr",
      group: "emissions",
    },
    {
      key: "removals_total",
      label: "Gross removals",
      kind: "flux",
      units: "Mg CO₂e / ha / yr",
      group: "removals",
    },
    {
      key: "net_flux",
      label: "Net flux",
      kind: "flux",
      units: "Mg CO₂e / ha / yr",
      group: "net",
    },
  ],
};

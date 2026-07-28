import type { AttributionChild } from "@navaramap/three";

import { asset } from "./assets";

/** A tile/asset data source used by the app, with its attribution fields. */
export type Dataset = {
  url: string;
  attribution?: string;
  attributionHtml?: string;
  attributionUrl?: string;
  /** Optional logo image path, shown in the always-visible logo frame. */
  logo?: string;
  /** Optional click target for the logo, separate from `attributionUrl`. */
  logoUrl?: string;
  /** Optional zoom-banded sub-credits, shown when the zoom is within the band. */
  children?: AttributionChild[];
};

/**
 * Raster tile datasets
 */
export const TILE_DATASETS = {
  eox: {
    url:
      "https://tiles.maps.eox.at/wmts?layer=s2cloudless-2020_3857&style=default" +
      "&tilematrixset=g&Service=WMTS&Request=GetTile" +
      "&Version=1.0.0&Format=image%2Fjpeg" +
      "&TileMatrix={z}&TileCol={x}&TileRow={y}",
    attributionHtml:
      '<a href="https://s2maps.eu">Sentinel-2 cloudless 2020</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2020)',
  },
} satisfies Record<string, Dataset>;

/**
 * Terrain/DEM datasets
 */
export const TERRAIN_DATASETS = {
  reearthQuantizedMesh: {
    url: "https://terrain.reearth.land/cesium-mesh/ellipsoid/{z}/{x}/{y}.terrain",
    attribution: "© Re:Earth Terrain",
    attributionUrl: "https://terrain.reearth.land/",
  },
} satisfies Record<string, Dataset>;

/**
 * GeoJSON datasets
 */
export const GEOJSON_DATASETS = {
  worldCities: {
    url: asset("/world-cities.geojson"),
    attribution: "World Major Cities",
  },
  /**
   * One label point per country: the centroid of each country's largest ring,
   * precomputed from the 14 MB `countries.geojson` of the geo-countries
   * dataset so a label layer does not have to download the polygons.
   */
  countryLabels: {
    url: asset("/data/country-labels.geojson"),
    attribution: "Country boundaries: geo-countries (Open Data Commons PDDL)",
    attributionUrl: "https://github.com/datasets/geo-countries",
  },
} satisfies Record<string, Dataset>;

/**
 * Local asset datasets — the vehicle models under `public/glTF/`.
 */
export const LOCAL_DATASETS = {
  soldierGLTF: {
    url: asset("/glTF/Soldier/Soldier.glb"),
    attribution:
      "https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/Soldier.glb",
  },
  travelPlaneGLTF: {
    url: asset("/glTF/travel/plane.glb"),
    attribution: "Airplane by Poly by Google - CC BY 3.0",
    attributionUrl: "https://poly.pizza/m/8ciDd9k8wha",
  },
  travelTrainGLTF: {
    url: asset("/glTF/travel/train.glb"),
    attribution: "Locomotive Front by Quaternius - CC0 1.0",
    attributionUrl: "https://poly.pizza/m/WY84FHug9s",
  },
  travelCarGLTF: {
    url: asset("/glTF/travel/car.glb"),
    attribution: "Car by Quaternius - CC0 1.0",
    attributionUrl: "https://poly.pizza/m/unqqkULtRU",
  },
  travelShipGLTF: {
    url: asset("/glTF/travel/ship.glb"),
    attribution: "Ship by Quaternius - CC0 1.0",
    attributionUrl: "https://poly.pizza/m/mEQj2wZ3GC",
  },
} satisfies Record<string, Dataset>;

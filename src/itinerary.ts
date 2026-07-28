import {
  EllipsoidGeodesic,
  degreeToRadian,
  radianToDegree,
} from "@navaramap/three";
import type { FeatureCollection, Point } from "geojson";

/** One destination on the journey. */
export type Stop = {
  name: string;
  country: string;
  lng: number;
  lat: number;
};

/** How one hop between two stops is travelled. */
export type LegPlan = {
  vehicleId: string;
  /** Speed multiplier relative to the trip's base pace. */
  speed: number;
};

/** A sample along the route, precomputed whenever the trip changes. */
export type RoutePoint = {
  lng: number;
  lat: number;
  /** Height above the ellipsoid in meters — the cruise arc of the leg. */
  height: number;
  /** Travel direction at this sample, in degrees clockwise from north. */
  heading: number;
  /** Flight-path angle in degrees: positive climbing, negative descending. */
  climb: number;
  /** How sharply the course turns here, clamped to -1 (left) … 1 (right). */
  turnRate: number;
  /** Ground distance from the first stop, in meters. */
  traveled: number;
  /** Index of the leg this sample belongs to (0 = first stop → second stop). */
  legIndex: number;
};

/** A single hop between two consecutive stops, travelled by one vehicle. */
export type Leg = {
  from: Stop;
  to: Stop;
  vehicleId: string;
  /** Speed multiplier relative to the trip's base pace. */
  speed: number;
  /** Geodesic ground distance in meters. */
  distance: number;
  /** Cumulative ground distance at the end of this leg, in meters. */
  endTraveled: number;
};

export type Route = {
  path: RoutePoint[];
  legs: Leg[];
  totalDistance: number;
};

/** The itinerary the page opens with; the planner can change it freely. */
export const DEFAULT_STOPS: Stop[] = [
  { name: "Tokyo", country: "JP", lng: 139.6917, lat: 35.6895 },
  { name: "Singapore", country: "SG", lng: 103.8198, lat: 1.3521 },
  { name: "Dubai", country: "AE", lng: 55.2708, lat: 25.2048 },
  { name: "Istanbul", country: "TR", lng: 28.9784, lat: 41.0082 },
  { name: "Paris", country: "FR", lng: 2.3522, lat: 48.8566 },
];

/** Vehicle assigned to each default leg — one per gap between the stops. */
export const DEFAULT_MODES = ["plane", "ship", "plane", "train"];

/** Samples per leg. Dense enough that the tip of the trail moves smoothly. */
const SAMPLES_PER_LEG = 96;

/** Course change per sample that maps to a full bank; see `RoutePoint.turnRate`. */
const FULL_BANK_DEGREES = 1.2;

/** Signed shortest difference between two bearings, in degrees. */
export const shortestAngleDelta = (from: number, to: number): number =>
  ((((to - from) % 360) + 540) % 360) - 180;

/** Bearing from `a` to `b` in degrees, using a local flat approximation. */
const bearingBetween = (
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number => {
  const lat = degreeToRadian((a.lat + b.lat) / 2);
  const dLng = shortestAngleDelta(a.lng, b.lng);
  return radianToDegree(Math.atan2(dLng * Math.cos(lat), b.lat - a.lat));
};

/** Arc profile of one leg, taken from the vehicle assigned to it. */
export type ArcProfile = { ratio: number; maxHeight: number };

/**
 * Builds the route: each leg is a geodesic between two stops, sampled at a
 * constant ground-distance interval and lifted onto a sine-shaped cruise arc.
 * The arc profile is per leg, so a plane leg rises through the air while a
 * ship, train or car leg stays on the curvature of the globe.
 */
export const buildRoute = (
  stops: Stop[],
  plans: LegPlan[],
  arcOf: (vehicleId: string) => ArcProfile,
): Route => {
  const path: RoutePoint[] = [];
  const legs: Leg[] = [];
  let traveled = 0;

  for (let legIndex = 0; legIndex < stops.length - 1; legIndex++) {
    const from = stops[legIndex];
    const to = stops[legIndex + 1];
    const plan = plans[legIndex];
    const arc = arcOf(plan.vehicleId);

    // EllipsoidGeodesic solves the inverse geodesic problem on WGS84: it gives
    // the true ground distance and interpolates a point at any distance along
    // the shortest path between the two stops.
    const geodesic = new EllipsoidGeodesic(
      {
        lat: degreeToRadian(from.lat),
        lng: degreeToRadian(from.lng),
        height: 0,
      },
      { lat: degreeToRadian(to.lat), lng: degreeToRadian(to.lng), height: 0 },
    );
    const distance = geodesic.distance;
    const arcHeight = Math.min(distance * arc.ratio, arc.maxHeight);
    const legStart = traveled;

    // Skip the first sample on later legs — the previous leg already ended there.
    for (let i = legIndex === 0 ? 0 : 1; i <= SAMPLES_PER_LEG; i++) {
      const t = i / SAMPLES_PER_LEG;
      const point = geodesic.interpolateDistance(distance * t);
      path.push({
        lng: radianToDegree(point.lng),
        lat: radianToDegree(point.lat),
        height: arcHeight * Math.sin(Math.PI * t),
        // heading, climb and turnRate need the neighbouring samples; filled in
        // once the whole path exists.
        heading: 0,
        climb: 0,
        turnRate: 0,
        traveled: legStart + distance * t,
        legIndex,
      });
    }

    // The geodesic is backed by WASM memory outside the JS heap; free it.
    geodesic.dispose();

    traveled = legStart + distance;
    legs.push({
      from,
      to,
      vehicleId: plan.vehicleId,
      speed: plan.speed,
      distance,
      endTraveled: traveled,
    });
  }

  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(i - 1, 0)];
    const next = path[Math.min(i + 1, path.length - 1)];
    path[i].heading = bearingBetween(prev, next);
    // The flight-path angle is the slope of the cruise arc: how much altitude
    // is gained over the ground distance covered between the neighbours.
    const ground = next.traveled - prev.traveled;
    path[i].climb =
      ground > 0
        ? radianToDegree(Math.atan2(next.height - prev.height, ground))
        : 0;
  }

  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(i - 1, 0)];
    const next = path[Math.min(i + 1, path.length - 1)];
    const turn = shortestAngleDelta(prev.heading, next.heading);
    path[i].turnRate = Math.max(-1, Math.min(turn / FULL_BANK_DEGREES, 1));
  }

  return { path, legs, totalDistance: traveled };
};

/**
 * Position on the route at `traveled` meters, linearly interpolated between the
 * two neighbouring samples. `index` is the last sample already passed, so the
 * caller can slice the revealed part of the trail.
 */
export const sampleRoute = (path: RoutePoint[], traveled: number) => {
  let index = 0;
  while (index < path.length - 2 && path[index + 1].traveled < traveled)
    index++;

  const a = path[index];
  const b = path[index + 1] ?? a;
  const span = b.traveled - a.traveled;
  const t =
    span > 0 ? Math.min(Math.max((traveled - a.traveled) / span, 0), 1) : 0;

  return {
    index,
    // Interpolating the longitude delta (not the raw values) keeps the tip
    // moving correctly when a leg crosses the antimeridian.
    lng: a.lng + shortestAngleDelta(a.lng, b.lng) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    height: a.height + (b.height - a.height) * t,
    heading: a.heading + shortestAngleDelta(a.heading, b.heading) * t,
    climb: a.climb + (b.climb - a.climb) * t,
    turnRate: a.turnRate + (b.turnRate - a.turnRate) * t,
    legIndex: a.legIndex,
  };
};

/** Index of the leg that `traveled` meters falls inside. */
export const legIndexAt = (legs: Leg[], traveled: number): number => {
  for (let i = 0; i < legs.length; i++) {
    if (traveled < legs[i].endTraveled) return i;
  }
  return Math.max(legs.length - 1, 0);
};

export type Place = {
  name: string;
  /** ISO 3166-1 alpha-2 code, or an empty string when the data has none. */
  country: string;
  lng: number;
  lat: number;
  kind: "city" | "country";
};

/** The same points the label layers draw, reused to name what the user clicks. */
export type PlaceIndex = Place[];

const loadPoints = async (
  url: string,
  kind: Place["kind"],
): Promise<PlaceIndex> => {
  const collection: FeatureCollection<
    Point,
    { name: string; country?: string }
  > = await (await fetch(url)).json();

  return collection.features.map((feature) => ({
    name: feature.properties.name,
    // The country dataset marks unassigned territories with "-99".
    country:
      feature.properties.country && feature.properties.country.length === 2
        ? feature.properties.country
        : "",
    lng: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    kind,
  }));
};

/** Loads both label tiers into one index, cities first. */
export const loadPlaces = async (
  cityUrl: string,
  countryUrl: string,
): Promise<PlaceIndex> => {
  const [cities, countries] = await Promise.all([
    loadPoints(cityUrl, "city"),
    loadPoints(countryUrl, "country"),
  ]);
  return [...cities, ...countries];
};

/** Rough great-circle distance in kilometers — good enough to rank candidates. */
const roughDistanceKm = (
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number => {
  const dLat = b.lat - a.lat;
  const dLng =
    shortestAngleDelta(a.lng, b.lng) *
    Math.cos(degreeToRadian((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng) * 111.32;
};

/** How close a click has to land to borrow a place's name, per tier. */
const SNAP_RADIUS_KM = { city: 250, country: 1_200 };

const nearestPlace = (
  position: { lng: number; lat: number },
  places: PlaceIndex,
  kind: Place["kind"],
): { place: Place; km: number } | undefined => {
  let best: { place: Place; km: number } | undefined;
  for (const place of places) {
    if (place.kind !== kind) continue;
    const km = roughDistanceKm(position, place);
    if (!best || km < best.km) best = { place, km };
  }
  return best;
};

/**
 * Names a clicked point from the same place data the label layers draw: the
 * nearest city if there is one close by, otherwise the country it fell in, and
 * only then an anonymous waypoint. The click's exact position is always kept —
 * the place only supplies the name — so the route still goes where you pointed.
 */
export const stopAt = (
  position: { lng: number; lat: number },
  places: PlaceIndex,
  fallbackIndex: number,
): Stop => {
  const city = nearestPlace(position, places, "city");
  if (city && city.km < SNAP_RADIUS_KM.city) {
    return {
      name: city.place.name,
      country: city.place.country,
      lng: position.lng,
      lat: position.lat,
    };
  }

  const country = nearestPlace(position, places, "country");
  if (country && country.km < SNAP_RADIUS_KM.country) {
    return {
      name: country.place.name,
      country: country.place.country,
      lng: position.lng,
      lat: position.lat,
    };
  }

  return {
    name: `Waypoint ${fallbackIndex}`,
    country: `${position.lat.toFixed(1)}°, ${position.lng.toFixed(1)}°`,
    lng: position.lng,
    lat: position.lat,
  };
};

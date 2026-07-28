import type ThreeView from "@navaramap/three";
import {
  Color,
  degreeToRadian,
  eastNorthUpToFixedFrame,
  fetchFontFamilyFromCss,
  geodeticToVector3,
  radianToDegree,
  vector3ToGeodetic,
  type FeatureEvaluator,
  type Layer,
  type MeshHandle,
} from "@navaramap/three";
import type {
  AmbientLightDesc,
  GLTFModelDesc,
  SmoothLineMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { FeatureCollection, Point } from "geojson";
import { Matrix4, Vector3 } from "three";

import { GEOJSON_DATASETS, TERRAIN_DATASETS, TILE_DATASETS } from "./datasets";
import {
  DEFAULT_MODES,
  DEFAULT_STOPS,
  buildRoute,
  legIndexAt,
  loadPlaces,
  sampleRoute,
  shortestAngleDelta,
  stopAt,
  type PlaceIndex,
  type LegPlan,
  type Route,
  type Stop,
} from "./itinerary";
import {
  LABEL_ALTITUDE,
  LABEL_FONT,
  LABEL_FONT_CSS_URLS,
  LABEL_PRIORITY,
  countryLabel,
} from "./labels";
import { addPlanner } from "./ui";
import { DEFAULT_VEHICLE_ID, VEHICLES, vehicleById } from "./vehicles";

export type CustomDescriptions = DefaultDescriptions;

/** Travel time for the whole itinerary at 1× pace, excluding the stop pauses. */
const TRAVEL_DURATION_MS = 45_000;
/** How long the vehicle waits at an intermediate stop. */
const DWELL_MS = 1200;
const CHASE_PITCH = -22;
/**
 * Yaw offset of the chase camera from the course. Looking straight down the
 * route would project it onto a single screen column; the offset lets the line
 * sweep across the frame.
 */
const CHASE_YAW = 38;
/** Time constant of the camera heading damping, in milliseconds. */
const HEADING_DAMPING_MS = 400;
/** Two clicks closer together than this count as a double-click. */
const DOUBLE_CLICK_MS = 400;

/** Rotates a Y-up model so its up axis matches the tangent frame's up (+Z). */
const UPRIGHT = new Matrix4().makeRotationX(Math.PI / 2);

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);

  await view.init();

  // The trail grows and the vehicle moves every frame, so the view must render
  // continuously instead of only when the camera or the data changes.
  view.animation = true;

  // One family, many faces: Latin/CJK/Indic/… for the place names plus the
  // COLRv1 emoji subsets that carry the country flags. The FontManager picks
  // the face per codepoint and downloads only the subsets in use.
  view.addFontFamily(
    await fetchFontFamilyFromCss(LABEL_FONT, LABEL_FONT_CSS_URLS),
  );

  defaultPlugin.addDefaultPhotorealScene();

  // The photoreal scene lights the models with the sun alone, which leaves the
  // vehicle a silhouette whenever the trip runs across the night side. An
  // ambient fill keeps it readable without flattening the daylit half.
  view.addLight<AmbientLightDesc>({
    ambient: { color: new Color().setStyle("#9fb6d8"), intensity: 10 },
  });

  // Terrain first, then the imagery draped over it — layer render order is add
  // order. Quantized mesh carries real relief, so the route crosses actual
  // mountains rather than a smooth ellipsoid.
  const terrain = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN_DATASETS.reearthQuantizedMesh.url,
    maxZoom: 18,
    requestVertexNormals: true,
    requestWaterMask: true,
  });
  view.addLayer({ type: "terrain", source: terrain });

  const imagery = view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.eox.url,
    maxZoom: 15,
  });
  view.addLayer({ type: "raster", source: imagery });

  // Place labels, coarse to fine. Both tiers read their text from feature
  // properties of a plain GeoJSON point source, so the evaluator is what turns
  // data into strings.
  //
  // A tier is switched by adding and deleting its layer rather than by
  // returning `show: false` from the evaluator: re-evaluating every feature
  // makes the labels flicker, while the sources stay alive and reference
  // counted, so re-adding a layer restyles cached data instead of refetching.
  const countrySource = view.addSource({
    type: "geojson",
    url: GEOJSON_DATASETS.countryLabels.url,
  });
  const citySource = view.addSource({
    type: "geojson",
    url: GEOJSON_DATASETS.worldCities.url,
  });

  let countryLabelLayer: Layer | undefined;
  let cityLabelLayer: Layer | undefined;
  let countriesEnabled = true;
  let citiesEnabled = true;

  const addCountryLabels = () => {
    const layer = view.addLayer({
      type: "vector",
      source: countrySource,
      text: {
        font: LABEL_FONT,
        color: new Color().setStyle("#ffffff"),
        size: 17,
        sizeInMeters: false,
        center: { x: 0.5, y: 0.5 },
        outlineColor: new Color().setStyle("#04070f"),
        outlineWidth: 5,
        outlineOpacity: 0.55,
        declutterPriority: LABEL_PRIORITY.country,
        offsetDepth: true,
        depthTest: true,
        maxWidth: 3,
      },
    });
    layer.on(
      "featureUpdated",
      ({ evaluator }: { evaluator: FeatureEvaluator }) => {
        // The flag comes from the ISO 3166-1 code; the emoji face in the family
        // resolves the two regional-indicator codepoints into one glyph.
        evaluator.evaluate(
          ({ properties }) => ({
            text: countryLabel(properties),
            show: true,
          }),
          { filters: ["name", "country"] },
        );
      },
    );
    return layer;
  };

  const addCityLabels = () => {
    const layer = view.addLayer({
      type: "vector",
      source: citySource,
      text: {
        font: LABEL_FONT,
        color: new Color().setStyle("#cfe4f5"),
        size: 13,
        sizeInMeters: false,
        center: { x: 0.5, y: 0.5 },
        outlineColor: new Color().setStyle("#04070f"),
        outlineWidth: 4,
        outlineOpacity: 0.55,
        declutterPriority: LABEL_PRIORITY.city,
        offsetDepth: true,
        depthTest: true,
      },
    });
    layer.on(
      "featureUpdated",
      ({ evaluator }: { evaluator: FeatureEvaluator }) => {
        evaluator.evaluate(
          ({ properties }) => ({
            text: String(properties?.["name"] ?? ""),
            show: true,
          }),
          { filters: ["name"] },
        );
      },
    );
    return layer;
  };

  /**
   * Adds or deletes each label layer to match the camera altitude and the
   * tier's toggle. Safe to call every frame: the layers only change when a
   * tier crosses its threshold.
   */
  const refreshLabelTiers = () => {
    const { height } = view.camera.positionGeographic;
    const wantCountries =
      countriesEnabled && height > LABEL_ALTITUDE.countryMinHeight;
    const wantCities = citiesEnabled && height < LABEL_ALTITUDE.cityMaxHeight;

    if (wantCountries && !countryLabelLayer)
      countryLabelLayer = addCountryLabels();
    else if (!wantCountries && countryLabelLayer) {
      countryLabelLayer.delete();
      countryLabelLayer = undefined;
    }

    if (wantCities && !cityLabelLayer) cityLabelLayer = addCityLabels();
    else if (!wantCities && cityLabelLayer) {
      cityLabelLayer.delete();
      cityLabelLayer = undefined;
    }
  };
  refreshLabelTiers();

  // The same two datasets the label layers draw, reused to name clicked points.
  const places: PlaceIndex = await loadPlaces(
    GEOJSON_DATASETS.worldCities.url,
    GEOJSON_DATASETS.countryLabels.url,
  );

  const stops: Stop[] = [...DEFAULT_STOPS];
  /** One plan per leg — `plans[i]` carries the trip from stop i to stop i+1. */
  const plans: LegPlan[] = DEFAULT_MODES.map((vehicleId) => ({
    vehicleId,
    speed: 1,
  }));

  const stopsGeoJson = (): FeatureCollection<Point, { name: string }> => ({
    type: "FeatureCollection",
    features: stops.map((stop) => ({
      type: "Feature",
      properties: { name: stop.name },
      geometry: { type: "Point", coordinates: [stop.lng, stop.lat] },
    })),
  });

  // One source feeds both the pins and the stop labels — the geometry is
  // tessellated once, then styled by two layers.
  const stopsSource = view.addSource({ type: "geojson", data: stopsGeoJson() });
  view.addLayer({
    type: "vector",
    source: stopsSource,
    billboard: {
      url: "/pin.png",
      color: new Color().setStyle("#ffffff"),
      // Screen-space size, so the pins read from orbit and from the low chase
      // camera alike.
      size: 40,
      sizeInMeters: false,
      center: { x: 0, y: -0.5 },
      transparent: true,
      declutter: false,
      clampToGround: true,
    },
  });
  view
    .addLayer({
      type: "vector",
      source: stopsSource,
      text: {
        text: "",
        font: LABEL_FONT,
        color: new Color().setStyle("#ffffff"),
        size: 22,
        sizeInMeters: false,
        declutterPriority: LABEL_PRIORITY.stop,
        center: { x: 0.5, y: 0.5 },
        outlineColor: new Color().setStyle("#04070f"),
        outlineWidth: 4,
        clampToGround: true,
        maxWidth: 3,
      },
    })
    .on("featureUpdated", ({ evaluator }) => {
      // Labels driven by feature properties need both `text` and `show: true` —
      // returning only `text` leaves every label hidden.
      evaluator.evaluate(
        ({ properties }) => ({
          text: String(properties?.["name"] ?? ""),
          show: true,
        }),
        { filters: ["name"] },
      );
    });

  // The planned itinerary, drawn faintly so the route ahead stays readable.
  const plannedRoute = view.addMesh<SmoothLineMeshDesc>({
    smoothLines: {
      points: [],
      segments: 1,
      lineWidth: 2,
      color: 0x4cc9ff,
      showPoints: false,
      dashed: true,
      dashSize: 120_000,
      gapSize: 120_000,
    },
  });

  // The part already travelled.
  const trail = view.addMesh<SmoothLineMeshDesc>({
    smoothLines: {
      points: [],
      segments: 1,
      lineWidth: 6,
      color: 0xffffff,
      showPoints: false,
    },
  });

  let modelScale = 1;
  let model: MeshHandle<GLTFModelDesc> | undefined;
  let modelVehicleId: string | undefined;

  const scaleOf = (vehicleId: string) => {
    const size = vehicleById(vehicleId).scale * modelScale;
    return { x: size, y: size, z: size };
  };

  /** Loads the model for `vehicleId`, replacing the previous one if it differs. */
  const loadVehicleModel = (vehicleId: string) => {
    if (modelVehicleId === vehicleId) return;
    modelVehicleId = vehicleId;

    const vehicle = vehicleById(vehicleId);
    model?.delete();
    model = view.addMesh<GLTFModelDesc>({
      gltfModel: {
        url: vehicle.dataset.url,
        animationEnabled: vehicle.clip !== undefined,
        animationActiveClip: vehicle.clip,
        animationAutoPlay: vehicle.clip !== undefined,
        animationLoop: true,
      },
      scale: scaleOf(vehicleId),
    });
  };

  let route: Route = { path: [], legs: [], totalDistance: 0 };
  let traveled = 0;
  let legIndex = 0;
  let dwellRemaining = 0;
  let playing = false;
  let following = true;
  let cameraHeading = 0;
  let clock = 0;
  let prevTime: number | undefined;

  const place = () => {
    if (route.path.length === 0 || !model) return;
    const at = sampleRoute(route.path, traveled);
    const vehicle = vehicleById(route.legs[at.legIndex].vehicleId);

    // Slice the precomputed path at the last sample passed and append the exact
    // current position, so the tip of the trail tracks the vehicle smoothly.
    trail.update({
      smoothLines: {
        points: [
          ...route.path.slice(0, at.index + 1),
          { lng: at.lng, lat: at.lat, height: at.height },
        ],
      },
    });

    // Route heights are above the ellipsoid, so on real terrain a ground
    // vehicle would drive through hillsides. Sampling is synchronous and only
    // needed for the one point the vehicle occupies (`undefined` until the
    // tile under it has loaded).
    const ground =
      view.sampleTerrainHeight({
        lat: degreeToRadian(at.lat),
        lng: degreeToRadian(at.lng),
        height: 0,
      }) ?? 0;
    // The models are centred on their bounding box, so the origin has to clear
    // the surface by the model's own half-height — otherwise a parked plane is
    // buried to the wings. The clearance grows with the size slider.
    const height = at.height + ground + vehicle.groundClearance * modelScale;

    // Mesh placement is Cartesian: an ECEF `position` alone would leave the
    // model lying on its side. Setting `matrixWorld` to the local east-north-up
    // frame at the vehicle's position makes it stand upright; every rotation
    // after that is expressed inside that frame.
    const frame = eastNorthUpToFixedFrame(
      geodeticToVector3({
        lat: degreeToRadian(at.lat),
        lng: degreeToRadian(at.lng),
        height,
      }),
    );
    // Read right-to-left, the order the vertices travel through: `noseYaw`
    // turns the model's nose to +Z, `pitch` tips it along the climb of the arc,
    // `bank` rolls it into the turn, `UPRIGHT` stands the Y-up model on the
    // frame, and `course` swings the whole thing onto the current heading.
    const noseYaw = new Matrix4().makeRotationY(
      degreeToRadian(vehicle.noseYaw),
    );
    const pitch = new Matrix4().makeRotationX(
      degreeToRadian(
        -at.climb +
          vehicle.bobDegrees * Math.sin(clock * vehicle.bobHz * Math.PI * 2),
      ),
    );
    const bank = new Matrix4().makeRotationZ(
      degreeToRadian(at.turnRate * vehicle.bankDegrees),
    );
    const course = new Matrix4().makeRotationZ(
      Math.PI - degreeToRadian(at.heading),
    );
    model.update({
      matrixWorld: frame
        .multiply(course)
        .multiply(UPRIGHT)
        .multiply(bank)
        .multiply(pitch)
        .multiply(noseYaw),
    });

    if (following) {
      // `distance` sets the camera back along its forward ray from the target,
      // so the vehicle stays centred while the heading follows the course.
      view.setCamera({
        lng: at.lng,
        lat: at.lat,
        height,
        heading: cameraHeading + CHASE_YAW,
        pitch: CHASE_PITCH,
        roll: 0,
        distance: vehicle.chaseDistance,
      });
    }

    const leg = route.legs[at.legIndex];
    planner.renderProgress(
      traveled / 1000,
      traveled / route.totalDistance,
      `${leg.from.name} → ${leg.to.name}`,
    );
  };

  const renderTrip = () =>
    planner.renderTrip(
      stops,
      route.legs.map((leg) => ({
        vehicleId: leg.vehicleId,
        speed: leg.speed,
        distanceKm: leg.distance / 1000,
      })),
      legIndex,
    );

  /**
   * Rebuilds the route from the current stops and leg plans. By default the
   * vehicle keeps the ground it has already covered — editing the itinerary
   * mid-journey must not snap the camera back to the first stop. `rewind`
   * restarts from the beginning instead (Replay, Clear).
   */
  const rebuild = ({ rewind = false, keepPlaying = false } = {}) => {
    // Every gap between two stops needs a plan; new gaps inherit the default.
    while (plans.length < Math.max(stops.length - 1, 0))
      plans.push({ vehicleId: DEFAULT_VEHICLE_ID, speed: 1 });
    plans.length = Math.max(stops.length - 1, 0);

    route = buildRoute(stops, plans, (id) => {
      const vehicle = vehicleById(id);
      return { ratio: vehicle.arcRatio, maxHeight: vehicle.maxArcHeight };
    });

    if (rewind) {
      traveled = 0;
      playing = keepPlaying && route.path.length > 0;
    } else {
      traveled = Math.min(traveled, route.totalDistance);
      playing = playing && route.path.length > 0;
    }
    legIndex = legIndexAt(route.legs, traveled);
    dwellRemaining = 0;
    planner.setPlaying(playing);
    renderTrip();

    plannedRoute.update({ smoothLines: { points: route.path } });

    if (route.path.length === 0) {
      trail.update({ smoothLines: { points: [] } });
      planner.renderProgress(
        0,
        0,
        stops.length ? "Add another stop" : "Empty trip",
      );
      return;
    }

    if (rewind) cameraHeading = route.path[0].heading;
    loadVehicleModel(route.legs[legIndex].vehicleId);
    place();
  };

  /**
   * Pushes the edited stop list into the source, then rebuilds. Updating a
   * source reloads every layer referencing it, so this runs only when the stops
   * really changed — not when a leg merely swaps vehicle or speed.
   */
  const rebuildWithStops = (options?: { rewind?: boolean }) => {
    stopsSource.update({ data: stopsGeoJson() });
    rebuild(options);
  };

  const planner = addPlanner(VEHICLES, modelScale, {
    onSelectLegVehicle: (index, vehicleId) => {
      plans[index].vehicleId = vehicleId;
      // The arc profile belongs to the vehicle, so the route changes shape too.
      rebuild();
    },
    onSelectLegSpeed: (index, speed) => {
      // Pace only — no need to resample the geometry.
      plans[index].speed = speed;
      route.legs[index].speed = speed;
    },
    onModelScale: (factor) => {
      modelScale = factor;
      if (!modelVehicleId) return;
      model?.update({ scale: scaleOf(modelVehicleId) });
      // A bigger model needs more ground clearance, which `place` applies.
      place();
    },
    onRemoveStop: (index) => {
      stops.splice(index, 1);
      // Drop the leg that led into the removed stop, keeping the rest aligned.
      plans.splice(Math.max(index - 1, 0), 1);
      rebuildWithStops();
    },
    onClear: () => {
      stops.length = 0;
      plans.length = 0;
      rebuildWithStops({ rewind: true });
    },
    onTogglePlay: () => {
      if (route.path.length === 0) return false;
      if (traveled >= route.totalDistance) rebuild({ rewind: true });
      playing = !playing;
      return playing;
    },
    onReplay: () => rebuild({ rewind: true, keepPlaying: true }),
    onToggleFollow: () => {
      following = !following;
      return following;
    },
    onToggleCountryLabels: () => {
      countriesEnabled = !countriesEnabled;
      refreshLabelTiers();
      return countriesEnabled;
    },
    onToggleCityLabels: () => {
      citiesEnabled = !citiesEnabled;
      refreshLabelTiers();
      return citiesEnabled;
    },
  });

  // Double-clicking the globe appends a stop; single clicks stay free for the
  // camera controls. `event.map` is the ECEF point under the cursor, so it
  // converts straight back to geodetic degrees.
  let lastClickAt = 0;
  view.on("click", (event) => {
    const now = event.timeStamp;
    const isDoubleClick = now - lastClickAt < DOUBLE_CLICK_MS;
    lastClickAt = now;
    if (!isDoubleClick) return;
    lastClickAt = 0;

    const geodetic = vector3ToGeodetic(
      new Vector3(event.map.x, event.map.y, event.map.z),
    );
    stops.push(
      stopAt(
        {
          lng: radianToDegree(geodetic.lng),
          lat: radianToDegree(geodetic.lat),
        },
        places,
        stops.length + 1,
      ),
    );
    rebuildWithStops();
  });

  rebuild({ rewind: true });

  const step = (time: number) => {
    // Advance by wall-clock time (capped, so a suspended tab does not jump),
    // never by a fixed per-frame amount.
    const elapsed = prevTime === undefined ? 0 : Math.min(time - prevTime, 100);
    prevTime = time;

    // Cheap every frame: reading the camera height is a getter, and the layers
    // are only restyled when a tier crosses its threshold.
    refreshLabelTiers();

    if (playing && route.path.length > 0) {
      clock += elapsed / 1000;
      // Base pace covers the whole itinerary in TRAVEL_DURATION_MS; each leg
      // then scales it by its own slider.
      const speed =
        (route.totalDistance / TRAVEL_DURATION_MS) * route.legs[legIndex].speed;

      if (dwellRemaining > 0) {
        dwellRemaining -= elapsed;
      } else {
        const next = traveled + speed * elapsed;
        const boundary = route.legs[legIndex].endTraveled;
        if (next >= boundary && legIndex < route.legs.length - 1) {
          // Land at the stop exactly, then wait there before the next leg —
          // which may well be travelled by a different vehicle.
          traveled = boundary;
          legIndex++;
          dwellRemaining = DWELL_MS;
          loadVehicleModel(route.legs[legIndex].vehicleId);
          renderTrip();
        } else {
          traveled = Math.min(next, route.totalDistance);
        }
      }

      cameraHeading +=
        shortestAngleDelta(
          cameraHeading,
          sampleRoute(route.path, traveled).heading,
        ) * Math.min(elapsed / HEADING_DAMPING_MS, 1);

      place();

      if (traveled >= route.totalDistance) {
        playing = false;
        planner.setPlaying(false);
      }
    }

    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);

  view.attribution?.add([
    TERRAIN_DATASETS.reearthQuantizedMesh,
    TILE_DATASETS.eox,
    GEOJSON_DATASETS.countryLabels,
    GEOJSON_DATASETS.worldCities,
    ...VEHICLES.map((vehicle) => vehicle.dataset),
  ]);
};

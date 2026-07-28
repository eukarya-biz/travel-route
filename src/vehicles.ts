import { LOCAL_DATASETS, type Dataset } from "./datasets";

/**
 * A vehicle that can be assigned to one leg of the trip. Everything here is
 * per-model tuning: how big it has to be drawn to read at globe scale, which
 * way its nose points in model space, whether the leg arcs through the air or
 * hugs the surface, and how it moves while travelling.
 */
export type Vehicle = {
  id: string;
  label: string;
  /** Model source and its credit, shown in the attribution UI. */
  dataset: Dataset & { attribution: string };
  /** Uniform scale applied inside the local tangent frame. */
  scale: number;
  /**
   * Yaw in degrees about the model's own up axis (+Y) that turns its nose to
   * +Z. Everything downstream — course, climb, bank — assumes a nose-forward,
   * Y-up model, so this is the only per-model orientation knob.
   */
  noseYaw: number;
  /** Clip played while travelling; models without animations leave it unset. */
  clip?: string;
  /**
   * Cruise altitude as a fraction of the leg's ground distance. Above zero the
   * leg arcs through the air; at zero it follows the curvature of the globe.
   */
  arcRatio: number;
  /** Cruise altitude cap in meters, so long legs do not leave the atmosphere. */
  maxArcHeight: number;
  /** How far behind the vehicle the chase camera sits, in meters. */
  chaseDistance: number;
  /**
   * Meters the model's origin has to sit above the surface for the model to
   * rest on it — most of these models are centred on their own bounding box,
   * so at a sea-level stop the lower half would otherwise be underground.
   * Measured at the vehicle's own `scale`, then scaled with the size slider.
   */
  groundClearance: number;
  /** Peak roll in degrees when the course turns — banking for aircraft. */
  bankDegrees: number;
  /** Peak pitch in degrees of the idle bob, and how fast it cycles in Hz. */
  bobDegrees: number;
  bobHz: number;
};

const GROUND = { arcRatio: 0, maxArcHeight: 0, chaseDistance: 110_000 };

export const VEHICLES: Vehicle[] = [
  {
    id: "plane",
    label: "✈️ Plane",
    dataset: LOCAL_DATASETS.travelPlaneGLTF,
    scale: 8,
    noseYaw: 0,
    arcRatio: 0.12,
    maxArcHeight: 700_000,
    chaseDistance: 140_000,
    groundClearance: 1_730,
    bankDegrees: 30,
    bobDegrees: 0,
    bobHz: 0,
  },
  {
    id: "ship",
    label: "🚢 Ship",
    dataset: LOCAL_DATASETS.travelShipGLTF,
    scale: 700,
    noseYaw: 90,
    ...GROUND,
    // Less than the keel depth, so the hull sits in the water rather than on it.
    groundClearance: 400,
    bankDegrees: 4,
    bobDegrees: 3,
    bobHz: 0.35,
  },
  {
    id: "train",
    label: "🚂 Train",
    dataset: LOCAL_DATASETS.travelTrainGLTF,
    scale: 1_400,
    noseYaw: 90,
    ...GROUND,
    groundClearance: 0,
    bankDegrees: 2,
    bobDegrees: 0.6,
    bobHz: 2.4,
  },
  {
    id: "car",
    label: "🚗 Car",
    dataset: LOCAL_DATASETS.travelCarGLTF,
    scale: 3_000,
    noseYaw: 0,
    ...GROUND,
    groundClearance: 90,
    bankDegrees: 6,
    bobDegrees: 1.2,
    bobHz: 3,
  },
  {
    id: "person",
    label: "🚶 Walk",
    dataset: LOCAL_DATASETS.soldierGLTF,
    scale: 6_000,
    noseYaw: 180,
    clip: "Run",
    ...GROUND,
    groundClearance: 0,
    bankDegrees: 0,
    bobDegrees: 0,
    bobHz: 0,
  },
];

export const DEFAULT_VEHICLE_ID = "plane";

export const vehicleById = (id: string): Vehicle =>
  VEHICLES.find((vehicle) => vehicle.id === id) ?? VEHICLES[0];

/**
 * DOM chrome for the travel-route example: a trip planner listing the stops
 * with a vehicle picker and a speed slider on every leg between them, a model
 * size slider, and playback controls.
 *
 * Presentation only — every Navara API call stays in run.ts.
 */

import type { Stop } from "./itinerary";
import { flagFor } from "./labels";
import type { Vehicle } from "./vehicles";

const CSS = `
.trip-panel {
  position: fixed;
  top: 20px;
  left: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 300px;
  max-height: calc(100vh - 40px);
  padding: 16px;
  color: #fff;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  background: rgba(11, 13, 20, 0.74);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
  user-select: none;
}
.trip-panel[data-collapsed="true"] {
  width: auto;
  gap: 0;
  padding: 10px 14px;
}
.trip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  padding: 0;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  background: none;
  border: none;
  cursor: pointer;
}
.trip-header:hover {
  color: rgba(255, 255, 255, 0.85);
}
.trip-header__chevron {
  font-size: 10px;
  letter-spacing: 0;
  transition: transform 120ms ease;
}
.trip-panel[data-collapsed="true"] .trip-header__chevron {
  transform: rotate(-90deg);
}
.trip-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.trip-panel[data-collapsed="true"] .trip-body {
  display: none;
}
.trip-itinerary {
  display: flex;
  flex-direction: column;
  /* Takes the slack inside the panel's max-height; min-height: 0 is what lets
     a flex child actually shrink far enough for overflow to kick in. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.trip-stop {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
}
.trip-stop--active {
  background: rgba(76, 201, 255, 0.24);
}
.trip-stop__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4cc9ff;
}
.trip-stop__name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trip-stop__country {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
.trip-stop__remove {
  padding: 0 2px;
  font: inherit;
  color: rgba(255, 255, 255, 0.4);
  background: none;
  border: none;
  cursor: pointer;
}
.trip-stop__remove:hover {
  color: #ff8080;
}
.trip-leg {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  padding: 4px 8px 5px 11px;
  margin-left: 3px;
  border-left: 2px dashed rgba(255, 255, 255, 0.22);
}
.trip-leg--active {
  border-left-color: #4cc9ff;
}
.trip-leg select {
  padding: 3px 6px;
  font: inherit;
  font-size: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  cursor: pointer;
}
.trip-leg select option {
  color: #111;
}
.trip-leg__distance {
  align-self: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.4);
}
.trip-leg input[type="range"],
.trip-field input[type="range"] {
  width: 100%;
  height: 14px;
  accent-color: #4cc9ff;
  cursor: pointer;
}
.trip-leg__speed {
  align-self: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.55);
}
.trip-field {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  align-items: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
.trip-field label {
  grid-column: 1 / -1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.38);
}
.trip-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.42);
}
.trip-progress {
  height: 3px;
  background: rgba(255, 255, 255, 0.16);
  border-radius: 2px;
  overflow: hidden;
}
.trip-progress__bar {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #4cc9ff, #b98bff);
}
.trip-readout {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.62);
}
.trip-buttons {
  display: flex;
  gap: 6px;
}
.trip-button {
  flex: 1 1 auto;
  padding: 7px 0;
  font: inherit;
  font-size: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  cursor: pointer;
}
.trip-button:hover {
  background: rgba(255, 255, 255, 0.16);
}
.trip-button[aria-pressed="true"] {
  color: #06111c;
  background: #4cc9ff;
  border-color: #4cc9ff;
}
`;

export type PlannerCallbacks = {
  onSelectLegVehicle: (legIndex: number, vehicleId: string) => void;
  onSelectLegSpeed: (legIndex: number, speed: number) => void;
  onModelScale: (factor: number) => void;
  onRemoveStop: (index: number) => void;
  onClear: () => void;
  onTogglePlay: () => boolean;
  onReplay: () => void;
  onToggleFollow: () => boolean;
  onToggleCountryLabels: () => boolean;
  onToggleCityLabels: () => boolean;
};

export type LegSummary = {
  vehicleId: string;
  speed: number;
  distanceKm: number;
};

export type Planner = {
  /** Redraws the itinerary; `activeLeg` is highlighted as the current hop. */
  renderTrip: (stops: Stop[], legs: LegSummary[], activeLeg: number) => void;
  /** Reflects playback: kilometres covered, progress 0–1 and the current hop. */
  renderProgress: (km: number, progress: number, label: string) => void;
  setPlaying: (playing: boolean) => void;
};

export const addPlanner = (
  vehicles: Vehicle[],
  modelScale: number,
  callbacks: PlannerCallbacks,
): Planner => {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "trip-panel";
  panel.dataset["collapsed"] = "false";
  panel.innerHTML = `
    <button class="trip-header" data-toggle aria-expanded="true">
      <span>Plan your trip</span><span class="trip-header__chevron">▼</span>
    </button>
    <div class="trip-body">
      <div class="trip-itinerary" data-itinerary></div>
      <p class="trip-hint">Double-click the globe to add a stop, then pick the vehicle and pace of each leg.</p>
      <div class="trip-field">
        <label for="trip-model-scale">Model size</label>
        <input id="trip-model-scale" type="range" min="0.3" max="3" step="0.1" value="${modelScale}" data-scale />
        <span data-scale-value></span>
      </div>
      <div class="trip-progress"><div class="trip-progress__bar" data-bar></div></div>
      <div class="trip-readout"><span data-leg></span><span data-distance></span></div>
      <div class="trip-buttons">
        <button class="trip-button" data-play></button>
        <button class="trip-button" data-replay>Replay</button>
        <button class="trip-button" data-follow aria-pressed="true">Follow</button>
        <button class="trip-button" data-clear>Clear</button>
      </div>
      <div class="trip-buttons">
        <button class="trip-button" data-countries aria-pressed="true">Countries</button>
        <button class="trip-button" data-cities aria-pressed="true">Cities</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Collapsing hides the body but keeps the panel mounted, so playback and
  // every callback keep running while the globe is unobstructed.
  const toggle = panel.querySelector("[data-toggle]") as HTMLButtonElement;
  toggle.onclick = () => {
    const collapsed = panel.dataset["collapsed"] !== "true";
    panel.dataset["collapsed"] = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };

  const query = <T extends HTMLElement>(selector: string) =>
    panel.querySelector(selector) as T;
  const itinerary = query<HTMLDivElement>("[data-itinerary]");
  const bar = query<HTMLDivElement>("[data-bar]");
  const legLabel = query<HTMLSpanElement>("[data-leg]");
  const distanceLabel = query<HTMLSpanElement>("[data-distance]");
  const play = query<HTMLButtonElement>("[data-play]");
  const scale = query<HTMLInputElement>("[data-scale]");
  const scaleValue = query<HTMLSpanElement>("[data-scale-value]");

  const showScale = () => {
    scaleValue.textContent = `${Number(scale.value).toFixed(1)}×`;
  };
  scale.oninput = () => {
    showScale();
    callbacks.onModelScale(Number(scale.value));
  };
  showScale();

  const setPlaying = (playing: boolean) => {
    play.textContent = playing ? "Pause" : "Play";
  };

  play.onclick = () => setPlaying(callbacks.onTogglePlay());
  query<HTMLButtonElement>("[data-replay]").onclick = () =>
    callbacks.onReplay();
  query<HTMLButtonElement>("[data-clear]").onclick = () => callbacks.onClear();
  const countryLabels = query<HTMLButtonElement>("[data-countries]");
  countryLabels.onclick = () =>
    countryLabels.setAttribute(
      "aria-pressed",
      String(callbacks.onToggleCountryLabels()),
    );
  const cityLabels = query<HTMLButtonElement>("[data-cities]");
  cityLabels.onclick = () =>
    cityLabels.setAttribute(
      "aria-pressed",
      String(callbacks.onToggleCityLabels()),
    );
  const follow = query<HTMLButtonElement>("[data-follow]");
  follow.onclick = () =>
    follow.setAttribute("aria-pressed", String(callbacks.onToggleFollow()));
  setPlaying(false);

  const stopRow = (stop: Stop, index: number, active: boolean) => {
    const row = document.createElement("div");
    row.className = `trip-stop${active ? " trip-stop--active" : ""}`;

    const dot = document.createElement("span");
    dot.className = "trip-stop__dot";

    const name = document.createElement("span");
    name.className = "trip-stop__name";
    name.textContent = stop.name;

    const country = document.createElement("span");
    country.className = "trip-stop__country";
    // A two-letter code gets its flag; anonymous waypoints show coordinates.
    const flag = flagFor(stop.country);
    country.textContent = flag ? `${flag} ${stop.country}` : stop.country;

    const remove = document.createElement("button");
    remove.className = "trip-stop__remove";
    remove.textContent = "✕";
    remove.title = `Remove ${stop.name}`;
    remove.onclick = () => callbacks.onRemoveStop(index);

    row.append(dot, name, country, remove);
    return row;
  };

  const legRow = (leg: LegSummary, index: number, active: boolean) => {
    const row = document.createElement("div");
    row.className = `trip-leg${active ? " trip-leg--active" : ""}`;

    const select = document.createElement("select");
    for (const vehicle of vehicles) {
      const option = document.createElement("option");
      option.value = vehicle.id;
      option.textContent = vehicle.label;
      option.selected = vehicle.id === leg.vehicleId;
      select.appendChild(option);
    }
    select.onchange = () => callbacks.onSelectLegVehicle(index, select.value);

    const distance = document.createElement("span");
    distance.className = "trip-leg__distance";
    distance.textContent = `${Math.round(leg.distanceKm).toLocaleString("en-US")} km`;

    const speed = document.createElement("input");
    speed.type = "range";
    speed.min = "0.25";
    speed.max = "4";
    speed.step = "0.05";
    speed.value = String(leg.speed);
    speed.title = "Speed of this leg";

    const speedValue = document.createElement("span");
    speedValue.className = "trip-leg__speed";
    const showSpeed = () => {
      speedValue.textContent = `${Number(speed.value).toFixed(2)}×`;
    };
    showSpeed();
    speed.oninput = () => {
      showSpeed();
      callbacks.onSelectLegSpeed(index, Number(speed.value));
    };

    row.append(select, distance, speed, speedValue);
    return row;
  };

  return {
    renderTrip: (stops, legs, activeLeg) => {
      itinerary.replaceChildren();
      stops.forEach((stop, index) => {
        itinerary.appendChild(
          stopRow(stop, index, index === activeLeg || index === activeLeg + 1),
        );
        if (index < legs.length)
          itinerary.appendChild(
            legRow(legs[index], index, index === activeLeg),
          );
      });
    },
    renderProgress: (km, progress, label) => {
      bar.style.width = `${(progress * 100).toFixed(1)}%`;
      legLabel.textContent = label;
      distanceLabel.textContent = `${Math.round(km).toLocaleString("en-US")} km`;
    },
    setPlaying,
  };
};

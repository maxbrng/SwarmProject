"use client";

import { memo, useEffect, useState } from "react";
import {
  BoidsConfig,
  DeathMode,
  SeedMode,
  BirthMode,
  DominanceMode,
  RGB,
  DEFAULT_CONFIG,
  MAX_COUNT,
  MAX_SPECIES,
} from "@/webgpu/boids/config";
import ColorSwatch from "./ColorSwatch";

interface Props {
  onChange: (partial: Partial<BoidsConfig>) => void;
  /** Bumped when a preset / reset is applied → re-sync this panel's sliders, modes and colors. */
  sync?: { nonce: number; cfg: Partial<BoidsConfig> } | null;
  /** Accordion state — controlled by the parent so only one settings section is open at a time. */
  open: boolean;
  onToggle: () => void;
}

type NumericKey = Exclude<
  keyof BoidsConfig,
  | "background"
  | "deathMode"
  | "seedMode"
  | "birthMode"
  | "dominanceMode"
  | "speciesColors"
  | "terrainEnabled"
  | "terrainValley"
  | "terrainMid"
  | "terrainPeak"
  | "terrainSnow"
  | "terrainTool"
  | "rescueEnabled"
  | "rescueRestart"
>;

// ── color helpers (linear rgb 0..1 ↔ #rrggbb) ──────────────────────────────────
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function rgbToHex(c: RGB): string {
  const h = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}
function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const cloneColors = (cs: RGB[]): RGB[] => cs.map((c) => [c[0], c[1], c[2]] as RGB);

type Group = "count" | "swarm" | "population" | "dynamics" | "rescue";

const BIRTH_MODES: { value: BirthMode; label: string; title: string }[] = [
  { value: "off", label: "Off", title: "No respawning → species can truly go extinct." },
  { value: "constant", label: "Constant", title: "Steady random trickle of new boids." },
  {
    value: "adaptive",
    label: "Adaptive",
    title: "New boids spawn inside the nearest swarm; a bigger swarm means a higher birth rate.",
  },
  {
    value: "homeland",
    label: "Homeland",
    title: "Each species has a home region where its offspring are born and which it defends.",
  },
];

interface SliderDef {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  group: Group;
  title: string;
  /** Optional human-readable value display (overrides the raw number). */
  display?: (v: number) => string;
  /** Optional transform config→slider position (for sliders in different units). */
  toSlider?: (configValue: number) => number;
  /** Optional transform slider position→config value. */
  fromSlider?: (sliderValue: number) => number;
}

// screen-relative percentage (sim height = 2 units → v/2*100)
const pct = (d = 0) => (v: number) => `${(v * 50).toFixed(d)}%`;

const SLIDERS: SliderDef[] = [
  { key: "count", label: "Count (capacity)", min: 100, max: MAX_COUNT, step: 100, digits: 0, group: "count", title: "Maximum number of boids that can exist at once (GPU capacity). More = denser, but lower FPS." },
  { key: "maxSpeed", label: "Speed", min: 0.1, max: 1.5, step: 0.01, digits: 2, group: "swarm", title: "How fast the boids travel, as a share of the screen crossed per second.", display: (v) => `${(v * 50).toFixed(0)}%/s` },
  { key: "perception", label: "Vision range", min: 0.05, max: 0.6, step: 0.01, digits: 2, group: "swarm", title: "How far a boid sees its neighbors (share of screen height). Larger = fewer, bigger flocks.", display: pct(0) },
  { key: "separationDist", label: "Personal space", min: 0.01, max: 0.2, step: 0.005, digits: 3, group: "swarm", title: "How close others may get before a boid pushes away (share of screen height).", display: pct(1) },
  { key: "alignWeight", label: "Alignment", min: 0, max: 3, step: 0.05, digits: 2, group: "swarm", title: "How strongly a boid matches its neighbors' heading — this creates the flocking flow." },
  { key: "cohesionWeight", label: "Cohesion", min: 0, max: 3, step: 0.05, digits: 2, group: "swarm", title: "How strongly a boid steers toward the center of its neighbors." },
  { key: "separationWeight", label: "Separation", min: 0, max: 3, step: 0.05, digits: 2, group: "swarm", title: "How strongly a boid pushes away from very close neighbors." },
  { key: "declump", label: "Crowd relief", min: 0, max: 0.1, step: 0.005, digits: 3, group: "swarm", title: "Adds a gentle outward push that grows with how crowded a boid is, so dense clumps thin out — airier look and steadier FPS in heavy birth/death scenes (fewer boids packed into one grid cell). This range is deliberately small: even the top is subtle; beyond it the swarm gets too loose. 0 = off (original density).", display: (v) => (v === 0 ? "off" : `${Math.round((v / 0.1) * 100)}%`) },
  { key: "maxForce", label: "Agility", min: 0.1, max: 5, step: 0.05, digits: 2, group: "swarm", title: "Max steering force for cohesion/separation. Higher = snappier turns." },
  { key: "trailFade", label: "Trail length", min: 0.02, max: 1, step: 0.01, digits: 2, group: "population", title: "Length of the motion trails. Long tails ↔ almost none.", display: (v) => (v <= 0.05 ? "very long" : v >= 0.9 ? "none" : `${Math.round((1 - v) * 100)}%`) },
  { key: "boidScale", label: "Boid size", min: 0.002, max: 0.02, step: 0.0005, digits: 3, group: "population", title: "On-screen size of each boid (share of screen height).", display: pct(2) },
  { key: "colorIntensity", label: "Color intensity", min: 0.2, max: 1.6, step: 0.05, digits: 2, group: "population", title: "Overall brightness of the boids. Lower = dense swarms stay colorful instead of blowing out to white; higher = brighter, whiter peaks.", display: (v) => `${Math.round(v * 100)}%` },
  { key: "numSpecies", label: "Species", min: 1, max: MAX_SPECIES, step: 1, digits: 0, group: "population", title: "Number of species/populations (1 = a single peaceful flock, no predator-prey). Changing this restarts the ecosystem." },
  { key: "chaseWeight", label: "Chase drive", min: 0, max: 3, step: 0.05, digits: 2, group: "dynamics", title: "How strongly a predator pursues its prey species." },
  { key: "fleeWeight", label: "Flee drive", min: 0, max: 4, step: 0.05, digits: 2, group: "dynamics", title: "How strongly prey flees from its predator species." },
  { key: "killRadius", label: "Bite range", min: 0.005, max: 0.08, step: 0.005, digits: 3, group: "dynamics", title: "How close a predator must get to eat prey (share of screen height).", display: pct(1) },
  { key: "birthRate", label: "Birth rate", min: 0, max: 3, step: 0.05, digits: 2, group: "dynamics", title: "How fast well-fed parents reproduce inside their swarm (Energy mode). 0 = no births." },
  { key: "adaptiveStrength", label: "Adaptive strength", min: 0, max: 3, step: 0.1, digits: 1, group: "dynamics", title: "Adaptive reproduction only: how strongly smaller/shrinking swarms breed faster to recover. 0 = every swarm uses the same birth rate (small ones can die out); higher = strong catch-up.", display: (v) => (v === 0 ? "off (uniform)" : `${v.toFixed(1)}×`) },
  {
    key: "starveRate",
    label: "Lifespan (no food)",
    min: 3,
    max: 90,
    step: 1,
    digits: 0,
    group: "dynamics",
    title: "How long a boid survives without eating (Energy mode). Drag right = lives longer.",
    display: (v) => `${Math.round(1 / v)} s`,
    toSlider: (v) => Math.round(1 / v),
    fromSlider: (s) => 1 / Math.max(1, s),
  },
  { key: "rescueThreshold", label: "Rescue threshold", min: 5, max: 200, step: 5, digits: 0, group: "rescue", title: "Population below which a species counts as critically endangered and gets re-colonised from the refuge. Keep this LOW relative to the total count — it should only engage at the very brink, so populations can still crash and recover dramatically. Too high and every species sticks to this floor, which kills the oscillation.", display: (v) => `${Math.round(v)} boids` },
  { key: "rescueRate", label: "Rescue speed", min: 1, max: 60, step: 1, digits: 0, group: "rescue", title: "How fast the refuge sends individuals back in, in boids per second. Scaled by how deep the deficit is, so a species at zero recovers fastest and the inflow eases off near the threshold. Low = slow, visible re-colonisation; high = a species snaps back almost instantly.", display: (v) => `${Math.round(v)}/s` },
];

function ControlPanel({ onChange, sync, open, onToggle }: Props) {
  const [values, setValues] = useState<Record<NumericKey, number>>(() => {
    const v = {} as Record<NumericKey, number>;
    for (const s of SLIDERS) v[s.key] = DEFAULT_CONFIG[s.key];
    return v;
  });
  const [mode, setMode] = useState<DeathMode>(DEFAULT_CONFIG.deathMode);
  const [seedMode, setSeedModeState] = useState<SeedMode>(DEFAULT_CONFIG.seedMode);
  const [birthMode, setBirthModeState] = useState<BirthMode>(DEFAULT_CONFIG.birthMode);
  const [dominanceMode, setDomState] = useState<DominanceMode>(DEFAULT_CONFIG.dominanceMode);
  const [colors, setColors] = useState<RGB[]>(() => cloneColors(DEFAULT_CONFIG.speciesColors));
  const [rescueEnabled, setRescueEnabledState] = useState(DEFAULT_CONFIG.rescueEnabled);
  const [rescueRestart, setRescueRestartState] = useState(DEFAULT_CONFIG.rescueRestart);
  const [sections, setSections] = useState<Record<Group, boolean>>({
    swarm: true,
    count: true,
    population: true,
    dynamics: true,
    rescue: true,
  });

  // A preset / reset was applied → mirror its Swarm values (sliders, modes, colors) into this panel
  // (the sim is already updated by the parent). Guarded on the nonce so it only runs on apply.
  useEffect(() => {
    const cfg = sync?.cfg;
    if (!cfg) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: mirror the loaded preset into local UI state */
    setValues((prev) => {
      const nv = { ...prev };
      for (const s of SLIDERS) {
        const v = cfg[s.key];
        if (typeof v === "number") nv[s.key] = v;
      }
      return nv;
    });
    if (cfg.deathMode) setMode(cfg.deathMode);
    if (cfg.seedMode) setSeedModeState(cfg.seedMode);
    if (cfg.birthMode) setBirthModeState(cfg.birthMode);
    if (cfg.dominanceMode) setDomState(cfg.dominanceMode);
    if (cfg.speciesColors) setColors(cloneColors(cfg.speciesColors));
    if (typeof cfg.rescueEnabled === "boolean") setRescueEnabledState(cfg.rescueEnabled);
    if (typeof cfg.rescueRestart === "boolean") setRescueRestartState(cfg.rescueRestart);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.nonce]);

  function toggleSection(g: Group) {
    setSections((prev) => ({ ...prev, [g]: !prev[g] }));
  }
  // NOTE: an older effect force-collapsed the other sections whenever the panel grew taller than the
  // viewport. That dates from when this panel was its own fixed, self-scrolling card. It now lives
  // inside the scrollable `.settings` container, so the guard is unnecessary — and it actively
  // fought the user by snapping sections shut the moment one was opened. Removed.

  function set(key: NumericKey, value: number) {
    setValues((prev) => ({ ...prev, [key]: value }));
    onChange({ [key]: value } as Partial<BoidsConfig>);
  }

  function setDeathMode(m: DeathMode) {
    setMode(m);
    onChange({ deathMode: m });
  }

  function setSeedMode(m: SeedMode) {
    setSeedModeState(m);
    onChange({ seedMode: m });
  }

  function setBirthMode(m: BirthMode) {
    setBirthModeState(m);
    onChange({ birthMode: m });
  }

  function setDominanceMode(m: DominanceMode) {
    setDomState(m);
    onChange({ dominanceMode: m });
  }

  function setRescueEnabled(v: boolean) {
    setRescueEnabledState(v);
    onChange({ rescueEnabled: v });
  }

  function setRescueRestart(v: boolean) {
    setRescueRestartState(v);
    onChange({ rescueRestart: v });
  }

  function setSpeciesColor(s: number, hex: string) {
    setColors((prev) => {
      const next = cloneColors(prev);
      next[s] = hexToRgb(hex);
      onChange({ speciesColors: next });
      return next;
    });
  }


  function renderSlider(s: SliderDef) {
    const cfgVal = values[s.key];
    const sliderVal = s.toSlider ? s.toSlider(cfgVal) : cfgVal;
    const shown = s.display ? s.display(cfgVal) : cfgVal.toFixed(s.digits);
    return (
      <label className="ctrl" key={s.key} title={s.title}>
        <span className="ctrl__label">{s.label}</span>
        <span className="ctrl__val">{shown}</span>
        <input
          className="ctrl__slider"
          type="range"
          min={s.min}
          max={s.max}
          step={s.step}
          value={sliderVal}
          onChange={(e) => {
            const raw = parseFloat(e.target.value);
            set(s.key, s.fromSlider ? s.fromSlider(raw) : raw);
          }}
        />
      </label>
    );
  }

  function slidersOf(g: Group) {
    return SLIDERS.filter((s) => s.group === g).map(renderSlider);
  }

  // Render specific sliders by key, in an explicit order (for the composed sections).
  function slidersByKey(keys: NumericKey[]) {
    return keys.map((k) => {
      const s = SLIDERS.find((x) => x.key === k);
      return s ? renderSlider(s) : null;
    });
  }

  const numSpeciesActive = Math.round(values.numSpecies);
  const colorPickers = (
    <>
      <div className="ctrl__label" style={{ marginTop: 2 }}>
        Population colors
      </div>
      <div className="colors">
        {Array.from({ length: numSpeciesActive }, (_, s) => (
          <ColorSwatch
            key={s}
            label={`S${s + 1}`}
            title={`Color of species ${s + 1}`}
            value={rgbToHex(colors[s] ?? [1, 1, 1])}
            onChange={(hex) => setSpeciesColor(s, hex)}
          />
        ))}
      </div>
    </>
  );

  // Plain render function (NOT a nested component → sliders keep focus while dragging).
  function renderSection(id: Group, title: string, children: React.ReactNode) {
    const isOpen = sections[id];
    return (
      <div className="section" key={id}>
        <button className="section__head" onClick={() => toggleSection(id)}>
          <span className="section__arrow">{isOpen ? "▾" : "▸"}</span>
          {title}
        </button>
        {isOpen && <div className="section__body">{children}</div>}
      </div>
    );
  }

  return (
    <div className={`panel ${open ? "" : "panel--closed"}`}>
      <div className="panel__head">
        <button className="panel__toggle" onClick={onToggle}>
          {open ? "▾" : "▸"} Swarm
        </button>
      </div>

      {open && (
        <div className="panel__body">
          {renderSection("swarm", "Swarm behavior", slidersOf("swarm"))}
          {renderSection("count", "Count", slidersOf("count"))}
          {renderSection(
            "population",
            "Populations & appearance",
            <>
              {slidersByKey(["numSpecies"])}
              {colorPickers}
              {slidersByKey(["colorIntensity", "trailFade", "boidScale"])}
            </>,
          )}
          {renderSection(
            "dynamics",
            "Population dynamics",
            <>
              {slidersByKey([
                "chaseWeight",
                "fleeWeight",
                "killRadius",
                "birthRate",
                "adaptiveStrength",
                "starveRate",
              ])}

              <div className="ctrl__label" style={{ marginTop: 2 }}>
                Death / birth model
              </div>
              <div className="panel__modes">
                <button
                  className={`panel__mode ${mode === "convert" ? "panel__mode--active" : ""}`}
                  onClick={() => setDeathMode("convert")}
                  title="Eaten prey instantly becomes the predator (total count stays constant)."
                >
                  Convert
                </button>
                <button
                  className={`panel__mode ${mode === "energy" ? "panel__mode--active" : ""}`}
                  onClick={() => setDeathMode("energy")}
                  title="Eat / starve / die + rebirth in the swarm (variable populations)."
                >
                  Energy
                </button>
              </div>

              <div className="ctrl__label" style={{ marginTop: 2 }}>
                Dominance (who eats whom)
              </div>
              <div className="panel__modes3">
                <button
                  className={`panel__mode ${dominanceMode === "cyclic" ? "panel__mode--active" : ""}`}
                  onClick={() => setDominanceMode("cyclic")}
                  title="Fixed rock–paper–scissors: A eats B eats C … eats A. Always balanced."
                >
                  Cyclic
                </button>
                <button
                  className={`panel__mode ${dominanceMode === "random" ? "panel__mode--active" : ""}`}
                  onClick={() => setDominanceMode("random")}
                  title="Fixed random matchups — who beats whom is decided once, re-rolled on Restart."
                >
                  Random
                </button>
                <button
                  className={`panel__mode ${dominanceMode === "chaos" ? "panel__mode--active" : ""}`}
                  onClick={() => setDominanceMode("chaos")}
                  title="No fixed predator or prey — every single encounter is decided by chance. Attacks randomly succeed or fail; no species can permanently dominate another."
                >
                  Chaos
                </button>
              </div>

              <div className="ctrl__label" style={{ marginTop: 2 }}>
                Start layout
              </div>
              <div className="panel__modes">
                <button
                  className={`panel__mode ${seedMode === "random" ? "panel__mode--active" : ""}`}
                  onClick={() => setSeedMode("random")}
                  title="All boids scattered randomly across the screen."
                >
                  Random
                </button>
                <button
                  className={`panel__mode ${seedMode === "clustered" ? "panel__mode--active" : ""}`}
                  onClick={() => setSeedMode("clustered")}
                  title="Each species starts as one swarm in its own corner."
                >
                  Corners
                </button>
              </div>

              <div className="ctrl__label" style={{ marginTop: 2 }}>
                Reproduction (Energy mode)
              </div>
              <div className="panel__modes4">
                {BIRTH_MODES.map((bm) => (
                  <button
                    key={bm.value}
                    className={`panel__mode ${birthMode === bm.value ? "panel__mode--active" : ""}`}
                    onClick={() => setBirthMode(bm.value)}
                    title={bm.title}
                  >
                    {bm.label}
                  </button>
                ))}
              </div>
            </>,
          )}
          {renderSection(
            "rescue",
            "Extinction safety",
            <>
              <div className="ctrl__label" style={{ marginTop: 2 }}>
                Refuge (rescue effect)
              </div>
              <div className="panel__modes">
                <button
                  className={`panel__mode ${rescueEnabled ? "panel__mode--active" : ""}`}
                  onClick={() => setRescueEnabled(true)}
                  title="A species that drops below the threshold is re-colonised as a small group in its home region, arriving well-fed so it can immediately reproduce. Makes extinction reversible — the ecosystem runs endlessly."
                >
                  On
                </button>
                <button
                  className={`panel__mode ${!rescueEnabled ? "panel__mode--active" : ""}`}
                  onClick={() => setRescueEnabled(false)}
                  title="No safety net: a species that hits zero is gone for good, which starves its predator and usually collapses the whole ecosystem within a minute."
                >
                  Off
                </button>
              </div>

              {rescueEnabled && slidersByKey(["rescueThreshold", "rescueRate"])}

              <div className="ctrl__label" style={{ marginTop: 2 }}>
                Emergency restart
              </div>
              <div className="panel__modes">
                <button
                  className={`panel__mode ${rescueRestart ? "panel__mode--active" : ""}`}
                  onClick={() => setRescueRestart(true)}
                  title="Last resort: if the entire ecosystem stays empty for several seconds, reseed it automatically. With the refuge on this should never trigger — it is insurance for an unattended exhibition."
                >
                  On
                </button>
                <button
                  className={`panel__mode ${!rescueRestart ? "panel__mode--active" : ""}`}
                  onClick={() => setRescueRestart(false)}
                  title="Never restart automatically — a fully collapsed ecosystem stays empty until you press Restart."
                >
                  Off
                </button>
              </div>
            </>,
          )}

        </div>
      )}
    </div>
  );
}

// memo: this panel keeps its own slider state and stays MOUNTED while the settings
// block is collapsed. Its parent re-renders several times a second (FPS + population
// readouts), and without memo every one of those would reconcile the whole control tree.
export default memo(ControlPanel);

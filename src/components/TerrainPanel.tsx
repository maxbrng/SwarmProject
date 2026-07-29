"use client";

import { memo, useEffect, useState } from "react";
import { BoidsConfig, DEFAULT_CONFIG, RGB, TerrainTool } from "@/webgpu/boids/config";
import ColorSwatch from "./ColorSwatch";

interface Props {
  onChange: (partial: Partial<BoidsConfig>) => void;
  onClearTerrain: () => void;
  onReseedTerrain: () => void;
  // Bumped when a preset is loaded, to re-sync the sliders and colors.
  sync?: { nonce: number; cfg: Partial<BoidsConfig> } | null;
  // Only one settings section is open at a time, so the parent controls this.
  open: boolean;
  onToggle: () => void;
}

// Only the terrain-related, numeric config keys.
type TerrainKey =
  | "terrainForce"
  | "terrainScale"
  | "terrainCoverage"
  | "terrainWarp"
  | "terrainDrift"
  | "terrainLineCount"
  | "terrainLineWidth"
  | "terrainLineBright"
  | "terrainTint"
  | "terrainShade"
  | "terrainSnowAmount"
  | "terrainBrushSize"
  | "terrainBrushStrength"
  | "terrainBrushDetail"
  | "terrainHealRate";

const TERRAIN_TOOLS: { value: TerrainTool; label: string; title: string }[] = [
  { value: "off", label: "Off", title: "Single-finger touch does the swirl vortex (no sculpting)." },
  { value: "raise", label: "Raise", title: "Hold on the map to push the ground up into mountains." },
  { value: "lower", label: "Lower", title: "Hold on the map to carve the ground down into valleys." },
];

interface TerrainSlider {
  key: TerrainKey;
  label: string;
  min: number;
  max: number;
  step: number;
  title: string;
  display: (v: number) => string;
}

const TERRAIN_SLIDERS: TerrainSlider[] = [
  {
    key: "terrainForce",
    label: "Barrier strength",
    min: 0,
    max: 20,
    step: 0.5,
    title:
      "How hard the mountains push the swarm downhill. Higher = peaks become a harder wall and the boids stay in the valleys. 0 = the relief is drawn but the swarm ignores it.",
    display: (v) => (v === 0 ? "off" : v.toFixed(1)),
  },
  {
    key: "terrainScale",
    label: "Mountain size",
    min: 0.3,
    max: 10,
    step: 0.05,
    title: "Spatial frequency of the relief. Low = few broad ranges; high = many small hills.",
    display: (v) => v.toFixed(2),
  },
  {
    key: "terrainCoverage",
    label: "Mountain amount",
    min: 0,
    max: 1,
    step: 0.02,
    title:
      "Valley↔mountain ratio. Low = almost all flat plateau with only a few isolated tall peaks; high = more mountainous. This is the main dial for how much open valley the swarm gets.",
    display: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "terrainWarp",
    label: "Warp (organic)",
    min: 0,
    max: 1,
    step: 0.02,
    title:
      "Bends the ridges so they meander like a real landscape instead of following the noise grid. 0 = the plain look; dial it up gently until it feels natural (too much gets smeary).",
    display: (v) => (v === 0 ? "off" : `${Math.round(v * 100)}%`),
  },
  {
    key: "terrainDrift",
    label: "Drift",
    min: 0,
    max: 1,
    step: 0.02,
    title: "How fast the whole landscape drifts and morphs on its own. 0 = frozen relief; higher = the mountains and valleys visibly travel and reshape. The swarm follows the moving valleys.",
    display: (v) => (v === 0 ? "frozen" : `${Math.round(v * 100)}%`),
  },
  {
    key: "terrainLineCount",
    label: "Contour lines",
    min: 4,
    max: 40,
    step: 1,
    title: "Number of height levels drawn as contour lines. More = a denser topographic map.",
    display: (v) => v.toFixed(0),
  },
  {
    key: "terrainLineWidth",
    label: "Line thickness",
    min: 0.4,
    max: 3,
    step: 0.1,
    title: "On-screen thickness of the contour lines (pixels).",
    display: (v) => `${v.toFixed(1)} px`,
  },
  {
    key: "terrainLineBright",
    label: "Line brightness",
    min: 0,
    max: 2,
    step: 0.05,
    title: "How bright the contour lines glow over the dark background.",
    display: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "terrainShade",
    label: "Relief shading",
    min: 0,
    max: 1.5,
    step: 0.05,
    title:
      "Directional hill-shading (a light from the upper-left). This is what makes the flat field look 3D — ridges catch the light, far slopes fall into shadow. 0 = flat, no relief feel.",
    display: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "terrainTint",
    label: "Color strength",
    min: 0,
    max: 2.5,
    step: 0.05,
    title:
      "Strength of the valley→peak fill color. 0 = grayscale relief (shading + lines only); higher = more color.",
    display: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "terrainSnowAmount",
    label: "Snow cap",
    min: 0,
    max: 1,
    step: 0.05,
    title:
      "Strength of the bright cap on the highest peaks. 0 = off (peaks stay the peak color); higher = more snow/rock cap. Its color is the Snow swatch below.",
    display: (v) => (v === 0 ? "off" : `${Math.round(v * 100)}%`),
  },
];

// Sculpt-brush sliders (shown when a Raise/Lower tool is active).
const BRUSH_SLIDERS: TerrainSlider[] = [
  {
    key: "terrainBrushSize",
    label: "Brush size",
    min: 0.05,
    max: 0.6,
    step: 0.01,
    title:
      "Radius of the single-finger button brush (share of screen height). Multi-finger gestures ignore this and use your finger spread instead.",
    display: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "terrainBrushStrength",
    label: "Brush strength",
    min: 0.1,
    max: 2.5,
    step: 0.05,
    title: "How fast the ground rises/sinks while you hold. Hold longer for taller mountains.",
    display: (v) => v.toFixed(2),
  },
  {
    key: "terrainBrushDetail",
    label: "Brush detail",
    min: 0,
    max: 1,
    step: 0.05,
    title:
      "Jaggedness of what you sculpt. 0 = smooth, rounded hills/basins; high = very craggy, angular mountains.",
    display: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "terrainHealRate",
    label: "Self-heal",
    min: 0,
    max: 0.3,
    step: 0.005,
    title:
      "How fast sculpted relief relaxes back toward the natural landscape. 0 = permanent; higher = it slowly heals away.",
    display: (v) => (v === 0 ? "permanent" : `${v.toFixed(3)}/s`),
  },
];

const ALL_SLIDERS = [...TERRAIN_SLIDERS, ...BRUSH_SLIDERS];

// color helpers: linear rgb 0..1 ↔ #rrggbb
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function rgbToHex(c: RGB): string {
  const h = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}
function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Live tuning panel for the terrain. Dev-only; final values get baked into DEFAULT_CONFIG.
function TerrainPanel({ onChange, onClearTerrain, onReseedTerrain, sync, open, onToggle }: Props) {
  const [values, setValues] = useState<Record<TerrainKey, number>>(() => {
    const v = {} as Record<TerrainKey, number>;
    for (const s of ALL_SLIDERS) v[s.key] = DEFAULT_CONFIG[s.key];
    return v;
  });
  const [enabled, setEnabled] = useState(DEFAULT_CONFIG.terrainEnabled);
  const [tool, setToolState] = useState<TerrainTool>(DEFAULT_CONFIG.terrainTool);
  const [valley, setValley] = useState<RGB>([...DEFAULT_CONFIG.terrainValley] as RGB);
  const [mid, setMid] = useState<RGB>([...DEFAULT_CONFIG.terrainMid] as RGB);
  const [peak, setPeak] = useState<RGB>([...DEFAULT_CONFIG.terrainPeak] as RGB);
  const [snow, setSnow] = useState<RGB>([...DEFAULT_CONFIG.terrainSnow] as RGB);

  // A preset was loaded: mirror its terrain values into this panel's sliders and colors. Guarded on
  // the nonce so it only runs on load; the sim itself is already updated by the parent's onChange.
  useEffect(() => {
    const cfg = sync?.cfg;
    if (!cfg) return;
    const mirror = () => {
      setValues((prev) => {
        const next = { ...prev };
        for (const s of ALL_SLIDERS) {
          const v = cfg[s.key];
          if (typeof v === "number") next[s.key] = v;
        }
        return next;
      });
      if (typeof cfg.terrainEnabled === "boolean") setEnabled(cfg.terrainEnabled);
      if (cfg.terrainTool) setToolState(cfg.terrainTool);
      if (cfg.terrainValley) setValley([...cfg.terrainValley] as RGB);
      if (cfg.terrainMid) setMid([...cfg.terrainMid] as RGB);
      if (cfg.terrainPeak) setPeak([...cfg.terrainPeak] as RGB);
      if (cfg.terrainSnow) setSnow([...cfg.terrainSnow] as RGB);
    };
    mirror();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.nonce]);

  function setTool(t: TerrainTool) {
    setToolState(t);
    onChange({ terrainTool: t });
  }

  function set(key: TerrainKey, value: number) {
    setValues((prev) => ({ ...prev, [key]: value }));
    onChange({ [key]: value } as Partial<BoidsConfig>);
  }

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    onChange({ terrainEnabled: next });
  }

  function reset() {
    const v = {} as Record<TerrainKey, number>;
    const partial: Partial<BoidsConfig> = {};
    for (const s of ALL_SLIDERS) {
      v[s.key] = DEFAULT_CONFIG[s.key];
      (partial as Record<TerrainKey, number>)[s.key] = DEFAULT_CONFIG[s.key];
    }
    const dv = [...DEFAULT_CONFIG.terrainValley] as RGB;
    const dm = [...DEFAULT_CONFIG.terrainMid] as RGB;
    const dp = [...DEFAULT_CONFIG.terrainPeak] as RGB;
    const ds = [...DEFAULT_CONFIG.terrainSnow] as RGB;
    setValues(v);
    setValley(dv);
    setMid(dm);
    setPeak(dp);
    setSnow(ds);
    setEnabled(DEFAULT_CONFIG.terrainEnabled);
    setToolState(DEFAULT_CONFIG.terrainTool);
    onChange({
      ...partial,
      terrainEnabled: DEFAULT_CONFIG.terrainEnabled,
      terrainTool: DEFAULT_CONFIG.terrainTool,
      terrainValley: dv,
      terrainMid: dm,
      terrainPeak: dp,
      terrainSnow: ds,
    });
  }

  function renderSlider(s: TerrainSlider) {
    const val = values[s.key];
    return (
      <label className="ctrl" key={s.key} title={s.title}>
        <span className="ctrl__label">{s.label}</span>
        <span className="ctrl__val">{s.display(val)}</span>
        <input
          className="ctrl__slider"
          type="range"
          min={s.min}
          max={s.max}
          step={s.step}
          value={val}
          onChange={(e) => set(s.key, parseFloat(e.target.value))}
        />
      </label>
    );
  }

  return (
    <div className={`panel panel--terrain ${open ? "" : "panel--closed"}`}>
      <div className="panel__head">
        <button className="panel__toggle" onClick={onToggle}>
          {open ? "▾" : "▸"} Terrain
        </button>
      </div>

      {open && (
        <div className="panel__body">
          <div className="swirl__hint">
            A relief of mountains &amp; valleys drawn as contour lines. The swarm is pushed
            downhill → it flows through the valleys and can&apos;t cross the peaks. Temporary panel —
            for dialing in the feel.
          </div>

          <button
            className="swirl__dir"
            onClick={toggle}
            title="Turn the whole terrain layer (contour lines + swarm avoidance) on or off."
          >
            <span className="swirl__dirIcon">{enabled ? "◉" : "○"}</span>
            Terrain: {enabled ? "on" : "off"}
          </button>

          <div className="ctrl__label" style={{ marginTop: 6 }}>
            Sculpt · touch gestures
          </div>
          <div className="swirl__hint">
            <b>2 fingers</b> = raise mountains · <b>3 fingers</b> = carve valleys. Spread your fingers
            wider for a bigger area, pinch for a small one. (1 finger = swirl.)
          </div>
          <div className="panel__modes3">
            {TERRAIN_TOOLS.map((tm) => (
              <button
                key={tm.value}
                className={`panel__mode ${tool === tm.value ? "panel__mode--active" : ""}`}
                onClick={() => setTool(tm.value)}
                title={tm.title}
              >
                {tm.label}
              </button>
            ))}
          </div>
          <div className="swirl__hint">
            Optional override for testing: pick <b>Raise</b>/<b>Lower</b> to sculpt with a single
            finger too; <b>Off</b> = one finger does the swirl. The multi-finger gestures work either way.
          </div>
          <div className="section__body">
            {enabled && BRUSH_SLIDERS.map(renderSlider)}
            {enabled && (
              <button className="panel__reset" onClick={onClearTerrain}>
                Clear sculpted terrain
              </button>
            )}
          </div>

          <div className="section__body">
            {enabled && (
              <button
                className="panel__reset"
                onClick={onReseedTerrain}
                title="Generate a fresh landscape — a new arrangement of mountains and valleys, same overall character. Also happens automatically on every reload."
              >
                New terrain
              </button>
            )}
            {TERRAIN_SLIDERS.map(renderSlider)}

            <div className="ctrl__label" style={{ marginTop: 2 }}>
              Elevation colors
            </div>
            <div className="colors" style={{ justifyContent: "flex-start", gap: 18 }}>
              <ColorSwatch
                label="Valley"
                title="Fill color at the valley floor (lowest ground)"
                value={rgbToHex(valley)}
                onChange={(hex) => {
                  const c = hexToRgb(hex);
                  setValley(c);
                  onChange({ terrainValley: c });
                }}
              />
              <ColorSwatch
                label="Mid"
                title="Fill color of the mid slopes (between valley and peak)"
                value={rgbToHex(mid)}
                onChange={(hex) => {
                  const c = hexToRgb(hex);
                  setMid(c);
                  onChange({ terrainMid: c });
                }}
              />
              <ColorSwatch
                label="Peak"
                title="Fill color at the mountain peaks (highest ground)"
                value={rgbToHex(peak)}
                onChange={(hex) => {
                  const c = hexToRgb(hex);
                  setPeak(c);
                  onChange({ terrainPeak: c });
                }}
              />
              <ColorSwatch
                label="Snow"
                title="Cap color on the very highest peaks (strength = the Snow cap slider above)"
                value={rgbToHex(snow)}
                onChange={(hex) => {
                  const c = hexToRgb(hex);
                  setSnow(c);
                  onChange({ terrainSnow: c });
                }}
              />
            </div>
          </div>

          <button className="panel__reset" onClick={reset}>
            Reset terrain values
          </button>
        </div>
      )}
    </div>
  );
}

// memo: the parent re-renders several times a second (FPS + population readouts). This panel keeps
// its own state while staying mounted, so without memo every tick would reconcile the whole tree.
export default memo(TerrainPanel);

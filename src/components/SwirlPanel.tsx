"use client";

import { memo, useEffect, useState } from "react";
import { BoidsConfig, DEFAULT_CONFIG } from "@/webgpu/boids/config";

interface Props {
  onChange: (partial: Partial<BoidsConfig>) => void;
  // Rotation direction (±1), controlled by the parent so the stir gesture stays synced.
  dir: number;
  // Bumped when a preset is loaded, to re-sync the sliders.
  sync?: { nonce: number; cfg: Partial<BoidsConfig> } | null;
  // Only one settings section is open at a time, so the parent controls this.
  open: boolean;
  onToggle: () => void;
}

// Only the swirl-related, numeric config keys.
type SwirlKey =
  | "swirlStrength"
  | "swirlRadius"
  | "swirlFalloff"
  | "swirlInward"
  | "swirlRampUp"
  | "swirlRampDown";

interface SwirlSlider {
  key: SwirlKey;
  label: string;
  min: number;
  max: number;
  step: number;
  title: string;
  display: (v: number) => string;
}

// sim height = 2 units → v/2*100 gives a screen-height percentage
const pctOfHeight = (v: number) => `${(v * 50).toFixed(0)}%`;

const SWIRL_SLIDERS: SwirlSlider[] = [
  {
    key: "swirlStrength",
    label: "Strength",
    min: 0.5,
    max: 6,
    step: 0.1,
    title:
      "Peak orbit speed at the center, as a multiple of the normal max speed. The swirl is applied after the speed cap, so >1 really does whip the middle faster than the swarm moves otherwise.",
    display: (v) => `${v.toFixed(1)}×`,
  },
  {
    key: "swirlRadius",
    label: "Radius",
    min: 0.05,
    max: 1.2,
    step: 0.01,
    title:
      "How far the vortex reaches (share of screen height). Outside this radius nothing changes — the swirl stays a local brush.",
    display: pctOfHeight,
  },
  {
    key: "swirlFalloff",
    label: "Center focus",
    min: 0.2,
    max: 5,
    step: 0.1,
    title:
      "Inner-faster profile. Higher = the rotation concentrates hard in the middle and fades quickly outward; lower = a broader, more even swirl.",
    display: (v) => v.toFixed(1),
  },
  {
    key: "swirlInward",
    label: "Pull ↔ push",
    min: -1,
    max: 1,
    step: 0.05,
    title:
      "Radial bias. 0 = pure orbit; negative pushes boids outward (opens a hole); positive sucks them inward (a drain).",
    display: (v) => (v === 0 ? "orbit" : v > 0 ? `in ${v.toFixed(2)}` : `out ${(-v).toFixed(2)}`),
  },
  {
    key: "swirlRampUp",
    label: "Build-up",
    min: 0,
    max: 1,
    step: 0.02,
    title: "Seconds for the swirl to reach full strength after you touch down.",
    display: (v) => `${v.toFixed(2)} s`,
  },
  {
    key: "swirlRampDown",
    label: "Heal-out",
    min: 0,
    max: 2,
    step: 0.05,
    title: "Seconds for the swirl to fade away after you lift your finger (the swarm heals).",
    display: (v) => `${v.toFixed(2)} s`,
  },
];

// Live tuning panel for the touch swirl. Dev-only; final values get baked into DEFAULT_CONFIG.
function SwirlPanel({ onChange, dir, sync, open, onToggle }: Props) {
  const [values, setValues] = useState<Record<SwirlKey, number>>(() => {
    const v = {} as Record<SwirlKey, number>;
    for (const s of SWIRL_SLIDERS) v[s.key] = DEFAULT_CONFIG[s.key];
    return v;
  });

  // A preset was loaded: mirror its swirl values into the sliders.
  useEffect(() => {
    const cfg = sync?.cfg;
    if (!cfg) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues((prev) => {
      const next = { ...prev };
      for (const s of SWIRL_SLIDERS) {
        const v = cfg[s.key];
        if (typeof v === "number") next[s.key] = v;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.nonce]);

  function set(key: SwirlKey, value: number) {
    setValues((prev) => ({ ...prev, [key]: value }));
    onChange({ [key]: value } as Partial<BoidsConfig>);
  }

  function flipDir() {
    onChange({ swirlDir: dir >= 0 ? -1 : 1 });
  }

  function reset() {
    const v = {} as Record<SwirlKey, number>;
    const partial: Partial<BoidsConfig> = {};
    for (const s of SWIRL_SLIDERS) {
      v[s.key] = DEFAULT_CONFIG[s.key];
      (partial as Record<SwirlKey, number>)[s.key] = DEFAULT_CONFIG[s.key];
    }
    const d = DEFAULT_CONFIG.swirlDir >= 0 ? 1 : -1;
    setValues(v);
    onChange({ ...partial, swirlDir: d });
  }

  return (
    <div className={`panel panel--swirl ${open ? "" : "panel--closed"}`}>
      <div className="panel__head">
        <button className="panel__toggle" onClick={onToggle}>
          {open ? "▾" : "▸"} Swirl
        </button>
      </div>

      {open && (
        <div className="panel__body">
          <div className="swirl__hint">
            Touch with <b>one finger</b> to spin a vortex; drag to move it, or <b>circle your
            finger</b> to set the spin direction. Two or more fingers turn it off. Temporary panel —
            for dialing in the feel.
          </div>
          <button
            className="swirl__dir"
            onClick={flipDir}
            title="Rotation direction of the vortex. Also set by stirring: circle your finger and the swirl follows. Click to flip."
          >
            <span className="swirl__dirIcon">{dir >= 0 ? "⟲" : "⟳"}</span>
            Direction: {dir >= 0 ? "counter-clockwise" : "clockwise"}
          </button>
          <div className="section__body">
            {SWIRL_SLIDERS.map((s) => {
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
            })}
          </div>
          <button className="panel__reset" onClick={reset}>
            Reset swirl values
          </button>
        </div>
      )}
    </div>
  );
}

// memo: the parent re-renders several times a second (FPS + population readouts). This panel keeps
// its own state while staying mounted, so without memo every tick would reconcile the whole tree.
export default memo(SwirlPanel);

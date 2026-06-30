"use client";

import { useState } from "react";
import { BoidsConfig, DEFAULT_CONFIG, MAX_COUNT } from "@/webgpu/boids/config";

interface Props {
  onChange: (partial: Partial<BoidsConfig>) => void;
  fps: number;
}

type NumericKey = Exclude<keyof BoidsConfig, "background">;

interface SliderDef {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Nachkommastellen für die Anzeige (0 = ganze Zahl). */
  digits: number;
}

const SLIDERS: SliderDef[] = [
  { key: "count", label: "Anzahl", min: 100, max: MAX_COUNT, step: 100, digits: 0 },
  { key: "maxSpeed", label: "Geschwindigkeit", min: 0.1, max: 1.5, step: 0.01, digits: 2 },
  { key: "perception", label: "Sichtweite", min: 0.05, max: 0.6, step: 0.01, digits: 2 },
  { key: "separationDist", label: "Mindestabstand", min: 0.01, max: 0.2, step: 0.005, digits: 3 },
  { key: "alignWeight", label: "Ausrichtung", min: 0, max: 3, step: 0.05, digits: 2 },
  { key: "cohesionWeight", label: "Zusammenhalt", min: 0, max: 3, step: 0.05, digits: 2 },
  { key: "separationWeight", label: "Abstoßung", min: 0, max: 3, step: 0.05, digits: 2 },
  { key: "maxForce", label: "Wendigkeit", min: 0.1, max: 5, step: 0.05, digits: 2 },
  { key: "trailFade", label: "Spur-Verblassen", min: 0.02, max: 1, step: 0.01, digits: 2 },
  { key: "boidScale", label: "Größe", min: 0.004, max: 0.04, step: 0.001, digits: 3 },
];

export default function ControlPanel({ onChange, fps }: Props) {
  const [values, setValues] = useState<Record<NumericKey, number>>(() => {
    const v = {} as Record<NumericKey, number>;
    for (const s of SLIDERS) v[s.key] = DEFAULT_CONFIG[s.key];
    return v;
  });
  const [open, setOpen] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function set(key: NumericKey, value: number) {
    setValues((prev) => ({ ...prev, [key]: value }));
    onChange({ [key]: value } as Partial<BoidsConfig>);
  }

  async function saveAsDefault() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/save-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setSaveState(res.ok && data.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
    setTimeout(() => setSaveState("idle"), 2500);
  }

  const saveLabel = {
    idle: "Als Standard speichern",
    saving: "Speichere …",
    saved: "✓ Im Code gespeichert",
    error: "✗ Fehler – läuft der Dev-Server?",
  }[saveState];

  function reset() {
    const v = {} as Record<NumericKey, number>;
    const partial: Partial<BoidsConfig> = {};
    for (const s of SLIDERS) {
      v[s.key] = DEFAULT_CONFIG[s.key];
      (partial as Record<NumericKey, number>)[s.key] = DEFAULT_CONFIG[s.key];
    }
    setValues(v);
    onChange(partial);
  }

  return (
    <div className={`panel ${open ? "" : "panel--closed"}`}>
      <div className="panel__head">
        <button className="panel__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Schwarm
        </button>
        <span className="panel__fps">{fps > 0 ? `${Math.round(fps)} FPS` : "…"}</span>
      </div>

      {open && (
        <div className="panel__body">
          {SLIDERS.map((s) => (
            <label className="ctrl" key={s.key}>
              <span className="ctrl__label">{s.label}</span>
              <span className="ctrl__val">{values[s.key].toFixed(s.digits)}</span>
              <input
                className="ctrl__slider"
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={values[s.key]}
                onChange={(e) => set(s.key, parseFloat(e.target.value))}
              />
            </label>
          ))}
          <button
            className={`panel__save panel__save--${saveState}`}
            onClick={saveAsDefault}
            disabled={saveState === "saving"}
            title="Schreibt die aktuellen Werte fest in config.ts (DEFAULT_CONFIG) — überlebt Reload. Nur im Dev-Modus."
          >
            {saveLabel}
          </button>
          <button className="panel__reset" onClick={reset}>
            Auf Code-Standard zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { SPECIES_PALETTE, type RGB } from "@/webgpu/boids/config";

interface Props {
  /** Alive boids per species (index = species). */
  counts: number[];
  numSpecies: number;
  /** Live per-species colors (linear rgb 0..1) — falls back to the palette. */
  colors?: RGB[];
}

function speciesColor(s: number, colors?: RGB[]): string {
  const c = colors?.[s] ?? SPECIES_PALETTE[s] ?? [1, 1, 1];
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}

export default function PopulationMonitor({ counts, numSpecies, colors }: Props) {
  const species = Array.from({ length: numSpecies }, (_, s) => s);
  const values = species.map((s) => counts[s] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...values);

  return (
    <div className="popmon">
      <div className="popmon__head">
        <span className="popmon__title">Populations</span>
        <span className="popmon__total">{total.toLocaleString("en-US")} alive</span>
      </div>
      <div className="popmon__rows">
        {species.map((s) => {
          const col = speciesColor(s, colors);
          const v = values[s];
          const pct = (v / max) * 100;
          return (
            <div className="popmon__row" key={s}>
              <span className="popmon__dot" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
              <div className="popmon__track">
                <div
                  className="popmon__fill"
                  style={{ width: `${pct}%`, background: col, boxShadow: `0 0 10px ${col}` }}
                />
              </div>
              <span className="popmon__num">{v.toLocaleString("en-US")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

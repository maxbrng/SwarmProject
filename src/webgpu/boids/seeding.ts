// Initial boid placement. The buffers always hold MAX_COUNT boids; cfg.count only limits how many
// are simulated, so a reseed refills the whole array regardless of the live count.

import { MAX_COUNT, SeedMode } from "./config";

// One boid = 8 floats: pos.xy, vel.xy, species, energy, age, flash. Matches Boid in
// shaders/common/boid.wgsl.
export const FLOATS_PER_BOID = 8;

// Fill `out` (length MAX_COUNT × FLOATS_PER_BOID) with a fresh population. "clustered" starts each
// species in a tight disc at its own point on a circle, so they begin maximally far apart; "random"
// scatters everyone across the field. maxSpeed sets the spread of the initial speeds.
export function seedBoids(
  out: Float32Array,
  numSpecies: number,
  seedMode: SeedMode,
  aspect: number,
  maxSpeed: number,
) {
  const centers: [number, number][] = [];
  for (let s = 0; s < numSpecies; s++) {
    const th = (2 * Math.PI * (s + 0.25)) / numSpecies;
    centers.push([Math.cos(th) * aspect * 0.78, Math.sin(th) * 0.78]);
  }
  const clusterR = 0.3;
  for (let i = 0; i < MAX_COUNT; i++) {
    const sp = i % numSpecies;
    const o = i * FLOATS_PER_BOID;
    let x: number;
    let y: number;
    if (seedMode === "clustered") {
      const c = centers[sp];
      const rr = Math.sqrt(Math.random()) * clusterR;
      const ra = Math.random() * Math.PI * 2;
      x = Math.max(-aspect * 0.98, Math.min(aspect * 0.98, c[0] + Math.cos(ra) * rr));
      y = Math.max(-0.98, Math.min(0.98, c[1] + Math.sin(ra) * rr));
    } else {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
    }
    const a = Math.random() * Math.PI * 2;
    const s = maxSpeed * (0.6 + Math.random() * 0.4);
    out[o + 0] = x;
    out[o + 1] = y;
    out[o + 2] = Math.cos(a) * s;
    out[o + 3] = Math.sin(a) * s;
    out[o + 4] = sp;
    out[o + 5] = 0.6 + Math.random() * 0.3;
    out[o + 6] = Math.random() * 5;
    out[o + 7] = 0;
  }
}

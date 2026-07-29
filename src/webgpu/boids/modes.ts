// How the config's string modes map to the plain numbers the shaders expect, plus the predator-prey
// dominance matrix. All of this is CPU-side config translation, kept out of the frame loop.

import { BoidsConfig } from "./config";

// convert = 0, energy = 1.
export function deathModeNum(m: BoidsConfig["deathMode"]): number {
  return m === "energy" ? 1 : 0;
}

export function birthModeNum(m: BoidsConfig["birthMode"]): number {
  return { off: 0, constant: 1, adaptive: 2, homeland: 3 }[m];
}

// Who-eats-whom as a per-predator bitmask: in row s, a set bit b means species s eats species b.
// 8 floats = 2×vec4, but only the first numSpecies rows are used. "chaos" returns all-zero — the
// shader gives every species mutual, coin-flip encounters instead of a fixed hierarchy.
export function computeDominance(
  mode: BoidsConfig["dominanceMode"],
  numSpecies: number,
): Float32Array<ArrayBuffer> {
  const rows = new Array(6).fill(0);
  if (numSpecies < 2 || mode === "chaos") return new Float32Array(8);
  if (mode === "cyclic") {
    // rock-paper-scissors: each species eats the next, in a closed loop.
    for (let a = 0; a < numSpecies; a++) rows[a] |= 1 << ((a + 1) % numSpecies);
  } else {
    // random: for each unordered pair, flip a coin for who is the predator.
    for (let a = 0; a < numSpecies; a++)
      for (let b = a + 1; b < numSpecies; b++) {
        if (Math.random() < 0.5) rows[a] |= 1 << b;
        else rows[b] |= 1 << a;
      }
  }
  const arr = new Float32Array(8);
  for (let s = 0; s < 6; s++) arr[s] = rows[s];
  return arr;
}

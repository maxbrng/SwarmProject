// Central tuning knobs for the boids behavior.
// Sim space is normalized: y ∈ [-1, 1], x ∈ [-aspect, aspect] (aspect = width/height).
// Lengths/speeds are therefore in "screen half-heights", aspect-correct.
//
// Rules after Craig Reynolds (roholazandie/boids): alignment / cohesion / separation.
// Stage 2: multiple species (populations) with predator-prey dominance (cyclic or random),
// chasing/fleeing, eating (destroying) and birth. Two death/birth models (toggle).

/** convert: eaten prey becomes the predator. energy: eat/starve/die/rebirth. */
export type DeathMode = "convert" | "energy";

/** random: everything scattered. clustered: each species as one swarm in its own corner. */
export type SeedMode = "random" | "clustered";

/**
 * Who-eats-whom relationship:
 * - cyclic: fixed rock–paper–scissors (A eats B eats C … eats A).
 * - random: a fixed random tournament — each pair's winner is decided once (re-rolled on restart).
 * - chaos: no fixed roles at all — every single encounter is decided by chance (symmetric),
 *   so there is no permanent predator or prey; attacks simply succeed or fail at random.
 */
export type DominanceMode = "cyclic" | "random" | "chaos";

/**
 * Reproduction / respawn mode (Energy mode):
 * - off: no respawning (species can go extinct)
 * - constant: steady random trickle of new boids
 * - adaptive: smaller populations reproduce faster (extinction rare, but possible)
 * - homeland: offspring are born in the species' home region, which it defends
 */
export type BirthMode = "off" | "constant" | "adaptive" | "homeland";

export interface BoidsConfig {
  /** Number of boids. O(n²) on the GPU — fine up to ~8000. */
  count: number;
  /** Perception radius for alignment & cohesion. */
  perception: number;
  /** Radius at which separation kicks in (smaller than perception). */
  separationDist: number;
  /** Maximum speed (units/second). */
  maxSpeed: number;
  /** Maximum steering force / acceleration per rule. */
  maxForce: number;
  /** Weights of the three Reynolds rules (same species only). */
  alignWeight: number;
  cohesionWeight: number;
  separationWeight: number;
  /** Size of the rendered boid triangle. */
  boidScale: number;
  /** Trail fade per frame (0 = eternal trail, 1 = no trail). */
  trailFade: number;
  /** Overall boid brightness. Lower keeps dense areas colorful (less white blow-out). */
  colorIntensity: number;
  /** Background color (linear RGB, 0..1). */
  background: [number, number, number];

  // ── Stage 2: species / predator-prey ───────────────────────────────────────
  /** Number of species/populations (1 … MAX_SPECIES; 1 = single flock, no predator-prey). */
  numSpecies: number;
  /** How strongly a predator chases its prey. */
  chaseWeight: number;
  /** How strongly prey flees from its predator (usually > chase). */
  fleeWeight: number;
  /** Distance at which prey is eaten (dies / converts). */
  killRadius: number;
  /** Birth rate (Energy mode only): how fast well-fed parents reproduce inside the swarm. */
  birthRate: number;
  /**
   * Adaptive strength (Adaptive reproduction only): how much smaller swarms breed faster to
   * recover. 0 = every swarm uses the same birth rate (small ones can die out); higher = strong
   * catch-up for shrinking swarms.
   */
  adaptiveStrength: number;
  /** Starvation (Energy mode only): energy lost per second. High = boids die faster. */
  starveRate: number;
  /** Death/birth model. */
  deathMode: DeathMode;
  /** Start layout: random, or each species as one swarm in its own corner. */
  seedMode: SeedMode;
  /** Reproduction / respawn mode (Energy mode). */
  birthMode: BirthMode;
  /** Who-eats-whom relationship (cyclic or random tournament). */
  dominanceMode: DominanceMode;
  /** Per-species color (linear RGB, 0..1), length MAX_SPECIES. Size stays from SPECIES_PALETTE. */
  speciesColors: RGB[];
}

/** Linear RGB triple, 0..1. */
export type RGB = [number, number, number];

// Upper bound of the pre-allocated boid buffers (active count is adjustable live).
// Note: behavior is O(n²) → high values cost FPS (watch the FPS readout in the panel).
export const MAX_COUNT = 20000;

// Maximum number of species (size of the color/rule arrays in the shader — must match there).
export const MAX_SPECIES = 6;

/**
 * Color + size factor per species: [r, g, b, sizeMul].
 * Nice, clearly distinguishable hues; sizeMul varies the shape slightly per species.
 */
export const SPECIES_PALETTE: [number, number, number, number][] = [
  [0.25, 0.65, 1.0, 1.0], // 0 cyan-blue
  [1.0, 0.45, 0.35, 1.15], // 1 coral (slightly bigger)
  [0.55, 1.0, 0.5, 0.9], // 2 green (slightly smaller)
  [1.0, 0.85, 0.3, 1.05], // 3 gold
  [0.8, 0.5, 1.0, 1.0], // 4 violet
  [1.0, 0.5, 0.85, 0.95], // 5 magenta
];

/** Default color per species (rgb from the palette) — the starting point for the color pickers. */
export const DEFAULT_COLORS: RGB[] = SPECIES_PALETTE.map((c) => [c[0], c[1], c[2]]);

export const DEFAULT_CONFIG: BoidsConfig = {
  count: 8000,
  perception: 0.1,
  separationDist: 0.06,
  maxSpeed: 0.15,
  maxForce: 2,
  alignWeight: 1,
  cohesionWeight: 0.6,
  separationWeight: 2,
  boidScale: 0.007,
  trailFade: 0.17,
  colorIntensity: 0.8,
  background: [0.02, 0.025, 0.04],

  numSpecies: 3,
  chaseWeight: 1.2,
  fleeWeight: 1.1,
  killRadius: 0.025,
  birthRate: 1,
  adaptiveStrength: 1,
  starveRate: 0.05,
  deathMode: "energy",
  seedMode: "clustered",
  birthMode: "adaptive",
  dominanceMode: "cyclic",
  speciesColors: DEFAULT_COLORS.map((c) => [c[0], c[1], c[2]] as RGB),
};

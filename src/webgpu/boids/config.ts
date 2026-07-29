// Tuning knobs for the boids behaviour. Sim space is normalized: y in [-1, 1],
// x in [-aspect, aspect], so lengths and speeds are in screen half-heights. Flocking follows
// Reynolds' three rules, with several species on top: predator-prey, eating and birth.

// convert = eaten prey becomes the predator. energy = eat, starve, die, rebirth.
export type DeathMode = "convert" | "energy";

// random = everything scattered. clustered = each species starts as one swarm in its own corner.
export type SeedMode = "random" | "clustered";

// cyclic = fixed rock-paper-scissors. random = a fixed random tournament. chaos = every clash a coin flip.
export type DominanceMode = "cyclic" | "random" | "chaos";

// off, a steady trickle, adaptive (small swarms breed faster), or homeland (born in a defended region).
export type BirthMode = "off" | "constant" | "adaptive" | "homeland";

// off = touch does the swirl. raise/lower = touch sculpts the relief.
export type TerrainTool = "off" | "raise" | "lower";

export interface BoidsConfig {
  count: number;
  perception: number;
  separationDist: number;
  maxSpeed: number;
  maxForce: number;
  alignWeight: number;
  cohesionWeight: number;
  separationWeight: number;
  boidScale: number;
  trailFade: number;
  colorIntensity: number;
  declump: number;
  background: [number, number, number];

  // Swirl: single-finger vortex that twists the swarm locally and heals when the finger lifts.
  swirlStrength: number;
  swirlRadius: number;
  swirlFalloff: number;
  swirlInward: number;
  swirlDir: number;
  swirlRampUp: number;
  swirlRampDown: number;

  // Terrain: a height field of mountains and valleys drawn as contour lines; boids drift downhill.
  terrainEnabled: boolean;
  terrainForce: number;
  terrainScale: number;
  terrainCoverage: number;
  terrainWarp: number;
  terrainDrift: number;
  terrainLineCount: number;
  terrainLineWidth: number;
  terrainLineBright: number;
  terrainTint: number;
  terrainShade: number;
  terrainValley: RGB;
  terrainMid: RGB;
  terrainPeak: RGB;
  terrainSnow: RGB;
  terrainSnowAmount: number;

  // Terrain sculpting: the long-press brush paints an editable delta on top of the base relief.
  terrainTool: TerrainTool;
  terrainBrushSize: number;
  terrainBrushStrength: number;
  terrainBrushDetail: number;
  terrainHealRate: number;

  // Refuge: re-seeds any species that drops below rescueThreshold, so extinction is reversible.
  rescueEnabled: boolean;
  rescueThreshold: number;
  rescueRate: number;
  rescueRestart: boolean;

  // Species / predator-prey
  numSpecies: number;
  chaseWeight: number;
  fleeWeight: number;
  killRadius: number;
  birthRate: number;
  adaptiveStrength: number;
  starveRate: number;
  deathMode: DeathMode;
  seedMode: SeedMode;
  birthMode: BirthMode;
  dominanceMode: DominanceMode;
  speciesColors: RGB[];
}

export type RGB = [number, number, number];

// Pre-allocated boid capacity (active count is adjustable live). Neighbour cost is O(n·k).
export const MAX_COUNT = 20000;

// Must match the array sizes in the shader.
export const MAX_SPECIES = 6;

// Color + size factor per species: [r, g, b, sizeMul].
export const SPECIES_PALETTE: [number, number, number, number][] = [
  [0.25, 0.65, 1.0, 1.0],
  [1.0, 0.45, 0.35, 1.15],
  [0.55, 1.0, 0.5, 0.9],
  [1.0, 0.85, 0.3, 1.05],
  [0.8, 0.5, 1.0, 1.0],
  [1.0, 0.5, 0.85, 0.95],
];

export const DEFAULT_COLORS: RGB[] = SPECIES_PALETTE.map((c) => [c[0], c[1], c[2]]);

export const DEFAULT_CONFIG: BoidsConfig = {
  count: 8000,
  perception: 0.1,
  separationDist: 0.06,
  maxSpeed: 0.12,
  maxForce: 2,
  alignWeight: 1,
  cohesionWeight: 0.6,
  separationWeight: 2,
  boidScale: 0.007,
  trailFade: 0.17,
  colorIntensity: 0.8,
  declump: 0.01,
  background: [0, 0, 0],

  swirlStrength: 2.5,
  swirlRadius: 0.4,
  swirlFalloff: 1.6,
  swirlInward: 0,
  swirlDir: -1,
  swirlRampUp: 0.12,
  swirlRampDown: 0.5,

  terrainEnabled: true,
  terrainForce: 6,
  terrainScale: 3.75,
  terrainCoverage: 0.5,
  terrainWarp: 0.5,
  terrainDrift: 0,
  terrainLineCount: 15,
  terrainLineWidth: 1,
  terrainLineBright: 0.5,
  terrainTint: 1,
  terrainShade: 0.8,
  terrainValley: [0.0078, 0.0078, 0.0078],
  terrainMid: [0.1529, 0.1608, 0.1451],
  terrainPeak: [0.4157, 0.3882, 0.3451],
  terrainSnow: [0.9, 0.92, 0.96],
  terrainSnowAmount: 0.85,

  terrainTool: "off",
  terrainBrushSize: 0.1,
  terrainBrushStrength: 0.8,
  terrainBrushDetail: 0,
  terrainHealRate: 0.02,

  rescueEnabled: true,
  rescueThreshold: 25,
  rescueRate: 12,
  rescueRestart: true,

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
  speciesColors: [[0.25, 0.65, 1], [1, 0.45, 0.35], [0.55, 1, 0.5], [1, 0.85, 0.3], [0.8, 0.5, 1], [1, 0.5, 0.85]],
};

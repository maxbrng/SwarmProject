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

/** Terrain sculpt tool: off (touch = swirl), or raise/lower relief at the finger (touch = brush). */
export type TerrainTool = "off" | "raise" | "lower";

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
  /**
   * Crowd relief strength (usable range ~0..0.1). 0 = off (exact original look). >0 adds an
   * outward pressure that grows with local crowding, so dense clumps thin out: airier look AND
   * fewer boids per grid cell → lower O(k) cost → steadier FPS in heavy birth/death scenes. The
   * range is small on purpose — beyond ~0.1 the push dominates and the swarm gets too loose. Also
   * widens newborn spacing slightly so birth waves don't instantly repack the swarm.
   */
  declump: number;
  /** Background color (linear RGB, 0..1). */
  background: [number, number, number];

  // ── Stage 1.5: swirl interaction (single-finger touch → vortex) ─────────────
  // A "brush" that only twists the existing swarm locally and temporarily; it heals when the
  // finger lifts. Rotation is strongest in the center and fades to the edge (vortex feel).
  // These values are meant to be dialed in via the temporary SwirlPanel, then baked as defaults.
  /** Peak swirl speed at the center, as a multiple of maxSpeed (can exceed the normal cap). */
  swirlStrength: number;
  /** Influence radius of the vortex (sim units; sim height = 2). Outside it nothing changes. */
  swirlRadius: number;
  /** Inner-faster profile exponent: higher = rotation concentrates harder toward the center. */
  swirlFalloff: number;
  /** Radial bias: 0 = pure orbit, <0 pushes boids outward, >0 sucks them inward. Range ~-1..1. */
  swirlInward: number;
  /** Rotation direction: +1 = counter-clockwise, -1 = clockwise. Toggled live in the panel. */
  swirlDir: number;
  /** Seconds for the swirl to build up to full strength after touch-down (feel). */
  swirlRampUp: number;
  /** Seconds for the swirl to fade back out after the finger lifts (self-healing). */
  swirlRampDown: number;

  // ── Stage 3: living terrain (relief) ────────────────────────────────────────
  // A slowly drifting height field of mountains & valleys drawn as contour lines under the swarm.
  // The boids are pushed downhill by its gradient → they flow through the valleys and cannot climb
  // over the peaks (steep slopes act as a soft wall). Right now the relief is a pure analytic
  // function of position + time (no buffer); gesture-sculpting later adds an editable delta on top.
  // These values are meant to be dialed in via the temporary TerrainPanel, then baked as defaults.
  /** Master switch for the terrain layer (render + boid avoidance). */
  terrainEnabled: boolean;
  /** How hard the downhill gradient pushes the boids. 0 = boids ignore the relief entirely. */
  terrainForce: number;
  /** Spatial frequency of the relief. Higher = more, smaller mountains; lower = broad ranges. */
  terrainScale: number;
  /** Valley↔mountain ratio (0..1). Low = almost all flat plateau with only a few isolated peaks;
   *  high = more mountainous. Controls the height threshold above which ground becomes mountain. */
  terrainCoverage: number;
  /** Domain-warp strength (0 = grid-aligned base look; higher = ridges bend more organically). */
  terrainWarp: number;
  /** How fast the whole landscape slowly drifts/morphs over time (0 = frozen relief). */
  terrainDrift: number;
  /** Number of contour lines across the full height range. Higher = a denser topographic map. */
  terrainLineCount: number;
  /** On-screen thickness of the contour lines (in pixels, anti-aliased). */
  terrainLineWidth: number;
  /** Brightness of the contour lines over the background. */
  terrainLineBright: number;
  /** Overall strength/brightness of the elevation fill color (0 = black, just the lines). */
  terrainTint: number;
  /** Hill-shading strength: directional light from the height gradient that makes ridges bright
   *  and shadowed slopes dark → the flat field reads as real 3D relief. 0 = flat (no shading). */
  terrainShade: number;
  /** Hypsometric elevation ramp (linear RGB, 0..1): valley floor → mid slopes → peaks. Kept
   *  muted/dark enough that the additive swarm on top still pops, but clearly readable by color. */
  terrainValley: RGB;
  terrainMid: RGB;
  terrainPeak: RGB;
  /** Snow/rock cap color blended onto the highest ground (set amount to 0 to disable the cap). */
  terrainSnow: RGB;
  /** Strength of the snow/rock cap on peaks (0 = off → peaks stay the peak color). */
  terrainSnowAmount: number;

  // ── Stage 3.5: terrain sculpting (long-press brush → editable delta on top of the base) ────
  /** Active sculpt tool. off = single-finger touch does the swirl; raise/lower = touch sculpts. */
  terrainTool: TerrainTool;
  /** Brush radius (share of screen height, aspect-corrected → round on screen). */
  terrainBrushSize: number;
  /** How fast the brush raises/lowers the ground per second of holding. */
  terrainBrushStrength: number;
  /** Jaggedness of sculpted relief: 0 = smooth hill/basin, 1 = very craggy, angular mountains. */
  terrainBrushDetail: number;
  /** How fast the sculpted relief relaxes back toward the base per second (0 = permanent). */
  terrainHealRate: number;

  // ── Stage 2.5: refuge / rescue effect (the extinction safety net) ──────────
  // Without this the ecosystem is NOT endless: adaptive reproduction needs a living, well-fed
  // parent nearby, so a species at 0 can never come back — extinction is an absorbing state. And
  // because cyclic dominance gives every species exactly one prey, one extinction starves the next
  // species in the ring, which starves the next → total collapse within ~a minute.
  // The fix mirrors the "rescue effect" from metapopulation ecology (Brown & Kodric-Brown 1977):
  // local populations do die out in the wild, and are re-colonised from a reservoir outside the
  // observed patch. Here: a species that drops below `rescueThreshold` gets re-seeded as a small
  // group in its home region — arriving at FULL energy so it can immediately act as a parent for
  // the normal adaptive reproduction, which then does the actual recovery.
  /** Master switch for the refuge. Off = species can go extinct for good (the old behaviour). */
  rescueEnabled: boolean;
  /** Population below which a species counts as critically endangered and gets re-colonised.
   *  Keep this LOW (~20 of 8000): it must only engage at the very brink, so the populations can
   *  still crash and recover dramatically. Too high and everything sticks to the floor — the
   *  oscillation, i.e. the whole spectacle, dies. */
  rescueThreshold: number;
  /** How fast the refuge sends individuals, in boids per second (scaled by how deep the deficit
   *  is, so a species at 0 recovers fastest and the flow eases off near the threshold). */
  rescueRate: number;
  /** Second line of defence: if the WHOLE ecosystem is empty for a few seconds, restart it.
   *  With the refuge on this should never fire — it is the insurance for an unattended exhibition,
   *  not the mechanism. */
  rescueRestart: boolean;

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
  maxSpeed: 0.12,
  maxForce: 2,
  alignWeight: 1,
  cohesionWeight: 0.6,
  separationWeight: 2,
  boidScale: 0.007,
  trailFade: 0.17,
  colorIntensity: 0.8,
  declump: 0.01, // off → exact original density; raise it to thin dense clumps (look + FPS)
  background: [0, 0, 0],

  // swirl (tune live in the SwirlPanel, then bake here)
  swirlStrength: 2.5,
  swirlRadius: 0.4,
  swirlFalloff: 1.6,
  swirlInward: 0,
  swirlDir: -1,
  swirlRampUp: 0.12,
  swirlRampDown: 0.5,

  // terrain (tune live in the TerrainPanel, then bake here)
  terrainEnabled: true,
  terrainForce: 6,
  terrainScale: 3.75, // lower = bigger mountains / broader valleys (numerically tuned)
  terrainCoverage: 0.5, // mostly flat plateau + a few isolated, craggy tall peaks (tuned)
  terrainWarp: 0.5, // 0 = current grid-aligned look (dial up for organic, non-grid ridges)
  terrainDrift: 0.14,
  terrainLineCount: 15,
  terrainLineWidth: 1,
  terrainLineBright: 0.5,
  terrainTint: 1,
  terrainShade: 0.8,
  // earthy hypsometric ramp: dark blue-green basin → olive slopes → muted rock-brown peaks.
  // Peaks are a medium earthy brown (NOT near-white) so mountain tops don't read as pale blobs;
  // the hill-shading provides the light/dark, not a bright fill color.
  terrainValley: [0.0078, 0.0078, 0.0078],
  terrainMid: [0.1529, 0.1608, 0.1451],
  terrainPeak: [0.4157, 0.3882, 0.3451], // lighter rock so peaks read as high (snow cap added on top)
  terrainSnow: [0.9, 0.92, 0.96], // snow/rock cap on the very highest ground
  terrainSnowAmount: 0.85,

  // terrain sculpting (brush)
  terrainTool: "off",
  terrainBrushSize: 0.22,
  terrainBrushStrength: 0.8,
  terrainBrushDetail: 0, // smooth rounded raise/lower by default; raise for craggy mountains
  terrainHealRate: 0.02, // slow self-heal (relief relaxes over ~50 s)

  // refuge / rescue effect — deliberately a low floor, so only true extinction is blocked
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

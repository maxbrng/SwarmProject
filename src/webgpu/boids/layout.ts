// Uniform-buffer layouts. Each map below turns a WGSL struct field into its float offset, so the
// CPU-side packing reads params[PARAM.rescueThr] instead of a bare params[38]. Keep every map in
// lockstep with its struct — a mismatch is silent (wrong values, or a black screen), never a compile
// error. Sources: Params → shaders/common/params.wgsl, RenderParams → shaders/boids.wgsl,
// TerrainParams → shaders/terrain.wgsl, Brush → shaders/terrain-edit.wgsl.

// Main per-frame compute uniform.
export const PARAM = {
  dt: 0, perception: 1, sepDist: 2, maxSpeed: 3, maxForce: 4,
  alignW: 5, cohesionW: 6, separationW: 7, aspect: 8, count: 9,
  time: 10, numSpecies: 11, chaseW: 12, fleeW: 13, killRadius: 14,
  birthRate: 15, deathMode: 16, birthMode: 17, starveRate: 18, domMode: 19,
  adaptiveStrength: 20, cellSize: 21, gridX: 22, gridY: 23,
  declump: 24, swirlX: 25, swirlY: 26, swirlAmp: 27,
  swirlStrength: 28, swirlRadius: 29, swirlFalloff: 30, swirlInward: 31,
  swirlDir: 32, terrainForce: 33, terrainScale: 34, terrainDrift: 35,
  terrainCoverage: 36, terrainWarp: 37, rescueThr: 38, rescueRate: 39,
  terrainSeedX: 40, terrainSeedY: 41,
} as const;
// Padded to 11×vec4 (the struct's trailing _pg4/_pg5 are the two spare floats).
export const PARAMS_FLOATS = 44;

// Boids render uniform (vertex + fragment). colorGain is read in the fragment stage.
export const RENDER = {
  aspect: 0, boidScale: 1, maxSpeed: 2, deathMode: 3, colorGain: 4,
} as const;
export const RENDER_FLOATS = 8;

// Terrain render uniform. The four elevation colours are vec4s whose alpha carries an unrelated
// scalar (coverage / warp / shade / snowAmount), and misc.xyz holds unitsPerPixel + the seed.
export const TERRAIN = {
  aspect: 0, time: 1, scale: 2, drift: 3,
  lineCount: 4, lineWidth: 5, lineBright: 6, tint: 7,
  valleyR: 8, valleyG: 9, valleyB: 10, coverage: 11,
  midR: 12, midG: 13, midB: 14, warp: 15,
  peakR: 16, peakG: 17, peakB: 18, shade: 19,
  snowR: 20, snowG: 21, snowB: 22, snowAmount: 23,
  unitsPerPixel: 24, seedX: 25, seedY: 26,
} as const;
export const TERRAIN_FLOATS = 28;

// Terrain sculpt-brush uniform.
export const BRUSH = {
  u: 0, v: 1, radius: 2, strength: 3,
  detail: 4, heal: 5, brushOn: 6, dt: 7,
  aspect: 8, time: 9,
} as const;
export const BRUSH_FLOATS = 12;

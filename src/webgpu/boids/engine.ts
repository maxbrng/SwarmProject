// WebGPU boids engine.
// init → runs autonomously in a requestAnimationFrame loop.
// A compute shader (ping-pong) computes the behavior; rendering goes into a
// trail texture (fade pass + additive boids), which is then blitted onto the canvas.
//
// Buffers are pre-allocated for MAX_COUNT boids and all filled once;
// cfg.count only controls how many are actively simulated/drawn →
// the count is adjustable live without re-allocation.

import {
  BoidsConfig,
  DEFAULT_CONFIG,
  MAX_COUNT,
  MAX_SPECIES,
  SPECIES_PALETTE,
  SeedMode,
} from "./config";
import {
  computeWGSL,
  boidsWGSL,
  fadeWGSL,
  blitWGSL,
  countWGSL,
  gridCountWGSL,
  gridScanWGSL,
  gridScatterWGSL,
  terrainWGSL,
  terrainEditWGSL,
  DELTA_W,
  DELTA_H,
} from "./shaders";

export interface BoidsHandle {
  dispose: () => void;
  /** Change parameters live (including count, up to MAX_COUNT). */
  update: (partial: Partial<BoidsConfig>) => void;
  /** Restart the ecosystem (with the current seedMode/numSpecies). */
  reseed: () => void;
  /** Erase all sculpted terrain (reset the delta buffer to 0). */
  clearTerrain: () => void;
  /** Roll a new random terrain seed → a different landscape arrangement (same character). */
  reseedTerrain: () => void;
  /** Snapshot of the full live config (all fields, incl. swirl + terrain) — for presets / defaults. */
  getConfig: () => BoidsConfig;
}

export interface EngineOptions {
  config?: Partial<BoidsConfig>;
  onFps?: (fps: number) => void;
  /** Alive boids per species (length MAX_SPECIES), several times per second. */
  onCounts?: (counts: number[]) => void;
  /**
   * Live swirl state for a subtle visual overlay (called every frame). Center + radius in CSS
   * pixels relative to the canvas, amp is the 0..1 activation envelope. amp ≈ 0 ⇒ nothing to draw.
   */
  onSwirl?: (s: { cx: number; cy: number; r: number; amp: number }) => void;
  /** Called when the swirl direction flips (±1), e.g. via the stir gesture — to sync the UI. */
  onSwirlDir?: (dir: number) => void;
}

const TRAIL_FORMAT: GPUTextureFormat = "rgba8unorm";
const PARAMS_FLOATS = 44; // compute uniform (176 bytes; 38..39 = refuge, 40..41 = terrain seed)
const FLOATS_PER_BOID = 8; // pos.xy, vel.xy, species, energy, age, flash
// Cap the render resolution. Touch devices (the iPad) get a lower cap: a Retina panel at dpr 2
// renders ~4× the pixels, and the terrain fragment (multi-octave fbm + gradient samples per pixel)
// is fill-rate bound → capping dpr there is the single biggest FPS win, for a small sharpness cost.
const MAX_DPR = 2;
const MAX_DPR_TOUCH = 1.5;
// Stir gesture: rotating the finger sets the swirl direction. We accumulate the per-frame turn
// (sin of the angle between consecutive move vectors, speed-independent) and flip when a clear
// rotation is reached. Straight drags have ~0 turn → they only move the vortex, never flip it.
const STIR_MOVE_EPS = 0.002; // min per-frame move (normalized) to count as motion
const STIR_DECAY = 0.9; // how fast the accumulated turn fades (per frame)
const STIR_TH = 1.2; // accumulated turn needed to flip direction (~a clear arc)
// Spatial grid: max resolution the neighbour-search grid can have. Buffers are sized for this;
// the actual grid dims each frame are ≤ these (cell size grows with the perception radius).
const MAX_GRID_X = 128;
const MAX_GRID_Y = 80;
const MAX_CELLS = MAX_GRID_X * MAX_GRID_Y; // 10240
// Emergency-restart watchdog (second line of defence behind the in-shader refuge). Only fires when
// the ENTIRE ecosystem is effectively empty for a sustained stretch — with the refuge enabled this
// should never happen, so it exists purely as insurance for an unattended exhibition. Deliberately
// not a config slider: it must not be tuned into a state where it fires during normal operation.
const WATCHDOG_ALIVE = 5; // total alive at or below this counts as collapsed
const WATCHDOG_SECONDS = 6; // how long it must stay collapsed before reseeding

function deathModeNum(m: BoidsConfig["deathMode"]): number {
  return m === "energy" ? 1 : 0;
}

function birthModeNum(m: BoidsConfig["birthMode"]): number {
  return { off: 0, constant: 1, adaptive: 2, homeland: 3 }[m];
}

// Who-eats-whom matrix as a per-predator bitmask (row s: bit b set ⇒ s eats b).
// 8 floats = 2×vec4; only the first `numSpecies` rows are used.
function computeDominance(mode: BoidsConfig["dominanceMode"], numSpecies: number) {
  const rows = new Array(6).fill(0);
  // No fixed matrix for a lone species, or in chaos mode (decided per encounter in the shader).
  if (numSpecies < 2 || mode === "chaos") return new Float32Array(8);
  if (mode === "cyclic") {
    for (let a = 0; a < numSpecies; a++) rows[a] |= 1 << ((a + 1) % numSpecies);
  } else {
    // random tournament: each pair's winner decided by a coin flip
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

export async function createBoidsEngine(
  canvas: HTMLCanvasElement,
  opts: EngineOptions = {},
): Promise<BoidsHandle> {
  const cfg: BoidsConfig = { ...DEFAULT_CONFIG, ...opts.config };
  cfg.count = Math.min(cfg.count, MAX_COUNT);

  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error("WebGPU is not supported by this browser (keep Chrome up to date).");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter found.");
  const device = await adapter.requestDevice();
  // Surface GPU loss (e.g. after a GPU-process crash) instead of silently freezing.
  device.lost.then((info) => {
    // eslint-disable-next-line no-console
    console.error("WebGPU device lost:", info.reason, info.message);
  });
  // Log the first WGSL/validation error in clear text (WGSL errors don't throw synchronously).
  let loggedErr = false;
  device.addEventListener("uncapturederror", (e) => {
    if (loggedErr) return;
    loggedErr = true;
    // eslint-disable-next-line no-console
    console.error("WebGPU error:", (e as GPUUncapturedErrorEvent).error.message);
  });

  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("WebGPU canvas context not available.");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // ── Buffers (pre-allocated for MAX_COUNT) ────────────────────────────────────
  // Boid = 8 floats (pos.xy, vel.xy, species, energy, age, flash) → 32 bytes
  const boidData = new Float32Array(MAX_COUNT * FLOATS_PER_BOID);
  function seedBoids(numSpecies: number, seedMode: SeedMode) {
    // aspect for the distribution (canvas is mounted, clientWidth available)
    const asp = Math.max(1, (canvas.clientWidth || 1) / (canvas.clientHeight || 1));
    // species centers evenly on a circle → maximally far apart (corners/edges)
    const centers: [number, number][] = [];
    for (let s = 0; s < numSpecies; s++) {
      const th = (2 * Math.PI * (s + 0.25)) / numSpecies;
      centers.push([Math.cos(th) * asp * 0.78, Math.sin(th) * 0.78]);
    }
    const clusterR = 0.3;
    for (let i = 0; i < MAX_COUNT; i++) {
      const sp = i % numSpecies;
      const o = i * FLOATS_PER_BOID;
      let x: number;
      let y: number;
      if (seedMode === "clustered") {
        const c = centers[sp];
        const rr = Math.sqrt(Math.random()) * clusterR; // evenly filled disc
        const ra = Math.random() * Math.PI * 2;
        x = Math.max(-asp * 0.98, Math.min(asp * 0.98, c[0] + Math.cos(ra) * rr));
        y = Math.max(-0.98, Math.min(0.98, c[1] + Math.sin(ra) * rr));
      } else {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
      }
      const a = Math.random() * Math.PI * 2;
      const s = cfg.maxSpeed * (0.6 + Math.random() * 0.4);
      boidData[o + 0] = x;
      boidData[o + 1] = y;
      boidData[o + 2] = Math.cos(a) * s;
      boidData[o + 3] = Math.sin(a) * s;
      boidData[o + 4] = sp; // species (evenly distributed)
      boidData[o + 5] = 0.6 + Math.random() * 0.3; // energy
      boidData[o + 6] = Math.random() * 5; // age
      boidData[o + 7] = 0; // flash
    }
  }
  seedBoids(cfg.numSpecies, cfg.seedMode);

  const boidBuffers: GPUBuffer[] = [0, 1].map(() =>
    device.createBuffer({
      size: boidData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  );
  device.queue.writeBuffer(boidBuffers[0], 0, boidData);

  // color/size palette per species (rgb + size factor), uploaded once
  const paletteBuffer = device.createBuffer({
    size: MAX_SPECIES * 4 * 4, // 6 × vec4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const paletteData = new Float32Array(MAX_SPECIES * 4);
  // rgb comes from the (live-editable) speciesColors, the size factor stays from SPECIES_PALETTE.
  function writePalette() {
    for (let s = 0; s < MAX_SPECIES; s++) {
      const col = cfg.speciesColors[s] ?? SPECIES_PALETTE[s] ?? [1, 1, 1];
      const size = SPECIES_PALETTE[s]?.[3] ?? 1;
      paletteData[s * 4 + 0] = col[0];
      paletteData[s * 4 + 1] = col[1];
      paletteData[s * 4 + 2] = col[2];
      paletteData[s * 4 + 3] = size;
    }
    device.queue.writeBuffer(paletteBuffer, 0, paletteData);
  }
  writePalette();

  // population counting: atomics buffer + staging buffer for async readback
  const countsBuffer = device.createBuffer({
    size: MAX_SPECIES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const stagingBuffer = device.createBuffer({
    size: MAX_SPECIES * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const countZeros = new Uint32Array(MAX_SPECIES);

  // population sizes fed back into the sim (for adaptive/homeland reproduction). 8 floats = 2×vec4.
  const popBuffer = device.createBuffer({
    size: 8 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const popData = new Float32Array(8);

  // Predator-prey (who-eats-whom) matrix, fed to the sim as a uniform.
  const domBuffer = device.createBuffer({
    size: 8 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  function writeDominance() {
    device.queue.writeBuffer(domBuffer, 0, computeDominance(cfg.dominanceMode, cfg.numSpecies));
  }
  writeDominance();

  // ── Spatial-grid buffers (counting sort of boids into cells each frame) ──────
  const cellCountBuf = device.createBuffer({
    size: MAX_CELLS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, // COPY_DST → cleared to 0 each frame
  });
  const cellStartBuf = device.createBuffer({
    size: (MAX_CELLS + 1) * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const cellCursorBuf = device.createBuffer({
    size: MAX_CELLS * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const sortedBuf = device.createBuffer({
    size: MAX_COUNT * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const cellOfBuf = device.createBuffer({
    size: MAX_COUNT * 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const cellZeros = new Uint32Array(MAX_CELLS); // to clear cellCount each frame

  let ping = 0; // ping-pong index (also reset by reseedNow)

  // Terrain seed: a random offset into the noise field, so the landscape ARRANGEMENT differs every
  // load (and on demand via reseedTerrain) while its character — set by scale/coverage/warp — stays.
  // A wide range keeps successive seeds well apart in the noise domain → visibly different maps.
  // NOT part of cfg: it is runtime state (like the ecosystem seed), never saved into presets.
  let terrainSeedX = Math.random() * 1000 - 500;
  let terrainSeedY = Math.random() * 1000 - 500;

  // rebuild the ecosystem (both ping-pong buffers, starting from buffer 0)
  function reseedNow() {
    seedBoids(cfg.numSpecies, cfg.seedMode);
    device.queue.writeBuffer(boidBuffers[0], 0, boidData);
    device.queue.writeBuffer(boidBuffers[1], 0, boidData);
    writeDominance(); // reroll (random mode gets fresh matchups on every restart)
    ping = 0;
  }

  const paramsBuffer = device.createBuffer({
    size: PARAMS_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderParamsBuffer = device.createBuffer({
    size: 8 * 4, // RenderParams = 5 floats, padded to 2×vec4
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const fadeBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // TerrainParams uniform: 28 floats / 112 bytes (+, misc vec4 with sim-units-per-pixel)
  const terrainParamsBuffer = device.createBuffer({
    size: 28 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Sculpted terrain delta: mutable f32 height field over screen uv (added on top of terrainH).
  const deltaBuffer = device.createBuffer({
    size: DELTA_W * DELTA_H * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const deltaZeros = new Float32Array(DELTA_W * DELTA_H);
  device.queue.writeBuffer(deltaBuffer, 0, deltaZeros); // start flat
  // Fragment-stage copy of the delta field as a TEXTURE. The terrain render shader samples this
  // instead of the storage buffer, because Apple/iOS WebGPU forbids storage buffers in the fragment
  // stage (maxStorageBuffersInFragmentStage = 0 → silent black terrain). Refreshed from deltaBuffer
  // every frame via copyBufferToTexture (bytesPerRow = DELTA_W*4 = 1280, a multiple of 256 ✓).
  const deltaTex = device.createTexture({
    size: [DELTA_W, DELTA_H],
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const deltaTexView = deltaTex.createView();
  // Brush uniform for the edit pass (12 floats).
  const editParamsBuffer = device.createBuffer({
    size: 12 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // triangle geometry per boid (+y = front)
  const triangle = new Float32Array([0.0, 1.0, -0.6, -0.8, 0.6, -0.8]);
  const triangleBuffer = device.createBuffer({
    size: triangle.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triangleBuffer, 0, triangle);

  // ── Bind group layouts ───────────────────────────────────────────────────────
  const computeBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // cellStart
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // sortedIdx
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // terrain delta
    ],
  });
  // Terrain edit (brush): uniform + read-write delta storage.
  const terrainEditBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  // Grid build passes share this simple 4-slot layout shape (uniform + 3 storage).
  const gridCountBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // inB
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // cellCount
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // cellOf
    ],
  });
  const gridScanBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // cellCount
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // cellStart
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // cellCursor
    ],
  });
  const gridScatterBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // cellCursor
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // sortedIdx
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // cellOf
    ],
  });
  const renderBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      // RenderParams is read in the fragment stage too (colorGain), so make it visible there.
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
    ],
  });
  const countBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const fadeBGL = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const blitBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  const terrainBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      // delta as a TEXTURE (not a fragment storage buffer — unsupported on Apple/iOS). r32float is
      // unfilterable → sampleType "unfilterable-float", sampled via textureLoad (no sampler).
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
    ],
  });

  // ── Pipelines ────────────────────────────────────────────────────────────────
  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
    compute: { module: device.createShaderModule({ code: computeWGSL }), entryPoint: "main" },
  });

  const countPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [countBGL] }),
    compute: { module: device.createShaderModule({ code: countWGSL }), entryPoint: "main" },
  });

  const gridCountPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [gridCountBGL] }),
    compute: { module: device.createShaderModule({ code: gridCountWGSL }), entryPoint: "main" },
  });
  const gridScanPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [gridScanBGL] }),
    compute: { module: device.createShaderModule({ code: gridScanWGSL }), entryPoint: "main" },
  });
  const gridScatterPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [gridScatterBGL] }),
    compute: { module: device.createShaderModule({ code: gridScatterWGSL }), entryPoint: "main" },
  });

  const boidsModule = device.createShaderModule({ code: boidsWGSL });
  const boidsPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
    vertex: {
      module: boidsModule,
      entryPoint: "vs",
      buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
      ],
    },
    fragment: {
      module: boidsModule,
      entryPoint: "fs",
      targets: [
        {
          format: TRAIL_FORMAT,
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const fadeModule = device.createShaderModule({ code: fadeWGSL });
  const fadePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [fadeBGL] }),
    vertex: { module: fadeModule, entryPoint: "vs" },
    fragment: {
      module: fadeModule,
      entryPoint: "fs",
      targets: [
        {
          format: TRAIL_FORMAT,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const blitModule = device.createShaderModule({ code: blitWGSL });
  const blitPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [blitBGL] }),
    vertex: { module: blitModule, entryPoint: "vs" },
    fragment: {
      module: blitModule,
      entryPoint: "fs",
      // Additive: the swarm glow is added on top of the terrain drawn first. Over pure black
      // (terrain disabled) this is identical to the old opaque copy → same look when off.
      targets: [
        {
          format: canvasFormat,
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  // Terrain: draws the contour-line relief into the canvas BEFORE the swarm blit.
  const terrainModule = device.createShaderModule({ code: terrainWGSL });
  const terrainPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [terrainBGL] }),
    vertex: { module: terrainModule, entryPoint: "vs" },
    fragment: { module: terrainModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
  });

  const terrainEditPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [terrainEditBGL] }),
    compute: { module: device.createShaderModule({ code: terrainEditWGSL }), entryPoint: "main" },
  });

  // ── Bind groups ──────────────────────────────────────────────────────────────
  const computeGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: boidBuffers[k] } },
        { binding: 2, resource: { buffer: boidBuffers[1 - k] } },
        { binding: 3, resource: { buffer: popBuffer } },
        { binding: 4, resource: { buffer: domBuffer } },
        { binding: 5, resource: { buffer: cellStartBuf } },
        { binding: 6, resource: { buffer: sortedBuf } },
        { binding: 7, resource: { buffer: deltaBuffer } },
      ],
    }),
  );
  const terrainEditGroup = device.createBindGroup({
    layout: terrainEditBGL,
    entries: [
      { binding: 0, resource: { buffer: editParamsBuffer } },
      { binding: 1, resource: { buffer: deltaBuffer } },
    ],
  });
  // grid build bind groups (count reads the current inB → one per ping)
  const gridCountGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: gridCountBGL,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: boidBuffers[k] } },
        { binding: 2, resource: { buffer: cellCountBuf } },
        { binding: 3, resource: { buffer: cellOfBuf } },
      ],
    }),
  );
  const gridScanGroup = device.createBindGroup({
    layout: gridScanBGL,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: cellCountBuf } },
      { binding: 2, resource: { buffer: cellStartBuf } },
      { binding: 3, resource: { buffer: cellCursorBuf } },
    ],
  });
  const gridScatterGroup = device.createBindGroup({
    layout: gridScatterBGL,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: cellCursorBuf } },
      { binding: 2, resource: { buffer: sortedBuf } },
      { binding: 3, resource: { buffer: cellOfBuf } },
    ],
  });
  const renderGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: boidBuffers[k] } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
        { binding: 2, resource: { buffer: paletteBuffer } },
      ],
    }),
  );
  const countGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: countBGL,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: boidBuffers[k] } },
        { binding: 2, resource: { buffer: countsBuffer } },
      ],
    }),
  );
  const fadeGroup = device.createBindGroup({
    layout: fadeBGL,
    entries: [{ binding: 0, resource: { buffer: fadeBuffer } }],
  });
  const terrainGroup = device.createBindGroup({
    layout: terrainBGL,
    entries: [
      { binding: 0, resource: { buffer: terrainParamsBuffer } },
      { binding: 1, resource: deltaTexView },
    ],
  });

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // ── Trail texture (size-dependent) ───────────────────────────────────────────
  let trailTexture: GPUTexture | null = null;
  let trailView: GPUTextureView | null = null;
  let blitGroup: GPUBindGroup | null = null;
  let needsClear = true;
  let aspect = 1;

  function resize() {
    const cap = window.matchMedia?.("(pointer: coarse)").matches ? MAX_DPR_TOUCH : MAX_DPR;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h && trailTexture) return;

    canvas.width = w;
    canvas.height = h;
    aspect = w / h;

    trailTexture?.destroy();
    trailTexture = device.createTexture({
      size: [w, h],
      format: TRAIL_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    trailView = trailTexture.createView();
    blitGroup = device.createBindGroup({
      layout: blitBGL,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: trailView },
      ],
    });
    needsClear = true;
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Re-render at the correct resolution when the device pixel ratio changes — e.g. the window
  // is dragged between a Retina laptop screen (dpr 2) and an external monitor (dpr 1). The
  // ResizeObserver only fires on element-size changes, so without this the canvas keeps its old
  // dpr after moving displays and looks blurry (rendered at the wrong resolution, then scaled).
  let dprMedia: MediaQueryList | null = null;
  function onDprChange() {
    resize();
    watchDpr(); // matchMedia is one-shot per dpr value → re-arm for the new ratio
  }
  function watchDpr() {
    dprMedia?.removeEventListener("change", onDprChange);
    dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMedia.addEventListener("change", onDprChange);
  }
  watchDpr();

  // ── Swirl interaction (single-finger touch → vortex) ─────────────────────────
  // Track every active pointer by id (Pointer Events → real multi-touch). The swirl only runs
  // while EXACTLY ONE finger is down; two or more fingers switch it off (reserved for later
  // multi-finger gestures). The center follows that finger; a smooth amp envelope ramps the
  // effect in on touch and back out on release, so the swarm heals itself.
  const activePointers = new Map<number, { nx: number; ny: number }>();
  let swirlX = 0;
  let swirlY = 0;
  let swirlAmp = 0;
  let lastNx = 0.5; // last pointer position (normalized), kept so the overlay stays put while healing
  let lastNy = 0.5;
  // stir-gesture bookkeeping
  let prevNx = 0.5;
  let prevNy = 0.5;
  let prevMvX = 0;
  let prevMvY = 0;
  let turnAccum = 0;

  // Change the swirl direction and let the UI know (keeps the panel button in sync with gestures).
  function applyDir(d: number) {
    if (cfg.swirlDir === d) return;
    cfg.swirlDir = d;
    opts.onSwirlDir?.(d);
  }

  function pointerNorm(e: PointerEvent): { nx: number; ny: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      nx: (e.clientX - rect.left) / Math.max(1, rect.width),
      ny: (e.clientY - rect.top) / Math.max(1, rect.height),
    };
  }
  function onPointerDown(e: PointerEvent) {
    activePointers.set(e.pointerId, pointerNorm(e));
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }
  function onPointerMove(e: PointerEvent) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, pointerNorm(e));
  }
  function onPointerUp(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  // ── Frame loop ───────────────────────────────────────────────────────────────
  const bg = cfg.background;
  const startTime = performance.now();
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  const params = new Float32Array(PARAMS_FLOATS);
  const renderParams = new Float32Array(8);
  const terrainParams = new Float32Array(28);
  const editParams = new Float32Array(12); // brush uniform for the sculpt pass

  // FPS averaging
  let fpsAccum = 0;
  let fpsFrames = 0;

  // population readback (several times per second, not every frame).
  // Gate on the staging buffer's own mapState instead of a boolean flag — a boolean
  // could get stuck true (e.g. if a mapAsync resolved after dispose) and freeze counts.
  const COUNT_EVERY = 8;
  let frameNo = 0;
  const speciesCounts: number[] = new Array(MAX_SPECIES).fill(0);
  // Watchdog bookkeeping. `countsReady` gates it until the first readback has landed — speciesCounts
  // starts all-zero, and without the gate a fresh start would look like a collapse and reseed itself.
  let countsReady = false;
  let collapseTime = 0;

  function frame(now: number) {
    if (disposed) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // cap jumps (tab switch)

    // report FPS (~2×/second)
    if (opts.onFps && dt > 0) {
      fpsAccum += dt;
      fpsFrames += 1;
      if (fpsAccum >= 0.5) {
        opts.onFps(fpsFrames / fpsAccum);
        fpsAccum = 0;
        fpsFrames = 0;
      }
    }

    const count = cfg.count;

    // Emergency restart: the whole ecosystem has been empty long enough that nothing can recover.
    if (cfg.rescueRestart && countsReady) {
      let totalAlive = 0;
      for (let s = 0; s < MAX_SPECIES; s++) totalAlive += speciesCounts[s] ?? 0;
      if (totalAlive <= WATCHDOG_ALIVE) {
        collapseTime += dt;
        if (collapseTime >= WATCHDOG_SECONDS) {
          reseedNow();
          collapseTime = 0;
        }
      } else {
        collapseTime = 0;
      }
    } else {
      collapseTime = 0;
    }

    params[0] = dt;
    params[1] = cfg.perception;
    params[2] = cfg.separationDist;
    params[3] = cfg.maxSpeed;
    params[4] = cfg.maxForce;
    params[5] = cfg.alignWeight;
    params[6] = cfg.cohesionWeight;
    params[7] = cfg.separationWeight;
    params[8] = aspect;
    params[9] = count;
    params[10] = (now - startTime) / 1000; // time (for wander)
    params[11] = cfg.numSpecies;
    params[12] = cfg.chaseWeight;
    params[13] = cfg.fleeWeight;
    params[14] = cfg.killRadius;
    params[15] = cfg.birthRate;
    params[16] = deathModeNum(cfg.deathMode);
    params[17] = birthModeNum(cfg.birthMode);
    params[18] = cfg.starveRate;
    params[19] = cfg.dominanceMode === "chaos" ? 1 : 0;
    params[20] = cfg.adaptiveStrength;
    // spatial grid: cell size ≥ the neighbour radius (interR = perception·1.6) so a 3×3 cell
    // block covers all neighbours; grid dims capped at MAX_GRID_* (buffers are sized for that).
    const interR = cfg.perception * 1.6;
    const cellSize = Math.max(interR, (2 * aspect) / MAX_GRID_X, 2 / MAX_GRID_Y);
    const gridX = Math.min(MAX_GRID_X, Math.max(1, Math.ceil((2 * aspect) / cellSize)));
    const gridY = Math.min(MAX_GRID_Y, Math.max(1, Math.ceil(2 / cellSize)));
    params[21] = cellSize;
    params[22] = gridX;
    params[23] = gridY;
    params[24] = cfg.declump; // anti-crowd strength (0 = off)

    // Terrain sculpting is gesture-driven (multi-touch): 2 fingers RAISE mountains, 3+ fingers
    // LOWER valleys. The brush centre is the finger centroid; its radius is the finger spread
    // (pinch = small, spread hand = large), aspect-corrected to match the round on-screen brush.
    // A single finger is the swirl vortex. Legacy single-finger button paint (dev TerrainPanel)
    // still works when a sculpt tool is explicitly selected.
    const terrainOn = cfg.terrainEnabled;
    const nFingers = activePointers.size;
    const buttonSculpt = terrainOn && cfg.terrainTool !== "off" && nFingers === 1;
    const gestureSculpt = terrainOn && nFingers >= 2;
    let brushActive = 0;
    let brushU = 0.5;
    let brushV = 0.5;
    let brushRadius = cfg.terrainBrushSize;
    let brushSign = 1; // +1 raise, -1 lower
    if (gestureSculpt) {
      let cx = 0;
      let cy = 0;
      for (const p of activePointers.values()) {
        cx += p.nx;
        cy += p.ny;
      }
      cx /= nFingers;
      cy /= nFingers;
      let spread = 0;
      for (const p of activePointers.values()) {
        const du = (p.nx - cx) * aspect;
        const dv = p.ny - cy;
        spread = Math.max(spread, Math.hypot(du, dv));
      }
      brushU = cx;
      brushV = cy;
      // fingers sit ~on the brush rim; floor keeps a usable brush when pinched, cap bounds huge spreads
      brushRadius = Math.min(0.55, Math.max(0.08, spread * 1.15));
      brushSign = nFingers === 2 ? 1 : -1; // 2 = raise, 3+ = lower
      brushActive = 1;
    } else if (buttonSculpt) {
      const p = activePointers.values().next().value;
      if (p) {
        brushU = p.nx;
        brushV = p.ny;
        brushRadius = cfg.terrainBrushSize;
        brushSign = cfg.terrainTool === "lower" ? -1 : 1;
        brushActive = 1;
      }
    }

    // swirl: exactly one finger AND no sculpt tool → the vortex follows it and ramps up; otherwise
    // it fades out in place. Center is in sim space (y up, x aspect-scaled), matching pos.
    const swirlFinger = nFingers === 1 && !buttonSculpt;
    let targetAmp = 0;
    if (swirlFinger) {
      const p = activePointers.values().next().value;
      if (p) {
        lastNx = p.nx;
        lastNy = p.ny;
        swirlX = (p.nx * 2 - 1) * aspect;
        swirlY = 1 - p.ny * 2;
        targetAmp = 1;
      }
    }
    const ramp = targetAmp > swirlAmp ? cfg.swirlRampUp : cfg.swirlRampDown;
    const kAmp = ramp > 0 ? Math.min(1, dt / ramp) : 1;
    swirlAmp += (targetAmp - swirlAmp) * kAmp;

    // Stir gesture: a curved finger motion sets the rotation direction; a straight drag doesn't.
    if (swirlFinger) {
      const mvX = lastNx - prevNx;
      const mvY = lastNy - prevNy;
      const ncur = Math.hypot(mvX, mvY);
      if (ncur > STIR_MOVE_EPS) {
        const nprev = Math.hypot(prevMvX, prevMvY);
        if (nprev > STIR_MOVE_EPS) {
          // sin of the turn between consecutive move vectors (screen coords, y down)
          const sinTurn = (prevMvX * mvY - prevMvY * mvX) / (nprev * ncur);
          turnAccum = turnAccum * STIR_DECAY + sinTurn;
          // screen-CW stir (turnAccum > 0) → clockwise swirl (dir -1), and vice versa
          if (turnAccum > STIR_TH && cfg.swirlDir > 0) {
            applyDir(-1);
            turnAccum = 0;
          } else if (turnAccum < -STIR_TH && cfg.swirlDir < 0) {
            applyDir(1);
            turnAccum = 0;
          }
        }
        prevMvX = mvX;
        prevMvY = mvY;
      }
      prevNx = lastNx;
      prevNy = lastNy;
    } else {
      turnAccum = 0;
      prevMvX = 0;
      prevMvY = 0;
      prevNx = lastNx;
      prevNy = lastNy;
    }
    params[25] = swirlX;
    params[26] = swirlY;
    params[27] = swirlAmp;
    params[28] = cfg.swirlStrength;
    params[29] = cfg.swirlRadius;
    params[30] = cfg.swirlFalloff;
    params[31] = cfg.swirlInward;
    params[32] = cfg.swirlDir;
    // terrain: downhill push weight (0 when disabled → boids ignore the relief), spatial freq, drift
    params[33] = cfg.terrainEnabled ? cfg.terrainForce : 0;
    params[34] = cfg.terrainScale;
    params[35] = cfg.terrainDrift;
    params[36] = cfg.terrainCoverage;
    params[37] = cfg.terrainWarp;
    // refuge: threshold 0 switches the safety net off inside the shader, so the master toggle
    // needs no separate uniform slot (these two were the struct's padding floats).
    params[38] = cfg.rescueEnabled ? cfg.rescueThreshold : 0;
    params[39] = cfg.rescueRate;
    params[40] = terrainSeedX;
    params[41] = terrainSeedY;
    device.queue.writeBuffer(paramsBuffer, 0, params);

    // terrain render uniform (must use the SAME scale/drift as the sim so drawn ⇄ felt line up)
    const simTime = (now - startTime) / 1000;
    terrainParams[0] = aspect;
    terrainParams[1] = simTime;
    terrainParams[2] = cfg.terrainScale;
    terrainParams[3] = cfg.terrainDrift;
    terrainParams[4] = cfg.terrainLineCount;
    terrainParams[5] = cfg.terrainLineWidth;
    terrainParams[6] = cfg.terrainLineBright;
    terrainParams[7] = cfg.terrainTint;
    terrainParams[8] = cfg.terrainValley[0];
    terrainParams[9] = cfg.terrainValley[1];
    terrainParams[10] = cfg.terrainValley[2];
    terrainParams[11] = cfg.terrainCoverage; // valley.a = terrainCoverage (shared with the sim)
    terrainParams[12] = cfg.terrainMid[0];
    terrainParams[13] = cfg.terrainMid[1];
    terrainParams[14] = cfg.terrainMid[2];
    terrainParams[15] = cfg.terrainWarp; // mid.a = terrainWarp (shared with the sim)
    terrainParams[16] = cfg.terrainPeak[0];
    terrainParams[17] = cfg.terrainPeak[1];
    terrainParams[18] = cfg.terrainPeak[2];
    terrainParams[19] = cfg.terrainShade; // peak.a = hill-shading strength
    terrainParams[20] = cfg.terrainSnow[0];
    terrainParams[21] = cfg.terrainSnow[1];
    terrainParams[22] = cfg.terrainSnow[2];
    terrainParams[23] = cfg.terrainSnowAmount; // snow.a = cap strength
    // misc.x = sim units per pixel (sim y spans 2 over the full canvas height) → used for the
    // derivative-free contour line width. Guard against a 0 height before the first resize.
    terrainParams[24] = 2 / Math.max(1, canvas.height);
    terrainParams[25] = terrainSeedX; // misc.y — must match params[40] in the compute pass
    terrainParams[26] = terrainSeedY; // misc.z — must match params[41]
    device.queue.writeBuffer(terrainParamsBuffer, 0, terrainParams);

    // brush uniform for the sculpt pass (heal always runs; the brush adds only while held)
    editParams[0] = brushU;
    editParams[1] = brushV;
    editParams[2] = brushRadius;
    editParams[3] = cfg.terrainBrushStrength * brushSign;
    editParams[4] = cfg.terrainBrushDetail;
    editParams[5] = cfg.terrainHealRate;
    editParams[6] = brushActive;
    editParams[7] = dt;
    editParams[8] = aspect;
    editParams[9] = (now - startTime) / 1000;
    device.queue.writeBuffer(editParamsBuffer, 0, editParams);

    // feed the subtle visual swirl overlay: center + radius in CSS px + envelope.
    if (opts.onSwirl) {
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      opts.onSwirl({
        cx: lastNx * cw,
        cy: lastNy * ch,
        r: cfg.swirlRadius * (ch / 2), // sim half-height (1 unit) = ch/2 px
        amp: swirlAmp,
      });
    }
    device.queue.writeBuffer(cellCountBuf, 0, cellZeros, 0, gridX * gridY); // clear per-cell counts

    // feed population sizes into the sim, but glide toward the latest counts instead of
    // snapping. The count readback lags a few frames (GPU backpressure); snapping made the
    // adaptive "need" jump, which spawned births in sudden waves. A smooth glide → births
    // trickle in gradually. ~0.5s time constant at 60 fps.
    const popSmooth = Math.min(1, 3 * dt);
    for (let s = 0; s < MAX_SPECIES; s++) {
      popData[s] += ((speciesCounts[s] ?? 0) - popData[s]) * popSmooth;
    }
    device.queue.writeBuffer(popBuffer, 0, popData);

    renderParams[0] = aspect;
    renderParams[1] = cfg.boidScale;
    renderParams[2] = cfg.maxSpeed;
    renderParams[3] = cfg.deathMode === "energy" ? 1 : 0; // brightness by energy
    renderParams[4] = cfg.colorIntensity;
    device.queue.writeBuffer(renderParamsBuffer, 0, renderParams);

    device.queue.writeBuffer(
      fadeBuffer,
      0,
      new Float32Array([bg[0], bg[1], bg[2], cfg.trailFade]),
    );

    frameNo++;
    const doCount =
      !!opts.onCounts && frameNo % COUNT_EVERY === 0 && stagingBuffer.mapState === "unmapped";
    if (doCount) device.queue.writeBuffer(countsBuffer, 0, countZeros); // zero the counters

    const encoder = device.createCommandEncoder();
    const gridDispatch = Math.ceil(count / 64);

    // −1) terrain sculpt: heal the delta + apply the brush. Runs first so the sim and the render
    //     this frame both see the updated relief. Only when terrain is enabled.
    if (cfg.terrainEnabled) {
      const editPass = encoder.beginComputePass();
      editPass.setPipeline(terrainEditPipeline);
      editPass.setBindGroup(0, terrainEditGroup);
      editPass.dispatchWorkgroups(Math.ceil((DELTA_W * DELTA_H) / 64));
      editPass.end();
      // Mirror the updated delta buffer into the texture the fragment shader samples (the render
      // stage can't read the storage buffer on Apple/iOS). bytesPerRow 1280 is 256-aligned.
      encoder.copyBufferToTexture(
        { buffer: deltaBuffer, bytesPerRow: DELTA_W * 4, rowsPerImage: DELTA_H },
        { texture: deltaTex },
        { width: DELTA_W, height: DELTA_H },
      );
    }

    // 0) build the spatial grid in THREE separate passes — dispatches within one pass are not
    //    ordered, but consecutive passes are (each sees the previous pass's storage writes).
    const countPass0 = encoder.beginComputePass();
    countPass0.setPipeline(gridCountPipeline);
    countPass0.setBindGroup(0, gridCountGroups[ping]);
    countPass0.dispatchWorkgroups(gridDispatch);
    countPass0.end();

    const scanPass0 = encoder.beginComputePass();
    scanPass0.setPipeline(gridScanPipeline);
    scanPass0.setBindGroup(0, gridScanGroup);
    scanPass0.dispatchWorkgroups(1);
    scanPass0.end();

    const scatterPass0 = encoder.beginComputePass();
    scatterPass0.setPipeline(gridScatterPipeline);
    scatterPass0.setBindGroup(0, gridScatterGroup);
    scatterPass0.dispatchWorkgroups(gridDispatch);
    scatterPass0.end();

    // 1) compute the behavior (reads inB[ping] + the grid, writes inB[1-ping])
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeGroups[ping]);
    cpass.dispatchWorkgroups(gridDispatch); // behavior compute uses workgroup_size(64)
    cpass.end();

    const latest = 1 - ping; // where the compute pass wrote to

    // 2) into the trail texture: fade + boids
    const trailPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: trailView!,
          loadOp: needsClear ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
        },
      ],
    });
    if (!needsClear) {
      trailPass.setPipeline(fadePipeline);
      trailPass.setBindGroup(0, fadeGroup);
      trailPass.draw(3);
    }
    trailPass.setPipeline(boidsPipeline);
    trailPass.setBindGroup(0, renderGroups[latest]);
    trailPass.setVertexBuffer(0, triangleBuffer);
    trailPass.draw(3, count);
    trailPass.end();
    needsClear = false;

    // 3) trail texture onto the canvas
    const canvasPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context!.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    // terrain relief first (fills the background), then the swarm glow additively on top
    if (cfg.terrainEnabled) {
      canvasPass.setPipeline(terrainPipeline);
      canvasPass.setBindGroup(0, terrainGroup);
      canvasPass.draw(3);
    }
    canvasPass.setPipeline(blitPipeline);
    canvasPass.setBindGroup(0, blitGroup!);
    canvasPass.draw(3);
    canvasPass.end();

    // 4) count populations (atomics) + copy into staging
    if (doCount) {
      const countPass = encoder.beginComputePass();
      countPass.setPipeline(countPipeline);
      countPass.setBindGroup(0, countGroups[latest]);
      countPass.dispatchWorkgroups(Math.ceil(count / 64));
      countPass.end();
      encoder.copyBufferToBuffer(countsBuffer, 0, stagingBuffer, 0, MAX_SPECIES * 4);
    }

    device.queue.submit([encoder.finish()]);

    if (doCount) {
      stagingBuffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          if (disposed) return;
          const arr = Array.from(new Uint32Array(stagingBuffer.getMappedRange().slice(0)));
          stagingBuffer.unmap();
          for (let s = 0; s < MAX_SPECIES; s++) speciesCounts[s] = arr[s] ?? 0;
          countsReady = true;
          opts.onCounts?.(arr);
        })
        .catch(() => {
          /* mapAsync can reject if the device was lost; the buffer stays unmapped → retried */
        });
    }

    ping = latest;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    update(partial: Partial<BoidsConfig>) {
      const prevSpecies = cfg.numSpecies;
      const prevSeed = cfg.seedMode;
      const prevDom = cfg.dominanceMode;
      Object.assign(cfg, partial);
      if (partial.speciesColors) writePalette();
      if (partial.count !== undefined) {
        cfg.count = Math.max(1, Math.min(Math.round(partial.count), MAX_COUNT));
      }
      if (partial.numSpecies !== undefined) {
        cfg.numSpecies = Math.max(1, Math.min(Math.round(partial.numSpecies), MAX_SPECIES));
      }
      // Species count or start layout changed → rebuild the ecosystem (also rerolls dominance).
      if (cfg.numSpecies !== prevSpecies || cfg.seedMode !== prevSeed) {
        reseedNow();
      } else if (cfg.dominanceMode !== prevDom) {
        writeDominance();
      }
    },
    reseed() {
      reseedNow();
    },
    clearTerrain() {
      device.queue.writeBuffer(deltaBuffer, 0, deltaZeros);
    },
    reseedTerrain() {
      // New random offset into the noise field. Applied instantly; the next frame's compute + render
      // both read it (params[40/41] and terrainParams[25/26]), so drawn and felt stay in lockstep.
      terrainSeedX = Math.random() * 1000 - 500;
      terrainSeedY = Math.random() * 1000 - 500;
    },
    getConfig() {
      return structuredClone(cfg);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      dprMedia?.removeEventListener("change", onDprChange);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      trailTexture?.destroy();
      boidBuffers.forEach((b) => b.destroy());
      paramsBuffer.destroy();
      renderParamsBuffer.destroy();
      fadeBuffer.destroy();
      terrainParamsBuffer.destroy();
      deltaBuffer.destroy();
      deltaTex.destroy();
      editParamsBuffer.destroy();
      triangleBuffer.destroy();
      paletteBuffer.destroy();
      countsBuffer.destroy();
      stagingBuffer.destroy();
      popBuffer.destroy();
      domBuffer.destroy();
      cellCountBuf.destroy();
      cellStartBuf.destroy();
      cellCursorBuf.destroy();
      sortedBuf.destroy();
      cellOfBuf.destroy();
      device.destroy();
    },
  };
}

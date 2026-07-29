// WebGPU boids engine — the orchestrator. It creates the GPU resources, runs the per-frame loop and
// returns a small handle (update/reseed/dispose) for the React layer. The heavy lifting lives in
// sibling modules: layout.ts (uniform field offsets), pipelines.ts (bind-group layouts + pipelines),
// input.ts (pointer tracking), modes.ts + seeding.ts (config → GPU translation and initial state).
// The WGSL simulation itself is in ./shaders.
//
// State is double-buffered (ping-pong): each frame reads one boid buffer and writes the other. The
// buffers always hold MAX_COUNT boids; cfg.count only limits how many are simulated, so the count is
// adjustable live without re-allocating. Each frame runs, in order:
//   1. terrain sculpt (heal the delta + apply the brush)
//   2. spatial grid (counting sort: count → scan → scatter) so neighbour search is O(n·k), not O(n²)
//   3. boids compute (flocking + predator-prey + swirl + terrain avoidance)
//   4. trail render (fade the previous frame, draw the boids additively into a trail texture)
//   5. composite (terrain relief, then the trail blitted additively onto the canvas)
//   6. population count (atomics + async readback, a few times per second)

import {
  BoidsConfig,
  DEFAULT_CONFIG,
  MAX_COUNT,
  MAX_SPECIES,
  SPECIES_PALETTE,
} from "./config";
import { DELTA_W, DELTA_H } from "./shaders";
import { createPipelines } from "./pipelines";
import { createPointerTracker } from "./input";
import {
  PARAM,
  RENDER,
  TERRAIN,
  BRUSH,
  PARAMS_FLOATS,
  RENDER_FLOATS,
  TERRAIN_FLOATS,
  BRUSH_FLOATS,
} from "./layout";
import { deathModeNum, birthModeNum, computeDominance } from "./modes";
import { FLOATS_PER_BOID, seedBoids } from "./seeding";

export interface BoidsHandle {
  dispose: () => void;
  update: (partial: Partial<BoidsConfig>) => void;
  reseed: () => void;
  clearTerrain: () => void;
  reseedTerrain: () => void;
  getConfig: () => BoidsConfig;
}

export interface EngineOptions {
  config?: Partial<BoidsConfig>;
  onFps?: (fps: number) => void;
  onCounts?: (counts: number[]) => void;
  // Live swirl state for the glow overlay. Center/radius in CSS px, amp is 0..1.
  onSwirl?: (s: { cx: number; cy: number; r: number; amp: number }) => void;
  // Fired when the swirl direction flips (±1) via the stir gesture, to sync the UI.
  onSwirlDir?: (dir: number) => void;
}

const TRAIL_FORMAT: GPUTextureFormat = "rgba8unorm";

// Touch devices get a lower render-resolution cap: the terrain fragment shader is fill-rate bound,
// so capping dpr there is the biggest FPS win for a small sharpness cost.
const MAX_DPR = 2;
const MAX_DPR_TOUCH = 1.5;

// Stir gesture: a rotating finger sets the swirl direction. We accumulate the per-frame turn and
// flip on a clear rotation; straight drags have ~0 turn, so they only move the vortex.
const STIR_MOVE_EPS = 0.002;
const STIR_DECAY = 0.9;
const STIR_TH = 1.2;

// Spatial grid: max resolution the neighbour-search grid can have. Buffers are sized for this; the
// actual dims each frame are smaller (cell size grows with the perception radius).
const MAX_GRID_X = 128;
const MAX_GRID_Y = 80;
const MAX_CELLS = MAX_GRID_X * MAX_GRID_Y;

// Emergency restart behind the in-shader refuge: fires only if the whole ecosystem stays empty for a
// while. Not a slider, so it can't be mistuned.
const WATCHDOG_ALIVE = 5;
const WATCHDOG_SECONDS = 6;

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
  device.lost.then((info) => {
    console.error("WebGPU device lost:", info.reason, info.message);
  });
  // WGSL/validation errors don't throw synchronously, so log the first one in clear text.
  let loggedErr = false;
  device.addEventListener("uncapturederror", (e) => {
    if (loggedErr) return;
    loggedErr = true;
    console.error("WebGPU error:", (e as GPUUncapturedErrorEvent).error.message);
  });

  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("WebGPU canvas context not available.");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // Boid = 8 floats (pos.xy, vel.xy, species, energy, age, flash). Buffers hold MAX_COUNT.
  const boidData = new Float32Array(MAX_COUNT * FLOATS_PER_BOID);
  // Seeding uses the CSS aspect ratio (species are laid out in sim space, independent of dpr).
  function reseedBoidData() {
    const asp = Math.max(1, (canvas.clientWidth || 1) / (canvas.clientHeight || 1));
    seedBoids(boidData, cfg.numSpecies, cfg.seedMode, asp, cfg.maxSpeed);
  }
  reseedBoidData();

  const boidBuffers: GPUBuffer[] = [0, 1].map(() =>
    device.createBuffer({
      size: boidData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  );
  device.queue.writeBuffer(boidBuffers[0], 0, boidData);

  // Per-species color + size factor, uploaded once (and again when colors change).
  const paletteBuffer = device.createBuffer({
    size: MAX_SPECIES * 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const paletteData = new Float32Array(MAX_SPECIES * 4);
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

  // Population counting: atomics buffer + staging buffer for async readback.
  const countsBuffer = device.createBuffer({
    size: MAX_SPECIES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const stagingBuffer = device.createBuffer({
    size: MAX_SPECIES * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const countZeros = new Uint32Array(MAX_SPECIES);

  // Population sizes fed back into the sim (for adaptive/homeland reproduction). 8 floats = 2×vec4.
  const popBuffer = device.createBuffer({
    size: 8 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const popData = new Float32Array(8);

  const domBuffer = device.createBuffer({
    size: 8 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  function writeDominance() {
    device.queue.writeBuffer(domBuffer, 0, computeDominance(cfg.dominanceMode, cfg.numSpecies));
  }
  writeDominance();

  // Spatial grid: a counting sort of boids into cells each frame.
  const cellCountBuf = device.createBuffer({
    size: MAX_CELLS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
  const cellZeros = new Uint32Array(MAX_CELLS);

  let ping = 0;

  // Random noise-field offset so the landscape differs each load (and via reseedTerrain).
  // Runtime state, never saved into presets.
  let terrainSeedX = Math.random() * 1000 - 500;
  let terrainSeedY = Math.random() * 1000 - 500;

  function reseedNow() {
    reseedBoidData();
    device.queue.writeBuffer(boidBuffers[0], 0, boidData);
    device.queue.writeBuffer(boidBuffers[1], 0, boidData);
    writeDominance();
    ping = 0;
  }

  const paramsBuffer = device.createBuffer({
    size: PARAMS_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderParamsBuffer = device.createBuffer({
    size: RENDER_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const fadeBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const terrainParamsBuffer = device.createBuffer({
    size: TERRAIN_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Sculpted terrain delta: a mutable f32 height field over screen uv, added on top of the base relief.
  const deltaBuffer = device.createBuffer({
    size: DELTA_W * DELTA_H * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const deltaZeros = new Float32Array(DELTA_W * DELTA_H);
  device.queue.writeBuffer(deltaBuffer, 0, deltaZeros);

  // The terrain render shader reads the delta from this texture, not the storage buffer, because
  // Apple/iOS forbids fragment-stage storage buffers. Refreshed from deltaBuffer each frame.
  const deltaTex = device.createTexture({
    size: [DELTA_W, DELTA_H],
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const deltaTexView = deltaTex.createView();
  const editParamsBuffer = device.createBuffer({
    size: BRUSH_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Triangle geometry per boid (+y = front).
  const triangle = new Float32Array([0.0, 1.0, -0.6, -0.8, 0.6, -0.8]);
  const triangleBuffer = device.createBuffer({
    size: triangle.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triangleBuffer, 0, triangle);

  const {
    computeBGL, terrainEditBGL, gridCountBGL, gridScanBGL, gridScatterBGL,
    renderBGL, countBGL, fadeBGL, blitBGL, terrainBGL,
    computePipeline, countPipeline, gridCountPipeline, gridScanPipeline, gridScatterPipeline,
    boidsPipeline, fadePipeline, blitPipeline, terrainPipeline, terrainEditPipeline,
    sampler,
  } = createPipelines(device, canvasFormat, TRAIL_FORMAT);

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

  // Re-render when the device pixel ratio changes (e.g. moving between a Retina and an external
  // monitor); ResizeObserver alone wouldn't catch a dpr-only change.
  let dprMedia: MediaQueryList | null = null;
  function onDprChange() {
    resize();
    watchDpr();
  }
  function watchDpr() {
    dprMedia?.removeEventListener("change", onDprChange);
    dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMedia.addEventListener("change", onDprChange);
  }
  watchDpr();

  // Swirl runs only with exactly one finger down (2+ are for terrain sculpting); an amp envelope
  // ramps it in/out so the swarm heals on release.
  const pointerTracker = createPointerTracker(canvas);
  const activePointers = pointerTracker.pointers;
  let swirlX = 0;
  let swirlY = 0;
  let swirlAmp = 0;
  let lastNx = 0.5;
  let lastNy = 0.5;
  let prevNx = 0.5;
  let prevNy = 0.5;
  let prevMvX = 0;
  let prevMvY = 0;
  let turnAccum = 0;

  function applyDir(d: number) {
    if (cfg.swirlDir === d) return;
    cfg.swirlDir = d;
    opts.onSwirlDir?.(d);
  }


  const bg = cfg.background;
  const startTime = performance.now();
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  const params = new Float32Array(PARAMS_FLOATS);
  const renderParams = new Float32Array(RENDER_FLOATS);
  const terrainParams = new Float32Array(TERRAIN_FLOATS);
  const editParams = new Float32Array(BRUSH_FLOATS);

  let fpsAccum = 0;
  let fpsFrames = 0;

  // Population readback runs a few times per second, not every frame. We gate on the staging buffer's
  // own mapState so a flag stuck true can't freeze the counts.
  const COUNT_EVERY = 8;
  let frameNo = 0;
  const speciesCounts: number[] = new Array(MAX_SPECIES).fill(0);
  // Gates the watchdog until the first readback lands, so a fresh all-zero start isn't read as collapse.
  let countsReady = false;
  let collapseTime = 0;

  function frame(now: number) {
    if (disposed) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

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

    params[PARAM.dt] = dt;
    params[PARAM.perception] = cfg.perception;
    params[PARAM.sepDist] = cfg.separationDist;
    params[PARAM.maxSpeed] = cfg.maxSpeed;
    params[PARAM.maxForce] = cfg.maxForce;
    params[PARAM.alignW] = cfg.alignWeight;
    params[PARAM.cohesionW] = cfg.cohesionWeight;
    params[PARAM.separationW] = cfg.separationWeight;
    params[PARAM.aspect] = aspect;
    params[PARAM.count] = count;
    params[PARAM.time] = (now - startTime) / 1000;
    params[PARAM.numSpecies] = cfg.numSpecies;
    params[PARAM.chaseW] = cfg.chaseWeight;
    params[PARAM.fleeW] = cfg.fleeWeight;
    params[PARAM.killRadius] = cfg.killRadius;
    params[PARAM.birthRate] = cfg.birthRate;
    params[PARAM.deathMode] = deathModeNum(cfg.deathMode);
    params[PARAM.birthMode] = birthModeNum(cfg.birthMode);
    params[PARAM.starveRate] = cfg.starveRate;
    params[PARAM.domMode] = cfg.dominanceMode === "chaos" ? 1 : 0;
    params[PARAM.adaptiveStrength] = cfg.adaptiveStrength;
    // Cell size >= the neighbour radius (interR = perception·1.6) so a 3×3 block covers all neighbours;
    // grid dims are capped at MAX_GRID_* (buffers are sized for that).
    const interR = cfg.perception * 1.6;
    const cellSize = Math.max(interR, (2 * aspect) / MAX_GRID_X, 2 / MAX_GRID_Y);
    const gridX = Math.min(MAX_GRID_X, Math.max(1, Math.ceil((2 * aspect) / cellSize)));
    const gridY = Math.min(MAX_GRID_Y, Math.max(1, Math.ceil(2 / cellSize)));
    params[PARAM.cellSize] = cellSize;
    params[PARAM.gridX] = gridX;
    params[PARAM.gridY] = gridY;
    params[PARAM.declump] = cfg.declump;

    // Terrain sculpting is gesture-driven: 2 fingers raise, 3+ lower; the brush centre/radius is the
    // finger centroid/spread. One finger is the swirl instead, unless a sculpt tool is selected.
    const terrainOn = cfg.terrainEnabled;
    const nFingers = activePointers.size;
    const buttonSculpt = terrainOn && cfg.terrainTool !== "off" && nFingers === 1;
    const gestureSculpt = terrainOn && nFingers >= 2;
    let brushActive = 0;
    let brushU = 0.5;
    let brushV = 0.5;
    let brushRadius = cfg.terrainBrushSize;
    let brushSign = 1;
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
      brushSign = nFingers === 2 ? 1 : -1;
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

    // Swirl: exactly one finger and no sculpt tool means the vortex follows it and ramps up; otherwise
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
          // screen-CW stir (turnAccum > 0) means a clockwise swirl (dir -1), and vice versa
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
    params[PARAM.swirlX] = swirlX;
    params[PARAM.swirlY] = swirlY;
    params[PARAM.swirlAmp] = swirlAmp;
    params[PARAM.swirlStrength] = cfg.swirlStrength;
    params[PARAM.swirlRadius] = cfg.swirlRadius;
    params[PARAM.swirlFalloff] = cfg.swirlFalloff;
    params[PARAM.swirlInward] = cfg.swirlInward;
    params[PARAM.swirlDir] = cfg.swirlDir;
    params[PARAM.terrainForce] = cfg.terrainEnabled ? cfg.terrainForce : 0;
    params[PARAM.terrainScale] = cfg.terrainScale;
    params[PARAM.terrainDrift] = cfg.terrainDrift;
    params[PARAM.terrainCoverage] = cfg.terrainCoverage;
    params[PARAM.terrainWarp] = cfg.terrainWarp;
    // A threshold of 0 switches the safety net off inside the shader, so the master toggle needs no
    // separate uniform slot (these two were the struct's padding floats).
    params[PARAM.rescueThr] = cfg.rescueEnabled ? cfg.rescueThreshold : 0;
    params[PARAM.rescueRate] = cfg.rescueRate;
    params[PARAM.terrainSeedX] = terrainSeedX;
    params[PARAM.terrainSeedY] = terrainSeedY;
    device.queue.writeBuffer(paramsBuffer, 0, params);

    // Terrain render uniform. Must use the same scale/drift as the sim so drawn and felt line up.
    const simTime = (now - startTime) / 1000;
    terrainParams[TERRAIN.aspect] = aspect;
    terrainParams[TERRAIN.time] = simTime;
    terrainParams[TERRAIN.scale] = cfg.terrainScale;
    terrainParams[TERRAIN.drift] = cfg.terrainDrift;
    terrainParams[TERRAIN.lineCount] = cfg.terrainLineCount;
    terrainParams[TERRAIN.lineWidth] = cfg.terrainLineWidth;
    terrainParams[TERRAIN.lineBright] = cfg.terrainLineBright;
    terrainParams[TERRAIN.tint] = cfg.terrainTint;
    terrainParams[TERRAIN.valleyR] = cfg.terrainValley[0];
    terrainParams[TERRAIN.valleyG] = cfg.terrainValley[1];
    terrainParams[TERRAIN.valleyB] = cfg.terrainValley[2];
    terrainParams[TERRAIN.coverage] = cfg.terrainCoverage;
    terrainParams[TERRAIN.midR] = cfg.terrainMid[0];
    terrainParams[TERRAIN.midG] = cfg.terrainMid[1];
    terrainParams[TERRAIN.midB] = cfg.terrainMid[2];
    terrainParams[TERRAIN.warp] = cfg.terrainWarp;
    terrainParams[TERRAIN.peakR] = cfg.terrainPeak[0];
    terrainParams[TERRAIN.peakG] = cfg.terrainPeak[1];
    terrainParams[TERRAIN.peakB] = cfg.terrainPeak[2];
    terrainParams[TERRAIN.shade] = cfg.terrainShade;
    terrainParams[TERRAIN.snowR] = cfg.terrainSnow[0];
    terrainParams[TERRAIN.snowG] = cfg.terrainSnow[1];
    terrainParams[TERRAIN.snowB] = cfg.terrainSnow[2];
    terrainParams[TERRAIN.snowAmount] = cfg.terrainSnowAmount;
    // unitsPerPixel drives the derivative-free contour line width. Guard against a 0 height before the
    // first resize.
    terrainParams[TERRAIN.unitsPerPixel] = 2 / Math.max(1, canvas.height);
    terrainParams[TERRAIN.seedX] = terrainSeedX;
    terrainParams[TERRAIN.seedY] = terrainSeedY;
    device.queue.writeBuffer(terrainParamsBuffer, 0, terrainParams);

    // Brush uniform for the sculpt pass (heal always runs; the brush adds only while held).
    editParams[BRUSH.u] = brushU;
    editParams[BRUSH.v] = brushV;
    editParams[BRUSH.radius] = brushRadius;
    editParams[BRUSH.strength] = cfg.terrainBrushStrength * brushSign;
    editParams[BRUSH.detail] = cfg.terrainBrushDetail;
    editParams[BRUSH.heal] = cfg.terrainHealRate;
    editParams[BRUSH.brushOn] = brushActive;
    editParams[BRUSH.dt] = dt;
    editParams[BRUSH.aspect] = aspect;
    editParams[BRUSH.time] = (now - startTime) / 1000;
    device.queue.writeBuffer(editParamsBuffer, 0, editParams);

    if (opts.onSwirl) {
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      opts.onSwirl({
        cx: lastNx * cw,
        cy: lastNy * ch,
        r: cfg.swirlRadius * (ch / 2),
        amp: swirlAmp,
      });
    }
    device.queue.writeBuffer(cellCountBuf, 0, cellZeros, 0, gridX * gridY);

    // Glide the sim's population sizes toward the latest counts (~0.5s) instead of snapping, so the
    // lagging readback doesn't make adaptive births spawn in waves.
    const popSmooth = Math.min(1, 3 * dt);
    for (let s = 0; s < MAX_SPECIES; s++) {
      popData[s] += ((speciesCounts[s] ?? 0) - popData[s]) * popSmooth;
    }
    device.queue.writeBuffer(popBuffer, 0, popData);

    renderParams[RENDER.aspect] = aspect;
    renderParams[RENDER.boidScale] = cfg.boidScale;
    renderParams[RENDER.maxSpeed] = cfg.maxSpeed;
    renderParams[RENDER.deathMode] = cfg.deathMode === "energy" ? 1 : 0;
    renderParams[RENDER.colorGain] = cfg.colorIntensity;
    device.queue.writeBuffer(renderParamsBuffer, 0, renderParams);

    device.queue.writeBuffer(
      fadeBuffer,
      0,
      new Float32Array([bg[0], bg[1], bg[2], cfg.trailFade]),
    );

    frameNo++;
    const doCount =
      !!opts.onCounts && frameNo % COUNT_EVERY === 0 && stagingBuffer.mapState === "unmapped";
    if (doCount) device.queue.writeBuffer(countsBuffer, 0, countZeros);

    const encoder = device.createCommandEncoder();
    const gridDispatch = Math.ceil(count / 64);

    // Terrain sculpt: heal the delta + apply the brush. Runs first so this frame's sim and render both
    // see the updated relief. Only when terrain is enabled.
    if (cfg.terrainEnabled) {
      const editPass = encoder.beginComputePass();
      editPass.setPipeline(terrainEditPipeline);
      editPass.setBindGroup(0, terrainEditGroup);
      editPass.dispatchWorkgroups(Math.ceil((DELTA_W * DELTA_H) / 64));
      editPass.end();
      // Mirror the delta buffer into the texture the fragment shader samples (the render stage can't
      // read the storage buffer on Apple/iOS). bytesPerRow 1280 is 256-aligned.
      encoder.copyBufferToTexture(
        { buffer: deltaBuffer, bytesPerRow: DELTA_W * 4, rowsPerImage: DELTA_H },
        { texture: deltaTex },
        { width: DELTA_W, height: DELTA_H },
      );
    }

    // Build the spatial grid in three separate passes: dispatches within a pass aren't ordered, but
    // consecutive passes are (each sees the previous pass's storage writes).
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

    // Compute the behaviour (reads inB[ping] + the grid, writes inB[1-ping]).
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeGroups[ping]);
    cpass.dispatchWorkgroups(gridDispatch);
    cpass.end();

    const latest = 1 - ping;

    // Into the trail texture: fade + boids.
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

    // Trail texture onto the canvas.
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
    // Terrain relief first (fills the background), then the swarm glow additively on top.
    if (cfg.terrainEnabled) {
      canvasPass.setPipeline(terrainPipeline);
      canvasPass.setBindGroup(0, terrainGroup);
      canvasPass.draw(3);
    }
    canvasPass.setPipeline(blitPipeline);
    canvasPass.setBindGroup(0, blitGroup!);
    canvasPass.draw(3);
    canvasPass.end();

    // Count populations (atomics) + copy into staging.
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
          // mapAsync can reject if the device was lost; the buffer stays unmapped and is retried
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
      // Species count or start layout changed, rebuild the ecosystem (also rerolls dominance).
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
      // New random offset into the noise field. The next frame's compute + render both read it
      // (params[40/41] and terrainParams[25/26]), so drawn and felt stay in lockstep.
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
      pointerTracker.dispose();
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

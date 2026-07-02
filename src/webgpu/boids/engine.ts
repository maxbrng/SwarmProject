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
import { computeWGSL, boidsWGSL, fadeWGSL, blitWGSL, countWGSL } from "./shaders";

export interface BoidsHandle {
  dispose: () => void;
  /** Change parameters live (including count, up to MAX_COUNT). */
  update: (partial: Partial<BoidsConfig>) => void;
  /** Restart the ecosystem (with the current seedMode/numSpecies). */
  reseed: () => void;
}

export interface EngineOptions {
  config?: Partial<BoidsConfig>;
  onFps?: (fps: number) => void;
  /** Alive boids per species (length MAX_SPECIES), several times per second. */
  onCounts?: (counts: number[]) => void;
}

const TRAIL_FORMAT: GPUTextureFormat = "rgba8unorm";
const PARAMS_FLOATS = 24; // compute uniform (96 bytes; 24 floats incl. padding)
const FLOATS_PER_BOID = 8; // pos.xy, vel.xy, species, energy, age, flash
const MAX_DPR = 2;

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

  let ping = 0; // ping-pong index (also reset by reseedNow)

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

  // ── Pipelines ────────────────────────────────────────────────────────────────
  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
    compute: { module: device.createShaderModule({ code: computeWGSL }), entryPoint: "main" },
  });

  const countPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [countBGL] }),
    compute: { module: device.createShaderModule({ code: countWGSL }), entryPoint: "main" },
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
    fragment: { module: blitModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
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
      ],
    }),
  );
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

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // ── Trail texture (size-dependent) ───────────────────────────────────────────
  let trailTexture: GPUTexture | null = null;
  let trailView: GPUTextureView | null = null;
  let blitGroup: GPUBindGroup | null = null;
  let needsClear = true;
  let aspect = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
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

  // ── Frame loop ───────────────────────────────────────────────────────────────
  const bg = cfg.background;
  const startTime = performance.now();
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  const params = new Float32Array(PARAMS_FLOATS);
  const renderParams = new Float32Array(8);

  // FPS averaging
  let fpsAccum = 0;
  let fpsFrames = 0;

  // population readback (several times per second, not every frame).
  // Gate on the staging buffer's own mapState instead of a boolean flag — a boolean
  // could get stuck true (e.g. if a mapAsync resolved after dispose) and freeze counts.
  const COUNT_EVERY = 8;
  let frameNo = 0;
  const speciesCounts: number[] = new Array(MAX_SPECIES).fill(0);

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
    device.queue.writeBuffer(paramsBuffer, 0, params);

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

    // 1) compute the behavior
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeGroups[ping]);
    cpass.dispatchWorkgroups(Math.ceil(count / 64));
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
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      trailTexture?.destroy();
      boidBuffers.forEach((b) => b.destroy());
      paramsBuffer.destroy();
      renderParamsBuffer.destroy();
      fadeBuffer.destroy();
      triangleBuffer.destroy();
      paletteBuffer.destroy();
      countsBuffer.destroy();
      stagingBuffer.destroy();
      popBuffer.destroy();
      domBuffer.destroy();
      device.destroy();
    },
  };
}

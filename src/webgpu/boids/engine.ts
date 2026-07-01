// WebGPU-Boids-Engine.
// init → läuft autonom in einer requestAnimationFrame-Schleife.
// Compute-Shader (Ping-Pong) berechnet das Verhalten, gerendert wird in eine
// Trail-Textur (Fade-Pass + additive Boids), die anschließend auf den Canvas geblittet wird.
//
// Buffer werden für MAX_COUNT Boids vorab allokiert und alle einmal befüllt;
// cfg.count steuert nur, wie viele davon aktiv simuliert/gezeichnet werden →
// die Anzahl ist live regelbar ohne Neu-Allokation.

import { BoidsConfig, DEFAULT_CONFIG, MAX_COUNT } from "./config";
import { computeWGSL, boidsWGSL, fadeWGSL, blitWGSL } from "./shaders";

export interface BoidsHandle {
  dispose: () => void;
  /** Parameter live ändern (auch count, bis MAX_COUNT). */
  update: (partial: Partial<BoidsConfig>) => void;
}

export interface EngineOptions {
  config?: Partial<BoidsConfig>;
  onFps?: (fps: number) => void;
}

const TRAIL_FORMAT: GPUTextureFormat = "rgba8unorm";
const PARAMS_FLOATS = 12; // Compute-Uniform (48 Byte)
const MAX_DPR = 2;

export async function createBoidsEngine(
  canvas: HTMLCanvasElement,
  opts: EngineOptions = {},
): Promise<BoidsHandle> {
  const cfg: BoidsConfig = { ...DEFAULT_CONFIG, ...opts.config };
  cfg.count = Math.min(cfg.count, MAX_COUNT);

  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error("WebGPU wird von diesem Browser nicht unterstützt (Chrome aktuell halten).");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Kein WebGPU-Adapter gefunden.");
  const device = await adapter.requestDevice();
  // GPU-Verlust (z.B. nach GPU-Prozess-Absturz) sichtbar machen statt still einzufrieren.
  device.lost.then((info) => {
    // eslint-disable-next-line no-console
    console.error("WebGPU-Device verloren:", info.reason, info.message);
  });
  // WGSL-/Validierungsfehler einmalig im Klartext loggen (WGSL-Fehler werfen nicht synchron).
  let loggedErr = false;
  device.addEventListener("uncapturederror", (e) => {
    if (loggedErr) return;
    loggedErr = true;
    // eslint-disable-next-line no-console
    console.error("WebGPU-Fehler:", (e as GPUUncapturedErrorEvent).error.message);
  });

  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("WebGPU-Canvas-Kontext nicht verfügbar.");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // ── Buffer (für MAX_COUNT vorab) ─────────────────────────────────────────────
  // Boid = 4 floats (pos.xy, vel.xy) → 16 Byte
  const boidData = new Float32Array(MAX_COUNT * 4);
  for (let i = 0; i < MAX_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = cfg.maxSpeed * (0.6 + Math.random() * 0.4);
    boidData[i * 4 + 0] = Math.random() * 2 - 1; // x ∈ [-1,1] (Subset des Sim-Raums)
    boidData[i * 4 + 1] = Math.random() * 2 - 1; // y ∈ [-1,1]
    boidData[i * 4 + 2] = Math.cos(a) * s;
    boidData[i * 4 + 3] = Math.sin(a) * s;
  }

  const boidBuffers: GPUBuffer[] = [0, 1].map(() =>
    device.createBuffer({
      size: boidData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  );
  device.queue.writeBuffer(boidBuffers[0], 0, boidData);

  const paramsBuffer = device.createBuffer({
    size: PARAMS_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderParamsBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const fadeBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Dreieck-Geometrie pro Boid (+y = vorne)
  const triangle = new Float32Array([0.0, 1.0, -0.6, -0.8, 0.6, -0.8]);
  const triangleBuffer = device.createBuffer({
    size: triangle.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triangleBuffer, 0, triangle);

  // ── Bind-Group-Layouts ───────────────────────────────────────────────────────
  const computeBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const renderBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
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

  // ── Bind-Groups ──────────────────────────────────────────────────────────────
  const computeGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: boidBuffers[k] } },
        { binding: 2, resource: { buffer: boidBuffers[1 - k] } },
      ],
    }),
  );
  const renderGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: boidBuffers[k] } },
        { binding: 1, resource: { buffer: renderParamsBuffer } },
      ],
    }),
  );
  const fadeGroup = device.createBindGroup({
    layout: fadeBGL,
    entries: [{ binding: 0, resource: { buffer: fadeBuffer } }],
  });

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // ── Trail-Textur (größenabhängig) ────────────────────────────────────────────
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

  // ── Frame-Loop ───────────────────────────────────────────────────────────────
  const bg = cfg.background;
  const startTime = performance.now();
  let ping = 0;
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  const params = new Float32Array(PARAMS_FLOATS);
  const renderParams = new Float32Array(4);

  // FPS-Mittelung
  let fpsAccum = 0;
  let fpsFrames = 0;

  function frame(now: number) {
    if (disposed) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // Sprünge (Tab-Wechsel) deckeln

    // FPS melden (~2×/Sekunde)
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
    params[10] = (now - startTime) / 1000; // time (für Wander)
    device.queue.writeBuffer(paramsBuffer, 0, params);

    renderParams[0] = aspect;
    renderParams[1] = cfg.boidScale;
    renderParams[2] = cfg.maxSpeed;
    device.queue.writeBuffer(renderParamsBuffer, 0, renderParams);

    device.queue.writeBuffer(
      fadeBuffer,
      0,
      new Float32Array([bg[0], bg[1], bg[2], cfg.trailFade]),
    );

    const encoder = device.createCommandEncoder();

    // 1) Verhalten berechnen
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeGroups[ping]);
    cpass.dispatchWorkgroups(Math.ceil(count / 64));
    cpass.end();

    const latest = 1 - ping; // dorthin hat der Compute-Pass geschrieben

    // 2) In die Trail-Textur: Fade + Boids
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

    // 3) Trail-Textur auf den Canvas
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

    device.queue.submit([encoder.finish()]);

    ping = latest;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    update(partial: Partial<BoidsConfig>) {
      Object.assign(cfg, partial);
      if (partial.count !== undefined) {
        cfg.count = Math.max(1, Math.min(Math.round(partial.count), MAX_COUNT));
      }
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
      device.destroy();
    },
  };
}

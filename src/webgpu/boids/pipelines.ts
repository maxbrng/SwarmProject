// All bind-group layouts, compute/render pipelines and the trail sampler. These depend only on the
// device, the shader code and the two texture formats — never on the actual buffers — so they live
// apart from the engine's buffer wiring. The engine builds its bind groups from the layouts returned
// here. Returned as one flat bag the engine destructures.

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
} from "./shaders";

export function createPipelines(
  device: GPUDevice,
  canvasFormat: GPUTextureFormat,
  trailFormat: GPUTextureFormat,
) {
  const computeBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });
  const terrainEditBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const gridCountBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const gridScanBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const gridScatterBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
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
      // Delta as a texture, not a fragment storage buffer (unsupported on Apple/iOS). r32float is
      // unfilterable, so sampleType "unfilterable-float", read via textureLoad without a sampler.
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
    ],
  });

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
          format: trailFormat,
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
          format: trailFormat,
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
    // Additive: the swarm glow is added on top of the terrain drawn first. Over pure black (terrain
    // off) this matches a plain opaque copy, so the look is unchanged when off.
    fragment: {
      module: blitModule,
      entryPoint: "fs",
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

  // Terrain: draws the contour-line relief into the canvas before the swarm blit.
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

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  return {
    computeBGL, terrainEditBGL, gridCountBGL, gridScanBGL, gridScatterBGL,
    renderBGL, countBGL, fadeBGL, blitBGL, terrainBGL,
    computePipeline, countPipeline, gridCountPipeline, gridScanPipeline, gridScatterPipeline,
    boidsPipeline, fadePipeline, blitPipeline, terrainPipeline, terrainEditPipeline,
    sampler,
  };
}

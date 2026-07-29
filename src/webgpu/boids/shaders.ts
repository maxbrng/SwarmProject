// WGSL shaders. Each shader lives in its own .wgsl file under ./shaders (real syntax highlighting),
// composed here from the shared building blocks in ./shaders/common. The .wgsl files are imported
// as raw strings via the raw-loader rule in next.config.ts.

import boid from "./shaders/common/boid.wgsl";
import params from "./shaders/common/params.wgsl";
import terrain from "./shaders/common/terrain.wgsl";
import delta from "./shaders/common/delta.wgsl";
import deltaTex from "./shaders/common/delta-tex.wgsl";
import cell from "./shaders/common/cell.wgsl";

import computeBody from "./shaders/compute.wgsl";
import gridCountBody from "./shaders/grid-count.wgsl";
import gridScanBody from "./shaders/grid-scan.wgsl";
import gridScatterBody from "./shaders/grid-scatter.wgsl";
import boidsBody from "./shaders/boids.wgsl";
import countBody from "./shaders/count.wgsl";
import fadeBody from "./shaders/fade.wgsl";
import terrainBody from "./shaders/terrain.wgsl";
import terrainEditBody from "./shaders/terrain-edit.wgsl";
import blitBody from "./shaders/blit.wgsl";

// Delta field resolution. Must match the literals in common/delta.wgsl + common/delta-tex.wgsl.
export const DELTA_W = 320;
export const DELTA_H = 200;

const join = (...parts: string[]) => parts.join("\n");

export const computeWGSL = join(boid, params, terrain, delta, computeBody);
export const gridCountWGSL = join(boid, params, cell, gridCountBody);
export const gridScanWGSL = join(params, gridScanBody);
export const gridScatterWGSL = join(params, gridScatterBody);
export const boidsWGSL = join(boid, boidsBody);
export const countWGSL = join(boid, countBody);
export const fadeWGSL = fadeBody;
export const terrainWGSL = join(terrain, deltaTex, terrainBody);
export const terrainEditWGSL = join(terrain, delta, terrainEditBody);
export const blitWGSL = blitBody;

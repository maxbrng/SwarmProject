struct TerrainParams {
  aspect : f32, time : f32, scale : f32, drift : f32,
  lineCount : f32, lineWidth : f32, lineBright : f32, tint : f32,
  valley : vec4f, // rgb = valley-floor color; .a = terrainCoverage
  mid    : vec4f, // rgb = mid-slope color; .a = terrainWarp
  peak   : vec4f, // rgb = peak color; .a = hill-shading strength
  snow   : vec4f, // rgb = snow/rock cap color; .a = snow-cap strength
  misc   : vec4f, // .x = sim units per pixel (contour AA); .yz = terrain seed
};
@group(0) @binding(0) var<uniform> T : TerrainParams;
// binding(1) = deltaTex, declared in DELTA_TEX_WGSL

struct VOut {
  @builtin(position) clip : vec4f,
  @location(0)       uv   : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let pos = p[vi];
  var out : VOut;
  out.clip = vec4f(pos, 0.0, 1.0);
  out.uv   = vec2f((pos.x + 1.0) * 0.5, (1.0 - pos.y) * 0.5);
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4f {
  // pixel → sim space (y up), matching the boid coordinates
  let sp = vec2f((in.uv.x * 2.0 - 1.0) * T.aspect, 1.0 - in.uv.y * 2.0);
  let te = T.time * T.drift;
  let cov = T.valley.a; // terrainCoverage packed into the unused valley alpha
  let wp = T.mid.a;     // terrainWarp packed into the unused mid alpha
  let tseed = vec2f(T.misc.y, T.misc.z); // terrain seed (must match the compute pass)
  // full height = analytic base + sculpted delta (unclamped, so sculpted peaks keep their slope)
  let h = terrainH(sp, te, T.scale, cov, wp, tseed) + sampleDelta(in.uv);
  // gradient by finite differences, not fwidth (which gave per-tile garbage on some Linux/Vulkan drivers)
  let ge = 0.014;
  let hgx = (terrainH(sp + vec2f(ge, 0.0), te, T.scale, cov, wp, tseed) + sampleDelta(simToUv(sp + vec2f(ge, 0.0), T.aspect))) - h;
  let hgy = (terrainH(sp + vec2f(0.0, ge), te, T.scale, cov, wp, tseed) + sampleDelta(simToUv(sp + vec2f(0.0, ge), T.aspect))) - h;
  let gradSim = vec2f(hgx, hgy) / ge; // d(height)/d(sim units)

  // elevation fill: valley → mid → peak, so height reads by colour too
  let t1 = clamp(h * 2.0, 0.0, 1.0);
  let t2 = clamp(h * 2.0 - 1.0, 0.0, 1.0);
  var col = mix(mix(T.valley.rgb, T.mid.rgb, t1), T.peak.rgb, t2) * T.tint;
  // snow/rock cap on the highest ground (before shading so it still gets lit)
  let snow = smoothstep(0.6, 1.0, h);
  col = mix(col, T.snow.rgb, snow * T.snow.a);

  // hill-shading: surface normal from the gradient, lit from the upper-left, kept gentle
  let n = normalize(vec3f(-gradSim.x, -gradSim.y, 1.1)); // z = vertical exaggeration
  let lightDir = normalize(vec3f(-0.5, 0.7, 0.75));
  let dif = clamp(dot(n, lightDir), 0.0, 1.0);
  let shadeF = mix(1.0, 0.5 + 0.9 * dif, T.peak.a); // range 0.5..1.4
  col = col * shadeF;

  // anti-aliased contour lines at each 1/lineCount level; per-pixel change from the FD gradient (no fwidth)
  let hf = h * T.lineCount;
  let w = T.lineCount * length(gradSim) * T.misc.x;
  let g = abs(fract(hf + 0.5) - 0.5);        // distance to nearest contour level (0..0.5)
  let aa = g / max(w, 1e-5);                  // in pixels from the line
  let line = 1.0 - smoothstep(0.0, T.lineWidth, aa);
  // fade lines out where they'd pack tighter than a pixel (steep sculpted walls), else they merge to white
  let lineFade = 1.0 - smoothstep(0.5, 1.2, w);
  // neutral warm-gray ink, a touch brighter toward the peaks
  let lineCol = vec3f(0.72, 0.74, 0.68) * (0.55 + 0.6 * clamp(h, 0.0, 1.0));
  col += lineCol * (line * T.lineBright * lineFade);

  return vec4f(col, 1.0);
}

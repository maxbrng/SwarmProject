// Integer bit-hash (the usual fract(sin(...)) hash differs across GPUs → tile artifacts on Linux/Vulkan).
fn thash2(p : vec2f) -> f32 {
  var n = u32(i32(p.x)) * 1597334677u + u32(i32(p.y)) * 3812015801u;
  n = (n ^ (n >> 16u)) * 2246822519u;
  n = (n ^ (n >> 13u)) * 3266489917u;
  n = n ^ (n >> 16u);
  return f32(n) * (1.0 / 4294967296.0);
}
// smooth value noise (0..1)
fn tvnoise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = thash2(i);
  let b = thash2(i + vec2f(1.0, 0.0));
  let c = thash2(i + vec2f(0.0, 1.0));
  let d = thash2(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 4-octave fbm → rolling landscape
fn tfbm(p : vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var f = 1.0;
  for (var o = 0; o < 4; o = o + 1) {
    v += a * tvnoise(p * f);
    a *= 0.5;
    f *= 2.0;
  }
  return v / 0.9375; // normalize to ~0..1
}
// cheap field for the optional domain warp (Warp slider)
fn twarp(p : vec2f) -> f32 {
  return tvnoise(p) * 0.65 + tvnoise(p * 2.1 + vec2f(4.0, 1.0)) * 0.35;
}
// Height in [0,1]: mostly flat plain with a few tall peaks; cov (Coverage) sets how much is mountain.
fn terrainH(p : vec2f, t : f32, s : f32, cov : f32, warp : f32, seed : vec2f) -> f32 {
  // seed shifts into the noise field for a different map; must match compute + render. t = time · drift.
  let dph = t * 0.6;
  var q = p * s + vec2f(t * 0.15 + sin(dph) * 0.06, t * 0.10 + cos(dph * 0.9) * 0.06) + seed;
  // optional domain warp so ridges meander off the grid
  if (warp > 0.001) {
    let w = vec2f(twarp(q + vec2f(1.7, 9.2)), twarp(q + vec2f(8.3, 2.8)));
    q = q + (w - vec2f(0.5)) * warp;
  }
  let base = tfbm(q);
  let thr = mix(0.72, 0.46, clamp(cov, 0.0, 1.0)); // higher cov → more mountains
  // mask only places the mountains; it must not be the height itself, or the tops go flat
  let mask = smoothstep(thr, thr + 0.12, base);
  // craggy ridged body so peaks stay shaped
  let r1 = 1.0 - abs(2.0 * tvnoise(q * 2.0 + vec2f(3.0, 3.0)) - 1.0);
  let r2 = 1.0 - abs(2.0 * tvnoise(q * 4.3 + vec2f(9.0, 9.0)) - 1.0);
  let crag = r1 * 0.6 + r2 * r2 * 0.4;
  let relief = 0.45 + 0.55 * crag;
  // gentle lowland structure; the boid barrier is height-gated so only tall peaks block
  let low = base * 0.40;
  return clamp(low * (1.0 - mask) + mask * relief, 0.0, 1.0);
}

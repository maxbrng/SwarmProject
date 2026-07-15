// WGSL shaders for the boids simulation.
// Kept inline as strings so no .wgsl loader is needed in Next/Turbopack.

// Boid: position, velocity, species, energy, age, eat/birth flash.
// 8 floats = 32 bytes. species < 0 ⇒ dead slot (Energy mode only).
const BOID_STRUCT = /* wgsl */ `
struct Boid {
  pos     : vec2f,
  vel     : vec2f,
  species : f32,
  energy  : f32,
  age     : f32,
  flash   : f32,
};
`;

// Shared Params uniform (36 floats / 144 bytes). Indices 21..23 carry the spatial-grid
// parameters (cell size + grid dims), 24 is the anti-crowd strength, 25..32 the swirl vortex
// (live center + activation envelope from the pointer, plus its shape + direction). Written by
// the engine each frame. 36 floats = 9×vec4 → 16-byte aligned; 33..35 pad the struct.
const PARAMS_WGSL = /* wgsl */ `
struct Params {
  dt : f32, perception : f32, sepDist : f32, maxSpeed : f32, maxForce : f32,
  alignW : f32, cohesionW : f32, separationW : f32, aspect : f32, count : f32,
  time : f32, numSpecies : f32, chaseW : f32, fleeW : f32, killRadius : f32,
  birthRate : f32, deathMode : f32, birthMode : f32, starveRate : f32, domMode : f32,
  adaptiveStrength : f32, cellSize : f32, gridX : f32, gridY : f32,
  declump : f32, swirlX : f32, swirlY : f32, swirlAmp : f32,
  swirlStrength : f32, swirlRadius : f32, swirlFalloff : f32, swirlInward : f32,
  swirlDir : f32, terrainForce : f32, terrainScale : f32, terrainDrift : f32,
  terrainCoverage : f32, terrainWarp : f32, _pg2 : f32, _pg3 : f32,
};
`;

// ── Shared terrain height field ───────────────────────────────────────────────
// A smooth analytic landscape in ~[0,1]: sum of a few sine "ridges" at different frequencies that
// slowly drift with time. The SAME function feeds the boid avoidance (downhill gradient) and the
// contour rendering, so what you see is exactly what the swarm feels. `p` is in sim space
// (x∈[-aspect,aspect], y∈[-1,1]); `t` is the already-scaled drift time; `s` the spatial frequency.
// (Later, gesture-sculpted relief becomes an editable delta added on top of this base.)
const TERRAIN_WGSL = /* wgsl */ `
fn thash2(p : vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
// smooth value noise (0..1) with cubic interpolation
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
// standard fbm (0..1): rolling landscape, natural look
fn tfbm(p : vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var f = 1.0;
  for (var o = 0; o < 4; o = o + 1) {
    v += a * tvnoise(p * f);
    a *= 0.5;
    f *= 2.0;
  }
  return v / 0.9375; // normalize (0.5+0.25+0.125+0.0625) → ~0..1
}
// cheap 2-octave field used only to warp the domain (optional, driven by the Warp slider)
fn twarp(p : vec2f) -> f32 {
  return tvnoise(p) * 0.65 + tvnoise(p * 2.1 + vec2f(4.0, 1.0)) * 0.35;
}
// Height field in [0,1]: mostly FLAT PLATEAU with only a FEW isolated tall mountains — the ratio
// is set by cov (the terrainCoverage slider). A steep smoothstep above a coverage-driven
// threshold makes the rare high spots rise fast to full-height peaks; below it the ground is a
// nearly-flat plateau carrying only a faint texture (a couple of widely-spaced contour lines) so
// it reads as low land, not a dead bleached blob. The plateau is one **connected** low region
// (isolated mountains in a sea of flat) → the swarm roams everywhere; only the steep peaks block.
// Numerically tuned + flood-fill verified (scratchpad/terr4.mjs). Same fn feeds boids + rendering.
fn terrainH(p : vec2f, t : f32, s : f32, cov : f32, warp : f32) -> f32 {
  var q = p * s + vec2f(t * 0.04, t * 0.02);
  // Optional domain warp (Warp slider): bend the coordinates with another noise field so ridges
  // meander organically instead of sitting on the grid. warp = 0 → byte-identical to the un-warped
  // terrain; dial it up gently for a more natural look. Kept subtle by design.
  if (warp > 0.001) {
    let w = vec2f(twarp(q + vec2f(1.7, 9.2)), twarp(q + vec2f(8.3, 2.8)));
    q = q + (w - vec2f(0.5)) * warp;
  }
  let base = tfbm(q);
  let thr = mix(0.72, 0.46, clamp(cov, 0.0, 1.0)); // higher cov → lower threshold → more mountains
  // mask = WHERE the mountains are (soft flanks); its width is the mountain-base slope the boids
  // climb. It only places the mountains — it must NOT be the height itself, or the tops saturate
  // flat (that was the "smooth flat surface" bug).
  let mask = smoothstep(thr, thr + 0.12, base);
  // relief = the mountain BODY, a craggy ridged surface that keeps varying inside the mountain so
  // the tops are shaped (peaks, ridges, contour lines + shading over them), never a flat cap.
  let r1 = 1.0 - abs(2.0 * tvnoise(q * 2.0 + vec2f(3.0, 3.0)) - 1.0);
  let r2 = 1.0 - abs(2.0 * tvnoise(q * 4.3 + vec2f(9.0, 9.0)) - 1.0);
  let crag = r1 * 0.6 + r2 * r2 * 0.4;
  let relief = 0.45 + 0.55 * crag; // mountain body height 0.45..1.0, always varying
  // Lowland/valley height: follow the base fbm (reuses it, free) so the WHOLE map has structure —
  // rolling relief, contour lines and gentle basins in the valleys too, not just under the peaks.
  // It stays low (≈0..0.3) → gentle slopes; the boid barrier is height-gated in the compute pass
  // so this valley structure never blocks the swarm (only the tall mountains do).
  let low = base * 0.40;
  return clamp(low * (1.0 - mask) + mask * relief, 0.0, 1.0);
}
`;

// ── Editable terrain delta (sculpting) ───────────────────────────────────────
// A mutable height field the user paints with the long-press brush, added on top of the analytic
// terrainH. Stored as a flat f32 buffer over screen-normalized uv (aspect-independent). The SAME
// sampleDelta feeds the boid avoidance, the rendering and the edit pass, so sculpted relief is felt
// and drawn identically. Resolution is fixed; bilinear sampling keeps it smooth.
export const DELTA_W = 320;
export const DELTA_H = 200;
const DELTA_WGSL = /* wgsl */ `
const DELTA_W : u32 = ${DELTA_W}u;
const DELTA_H : u32 = ${DELTA_H}u;
fn simToUv(p : vec2f, aspect : f32) -> vec2f {
  return vec2f((p.x / aspect + 1.0) * 0.5, (1.0 - p.y) * 0.5);
}
fn sampleDelta(uv : vec2f) -> f32 {
  let cu = clamp(uv.x, 0.0, 1.0) * f32(DELTA_W - 1u);
  let cv = clamp(uv.y, 0.0, 1.0) * f32(DELTA_H - 1u);
  let x0 = u32(floor(cu)); let y0 = u32(floor(cv));
  let x1 = min(x0 + 1u, DELTA_W - 1u); let y1 = min(y0 + 1u, DELTA_H - 1u);
  let tx = cu - f32(x0); let ty = cv - f32(y0);
  let a = delta[y0 * DELTA_W + x0];
  let b = delta[y0 * DELTA_W + x1];
  let c = delta[y1 * DELTA_W + x0];
  let d = delta[y1 * DELTA_W + x1];
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}
`;

// Which grid cell a position falls into (clamped to the grid).
const CELL_WGSL = /* wgsl */ `
fn cellOfPos(pos : vec2f, aspect : f32, cellSize : f32, gx : i32, gy : i32) -> u32 {
  let cx = clamp(i32(floor((pos.x + aspect) / cellSize)), 0, gx - 1);
  let cy = clamp(i32(floor((pos.y + 1.0) / cellSize)), 0, gy - 1);
  return u32(cy) * u32(gx) + u32(cx);
}
`;

// ── Compute: flocking behavior + predator-prey (spatial-grid neighbour search) ─
export const computeWGSL = /* wgsl */ `
${BOID_STRUCT}
${PARAMS_WGSL}
${TERRAIN_WGSL}
${DELTA_WGSL}
struct PopCounts { a : vec4f, b : vec4f }; // alive boids per species: a=0..3, b=4..5
struct DomMatrix { a : vec4f, b : vec4f }; // per-predator bitmask of prey: a=rows 0..3, b=rows 4..5

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read>        inB  : array<Boid>;
@group(0) @binding(2) var<storage, read_write>  outB : array<Boid>;
@group(0) @binding(3) var<uniform> Pop : PopCounts;
@group(0) @binding(4) var<uniform> Dom : DomMatrix;
@group(0) @binding(5) var<storage, read> cellStart : array<u32>; // prefix sums (len numCells+1)
@group(0) @binding(6) var<storage, read> sortedIdx : array<u32>; // boid indices sorted by cell
@group(0) @binding(7) var<storage, read> delta : array<f32>;     // sculpted height delta

fn popCount(s : i32) -> f32 {
  if (s == 0) { return Pop.a.x; } if (s == 1) { return Pop.a.y; }
  if (s == 2) { return Pop.a.z; } if (s == 3) { return Pop.a.w; }
  if (s == 4) { return Pop.b.x; } return Pop.b.y;
}

// Home center of a species (same circle as the "Corners" start).
fn homeCenter(s : i32, ns : i32, aspect : f32) -> vec2f {
  let th = 6.2831853 * (f32(s) + 0.25) / f32(ns);
  return vec2f(cos(th) * aspect * 0.78, sin(th) * 0.78);
}

// Center-weighted radial offset (a soft "ball": densest in the middle, thinning out).
fn radialBlob(seed : f32, radius : f32) -> vec2f {
  let ang = hash11(seed) * 6.2831853;
  let rr = radius * hash11(seed + 17.3) * hash11(seed + 31.7); // product of two → center bias
  return vec2f(cos(ang), sin(ang)) * rr;
}

fn limit(v : vec2f, m : f32) -> vec2f {
  let l = length(v);
  if (l > m && l > 0.0) { return v / l * m; }
  return v;
}

fn hash11(p : f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453); }

// Robust integer hash (no sin → no f32 precision loss for large boid indices).
// Used for chaos-mode encounters, which mix in indices up to the boid count.
fn hash3(a : u32, b : u32, c : u32) -> f32 {
  var h = (a * 0x9e3779b1u) ^ (b * 0x85ebca77u) ^ (c * 0xc2b2ae3du);
  h = h ^ (h >> 15u);
  h = h * 0x27d4eb2fu;
  h = h ^ (h >> 15u);
  return f32(h & 0x00ffffffu) / 16777216.0;
}

// Predator-prey matrix (bitmask per predator row): does species 'a' eat species 'b'?
fn domRow(s : i32) -> f32 {
  if (s == 0) { return Dom.a.x; } if (s == 1) { return Dom.a.y; }
  if (s == 2) { return Dom.a.z; } if (s == 3) { return Dom.a.w; }
  if (s == 4) { return Dom.b.x; } return Dom.b.y;
}
fn eats(a : i32, b : i32) -> bool {
  return (u32(domRow(a)) & (1u << u32(b))) != 0u;
}

const ALIGN_RATE  : f32 = 12.0;
const EDGE_MARGIN : f32 = 0.25;
const EDGE_PUSH   : f32 = 6.0;
const WANDER_FREQ : f32 = 0.7;
const WANDER_STR  : f32 = 1.1;

// Energy mode
const STARVE     : f32 = 0.05; // energy used per second (slower → more stable cycle)
const EAT_GAIN   : f32 = 0.55; // energy gained per eaten prey
const DYING_TIME : f32 = 0.55; // seconds to fade out after death
const REPRO_E    : f32 = 0.6;  // min. parent energy required to trigger offspring
const BIRTH_E    : f32 = 0.5;  // starting energy of a newborn
const IMMIGRATION : f32 = 0.0007; // constant immigration rate per dead slot/frame
const ADAPT_RATE  : f32 = 0.16;   // homeland: gentle refill for below-share species
const REPRO_RATE  : f32 = 0.08;   // adaptive: base per-frame reproduction chance of a well-fed parent
const HOMING      : f32 = 0.5;    // homeland mode: pull force of boids toward their home region
const CHAOS_RATE  : f32 = 6.0;    // chaos: encounter-decision windows per second
const CHAOS_KILL  : f32 = 0.5;    // chaos: chance an in-range encounter results in a kill
// Crowd relief (declump): outward pressure per crowding neighbour, and how many neighbours it
// saturates at. The usable range is small (slider goes 0..0.1) — above that it gets too strong.
const DECLUMP_PER  : f32 = 0.25;  // pressure (×maxForce) contributed per neighbour in sepDist
const DECLUMP_CAP  : f32 = 12.0;  // neighbour count at which the pressure stops growing
const DECLUMP_BIRTH : f32 = 0.09; // extra newborn spawn radius per unit declump (stays in-swarm)

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = u32(P.count);
  let i = gid.x;
  if (i >= n) { return; }

  let ns = i32(P.numSpecies);
  var pos    = inB[i].pos;
  var vel    = inB[i].vel;
  var spMe   = i32(inB[i].species);
  var energy = inB[i].energy;
  var age    = inB[i].age + P.dt;
  var flash  = inB[i].flash * exp(-8.0 * P.dt); // flash fades quickly
  let bmode  = i32(P.birthMode);
  let rGate  = hash11(f32(i) * 0.017 + P.time * 7.13);

  // ── Free slot whose birth mode needs NO neighbours (off / constant / homeland) ──
  if (spMe < 0 && bmode != 2) {
    var born = false;
    if (bmode == 1) {
      // constant: small random trickle, random species at a random spot
      if (hash11(f32(i) * 0.037 + P.time * 3.7 + 5.0) < IMMIGRATION) {
        spMe = clamp(i32(floor(hash11(f32(i) * 1.7 + P.time * 2.3) * f32(ns))), 0, ns - 1);
        pos = vec2f((hash11(f32(i) + 9.1) * 2.0 - 1.0) * P.aspect * 0.9,
                    (hash11(f32(i) + 3.3) * 2.0 - 1.0) * 0.9);
        born = true;
      }
    } else if (bmode == 3) {
      // homeland: nearest home region owner, below-share only (need-based).
      var hs = 0; var hd = 1e30;
      for (var s = 0; s < ns; s = s + 1) {
        let hdist = distance(pos, homeCenter(s, ns, P.aspect));
        if (hdist < hd) { hd = hdist; hs = s; }
      }
      var totalH = 0.0;
      for (var s = 0; s < ns; s = s + 1) { totalH += popCount(s); }
      let targetFracH = 1.0 / f32(ns);
      let needH = clamp((targetFracH - popCount(hs) / max(totalH, 1.0)) / targetFracH, 0.0, 1.0);
      if (rGate < P.birthRate * ADAPT_RATE * needH * (P.dt * 60.0)) {
        spMe = hs;
        pos = homeCenter(hs, ns, P.aspect) + radialBlob(f32(i) + P.time, 0.38);
        vel = vec2f(cos(f32(i)), sin(f32(i))) * (P.maxSpeed * 0.5);
        born = true;
      }
    }
    // bmode == 0 (off): nothing respawns.
    if (born) { energy = BIRTH_E; flash = 1.0; age = 0.0; }
    else { vel = vel * exp(-3.0 * P.dt); pos += vel * P.dt; } // coast, stay invisible
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // ── Dying (energy ≤ 0): fade out in place, then free the slot ───────────────
  if (spMe >= 0 && energy <= 0.0) {
    energy = energy - P.dt / DYING_TIME; // runs from 0 → -1 over DYING_TIME
    vel = vel * exp(-4.0 * P.dt);
    pos = pos + vel * P.dt;
    if (energy <= -1.0) { spMe = -1; } // now free
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // Remaining: LIVING (spMe>=0, energy>0) OR FREE-ADAPTIVE (spMe<0, bmode==2).
  let isLiving = spMe >= 0;
  let interR = P.perception * 1.6; // predators/prey sense a bit farther
  let wq = u32(max(floor(P.time * CHAOS_RATE), 0.0));

  var alignSum = vec2f(0.0); var cohSum = vec2f(0.0); var sepSum = vec2f(0.0);
  var nFlock = 0.0; var nSep = 0.0;
  var chaseSum = vec2f(0.0); var chaseN = 0.0;
  var fleeSum  = vec2f(0.0); var fleeN  = 0.0;
  var gotEaten = false; var eaterSp = 0; var ate = false;
  var nd = 1e30; var nsp = -1; var npos = vec2f(0.0); var nvel = vec2f(0.0);

  // ── Spatial-grid neighbour sweep: the boid's own cell + the 8 around it ──────
  // Cell size ≥ interR, so every neighbour within range lives in this 3×3 block →
  // exactly the same neighbours the old O(n²) loop found (only summation order differs).
  // Perf: all range tests use SQUARED distances (dot(diff,diff)) so the per-pair sqrt is
  // avoided — in dense clumps that is millions of sqrt/frame. The real distance is only
  // computed in the separation branch (a small subset within sepDist). Behaviour is
  // bit-identical (d² < r²  ⇔  d < r; sqrt(d²) == length(diff)).
  let perc2  = P.perception * P.perception;
  let sep2   = P.sepDist * P.sepDist;
  let inter2 = interR * interR;
  let kill2  = P.killRadius * P.killRadius;
  let cs = P.cellSize;
  let gx = i32(P.gridX); let gy = i32(P.gridY);
  let cx = clamp(i32(floor((pos.x + P.aspect) / cs)), 0, gx - 1);
  let cy = clamp(i32(floor((pos.y + 1.0) / cs)), 0, gy - 1);
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    let ny = cy + oy;
    if (ny < 0 || ny >= gy) { continue; }
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let nx = cx + ox;
      if (nx < 0 || nx >= gx) { continue; }
      let cell = u32(ny) * u32(gx) + u32(nx);
      let cS = cellStart[cell];
      let cE = cellStart[cell + 1u];
      for (var p = cS; p < cE; p = p + 1u) {
        let j = sortedIdx[p];
        if (j == i) { continue; }
        let o = inB[j];
        let so = i32(o.species);
        if (so < 0) { continue; }
        let opos = o.pos;
        let diff = pos - opos;
        let d2 = dot(diff, diff);
        if (isLiving) {
          if (so == spMe) {
            if (d2 < perc2) { alignSum += o.vel; cohSum += opos; nFlock += 1.0; }
            if (d2 < sep2 && d2 > 0.0) {
              let d = sqrt(d2);
              sepSum += diff / d * (1.0 - d / P.sepDist); nSep += 1.0;
            }
          } else if (d2 < inter2 && d2 > 0.0) {
            if (P.domMode >= 0.5) {
              // chaos: everyone drawn to every other species; contact → symmetric coin flip
              chaseSum += -diff; chaseN += 1.0;
              if (d2 < kill2) {
                let lo = min(i, j); let hi = max(i, j);
                let hit = hash3(lo, hi, wq);
                if (hit < CHAOS_KILL) {
                  let w = hash3(hi, lo, wq + 7u);
                  let iWins = select(i == hi, i == lo, w < 0.5);
                  if (iWins) { ate = true; } else { gotEaten = true; eaterSp = so; }
                }
              }
            } else if (eats(spMe, so)) {
              chaseSum += -diff; chaseN += 1.0;           // prey → chase it
              if (d2 < kill2) { ate = true; }
            } else if (eats(so, spMe)) {
              fleeSum += diff; fleeN += 1.0;              // predator → flee
              if (d2 < kill2) { gotEaten = true; eaterSp = so; }
            }
          }
        } else {
          // free-adaptive: track the nearest well-fed parent (compare squared distances)
          if (o.energy > REPRO_E && d2 < perc2 && d2 < nd) { nd = d2; nsp = so; npos = opos; nvel = o.vel; }
        }
      }
    }
  }

  // ── Free-adaptive slot: reborn from the nearest well-fed parent (in-swarm) ───
  if (!isLiving) {
    var born = false;
    if (nsp >= 0) {
      var total = 0.0;
      for (var s = 0; s < ns; s = s + 1) { total += popCount(s); }
      let targetFrac = 1.0 / f32(ns);
      let frac = popCount(nsp) / max(total, 1.0);
      let ratio = targetFrac / max(frac, 0.001);            // >1 if below fair share
      let factor = clamp(pow(ratio, P.adaptiveStrength), 0.0, 8.0); // strength 0 → 1 (uniform)
      if (rGate < P.birthRate * REPRO_RATE * factor * (P.dt * 60.0)) {
        spMe = nsp;
        // Spawn next to the parent; anti-crowd widens this a bit so birth waves don't instantly
        // repack the swarm to peak density (still well inside the swarm, never random).
        pos = npos + radialBlob(f32(i) + P.time, 0.02 + DECLUMP_BIRTH * P.declump);
        if (length(nvel) > 0.0) { vel = normalize(nvel) * (P.maxSpeed * 0.6); }
        else { vel = vec2f(cos(f32(i)), sin(f32(i))) * (P.maxSpeed * 0.5); }
        born = true;
      }
    }
    if (born) { energy = BIRTH_E; flash = 1.0; age = 0.0; }
    else { vel = vel * exp(-3.0 * P.dt); pos += vel * P.dt; }
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // ── Living boid: apply the accumulated forces ───────────────────────────────

  var acc = vec2f(0.0);

  if (nFlock > 0.0) {
    let center = cohSum / nFlock;
    var dCoh = center - pos;
    if (length(dCoh) > 0.0) { dCoh = normalize(dCoh) * P.maxSpeed; }
    acc += limit(dCoh - vel, P.maxForce) * P.cohesionW;
  }
  if (nSep > 0.0) {
    var dSep = sepSum / nSep;
    if (length(dSep) > 0.0) { dSep = normalize(dSep) * P.maxSpeed; }
    acc += limit(dSep - vel, P.maxForce) * P.separationW;

    // Crowd relief: extra outward pressure whose STRENGTH grows with the crowd COUNT (nSep) — the
    // normal separation above is averaged + clamped to maxForce, so it saturates and lets dense
    // clumps keep packing. This term does not saturate with density → clumps cap their own
    // density (fewer boids per grid cell = lower O(k) cost = better FPS), and the swarm looks
    // airier. Direction is the net away-from-neighbours vector; magnitude ∝ how crowded it is.
    // The usable range is small (slider 0..0.1); declump = 0 → exact original behaviour.
    if (P.declump > 0.0) {
      let s = length(sepSum);
      if (s > 1e-5) {
        let mag = min(nSep, DECLUMP_CAP) * DECLUMP_PER * P.declump;
        acc += (sepSum / s) * (P.maxForce * mag);
      }
    }
  }
  if (chaseN > 0.0) {
    let cdir = normalize(chaseSum);
    acc += limit(cdir * P.maxSpeed - vel, P.maxForce) * P.chaseW;
  }
  if (fleeN > 0.0) {
    let fdir = normalize(fleeSum);
    acc += limit(fdir * P.maxSpeed - vel, P.maxForce) * P.fleeW;
  }

  // homeland mode: gentle pull toward the boid's own home region (defend territory)
  if (i32(P.birthMode) == 3) {
    let hc = homeCenter(spMe, ns, P.aspect);
    var toHome = hc - pos;
    if (length(toHome) > 0.0) { toHome = normalize(toHome) * P.maxSpeed; }
    acc += limit(toHome - vel, P.maxForce) * HOMING;
  }

  vel += acc * P.dt;

  // alignment (same species only): blend heading toward the local average direction
  if (nFlock > 0.0 && length(alignSum) > 0.0) {
    let alignVel = normalize(alignSum / nFlock) * P.maxSpeed;
    let t = clamp(P.alignW * P.dt * ALIGN_RATE, 0.0, 1.0);
    vel = mix(vel, alignVel, t);
  }

  // wander: lively self-motion, prevents collapse
  let ph = f32(i) * 2.3999632;
  let wdir = vec2f(cos(P.time * WANDER_FREQ + ph), sin(P.time * WANDER_FREQ * 1.27 + ph * 1.7));
  vel += wdir * (WANDER_STR * P.maxSpeed) * P.dt;

  // edge avoidance as a soft force (no clamping → no bright edge line)
  let m = EDGE_MARGIN;
  var edgeAcc = vec2f(0.0);
  if (pos.x >  P.aspect - m) { let dpt = (pos.x - (P.aspect - m)) / m; edgeAcc.x -= dpt * dpt; }
  if (pos.x < -P.aspect + m) { let dpt = ((-P.aspect + m) - pos.x) / m; edgeAcc.x += dpt * dpt; }
  if (pos.y >  1.0 - m)      { let dpt = (pos.y - (1.0 - m)) / m;       edgeAcc.y -= dpt * dpt; }
  if (pos.y < -1.0 + m)      { let dpt = ((-1.0 + m) - pos.y) / m;      edgeAcc.y += dpt * dpt; }
  vel += edgeAcc * (EDGE_PUSH * P.maxSpeed) * P.dt;

  // ── Terrain avoidance: repel off the mountains like the screen edge does ─────
  // The user's reference: the soft screen-edge repulsion feels natural (not a hard bounce, not
  // leaky). So mountains use the SAME shape — a restoring push back down the slope whose strength
  // grows CUBICALLY with height into the mountain: nearly nothing at the foot (smooth entry, no
  // "water bouncing off glass"), a firm ceiling near the top (nothing flies over). A per-frame cap
  // keeps even a high Barrier strength from snapping boids back violently, so there is a wide
  // usable range instead of the old "too weak = fly over / too strong = bounce".
  if (P.terrainForce > 0.0) {
    let te = P.time * P.terrainDrift;
    let e = 0.012; // sim-space sampling offset for the finite-difference gradient
    let s = P.terrainScale;
    let cov = P.terrainCoverage;
    let wp = P.terrainWarp;
    let asp = P.aspect;
    // full height = analytic base + sculpted delta, so the swarm feels painted mountains/valleys too
    let hR = terrainH(pos + vec2f(e, 0.0), te, s, cov, wp) + sampleDelta(simToUv(pos + vec2f(e, 0.0), asp));
    let hL = terrainH(pos - vec2f(e, 0.0), te, s, cov, wp) + sampleDelta(simToUv(pos - vec2f(e, 0.0), asp));
    let hU = terrainH(pos + vec2f(0.0, e), te, s, cov, wp) + sampleDelta(simToUv(pos + vec2f(0.0, e), asp));
    let hD = terrainH(pos - vec2f(0.0, e), te, s, cov, wp) + sampleDelta(simToUv(pos - vec2f(0.0, e), asp));
    let grad = vec2f(hR - hL, hU - hD) / (2.0 * e);
    // Penetration into the mountain, exactly like the screen edge's margin: 0 at the foot of the
    // slope, growing with height. A CUBIC ramp makes the push almost nothing at the foot (smooth,
    // no bounce) and very firm near the top (a hard ceiling nothing crosses) — the same shape that
    // makes the screen-edge repulsion feel natural yet solid. Capped so a sculpted cliff can't fling.
    let hHere = terrainH(pos, te, s, cov, wp) + sampleDelta(simToUv(pos, asp));
    let dpt = (hHere - 0.25) / 0.35; // 0 at the slope foot, ~1 mid-slope, >1 near the peak
    let gl = length(grad);
    if (dpt > 0.0 && gl > 1e-4) {
      let downhill = -grad / gl;                 // restoring direction: back down the slope
      // Quadratic in penetration, EXACTLY like EDGE_PUSH·dpt², and NOT capped per-second (that was
      // the bug: after ·dt the push became ~0.01·maxSpeed/frame — far too weak to stop a boid before
      // the peak, so they flew over). The cap is on the per-FRAME change instead, so a natural
      // mountain gets its full (blocking) force while only an extreme sculpted cliff is bounded.
      var dvf = downhill * (P.terrainForce * P.maxSpeed * dpt * dpt) * P.dt;
      dvf = limit(dvf, P.maxSpeed * 0.5);        // ≤ half maxSpeed per frame → firm, never explosive
      vel += dvf;
    }
  }

  vel = limit(vel, P.maxSpeed);
  let spd = length(vel);
  let minSp = P.maxSpeed * 0.5;
  if (spd < minSp && spd > 0.0) { vel = vel / spd * minSp; }

  // ── Swirl (touch vortex): drag the swarm around the finger, faster toward the center ──
  // A local, temporary "brush": inside swirlRadius the velocity is blended toward a tangential
  // orbit; the blend (and thus the effect) is strongest in the middle and fades to the edge.
  // Applied AFTER the speed clamp so the center can genuinely whip faster than maxSpeed
  // (swirlStrength > 1). swirlAmp ramps 0→1 on touch and back to 0 on release → self-healing.
  if (P.swirlAmp > 0.001) {
    let rel = pos - vec2f(P.swirlX, P.swirlY);
    let r = length(rel);
    if (r > 1e-4 && r < P.swirlRadius) {
      let rn = r / P.swirlRadius;                              // 0 = center … 1 = edge
      let profile = pow(1.0 - rn, max(P.swirlFalloff, 0.05));  // inner faster, outer slower
      let radial = rel / r;                                    // outward unit
      let tangent = vec2f(-radial.y, radial.x) * P.swirlDir;   // orbit unit (±1 = CCW/CW)
      let desired = normalize(tangent + radial * P.swirlInward) * (P.maxSpeed * P.swirlStrength);
      vel = mix(vel, desired, clamp(profile * P.swirlAmp, 0.0, 1.0));
    }
  }

  pos += vel * P.dt;

  // ── Eating / death / conversion ─────────────────────────────────────────────
  var outSp = spMe;
  if (P.deathMode < 0.5) {
    // convert: eaten prey instantly becomes the predator
    if (gotEaten) { outSp = eaterSp; flash = 1.0; age = 0.0; }
  } else {
    // energy: eating refills, base consumption drains (starvation)
    energy = min(energy - P.starveRate * P.dt + select(0.0, EAT_GAIN, ate), 1.0);
    // eaten OR starved → start dying (fades out next frame)
    if (gotEaten || energy <= 0.0) { energy = -0.0001; }
  }

  outB[i].pos = pos; outB[i].vel = vel;
  outB[i].species = f32(outSp); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
}
`;

// ── Spatial grid build (3 tiny passes before the behavior pass) ───────────────
// 1) count alive boids per cell (atomics) + remember each boid's cell.
export const gridCountWGSL = /* wgsl */ `
${BOID_STRUCT}
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> inB : array<Boid>;
@group(0) @binding(2) var<storage, read_write> cellCount : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellOf : array<u32>;
${CELL_WGSL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = u32(P.count);
  let i = gid.x;
  if (i >= n) { return; }
  if (i32(inB[i].species) < 0) { cellOf[i] = 0xffffffffu; return; } // dead → not in grid
  let c = cellOfPos(inB[i].pos, P.aspect, P.cellSize, i32(P.gridX), i32(P.gridY));
  cellOf[i] = c;
  atomicAdd(&cellCount[c], 1u);
}
`;

// 2) exclusive prefix sum over the per-cell counts (single thread; numCells is small).
export const gridScanWGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> cellCount : array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStart : array<u32>;
@group(0) @binding(3) var<storage, read_write> cellCursor : array<u32>;
@compute @workgroup_size(1)
fn main() {
  let numCells = u32(P.gridX) * u32(P.gridY);
  var acc = 0u;
  for (var c = 0u; c < numCells; c = c + 1u) {
    cellStart[c] = acc;
    cellCursor[c] = acc;   // running write cursor, consumed by the scatter pass
    acc = acc + cellCount[c];
  }
  cellStart[numCells] = acc; // end sentinel (= total alive)
}
`;

// 3) scatter each alive boid's index into its cell's slot in the sorted list.
export const gridScatterWGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> cellCursor : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> sortedIdx : array<u32>;
@group(0) @binding(3) var<storage, read> cellOf : array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = u32(P.count);
  let i = gid.x;
  if (i >= n) { return; }
  let c = cellOf[i];
  if (c == 0xffffffffu) { return; } // dead → skip
  let slot = atomicAdd(&cellCursor[c], 1u);
  sortedIdx[slot] = i;
}
`;

// ── Render: one oriented triangle per boid, color/size by species ─────────────
export const boidsWGSL = /* wgsl */ `
${BOID_STRUCT}
struct RenderParams {
  aspect     : f32,
  scale      : f32,
  maxSpeed   : f32,
  energyView : f32, // 1 in Energy mode (brightness by energy), otherwise 0
  colorGain  : f32, // overall brightness of a boid; lower = less white blow-out in dense areas
  _p0 : f32, _p1 : f32, _p2 : f32,
};
struct Palette { colors : array<vec4f, 6>, }; // rgb = color, a = size factor

@group(0) @binding(0) var<storage, read> boids : array<Boid>;
@group(0) @binding(1) var<uniform> R : RenderParams;
@group(0) @binding(2) var<uniform> Pal : Palette;

struct VSOut {
  @builtin(position) clip   : vec4f,
  @location(0)       speedN : f32,
  @location(1)       along  : f32,
  @location(2)       col    : vec3f,
  @location(3)       flash  : f32,
  @location(4)       bright : f32,
  @location(5)       dying  : f32, // 1 = dying (for reddish tint)
};

@vertex
fn vs(@location(0) v : vec2f, @builtin(instance_index) ii : u32) -> VSOut {
  let b = boids[ii];
  var out : VSOut;

  let spI = i32(b.species);
  if (spI < 0) {
    // free/dead slot → offscreen (invisible)
    out.clip = vec4f(2.0, 2.0, 0.0, 1.0);
    out.speedN = 0.0; out.along = 0.0; out.col = vec3f(0.0); out.flash = 0.0;
    out.bright = 0.0; out.dying = 0.0;
    return out;
  }

  let pal = Pal.colors[clamp(spI, 0, 5)];

  // dying (energy ≤ 0): shrinks and fades; alive: dim by energy (Energy mode only)
  var eb = 1.0;
  var szMul = pal.a;
  var dyingF = 0.0;
  if (b.energy <= 0.0) {
    let fade = clamp(1.0 + b.energy, 0.0, 1.0); // 0 → 1.0, -1 → 0.0
    eb = fade;
    szMul = pal.a * (0.25 + 0.75 * fade);
    dyingF = 1.0;
  } else {
    eb = mix(1.0, clamp(b.energy, 0.2, 1.0), R.energyView);
  }

  var dir = vec2f(0.0, 1.0);
  let sp = length(b.vel);
  if (sp > 1e-5) { dir = b.vel / sp; }

  let rx =  v.x * dir.y + v.y * dir.x;
  let ry = -v.x * dir.x + v.y * dir.y;

  let world = b.pos + vec2f(rx, ry) * (R.scale * szMul);
  let clipX = world.x / R.aspect;

  out.clip   = vec4f(clipX, world.y, 0.0, 1.0);
  out.speedN = clamp(sp / R.maxSpeed, 0.0, 1.0);
  out.along  = v.y;
  out.col    = pal.rgb;
  out.flash  = clamp(b.flash, 0.0, 1.0);
  out.bright = eb;
  out.dying  = dyingF;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let head = clamp(in.along * 0.5 + 0.5, 0.0, 1.0);
  let intensity = 0.35 + 0.45 * head + 0.2 * in.speedN;
  var col = in.col;
  col = mix(col, vec3f(0.9, 0.15, 0.1), in.dying * 0.6); // dying → reddish
  var c = col * intensity * in.bright * R.colorGain;
  c = mix(c, vec3f(1.0, 1.0, 1.0), in.flash * 0.6); // eat/birth flash (subtle)
  return vec4f(c, 1.0); // additively blended
}
`;

// ── Count: counts alive boids per species via atomics (for the live panel) ────
export const countWGSL = /* wgsl */ `
${BOID_STRUCT}
struct CParams {
  dt : f32, perception : f32, sepDist : f32, maxSpeed : f32, maxForce : f32,
  alignW : f32, cohesionW : f32, separationW : f32, aspect : f32, count : f32,
  time : f32, numSpecies : f32, chaseW : f32, fleeW : f32, killRadius : f32,
  birthRate : f32, deathMode : f32, _p0 : f32, _p1 : f32, _p2 : f32,
};
@group(0) @binding(0) var<uniform> P : CParams;
@group(0) @binding(1) var<storage, read> boids : array<Boid>;
@group(0) @binding(2) var<storage, read_write> counts : array<atomic<u32>, 6>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = u32(P.count);
  let i = gid.x;
  if (i >= n) { return; }
  let sp = i32(boids[i].species);
  if (sp >= 0 && sp < 6) { atomicAdd(&counts[sp], 1u); }
}
`;

// ── Fade: fullscreen quad, pulls the trail buffer toward the BG each frame ────
export const fadeWGSL = /* wgsl */ `
struct FadeParams { r : f32, g : f32, b : f32, fade : f32, };
@group(0) @binding(0) var<uniform> F : FadeParams;

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(F.r, F.g, F.b, F.fade);
}
`;

// ── Terrain: contour-line relief drawn under the swarm (fullscreen) ───────────
// Same height field the boids feel. Renders as a subtle topographic map: a dark valley→peak
// tint plus anti-aliased contour lines. The lines bunch up automatically where the ground is
// steep (equal-height spacing over a short screen distance) → mountains read clearly, valleys
// stay open, and it all stays dark so the additive swarm on top remains the star.
export const terrainWGSL = /* wgsl */ `
${TERRAIN_WGSL}
${DELTA_WGSL}
struct TerrainParams {
  aspect : f32, time : f32, scale : f32, drift : f32,
  lineCount : f32, lineWidth : f32, lineBright : f32, tint : f32,
  valley : vec4f, // rgb = valley-floor color; .a = terrainCoverage
  mid    : vec4f, // rgb = mid-slope color; .a = terrainWarp
  peak   : vec4f, // rgb = peak color; .a = hill-shading strength
  snow   : vec4f, // rgb = snow/rock cap color; .a = snow-cap strength
  misc   : vec4f, // .x = sim units per pixel (for derivative-free contour AA)
};
@group(0) @binding(0) var<uniform> T : TerrainParams;
@group(0) @binding(1) var<storage, read> delta : array<f32>; // sculpted height delta

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
  // full height = analytic base + sculpted delta (what the swarm feels too). NOT clamped to [0,1]:
  // clamping flattened sculpted peaks/pits into structureless caps (white when raised, blue when
  // lowered). Left unbounded, the dome/bowl keeps its slope → contour lines + shading run right
  // over it. The color ramp + line brightness clamp internally, so oversaturation is graceful.
  let h = terrainH(sp, te, T.scale, cov, wp) + sampleDelta(in.uv);
  // Analytic height gradient (NO screen-space derivatives): dpdx/dpdy/fwidth returned per-tile
  // garbage on some Linux Vulkan / ANGLE drivers → rectangular block artifacts in the terrain.
  // Sampling the full height (base + delta) at small offsets is fully driver-independent.
  let ge = 0.014;
  let hgx = (terrainH(sp + vec2f(ge, 0.0), te, T.scale, cov, wp) + sampleDelta(simToUv(sp + vec2f(ge, 0.0), T.aspect))) - h;
  let hgy = (terrainH(sp + vec2f(0.0, ge), te, T.scale, cov, wp) + sampleDelta(simToUv(sp + vec2f(0.0, ge), T.aspect))) - h;
  let gradSim = vec2f(hgx, hgy) / ge; // d(height)/d(sim units)

  // hypsometric elevation fill: valley → mid → peak, so the height reads by COLOR (not just the
  // lines). Two chained mixes (no branch): t1 drives the lower half, t2 the upper half.
  let t1 = clamp(h * 2.0, 0.0, 1.0);
  let t2 = clamp(h * 2.0 - 1.0, 0.0, 1.0);
  var col = mix(mix(T.valley.rgb, T.mid.rgb, t1), T.peak.rgb, t2) * T.tint;
  // Bright snow/rock cap on the highest ground → tall peaks read as light & high (natural peaks get
  // a touch, hand-sculpted tall ones get a full cap). Applied before shading so it still gets lit.
  let snow = smoothstep(0.6, 1.0, h);
  col = mix(col, T.snow.rgb, snow * T.snow.a);

  // ── Hill-shading from the ANALYTIC gradient of the FULL height ──
  // Surface normal from the sampled height gradient (base + sculpted delta), lit from the
  // upper-left. Large normal-z + a narrow bright/shadow range → gentle relief, no harsh shadows.
  let n = normalize(vec3f(-gradSim.x, -gradSim.y, 1.1)); // z = vertical exaggeration
  let lightDir = normalize(vec3f(-0.5, 0.7, 0.75));
  let dif = clamp(dot(n, lightDir), 0.0, 1.0);
  let shadeF = mix(1.0, 0.5 + 0.9 * dif, T.peak.a); // range 0.5..1.4
  col = col * shadeF;

  // anti-aliased contour lines at each 1/lineCount height level. The per-pixel change of hf is
  // computed ANALYTICALLY (no fwidth) so steep ground still packs more lines in, but nothing
  // depends on driver derivatives: |d(hf)/dpixel| = lineCount·|gradSim|·(sim units per pixel).
  let hf = h * T.lineCount;
  let w = T.lineCount * length(gradSim) * T.misc.x;
  let g = abs(fract(hf + 0.5) - 0.5);        // distance to nearest contour level (0..0.5)
  let aa = g / max(w, 1e-5);                  // in pixels from the line
  let line = 1.0 - smoothstep(0.0, T.lineWidth, aa);
  // Fade the lines out where they would pack tighter than a pixel (very steep sculpted walls):
  // otherwise dozens of contours merge into one solid near-white fill (the "white blob"). Fading
  // them keeps the shaded slope readable instead.
  let lineFade = 1.0 - smoothstep(0.5, 1.2, w);
  // neutral warm-gray ink lines over the shaded relief; a touch brighter toward the peaks
  let lineCol = vec3f(0.72, 0.74, 0.68) * (0.55 + 0.6 * clamp(h, 0.0, 1.0));
  col += lineCol * (line * T.lineBright * lineFade);

  return vec4f(col, 1.0);
}
`;

// ── Terrain edit: the long-press brush paints the delta buffer + slow self-heal ──
// Runs each frame before the sim. Each thread owns one delta cell: it relaxes the cell toward 0
// (self-healing relief) and, while a brush is active, raises/lowers it with a smooth falloff. A
// detail term modulates the brush with craggy noise so high "detail" sculpts jagged mountains.
export const terrainEditWGSL = /* wgsl */ `
${TERRAIN_WGSL}
${DELTA_WGSL}
struct Brush {
  u : f32, v : f32, radius : f32, strength : f32,
  detail : f32, heal : f32, brushOn : f32, dt : f32,
  aspect : f32, time : f32, _p0 : f32, _p1 : f32,
};
@group(0) @binding(0) var<uniform> B : Brush;
@group(0) @binding(1) var<storage, read_write> delta : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= DELTA_W * DELTA_H) { return; }
  let x = i % DELTA_W;
  let y = i / DELTA_W;
  let uv = vec2f((f32(x) + 0.5) / f32(DELTA_W), (f32(y) + 0.5) / f32(DELTA_H));

  var d = delta[i];
  d *= (1.0 - clamp(B.heal * B.dt, 0.0, 1.0)); // slow relax toward the base relief

  if (B.brushOn > 0.5) {
    let du = (uv.x - B.u) * B.aspect; // aspect-correct → the brush is round on screen
    let dv = uv.y - B.v;
    let r = sqrt(du * du + dv * dv) / max(B.radius, 1e-4);
    if (r < 1.0) {
      // Parabolic dome (like the classic Sims pond/hill tool): highest in the middle, and the slope
      // GROWS toward the rim (d/dr(1-r²) = -2r → linear in r) → a clean, rounded raise/lower.
      var amt = 1.0 - r * r;
      if (B.detail > 0.0) {
        // craggy modulation for jagged mountains — floored at 0.45 so it roughens the dome without
        // punching holes in it (keeps the overall rounded shape).
        let n1 = tvnoise(uv * 26.0 + vec2f(3.0, 7.0));
        let n2 = 1.0 - abs(2.0 * tvnoise(uv * 47.0 + vec2f(11.0, 5.0)) - 1.0);
        let rough = 0.45 + 0.55 * clamp(n1 * 0.5 + n2 * n2, 0.0, 1.0);
        amt *= mix(1.0, rough, clamp(B.detail, 0.0, 1.0));
      }
      // Asymptotic approach to the ±cap: as the cell nears its limit the brush adds less, so heavy
      // painting eases in smoothly instead of slamming into a hard flat plateau (dead cap).
      var factor = 1.0;
      if (B.strength > 0.0) { factor = clamp(1.0 - d / 0.95, 0.0, 1.0); }
      else { factor = clamp(1.0 + d / 0.75, 0.0, 1.0); }
      d += B.strength * amt * B.dt * factor;
    }
  }
  delta[i] = clamp(d, -0.7, 0.9);
}
`;

// ── Blit: copy the trail texture onto the canvas ──────────────────────────────
export const blitWGSL = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var tex  : texture_2d<f32>;

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
  var c = textureSample(tex, samp, in.uv).rgb;
  // Floor the faintest residue to pure black. An 8-bit trail buffer that fades
  // multiplicatively gets stuck around 1/255 (rounding never reaches 0), leaving a dim
  // permanent smear. Subtract a tiny threshold and rescale so bright boids stay full.
  let eps = 0.011;
  c = max(c - vec3f(eps), vec3f(0.0)) / (1.0 - eps);
  return vec4f(c, 1.0);
}
`;

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

// ── Compute: flocking behavior + predator-prey ───────────────────────────────
export const computeWGSL = /* wgsl */ `
${BOID_STRUCT}
struct Params {
  dt          : f32,
  perception  : f32,
  sepDist     : f32,
  maxSpeed    : f32,
  maxForce    : f32,
  alignW      : f32,
  cohesionW   : f32,
  separationW : f32,
  aspect      : f32,
  count       : f32,
  time        : f32,
  numSpecies  : f32,
  chaseW      : f32,
  fleeW       : f32,
  killRadius  : f32,
  birthRate   : f32,
  deathMode   : f32, // 0 = convert, 1 = energy
  birthMode   : f32, // 0 off, 1 constant, 2 adaptive, 3 homeland
  starveRate  : f32, // energy lost per second (starvation)
  domMode     : f32, // 0 = matrix (cyclic/random), 1 = chaos (per-encounter random)
  adaptiveStrength : f32, // adaptive reproduction: how strongly small swarms breed faster
  _p3 : f32, _p4 : f32, _p5 : f32, // pad to 24 floats (96 bytes)
};
struct PopCounts { a : vec4f, b : vec4f }; // alive boids per species: a=0..3, b=4..5
struct DomMatrix { a : vec4f, b : vec4f }; // per-predator bitmask of prey: a=rows 0..3, b=rows 4..5

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read>        inB  : array<Boid>;
@group(0) @binding(2) var<storage, read_write>  outB : array<Boid>;
@group(0) @binding(3) var<uniform> Pop : PopCounts;
@group(0) @binding(4) var<uniform> Dom : DomMatrix;

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

  // ── Free slot (dead): respawn depending on birth mode ──────────────────────
  if (spMe < 0) {
    let bmode = i32(P.birthMode);
    let rGate = hash11(f32(i) * 0.017 + P.time * 7.13);
    var born = false;

    if (bmode == 1) {
      // constant: small random trickle, random species at a random spot
      if (hash11(f32(i) * 0.037 + P.time * 3.7 + 5.0) < IMMIGRATION) {
        spMe = clamp(i32(floor(hash11(f32(i) * 1.7 + P.time * 2.3) * f32(ns))), 0, ns - 1);
        pos = vec2f((hash11(f32(i) + 9.1) * 2.0 - 1.0) * P.aspect * 0.9,
                    (hash11(f32(i) + 3.3) * 2.0 - 1.0) * 0.9);
        born = true;
      }
    } else if (bmode == 2) {
      // adaptive: a free slot is reborn from the NEAREST well-fed parent (energy > REPRO_E)
      // → the child appears right next to a real boid, inside the swarm (never random, no
      // fragmentation). The birth RATE adapts to swarm size: a species below its fair share
      // (1/ns of all alive) breeds faster, controlled by adaptiveStrength (0 = uniform rate).
      var total = 0.0;
      for (var s = 0; s < ns; s = s + 1) { total += popCount(s); }
      let targetFrac = 1.0 / f32(ns);

      var nd = 1e30; var nsp = -1; var npos = vec2f(0.0); var nvel = vec2f(0.0);
      for (var j = 0u; j < n; j = j + 1u) {
        let o = inB[j];
        let so = i32(o.species);
        if (so < 0 || o.energy <= REPRO_E) { continue; } // only well-fed parents
        let dd = distance(pos, o.pos);
        if (dd < P.perception && dd < nd) { nd = dd; nsp = so; npos = o.pos; nvel = o.vel; }
      }
      if (nsp >= 0) {
        let frac = popCount(nsp) / max(total, 1.0);
        let ratio = targetFrac / max(frac, 0.001);            // >1 if below fair share
        let factor = clamp(pow(ratio, P.adaptiveStrength), 0.0, 8.0); // strength 0 → 1 (uniform)
        if (rGate < P.birthRate * REPRO_RATE * factor * (P.dt * 60.0)) {
          spMe = nsp;
          pos = npos + radialBlob(f32(i) + P.time, 0.02); // right next to the parent
          if (length(nvel) > 0.0) { vel = normalize(nvel) * (P.maxSpeed * 0.6); }
          else { vel = vec2f(cos(f32(i)), sin(f32(i))) * (P.maxSpeed * 0.5); }
          born = true;
        }
      }
    } else if (bmode == 3) {
      // homeland: born as the owner of the nearest home region, as a soft ball around
      // the home center — but only while that species is below its fair share (so big
      // territories stop growing; empty territories can be re-founded).
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

    if (born) {
      energy = BIRTH_E; flash = 1.0; age = 0.0;
    } else {
      vel = vel * exp(-3.0 * P.dt); // coast, stay invisible
      pos += vel * P.dt;
    }
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // ── Dying (energy ≤ 0): fade out in place, then free the slot ───────────────
  if (energy <= 0.0) {
    energy = energy - P.dt / DYING_TIME; // runs from 0 → -1 over DYING_TIME
    vel = vel * exp(-4.0 * P.dt);
    pos = pos + vel * P.dt;
    if (energy <= -1.0) { spMe = -1; } // now free
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // ── Living boid ─────────────────────────────────────────────────────────────
  var alignSum = vec2f(0.0);
  var cohSum   = vec2f(0.0);
  var sepSum   = vec2f(0.0);
  var nFlock   = 0.0;
  var nSep     = 0.0;
  var chaseSum = vec2f(0.0); var chaseN = 0.0;
  var fleeSum  = vec2f(0.0); var fleeN  = 0.0;
  var gotEaten = false; var eaterSp = 0;
  var ate = false;

  let interR = P.perception * 1.6; // predators/prey sense a bit farther

  for (var j = 0u; j < n; j = j + 1u) {
    if (j == i) { continue; }
    let o = inB[j];
    let so = i32(o.species);
    if (so < 0) { continue; } // ignore the dead
    let diff = pos - o.pos;
    let d = length(diff);

    if (so == spMe) {
      if (d < P.perception) { alignSum += o.vel; cohSum += o.pos; nFlock += 1.0; }
      if (d < P.sepDist && d > 0.0) { sepSum += normalize(diff) * (1.0 - d / P.sepDist); nSep += 1.0; }
    } else if (d < interR && d > 0.0) {
      if (P.domMode >= 0.5) {
        // chaos: no fixed roles — everyone is drawn toward every other species (they pile into
        // a dense brawl), and on contact a symmetric per-pair coin flip decides whether the
        // attack lands and who wins → exactly one dies. No permanent predator or prey.
        chaseSum += -diff; chaseN += 1.0;
        if (d < P.killRadius) {
          let lo = min(i, j); let hi = max(i, j);
          let wq = u32(max(floor(P.time * CHAOS_RATE), 0.0));
          let hit = hash3(lo, hi, wq);
          if (hit < CHAOS_KILL) {
            let w = hash3(hi, lo, wq + 7u);
            let iWins = select(i == hi, i == lo, w < 0.5);
            if (iWins) { ate = true; }
            else { gotEaten = true; eaterSp = so; }
          }
        }
      } else if (eats(spMe, so)) {
        chaseSum += -diff; chaseN += 1.0;           // prey → chase it
        if (d < P.killRadius) { ate = true; }
      } else if (eats(so, spMe)) {
        fleeSum += diff; fleeN += 1.0;              // predator → flee
        if (d < P.killRadius) { gotEaten = true; eaterSp = so; }
      }
    }
  }

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

  vel = limit(vel, P.maxSpeed);
  let spd = length(vel);
  let minSp = P.maxSpeed * 0.5;
  if (spd < minSp && spd > 0.0) { vel = vel / spd * minSp; }

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
  return textureSample(tex, samp, in.uv);
}
`;

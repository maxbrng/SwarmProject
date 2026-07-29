struct PopCounts { a : vec4f, b : vec4f }; // alive per species: a=0..3, b=4..5
struct DomMatrix { a : vec4f, b : vec4f }; // per-predator prey bitmask: a=rows 0..3, b=rows 4..5

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

// Center-weighted radial offset (a soft ball, densest in the middle).
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

// Refuge: the most endangered species (smallest one below the threshold), or -1 if none / off.
fn rescueTarget(ns : i32, thr : f32) -> i32 {
  if (thr <= 0.0) { return -1; }
  var worst = -1;
  var worstN = thr;
  for (var s = 0; s < ns; s = s + 1) {
    let c = popCount(s);
    if (c < worstN) { worstN = c; worst = s; }
  }
  return worst;
}

struct Rescue { hit : bool, sp : i32, pos : vec2f, vel : vec2f };

// A free slot asks the refuge whether to re-colonise this frame (independent of the birth mode).
fn tryRescue(i : u32, ns : i32) -> Rescue {
  var r : Rescue;
  r.hit = false; r.sp = -1; r.pos = vec2f(0.0); r.vel = vec2f(0.0);
  let sp = rescueTarget(ns, P.rescueThr);
  if (sp < 0) { return r; }
  // rescueRate is boids/sec for the whole sim; dividing by the free slots keeps the rate steady.
  var alive = 0.0;
  for (var s = 0; s < ns; s = s + 1) { alive += popCount(s); }
  let freeSlots = max(P.count - alive, 1.0);
  // deeper deficit → faster inflow (a species at 0 recovers hard, one near the threshold trickles)
  let deficit = clamp((P.rescueThr - popCount(sp)) / max(P.rescueThr, 1.0), 0.0, 1.0);
  let chance = P.rescueRate * deficit * P.dt / freeSlots;
  if (hash11(f32(i) * 0.091 + P.time * 11.7 + 2.5) >= chance) { return r; }
  r.hit = true;
  r.sp = sp;
  // Arrive from beyond the edge and swim in, spread along the border, so a predator can't camp the spawn.
  let th = 6.2831853 * (f32(sp) + 0.25) / f32(ns);
  let dir = vec2f(cos(th), sin(th));                                    // this species' side of the world
  let tX = select(1e9, P.aspect / abs(dir.x), abs(dir.x) > 1e-4);
  let tY = select(1e9, 1.0 / abs(dir.y), abs(dir.y) > 1e-4);
  let tBorder = min(tX, tY);                                            // distance along dir to the edge
  let tang = vec2f(-dir.y, dir.x);                                      // along the border
  let spread = (hash11(f32(i) * 0.77 + P.time * 1.7) - 0.5) * 2.0 * RESCUE_SPREAD;
  r.pos = dir * (tBorder + 0.15) + tang * spread;                      // just outside, spread along the edge
  r.vel = -dir * (P.maxSpeed * 0.7);                                    // stream inward, into view
  return r;
}

fn hash11(p : f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453); }

// Robust integer hash (no sin → no precision loss for large boid indices); used by chaos encounters.
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
const RESCUE_SPREAD : f32 = 0.35; // how far rescue arrivals spread along the border they enter from
// Crowd relief (declump): outward pressure per crowding neighbour, and where it saturates.
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

  // Free slot whose birth mode needs no neighbours (off / constant / homeland).
  if (spMe < 0 && bmode != 2) {
    var born = false;
    var rescued = false;
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
    // bmode == 0 (off): nothing respawns — except the refuge below, which is independent.
    if (!born) {
      let rc = tryRescue(i, ns);
      if (rc.hit) { spMe = rc.sp; pos = rc.pos; vel = rc.vel; born = true; rescued = true; }
    }
    // Refuge arrivals start full so they can immediately reproduce (needs energy > REPRO_E).
    if (born) { energy = select(BIRTH_E, 1.0, rescued); flash = 1.0; age = 0.0; }
    else { vel = vel * exp(-3.0 * P.dt); pos += vel * P.dt; } // coast, stay invisible
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // Dying (energy ≤ 0): fade out in place, then free the slot.
  if (spMe >= 0 && energy <= 0.0) {
    energy = energy - P.dt / DYING_TIME; // runs from 0 → -1 over DYING_TIME
    vel = vel * exp(-4.0 * P.dt);
    pos = pos + vel * P.dt;
    if (energy <= -1.0) { spMe = -1; } // now free
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // Remaining: living (spMe>=0, energy>0) or free-adaptive (spMe<0, bmode==2).
  let isLiving = spMe >= 0;
  let interR = P.perception * 1.6; // predators/prey sense a bit farther
  let wq = u32(max(floor(P.time * CHAOS_RATE), 0.0));

  var alignSum = vec2f(0.0); var cohSum = vec2f(0.0); var sepSum = vec2f(0.0);
  var nFlock = 0.0; var nSep = 0.0;
  var chaseSum = vec2f(0.0); var chaseN = 0.0;
  var fleeSum  = vec2f(0.0); var fleeN  = 0.0;
  var gotEaten = false; var eaterSp = 0; var ate = false;
  var nd = 1e30; var nsp = -1; var npos = vec2f(0.0); var nvel = vec2f(0.0);

  // Sweep the boid's cell + the 8 around it (cell size ≥ interR). Range tests use squared distances;
  // only the separation branch needs the real length.
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

  // Free-adaptive slot: reborn from the nearest well-fed parent in the swarm.
  if (!isLiving) {
    var born = false;
    var rescued = false;
    if (nsp >= 0) {
      var total = 0.0;
      for (var s = 0; s < ns; s = s + 1) { total += popCount(s); }
      let targetFrac = 1.0 / f32(ns);
      let frac = popCount(nsp) / max(total, 1.0);
      let ratio = targetFrac / max(frac, 0.001);            // >1 if below fair share
      let factor = clamp(pow(ratio, P.adaptiveStrength), 0.0, 8.0); // strength 0 → 1 (uniform)
      if (rGate < P.birthRate * REPRO_RATE * factor * (P.dt * 60.0)) {
        spMe = nsp;
        // spawn next to the parent; declump widens this so birth waves don't repack to peak density
        pos = npos + radialBlob(f32(i) + P.time, 0.02 + DECLUMP_BIRTH * P.declump);
        if (length(nvel) > 0.0) { vel = normalize(nvel) * (P.maxSpeed * 0.6); }
        else { vel = vec2f(cos(f32(i)), sin(f32(i))) * (P.maxSpeed * 0.5); }
        born = true;
      }
    }
    // The parent-based path can't revive a species at 0 (no parent left) — that's what the refuge is for.
    if (!born) {
      let rc = tryRescue(i, ns);
      if (rc.hit) { spMe = rc.sp; pos = rc.pos; vel = rc.vel; born = true; rescued = true; }
    }
    if (born) { energy = select(BIRTH_E, 1.0, rescued); flash = 1.0; age = 0.0; }
    else { vel = vel * exp(-3.0 * P.dt); pos += vel * P.dt; }
    outB[i].pos = pos; outB[i].vel = vel;
    outB[i].species = f32(spMe); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
    return;
  }

  // Living boid: apply the accumulated forces.

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

    // Crowd relief: outward pressure that grows with the neighbour count, so clumps cap their density.
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

  // homeland mode: gentle pull toward the boid's own home region
  if (i32(P.birthMode) == 3) {
    let hc = homeCenter(spMe, ns, P.aspect);
    var toHome = hc - pos;
    if (length(toHome) > 0.0) { toHome = normalize(toHome) * P.maxSpeed; }
    acc += limit(toHome - vel, P.maxForce) * HOMING;
  }

  vel += acc * P.dt;

  // alignment (same species): blend heading toward the local average direction
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

  // Terrain avoidance: a restoring push down the slope that grows with how far the boid has climbed.
  if (P.terrainForce > 0.0) {
    let te = P.time * P.terrainDrift;
    let e = 0.012; // sim-space offset for the finite-difference gradient
    let s = P.terrainScale;
    let cov = P.terrainCoverage;
    let wp = P.terrainWarp;
    let asp = P.aspect;
    let tseed = vec2f(P.terrainSeedX, P.terrainSeedY);
    // full height = analytic base + sculpted delta, so painted mountains/valleys are felt too
    let hR = terrainH(pos + vec2f(e, 0.0), te, s, cov, wp, tseed) + sampleDelta(simToUv(pos + vec2f(e, 0.0), asp));
    let hL = terrainH(pos - vec2f(e, 0.0), te, s, cov, wp, tseed) + sampleDelta(simToUv(pos - vec2f(e, 0.0), asp));
    let hU = terrainH(pos + vec2f(0.0, e), te, s, cov, wp, tseed) + sampleDelta(simToUv(pos + vec2f(0.0, e), asp));
    let hD = terrainH(pos - vec2f(0.0, e), te, s, cov, wp, tseed) + sampleDelta(simToUv(pos - vec2f(0.0, e), asp));
    let grad = vec2f(hR - hL, hU - hD) / (2.0 * e);
    // 0 at the foot, ~1 mid-slope, >1 near the peak
    let hHere = terrainH(pos, te, s, cov, wp, tseed) + sampleDelta(simToUv(pos, asp));
    let dpt = (hHere - 0.25) / 0.35;
    let gl = length(grad);
    if (dpt > 0.0 && gl > 1e-4) {
      let downhill = -grad / gl;                 // back down the slope
      // grows quadratically with the climb; the per-frame cap keeps a sculpted cliff bounded
      var dvf = downhill * (P.terrainForce * P.maxSpeed * dpt * dpt) * P.dt;
      dvf = limit(dvf, P.maxSpeed * 0.5);        // ≤ half maxSpeed per frame
      vel += dvf;
    }
  }

  vel = limit(vel, P.maxSpeed);
  let spd = length(vel);
  let minSp = P.maxSpeed * 0.5;
  if (spd < minSp && spd > 0.0) { vel = vel / spd * minSp; }

  // Swirl (touch vortex): inside swirlRadius, blend velocity toward a tangential orbit, strongest in
  // the middle. swirlAmp ramps 0→1 on touch and back on release, so the swarm heals itself.
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

  // Eating / death / conversion.
  var outSp = spMe;
  if (P.deathMode < 0.5) {
    // convert: eaten prey instantly becomes the predator
    if (gotEaten) { outSp = eaterSp; flash = 1.0; age = 0.0; }
  } else {
    // energy: eating refills, base consumption drains (starvation)
    energy = min(energy - P.starveRate * P.dt + select(0.0, EAT_GAIN, ate), 1.0);
    if (gotEaten || energy <= 0.0) { energy = -0.0001; } // eaten or starved → start dying
  }

  outB[i].pos = pos; outB[i].vel = vel;
  outB[i].species = f32(outSp); outB[i].energy = energy; outB[i].age = age; outB[i].flash = flash;
}

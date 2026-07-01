// WGSL-Shader für die Boids-Simulation.
// Inline als Strings gehalten, damit kein .wgsl-Loader in Next/Turbopack nötig ist.

// Gemeinsame Struct-Definitionen (in jedes Modul kopiert, da WGSL-Module getrennt sind).
const BOID_STRUCT = /* wgsl */ `
struct Boid {
  pos : vec2f,
  vel : vec2f,
};
`;

// ── Compute: das eigentliche Schwarmverhalten ────────────────────────────────
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
  _pad1       : f32,
};

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read>        inB  : array<Boid>;
@group(0) @binding(2) var<storage, read_write>  outB : array<Boid>;

fn limit(v : vec2f, m : f32) -> vec2f {
  let l = length(v);
  if (l > m && l > 0.0) { return v / l * m; }
  return v;
}

// Wie schnell sich ein Boid auf die mittlere Nachbar-Heading dreht (mit alignW skaliert).
// Im Referenz-Repo ist alignment ungeclampt & dominant — hier als stabiler Blend nachgebaut.
const ALIGN_RATE : f32 = 12.0;

// Randvermeidung als sanfte Kraft (quadratischer Anstieg zur Wand). Generöser Margin,
// kein hartes Klemmen → keine Rand-Linie, der Schwarm bankt davor ab.
const EDGE_MARGIN : f32 = 0.25;
const EDGE_PUSH   : f32 = 6.0;

// Wander: lebendige, langsam variierende Eigenbewegung pro Boid → verhindert Kollaps & Stillstand.
const WANDER_FREQ : f32 = 0.7;
const WANDER_STR  : f32 = 1.1;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = u32(P.count);
  let i = gid.x;
  if (i >= n) { return; }

  var pos = inB[i].pos;
  var vel = inB[i].vel;

  var alignSum = vec2f(0.0);
  var cohSum   = vec2f(0.0);
  var sepSum   = vec2f(0.0);
  var nFlock   = 0.0;
  var nSep     = 0.0;

  for (var j = 0u; j < n; j = j + 1u) {
    if (j == i) { continue; }
    let o = inB[j];
    let diff = pos - o.pos;
    let d = length(diff);
    if (d < P.perception) {
      alignSum += o.vel;
      cohSum   += o.pos;
      nFlock   += 1.0;
    }
    if (d < P.sepDist && d > 0.0) {
      // weiche, lineare Abstoßung (1 nah → 0 am Rand); kein 1/d²-Spike
      sepSum += normalize(diff) * (1.0 - d / P.sepDist);
      nSep   += 1.0;
    }
  }

  // cohesion + separation: sanfte Kräfte, auf maxForce begrenzt (wie im Referenz-Repo)
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

  vel += acc * P.dt;

  // alignment: DOMINANT — Heading auf die lokale Nachbar-Durchschnittsrichtung blenden.
  // Das ist der Kern des Vogelschwarm-Looks (gemeinsames Fließen & Wenden).
  if (nFlock > 0.0 && length(alignSum) > 0.0) {
    let alignVel = normalize(alignSum / nFlock) * P.maxSpeed;
    let t = clamp(P.alignW * P.dt * ALIGN_RATE, 0.0, 1.0);
    vel = mix(vel, alignVel, t);
  }

  // Wander: pro Boid eine langsam rotierende Eigenbewegung → ständige Lebendigkeit,
  // bricht Symmetrie auf, verhindert den globalen Kollaps zu einem Punkt.
  let ph = f32(i) * 2.3999632; // goldener Winkel als Phase
  let wdir = vec2f(cos(P.time * WANDER_FREQ + ph), sin(P.time * WANDER_FREQ * 1.27 + ph * 1.7));
  vel += wdir * (WANDER_STR * P.maxSpeed) * P.dt;

  // Randvermeidung als sanfte Kraft: quadratischer Anstieg zur Wand, kein Klemmen → keine Linie.
  let m = EDGE_MARGIN;
  var edgeAcc = vec2f(0.0);
  if (pos.x >  P.aspect - m) { let dpt = (pos.x - (P.aspect - m)) / m; edgeAcc.x -= dpt * dpt; }
  if (pos.x < -P.aspect + m) { let dpt = ((-P.aspect + m) - pos.x) / m; edgeAcc.x += dpt * dpt; }
  if (pos.y >  1.0 - m)      { let dpt = (pos.y - (1.0 - m)) / m;       edgeAcc.y -= dpt * dpt; }
  if (pos.y < -1.0 + m)      { let dpt = ((-1.0 + m) - pos.y) / m;      edgeAcc.y += dpt * dpt; }
  vel += edgeAcc * (EDGE_PUSH * P.maxSpeed) * P.dt;

  vel = limit(vel, P.maxSpeed);

  // gleichmäßige Reisegeschwindigkeit (≥ 50 % maxSpeed) → ruhiges, gleitendes Bild
  let sp = length(vel);
  let minSp = P.maxSpeed * 0.5;
  if (sp < minSp && sp > 0.0) { vel = vel / sp * minSp; }

  pos += vel * P.dt;

  outB[i].pos = pos;
  outB[i].vel = vel;
}
`;

// ── Render: ein orientiertes Dreieck pro Boid (instanziert) ───────────────────
export const boidsWGSL = /* wgsl */ `
${BOID_STRUCT}
struct RenderParams {
  aspect   : f32,
  scale    : f32,
  maxSpeed : f32,
  _pad     : f32,
};

@group(0) @binding(0) var<storage, read> boids : array<Boid>;
@group(0) @binding(1) var<uniform> R : RenderParams;

struct VSOut {
  @builtin(position) clip   : vec4f,
  @location(0)       speedN : f32,
  @location(1)       along  : f32,  // -0.8 (Heck) .. 1.0 (Spitze)
};

@vertex
fn vs(@location(0) v : vec2f, @builtin(instance_index) ii : u32) -> VSOut {
  let b = boids[ii];

  var dir = vec2f(0.0, 1.0);
  let sp = length(b.vel);
  if (sp > 1e-5) { dir = b.vel / sp; }

  // lokales Dreieck (+y = vorne) auf die Flugrichtung drehen
  let rx =  v.x * dir.y + v.y * dir.x;
  let ry = -v.x * dir.x + v.y * dir.y;

  let world = b.pos + vec2f(rx, ry) * R.scale;
  let clipX = world.x / R.aspect; // Sim-x → Clip-x

  var out : VSOut;
  out.clip   = vec4f(clipX, world.y, 0.0, 1.0);
  out.speedN = clamp(sp / R.maxSpeed, 0.0, 1.0);
  out.along  = v.y;
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  let cool = vec3f(0.18, 0.55, 0.95);
  let warm = vec3f(1.0,  0.82, 0.5);
  let col  = mix(cool, warm, in.speedN);
  let head = clamp(in.along * 0.5 + 0.5, 0.0, 1.0);
  let intensity = 0.45 + 0.75 * head;
  return vec4f(col * intensity, 1.0); // additiv geblendet → Glühen
}
`;

// ── Fade: Vollbild-Quad, das den Trail-Buffer pro Frame Richtung BG zieht ─────
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
  return vec4f(F.r, F.g, F.b, F.fade); // alpha-over → blendet alte Spuren aus
}
`;

// ── Blit: Trail-Textur auf den Canvas kopieren ───────────────────────────────
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

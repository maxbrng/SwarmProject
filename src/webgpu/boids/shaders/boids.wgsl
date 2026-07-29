struct RenderParams {
  aspect     : f32,
  scale      : f32,
  maxSpeed   : f32,
  energyView : f32, // 1 in Energy mode (brightness by energy), otherwise 0
  colorGain  : f32, // overall brightness; lower = less white blow-out in dense areas
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
    // free/dead slot → offscreen
    out.clip = vec4f(2.0, 2.0, 0.0, 1.0);
    out.speedN = 0.0; out.along = 0.0; out.col = vec3f(0.0); out.flash = 0.0;
    out.bright = 0.0; out.dying = 0.0;
    return out;
  }

  let pal = Pal.colors[clamp(spI, 0, 5)];

  // dying: shrinks and fades; alive: dim by energy (Energy mode only)
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

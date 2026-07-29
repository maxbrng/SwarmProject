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
  // Floor the faintest residue to black: an 8-bit trail buffer that fades multiplicatively gets
  // stuck near 1/255, leaving a dim smear. Subtract a threshold and rescale so bright boids stay full.
  let eps = 0.011;
  c = max(c - vec3f(eps), vec3f(0.0)) / (1.0 - eps);
  return vec4f(c, 1.0);
}

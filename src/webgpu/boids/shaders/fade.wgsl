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

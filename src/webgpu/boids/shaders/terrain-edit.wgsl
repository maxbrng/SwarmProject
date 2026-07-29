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
      // parabolic dome: highest in the middle
      var amt = 1.0 - r * r;
      if (B.detail > 0.0) {
        // craggy modulation for jagged mountains, floored at 0.45 so it roughens without holes
        let n1 = tvnoise(uv * 26.0 + vec2f(3.0, 7.0));
        let n2 = 1.0 - abs(2.0 * tvnoise(uv * 47.0 + vec2f(11.0, 5.0)) - 1.0);
        let rough = 0.45 + 0.55 * clamp(n1 * 0.5 + n2 * n2, 0.0, 1.0);
        amt *= mix(1.0, rough, clamp(B.detail, 0.0, 1.0));
      }
      // ease toward the ±cap so heavy painting settles smoothly instead of hitting a plateau
      var factor = 1.0;
      if (B.strength > 0.0) { factor = clamp(1.0 - d / 0.95, 0.0, 1.0); }
      else { factor = clamp(1.0 + d / 0.75, 0.0, 1.0); }
      d += B.strength * amt * B.dt * factor;
    }
  }
  delta[i] = clamp(d, -0.7, 0.9);
}

const DELTA_W : u32 = 320u;
const DELTA_H : u32 = 200u;
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

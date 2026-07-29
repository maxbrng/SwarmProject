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

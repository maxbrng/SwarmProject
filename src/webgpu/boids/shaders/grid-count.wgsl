@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> inB : array<Boid>;
@group(0) @binding(2) var<storage, read_write> cellCount : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellOf : array<u32>;
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

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> cellCursor : array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> sortedIdx : array<u32>;
@group(0) @binding(3) var<storage, read> cellOf : array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = u32(P.count);
  let i = gid.x;
  if (i >= n) { return; }
  let c = cellOf[i];
  if (c == 0xffffffffu) { return; } // dead → skip
  let slot = atomicAdd(&cellCursor[c], 1u);
  sortedIdx[slot] = i;
}

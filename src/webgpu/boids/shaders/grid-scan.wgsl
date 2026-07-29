@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> cellCount : array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStart : array<u32>;
@group(0) @binding(3) var<storage, read_write> cellCursor : array<u32>;
@compute @workgroup_size(1)
fn main() {
  let numCells = u32(P.gridX) * u32(P.gridY);
  var acc = 0u;
  for (var c = 0u; c < numCells; c = c + 1u) {
    cellStart[c] = acc;
    cellCursor[c] = acc;   // running write cursor, consumed by the scatter pass
    acc = acc + cellCount[c];
  }
  cellStart[numCells] = acc; // end sentinel (= total alive)
}

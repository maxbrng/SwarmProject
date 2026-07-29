fn cellOfPos(pos : vec2f, aspect : f32, cellSize : f32, gx : i32, gy : i32) -> u32 {
  let cx = clamp(i32(floor((pos.x + aspect) / cellSize)), 0, gx - 1);
  let cy = clamp(i32(floor((pos.y + 1.0) / cellSize)), 0, gy - 1);
  return u32(cy) * u32(gx) + u32(cx);
}

// Multi-touch pointer tracking. Keeps a live map of active pointers in normalized [0,1] canvas
// coordinates, keyed by pointerId, and captures each pointer so a finger that slides off the canvas
// keeps reporting. This module only tracks — the engine reads the finger count and positions each
// frame to decide between the swirl (one finger) and terrain sculpting (two or more).

export interface PointerTracker {
  // Live map, mutated in place as fingers move; safe to read every frame.
  pointers: Map<number, { nx: number; ny: number }>;
  dispose: () => void;
}

export function createPointerTracker(canvas: HTMLCanvasElement): PointerTracker {
  const pointers = new Map<number, { nx: number; ny: number }>();

  function norm(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      nx: (e.clientX - rect.left) / Math.max(1, rect.width),
      ny: (e.clientY - rect.top) / Math.max(1, rect.height),
    };
  }
  function onDown(e: PointerEvent) {
    pointers.set(e.pointerId, norm(e));
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
  }
  function onMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, norm(e));
  }
  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return {
    pointers,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
  };
}

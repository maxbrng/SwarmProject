"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBoidsEngine, type BoidsHandle } from "@/webgpu/boids/engine";
import type { BoidsConfig } from "@/webgpu/boids/config";
import ControlPanel from "./ControlPanel";

export default function BoidsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<BoidsHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    createBoidsEngine(canvas, { onFps: setFps })
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
        } else {
          handleRef.current = handle;
          dispose = handle.dispose;
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      handleRef.current = null;
      dispose?.();
    };
  }, []);

  const onChange = useCallback((partial: Partial<BoidsConfig>) => {
    handleRef.current?.update(partial);
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="swarm-canvas" />
      {error ? (
        <div className="swarm-error">{error}</div>
      ) : (
        <ControlPanel onChange={onChange} fps={fps} />
      )}
    </>
  );
}

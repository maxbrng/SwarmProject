"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBoidsEngine, type BoidsHandle } from "@/webgpu/boids/engine";
import { DEFAULT_CONFIG, type BoidsConfig, type RGB } from "@/webgpu/boids/config";
import ControlPanel from "./ControlPanel";
import PopulationMonitor from "./PopulationMonitor";

export default function BoidsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<BoidsHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const [numSpecies, setNumSpecies] = useState(DEFAULT_CONFIG.numSpecies);
  const [colors, setColors] = useState<RGB[]>(DEFAULT_CONFIG.speciesColors);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    createBoidsEngine(canvas, { onFps: setFps, onCounts: setCounts })
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
    if (partial.numSpecies !== undefined) setNumSpecies(Math.round(partial.numSpecies));
    if (partial.speciesColors) setColors(partial.speciesColors);
  }, []);

  const onReseed = useCallback(() => {
    handleRef.current?.reseed();
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="swarm-canvas" />
      {error ? (
        <div className="swarm-error">{error}</div>
      ) : (
        <>
          <ControlPanel onChange={onChange} onReseed={onReseed} fps={fps} />
          <PopulationMonitor counts={counts} numSpecies={numSpecies} colors={colors} />
        </>
      )}
    </>
  );
}

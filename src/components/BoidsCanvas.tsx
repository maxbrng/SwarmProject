"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBoidsEngine, type BoidsHandle } from "@/webgpu/boids/engine";
import { DEFAULT_CONFIG, type BoidsConfig, type RGB } from "@/webgpu/boids/config";
import ControlPanel from "./ControlPanel";
import PopulationMonitor from "./PopulationMonitor";
import SwirlPanel from "./SwirlPanel";

export default function BoidsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<BoidsHandle | null>(null);
  const swirlFxRef = useRef<HTMLDivElement>(null); // soft glow overlay (follows the finger)
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const [numSpecies, setNumSpecies] = useState(DEFAULT_CONFIG.numSpecies);
  const [colors, setColors] = useState<RGB[]>(DEFAULT_CONFIG.speciesColors);
  const [swirlDir, setSwirlDir] = useState(DEFAULT_CONFIG.swirlDir >= 0 ? 1 : -1);

  // Update the swirl overlay imperatively (called every frame from the engine) so it tracks the
  // finger at 60 fps without triggering a React re-render. Kept deliberately subtle: just a soft
  // glow that fades in/out with the amp envelope, matching the additive particle look.
  const onSwirl = useCallback((s: { cx: number; cy: number; r: number; amp: number }) => {
    const el = swirlFxRef.current;
    if (!el) return;
    if (s.amp < 0.003) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.opacity = String(Math.min(1, s.amp));
    el.style.left = `${s.cx}px`;
    el.style.top = `${s.cy}px`;
    el.style.width = `${s.r * 2}px`;
    el.style.height = `${s.r * 2}px`;
  }, []);

  // Keep the panel button in sync when a stir gesture flips the direction.
  const onSwirlDir = useCallback((dir: number) => {
    setSwirlDir(dir >= 0 ? 1 : -1);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    createBoidsEngine(canvas, { onFps: setFps, onCounts: setCounts, onSwirl, onSwirlDir })
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
  }, [onSwirl, onSwirlDir]);

  const onChange = useCallback((partial: Partial<BoidsConfig>) => {
    handleRef.current?.update(partial);
    if (partial.numSpecies !== undefined) setNumSpecies(Math.round(partial.numSpecies));
    if (partial.speciesColors) setColors(partial.speciesColors);
    if (partial.swirlDir !== undefined) setSwirlDir(partial.swirlDir >= 0 ? 1 : -1);
  }, []);

  const onReseed = useCallback(() => {
    handleRef.current?.reseed();
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="swarm-canvas" />
      {/* Subtle swirl feedback: a soft radial glow that follows the finger and fades with the amp
          envelope. No hard edge, no motion of its own — the boids show the actual swirl. */}
      <div ref={swirlFxRef} className="swirl-fx" aria-hidden="true">
        <span className="swirl-fx__glow" />
      </div>
      {error ? (
        <div className="swarm-error">{error}</div>
      ) : (
        <>
          <ControlPanel onChange={onChange} onReseed={onReseed} fps={fps} />
          <PopulationMonitor counts={counts} numSpecies={numSpecies} colors={colors} />
          <SwirlPanel onChange={onChange} dir={swirlDir} />
        </>
      )}
    </>
  );
}

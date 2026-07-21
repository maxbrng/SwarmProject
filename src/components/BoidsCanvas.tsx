"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBoidsEngine, type BoidsHandle } from "@/webgpu/boids/engine";
import { DEFAULT_CONFIG, type BoidsConfig, type RGB } from "@/webgpu/boids/config";
import ControlPanel from "./ControlPanel";
import PopulationMonitor from "./PopulationMonitor";
import SwirlPanel from "./SwirlPanel";
import TerrainPanel from "./TerrainPanel";
import SettingsFooter from "./SettingsFooter";
import HelpModal from "./HelpModal";

type PanelId = "swarm" | "terrain" | "swirl";

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
  // Accordion: which settings section (Swarm / Terrain / Swirl) is expanded — at most one at a time.
  // Start with EVERYTHING collapsed (on every screen): the piece must open on the art alone, and the
  // visitor expands sections one by one if they want to. No section is pre-opened.
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const togglePanel = useCallback(
    (p: PanelId) => setOpenPanel((cur) => (cur === p ? null : p)),
    [],
  );
  // Stable per-section handlers. Inline arrows would be new function identities on every render,
  // which would defeat the memo() on the panels — and this component re-renders several times a
  // second from the FPS and population readouts.
  const toggleSwarm = useCallback(() => togglePanel("swarm"), [togglePanel]);
  const toggleTerrain = useCallback(() => togglePanel("terrain"), [togglePanel]);
  const toggleSwirl = useCallback(() => togglePanel("swirl"), [togglePanel]);
  // Master collapse for the whole settings block → one line when closed. Start CLOSED on every
  // screen, so the art is unobstructed until someone taps the top line open.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [help, setHelp] = useState(false); // the guide modal (opened from the ⓘ on the top line)

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

  const onClearTerrain = useCallback(() => {
    handleRef.current?.clearTerrain();
  }, []);

  const onReseedTerrain = useCallback(() => {
    handleRef.current?.reseedTerrain();
  }, []);

  // Full live config snapshot (all fields, incl. swirl + terrain) → so "Save as default" and presets
  // capture EVERYTHING, not just the Swarm panel's own sliders.
  const getFullConfig = useCallback(() => handleRef.current?.getConfig() ?? null, []);

  // When a preset is loaded, ControlPanel pushes the full config to the engine; this nonce lets the
  // Terrain and Swirl panels re-sync their displayed sliders to the loaded values.
  const [sync, setSync] = useState<{ nonce: number; cfg: Partial<BoidsConfig> } | null>(null);
  const onConfigApplied = useCallback(
    (cfg: Partial<BoidsConfig>) => setSync((s) => ({ nonce: (s?.nonce ?? 0) + 1, cfg })),
    [],
  );
  // Apply a whole config (preset load / reset): push to the sim AND re-sync every panel's sliders.
  const applyConfig = useCallback(
    (cfg: Partial<BoidsConfig>) => {
      onChange(cfg);
      onConfigApplied(cfg);
    },
    [onChange, onConfigApplied],
  );

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
          {/* Populations stays pinned on its own, top-right — it's a live readout, not a setting. */}
          <PopulationMonitor counts={counts} numSpecies={numSpecies} colors={colors} />
          {/* ONE settings card. A master line collapses the whole thing to a single row; open, it
              reveals the Swarm / Terrain / Swirl sections (accordion — one at a time), each of which
              has its own sub-sections. The card is the single scroller (height-capped in CSS). */}
          <div className={`settings ${settingsOpen ? "" : "settings--closed"}`}>
            {/* Top line, always visible: the master collapse toggle + the always-on controls
                (guide, live FPS, restart). These stay reachable even when everything is collapsed. */}
            <div className="settings__head">
              <button
                className="settings__toggle"
                onClick={() => setSettingsOpen((o) => !o)}
                title={settingsOpen ? "Collapse controls" : "Expand controls"}
              >
                <span className="settings__arrow">{settingsOpen ? "▾" : "▸"}</span>
                Settings
              </button>
              <button
                className="panel__info"
                onClick={() => setHelp(true)}
                title="What is this? Open the guide."
                aria-label="Open guide"
              >
                ⓘ
              </button>
              <span className="panel__fps">{fps > 0 ? `${Math.round(fps)} FPS` : "…"}</span>
              <button
                className="panel__restart"
                onClick={onReseed}
                title="Restart ecosystem"
                aria-label="Restart ecosystem"
              >
                ↻
              </button>
            </div>
            {/* The body is ALWAYS mounted and only hidden by CSS when collapsed. Unmounting it
                (the obvious `{settingsOpen && …}`) threw away each panel's local slider state, so
                reopening the block showed DEFAULT_CONFIG again while the engine kept running with
                the values you had actually dialled in. Collapsing is a display state, not a data
                event — the panels must survive it. */}
            <div className="settings__body">
              <ControlPanel
                onChange={onChange}
                sync={sync}
                open={openPanel === "swarm"}
                onToggle={toggleSwarm}
              />
              <TerrainPanel
                onChange={onChange}
                onClearTerrain={onClearTerrain}
                onReseedTerrain={onReseedTerrain}
                sync={sync}
                open={openPanel === "terrain"}
                onToggle={toggleTerrain}
              />
              <SwirlPanel
                onChange={onChange}
                dir={swirlDir}
                sync={sync}
                open={openPanel === "swirl"}
                onToggle={toggleSwirl}
              />
              {/* Overarching controls for the WHOLE config, below all three sections. */}
              <SettingsFooter
                getFullConfig={getFullConfig}
                applyConfig={applyConfig}
                onReseed={onReseed}
              />
            </div>
          </div>
          {/* Rendered outside .settings: that card has backdrop-filter, which would trap a
              position:fixed modal inside its bounds. */}
          {help && <HelpModal onClose={() => setHelp(false)} />}
        </>
      )}
    </>
  );
}

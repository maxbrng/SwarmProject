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
import { IS_DEV } from "@/lib/viewMode";
import { useIsMobile } from "@/lib/useIsMobile";

// Phone-only chrome behaviour. The artwork owns the screen, so both bars dim themselves once nobody
// has touched them, and a swipe walks through three states: hidden → bar → open sheet.
const CHROME_IDLE_MS = 6000;
const SWIPE_PX = 40;

type PanelId = "swarm" | "terrain" | "swirl";
type TouchTool = BoidsConfig["terrainTool"]; // "off" (swirl) | "raise" | "lower"

// What a single finger does — for single-touch screens without the multi-finger gestures.
const TOUCH_TOOLS: { tool: TouchTool; label: string; icon: React.ReactNode }[] = [
  {
    tool: "off",
    label: "Touch draws a swirl",
    icon: (
      <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 8 a2 2 0 1 1 2 -2 a4 4 0 1 1 -4 4 a6 6 0 1 1 6 -6" />
      </svg>
    ),
  },
  {
    tool: "raise",
    label: "Touch raises a mountain",
    icon: (
      <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 13 L6 5 L9 9.5 L11 6.5 L14.5 13" />
      </svg>
    ),
  },
  {
    tool: "lower",
    label: "Touch digs a valley",
    icon: (
      <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 4 L6 12 L9 7.5 L11 10.5 L14.5 4" />
      </svg>
    ),
  },
];

export default function BoidsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<BoidsHandle | null>(null);
  const swirlFxRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const [numSpecies, setNumSpecies] = useState(DEFAULT_CONFIG.numSpecies);
  const [colors, setColors] = useState<RGB[]>(DEFAULT_CONFIG.speciesColors);
  const [swirlDir, setSwirlDir] = useState(DEFAULT_CONFIG.swirlDir >= 0 ? 1 : -1);

  // Which settings section is open (at most one). Everything starts collapsed so the art opens alone.
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const togglePanel = useCallback(
    (p: PanelId) => setOpenPanel((cur) => (cur === p ? null : p)),
    [],
  );
  // Stable handlers so the memo()'d panels don't re-render on every FPS/count update.
  const toggleSwarm = useCallback(() => togglePanel("swarm"), [togglePanel]);
  const toggleTerrain = useCallback(() => togglePanel("terrain"), [togglePanel]);
  const toggleSwirl = useCallback(() => togglePanel("swirl"), [togglePanel]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Phone-only chrome state. On desktop every flag below stays inert.
  const isMobile = useIsMobile();
  const [chromeHidden, setChromeHidden] = useState(false);
  const [chromeIdle, setChromeIdle] = useState(false);
  const [popExpanded, setPopExpanded] = useState(false);
  // Bumped on every touch of the chrome; restarting the effect below restarts the idle countdown.
  const [idleNonce, setIdleNonce] = useState(0);

  const wakeChrome = useCallback(() => {
    setChromeIdle(false);
    setIdleNonce((n) => n + 1);
  }, []);

  // Dim the chrome once it has been left alone. Touching the canvas deliberately does NOT count —
  // that is when the swarm should be least obstructed. An open sheet never dims: sitting and reading
  // the controls is using them.
  useEffect(() => {
    if (!isMobile || chromeHidden || settingsOpen) return;
    const t = window.setTimeout(() => setChromeIdle(true), CHROME_IDLE_MS);
    return () => window.clearTimeout(t);
  }, [isMobile, chromeHidden, settingsOpen, idleNonce]);

  // hidden → bar → open sheet, and back down again.
  const stepUp = useCallback(() => {
    if (chromeHidden) setChromeHidden(false);
    else setSettingsOpen(true);
  }, [chromeHidden]);
  const stepDown = useCallback(() => {
    if (settingsOpen) setSettingsOpen(false);
    else setChromeHidden(true);
  }, [settingsOpen]);

  // The grabber is the one handle that is always reachable, so it can never strand the user: a drag
  // moves one state, a plain tap toggles the sheet.
  const dragStartY = useRef<number | null>(null);
  const onGrabDown = useCallback(
    (e: React.PointerEvent) => {
      dragStartY.current = e.clientY;
      wakeChrome();
    },
    [wakeChrome],
  );
  const onGrabUp = useCallback(
    (e: React.PointerEvent) => {
      const start = dragStartY.current;
      dragStartY.current = null;
      if (start === null) return;
      const dy = e.clientY - start;
      if (dy > SWIPE_PX) stepDown();
      else if (dy < -SWIPE_PX) stepUp();
      else if (chromeHidden) setChromeHidden(false);
      else setSettingsOpen((o) => !o);
    },
    [chromeHidden, stepDown, stepUp],
  );

  const togglePop = useCallback(() => {
    wakeChrome();
    setPopExpanded((v) => !v);
  }, [wakeChrome]);

  const [help, setHelp] = useState(false);
  const [touchTool, setTouchTool] = useState<TouchTool>(DEFAULT_CONFIG.terrainTool);
  const [showTouchBar, setShowTouchBar] = useState(false);
  const setTouch = useCallback((tool: TouchTool) => {
    setTouchTool(tool);
    handleRef.current?.update({ terrainTool: tool });
  }, []);

  // Move the swirl glow imperatively every frame so it tracks the finger without a React re-render.
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
    if (partial.terrainTool) setTouchTool(partial.terrainTool);
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

  // Full live config (incl. swirl + terrain) so presets and "Save as default" capture everything.
  const getFullConfig = useCallback(() => handleRef.current?.getConfig() ?? null, []);

  // Bumped on preset load so every panel re-syncs its sliders to the loaded values.
  const [sync, setSync] = useState<{ nonce: number; cfg: Partial<BoidsConfig> } | null>(null);
  const onConfigApplied = useCallback(
    (cfg: Partial<BoidsConfig>) => setSync((s) => ({ nonce: (s?.nonce ?? 0) + 1, cfg })),
    [],
  );
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
      <div ref={swirlFxRef} className="swirl-fx" aria-hidden="true">
        <span className="swirl-fx__glow" />
      </div>
      {error ? (
        <div className="swarm-error">{error}</div>
      ) : (
        <>
          <PopulationMonitor
            counts={counts}
            numSpecies={numSpecies}
            colors={colors}
            className={
              isMobile
                ? [
                    popExpanded ? "" : "popmon--compact",
                    chromeHidden ? "popmon--hidden" : "",
                    chromeIdle ? "chrome--idle" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")
                : undefined
            }
            onToggle={isMobile ? togglePop : undefined}
          />
          <div
            className={[
              "settings",
              settingsOpen ? "" : "settings--closed",
              isMobile && chromeHidden ? "settings--hidden" : "",
              isMobile && chromeIdle ? "chrome--idle" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onPointerDown={isMobile ? wakeChrome : undefined}
          >
            {isMobile && (
              <div
                className="settings__grabber"
                onPointerDown={onGrabDown}
                onPointerUp={onGrabUp}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (chromeHidden) setChromeHidden(false);
                  else setSettingsOpen((o) => !o);
                }}
                role="button"
                tabIndex={0}
                aria-label="Drag to show or hide the controls"
              >
                <span className="settings__grabberBar" />
              </div>
            )}
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
                className={`panel__restart ${showTouchBar ? "panel__restart--on" : ""}`}
                onClick={() => setShowTouchBar((v) => !v)}
                title="Show or hide the touch controls"
                aria-label="Toggle touch controls"
                aria-pressed={showTouchBar}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="8" cy="8" r="5.5" />
                  <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <button
                className="panel__restart"
                onClick={onReseed}
                title="Restart ecosystem"
                aria-label="Restart ecosystem"
              >
                ↻
              </button>
            </div>
            {showTouchBar && (
              <div className="settings__touchbar">
                <span className="touchrow__label">Touch</span>
                <div className="touchtools" role="group" aria-label="Touch mode">
                  {TOUCH_TOOLS.map((t) => (
                    <button
                      key={t.tool}
                      className={`touchtool ${touchTool === t.tool ? "touchtool--active" : ""}`}
                      onClick={() => setTouch(t.tool)}
                      aria-label={t.label}
                      aria-pressed={touchTool === t.tool}
                    >
                      {t.icon}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="settings__body">
              <div className="settings__scroll">
                <ControlPanel
                  onChange={onChange}
                  sync={sync}
                  open={openPanel === "swarm"}
                  onToggle={toggleSwarm}
                />
                {IS_DEV && (
                  <>
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
                  </>
                )}
              </div>
              <div className="settings__foot">
                <SettingsFooter
                  getFullConfig={getFullConfig}
                  applyConfig={applyConfig}
                  onReseed={onReseed}
                  onReseedTerrain={onReseedTerrain}
                />
              </div>
            </div>
          </div>
          {help && <HelpModal onClose={() => setHelp(false)} />}
        </>
      )}
    </>
  );
}

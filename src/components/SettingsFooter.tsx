"use client";

import { memo, useEffect, useState } from "react";
import { BoidsConfig, DEFAULT_CONFIG } from "@/webgpu/boids/config";
import { BUILTIN_PRESETS, type Preset } from "@/webgpu/boids/presets";
import { IS_DEV } from "@/lib/viewMode";

interface Props {
  // Full live config snapshot (all sections), what presets and defaults save.
  getFullConfig: () => BoidsConfig | null;
  // Apply a config to the running sim and re-sync every panel's sliders (preset load / reset).
  applyConfig: (cfg: Partial<BoidsConfig>) => void;
  // Restart the ecosystem.
  onReseed: () => void;
  // Roll a new random terrain (a different landscape).
  onReseedTerrain: () => void;
}

// Presets ship baked into code (BUILTIN_PRESETS) so they're identical in every production build.
// In dev you can edit the in-memory list and "Publish presets to code" bakes it into presets.ts.
// These act on the whole config (swarm + terrain + swirl), so they sit below the settings block.
function SettingsFooter({ getFullConfig, applyConfig, onReseed, onReseedTerrain }: Props) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pubState, setPubState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetDesc, setPresetDesc] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [presetMsg, setPresetMsg] = useState("");
  // Collapsed preset picker: show only the current selection; expand to choose another.
  const [listOpen, setListOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(BUILTIN_PRESETS[0]?.name ?? null);

  function pickPreset(p: Preset) {
    applyConfig(p.config);
    setSelected(p.name);
    setListOpen(false);
  }

  // Seed the preset list from code once on mount. In dev, edits live in memory until published.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresets(BUILTIN_PRESETS);
  }, []);

  function currentConfig(): Partial<BoidsConfig> {
    return getFullConfig() ?? {};
  }

  async function saveAsDefault() {
    setSaveState("saving");
    try {
      const res = await fetch("/api/save-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentConfig()),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setSaveState(res.ok && data.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
    setTimeout(() => setSaveState("idle"), 2500);
  }

  const saveLabel = {
    idle: "Save as default",
    saving: "Saving …",
    saved: "✓ Saved to code",
    error: "✗ Error – is the dev server running?",
  }[saveState];

  function persistPresets(next: Preset[]) {
    // In-memory only; "Publish presets to code" is the persistence path (writes presets.ts).
    setPresets(next);
  }

  async function publishPresets() {
    setPubState("saving");
    try {
      const res = await fetch("/api/save-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presets }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setPubState(res.ok && data.ok ? "saved" : "error");
    } catch {
      setPubState("error");
    }
    setTimeout(() => setPubState("idle"), 2500);
  }

  const pubLabel = {
    idle: "⤴ Publish presets to code",
    saving: "Publishing …",
    saved: "✓ Published (commit presets.ts)",
    error: "✗ Error – is the dev server running?",
  }[pubState];

  // Transient confirmation line under the presets (auto-clears).
  function flashMsg(text: string) {
    setPresetMsg(text);
    window.setTimeout(() => setPresetMsg((m) => (m === text ? "" : m)), 2600);
  }

  function saveCurrentAsPreset() {
    const name = presetName.trim();
    if (!name) return;
    const desc = presetDesc.trim();
    const idx = presets.findIndex((p) => p.name === name);
    if (idx >= 0 && !window.confirm(`A preset “${name}” already exists — overwrite it?`)) return;
    const cfg = currentConfig();
    const entry: Preset = desc ? { name, description: desc, config: cfg } : { name, config: cfg };
    const next = idx >= 0 ? presets.map((p, i) => (i === idx ? entry : p)) : [...presets, entry];
    persistPresets(next);
    setPresetName("");
    setPresetDesc("");
    flashMsg(idx >= 0 ? `✓ “${name}” overwritten` : `✓ Saved preset “${name}”`);
  }

  function overwritePreset(name: string) {
    if (!window.confirm(`Overwrite preset “${name}” with the current settings?`)) return;
    persistPresets(
      presets.map((p) => (p.name === name ? { ...p, config: currentConfig() } : p)),
    );
    flashMsg(`✓ “${name}” updated with current settings`);
  }

  function startRename(name: string) {
    setRenaming(name);
    setRenameValue(name);
  }

  function commitRename(oldName: string) {
    const next = renameValue.trim();
    setRenaming(null);
    if (!next || next === oldName) return;
    if (presets.some((p) => p.name === next)) {
      flashMsg(`✗ A preset named “${next}” already exists`);
      return;
    }
    persistPresets(presets.map((p) => (p.name === oldName ? { ...p, name: next } : p)));
    flashMsg(`✓ Renamed to “${next}”`);
  }

  function deletePreset(name: string) {
    if (!window.confirm(`Delete preset “${name}”?`)) return;
    persistPresets(presets.filter((p) => p.name !== name));
    flashMsg(`✓ Deleted “${name}”`);
  }

  return (
    <div className="settings__footer">
      <div className="presets">
        <button
          className="presets__toggle"
          onClick={() => setListOpen((o) => !o)}
          title="Choose a preset"
        >
          <span className="presets__toggleArrow">{listOpen ? "▾" : "▸"}</span>
          <span className="presets__toggleLabel">Preset</span>
          <span className="presets__toggleName">{selected ?? "choose…"}</span>
        </button>
        {listOpen && (
          <>
        {IS_DEV && (
          <div className="presets__save">
            <input
              className="presets__input"
              type="text"
              placeholder="Preset name…"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveCurrentAsPreset();
              }}
            />
            <button
              className="presets__btn"
              onClick={saveCurrentAsPreset}
              disabled={!presetName.trim()}
              title="Save ALL current settings (Swarm + Terrain + Swirl) as a preset."
            >
              Save
            </button>
          </div>
        )}
        {IS_DEV && (
          <input
            className="presets__input presets__input--desc"
            type="text"
            placeholder="Description (shown to visitors)…"
            value={presetDesc}
            onChange={(e) => setPresetDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveCurrentAsPreset();
            }}
          />
        )}
        {presets.length > 0 ? (
          <div className="presets__list">
            {presets.map((p) =>
              IS_DEV && renaming === p.name ? (
                <div className="presets__row" key={p.name}>
                  <input
                    className="presets__renameInput"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p.name);
                      else if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                  <button
                    className="presets__act presets__act--ok"
                    onClick={() => commitRename(p.name)}
                    title="Confirm rename"
                    aria-label="Confirm rename"
                  >
                    ✓
                  </button>
                  <button
                    className="presets__act"
                    onClick={() => setRenaming(null)}
                    title="Cancel"
                    aria-label="Cancel rename"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  className={`presets__row ${p.variant ? "presets__row--variant" : ""}`}
                  key={p.name}
                >
                  <button
                    className={`presets__load ${selected === p.name ? "presets__load--active" : ""}`}
                    onClick={() => pickPreset(p)}
                    title={p.description ?? "Load this preset"}
                  >
                    <span className="presets__name">{p.name}</span>
                    {p.description && (
                      <span className="presets__desc">{p.description}</span>
                    )}
                  </button>
                  {IS_DEV && (
                    <>
                      <button
                        className="presets__act"
                        onClick={() => startRename(p.name)}
                        title="Rename preset"
                        aria-label={`Rename ${p.name}`}
                      >
                        ✎
                      </button>
                      <button
                        className="presets__act"
                        onClick={() => overwritePreset(p.name)}
                        title="Overwrite this preset with the current settings"
                        aria-label={`Overwrite ${p.name}`}
                      >
                        ⤓
                      </button>
                      <button
                        className="presets__del"
                        onClick={() => deletePreset(p.name)}
                        aria-label={`Delete ${p.name}`}
                        title="Delete preset"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
          </div>
        ) : (
          !IS_DEV && <div className="presets__msg">No presets shipped yet.</div>
        )}
        {IS_DEV && (
          <button
            className={`presets__publish presets__publish--${pubState}`}
            onClick={publishPresets}
            disabled={pubState === "saving"}
            title="Bake the current presets into presets.ts so they ship with the app on every device. Dev only — commit presets.ts afterward."
          >
            {pubLabel}
          </button>
        )}
        {presetMsg && <div className="presets__msg">{presetMsg}</div>}
          </>
        )}
      </div>

      <div className="footer__actions">
        {IS_DEV && (
          <button
            className={`panel__save panel__save--${saveState}`}
            onClick={saveAsDefault}
            disabled={saveState === "saving"}
            title="Writes ALL current values (Swarm + Terrain + Swirl) into config.ts (DEFAULT_CONFIG) — survives reload. Dev only."
          >
            {saveLabel}
          </button>
        )}
        <button className="panel__reset" onClick={onReseed} title="Restart the ecosystem with the current settings.">
          ↻ Restart
        </button>
        <button
          className="panel__reset"
          onClick={onReseedTerrain}
          title="Generate a fresh random landscape."
        >
          New terrain
        </button>
        {IS_DEV && (
          <button
            className="panel__reset"
            onClick={() => applyConfig(DEFAULT_CONFIG)}
            title="Reset every setting (Swarm + Terrain + Swirl) to the built-in defaults."
          >
            Reset all values
          </button>
        )}
      </div>
    </div>
  );
}

// memo: the parent re-renders several times a second (FPS + population readouts). This panel keeps
// its own state while staying mounted, so without memo every tick would reconcile the whole tree.
export default memo(SettingsFooter);

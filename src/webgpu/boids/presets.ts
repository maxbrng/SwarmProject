// Built-in presets shipped WITH the app (baked into code → available in every production build,
// on every device). This is the single source of truth for shipped presets.
//
// In development you edit presets in the ControlPanel and click "Publish presets to code", which
// overwrites this file via /api/save-presets (dev-only). Commit it → the presets ship globally.
// In production the panel shows these read-only (no create/rename/overwrite/delete).
//
// AUTO-GENERATED region: the BUILTIN_PRESETS array below is rewritten by the publish route.
import { BoidsConfig } from "./config";

/** A named, saved configuration (a subset of BoidsConfig). */
export interface Preset {
  name: string;
  config: Partial<BoidsConfig>;
}

export const BUILTIN_PRESETS: Preset[] = [];

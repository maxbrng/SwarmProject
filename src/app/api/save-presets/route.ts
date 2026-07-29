// Dev-only: writes the current preset list into presets.ts (BUILTIN_PRESETS).
// → "Publish presets to code" in the panel bakes the browser's presets into code, so they ship
//   with the app and are available in every production build, on every device (read-only there).
// In the production/static export there are no API routes; the presets are already baked in.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PRESETS_PATH = path.join(process.cwd(), "src", "webgpu", "boids", "presets.ts");

// Numeric fields a preset may carry (mirrors the panel's sliders / save-defaults KEYS).
const NUM_KEYS = [
  "count",
  "perception",
  "separationDist",
  "maxSpeed",
  "maxForce",
  "alignWeight",
  "cohesionWeight",
  "separationWeight",
  "boidScale",
  "trailFade",
  "colorIntensity",
  "declump",
  "numSpecies",
  "chaseWeight",
  "fleeWeight",
  "killRadius",
  "birthRate",
  "adaptiveStrength",
  "starveRate",
  // swirl
  "swirlStrength",
  "swirlRadius",
  "swirlFalloff",
  "swirlInward",
  "swirlDir",
  "swirlRampUp",
  "swirlRampDown",
  // terrain
  "terrainForce",
  "terrainScale",
  "terrainCoverage",
  "terrainWarp",
  "terrainDrift",
  "terrainLineCount",
  "terrainLineWidth",
  "terrainLineBright",
  "terrainTint",
  "terrainShade",
  "terrainSnowAmount",
  "terrainBrushSize",
  "terrainBrushStrength",
  "terrainBrushDetail",
  "terrainHealRate",
  // refuge / extinction safety net
  "rescueThreshold",
  "rescueRate",
] as const;
const INT_KEYS = new Set(["count", "numSpecies", "terrainLineCount"]);
const TERRAIN_COLOR_KEYS = ["terrainValley", "terrainMid", "terrainPeak", "terrainSnow"] as const;

// Keep only known, well-typed fields — never write arbitrary posted JSON into source.
function sanitizeConfig(input: unknown): Record<string, unknown> {
  const c = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of NUM_KEYS) {
    const v = c[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = INT_KEYS.has(k) ? Math.max(1, Math.round(v)) : parseFloat(v.toFixed(4));
    }
  }
  if (c.deathMode === "convert" || c.deathMode === "energy") out.deathMode = c.deathMode;
  if (c.seedMode === "random" || c.seedMode === "clustered") out.seedMode = c.seedMode;
  if (["off", "constant", "adaptive", "homeland"].includes(c.birthMode as string)) {
    out.birthMode = c.birthMode;
  }
  if (["cyclic", "random", "chaos"].includes(c.dominanceMode as string)) {
    out.dominanceMode = c.dominanceMode;
  }
  if (Array.isArray(c.speciesColors)) {
    const ok = c.speciesColors.every(
      (col) =>
        Array.isArray(col) &&
        col.length === 3 &&
        col.every((n) => typeof n === "number" && Number.isFinite(n)),
    );
    if (ok) {
      out.speciesColors = (c.speciesColors as number[][]).map((col) =>
        col.map((n) => parseFloat(Math.max(0, Math.min(1, n)).toFixed(4))),
      );
    }
  }
  if (typeof c.terrainEnabled === "boolean") out.terrainEnabled = c.terrainEnabled;
  if (typeof c.rescueEnabled === "boolean") out.rescueEnabled = c.rescueEnabled;
  if (typeof c.rescueRestart === "boolean") out.rescueRestart = c.rescueRestart;
  if (["off", "raise", "lower"].includes(c.terrainTool as string)) out.terrainTool = c.terrainTool;
  for (const k of TERRAIN_COLOR_KEYS) {
    const col = c[k];
    if (
      Array.isArray(col) &&
      col.length === 3 &&
      col.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      out[k] = (col as number[]).map((n) => parseFloat(Math.max(0, Math.min(1, n)).toFixed(4)));
    }
  }
  return out;
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Disabled in production build." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.presets)) {
    return NextResponse.json({ ok: false, error: "Missing 'presets' array." }, { status: 400 });
  }

  // validate + sanitize each preset; dedupe by name (last wins), keep insertion order
  type CleanPreset = {
    name: string;
    description?: string;
    variant?: boolean;
    config: Record<string, unknown>;
  };
  const byName = new Map<string, CleanPreset>();
  for (const p of body.presets as unknown[]) {
    const rec = (p ?? {}) as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const out: CleanPreset = { name, config: sanitizeConfig(rec.config) };
    if (typeof rec.description === "string" && rec.description.trim()) {
      out.description = rec.description.trim();
    }
    if (rec.variant === true) out.variant = true;
    byName.set(name, out);
  }
  const cleaned = Array.from(byName.values());

  const file =
    `// Presets shipped with the app, baked into code so every build on every device has them.\n` +
    `// In dev you edit them in the panel and click "Publish presets to code", which overwrites this\n` +
    `// file via /api/save-presets. In production the panel shows them read-only.\n` +
    `import { BoidsConfig } from "./config";\n\n` +
    `export interface Preset {\n` +
    `  name: string;\n` +
    `  // One-line explanation shown under the name.\n` +
    `  description?: string;\n` +
    `  // Marks a variation of the preset above it, shown indented.\n` +
    `  variant?: boolean;\n` +
    `  config: Partial<BoidsConfig>;\n` +
    `}\n\n` +
    `export const BUILTIN_PRESETS: Preset[] = ${JSON.stringify(cleaned, null, 2)};\n`;

  try {
    await fs.writeFile(PRESETS_PATH, file, "utf8");
  } catch {
    return NextResponse.json({ ok: false, error: "Write failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: cleaned.length });
}

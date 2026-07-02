// Dev-only: writes the current boids values back into config.ts as the new DEFAULT_CONFIG.
// → "Save as default" in the panel anchors the values in code (survives reload, goes into Git).
// In the production/static export there are no API routes; the defaults are already baked in there.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "src", "webgpu", "boids", "config.ts");

// Exactly the fields the panel controls (background is left untouched).
const KEYS = [
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
  "numSpecies",
  "chaseWeight",
  "fleeWeight",
  "killRadius",
  "birthRate",
  "adaptiveStrength",
  "starveRate",
] as const;

const INT_KEYS = new Set(["count", "numSpecies"]);

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Disabled in production build." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  // validate + round to clean precision
  const vals: Record<string, number> = {};
  for (const k of KEYS) {
    const v = body[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return NextResponse.json({ ok: false, error: `Missing/invalid value: ${k}` }, { status: 400 });
    }
    vals[k] = INT_KEYS.has(k) ? Math.max(1, Math.round(v)) : parseFloat(v.toFixed(4));
  }

  // string fields ("convert"|"energy", "random"|"clustered", …) — optional, handled separately
  const deathMode =
    body.deathMode === "energy" || body.deathMode === "convert" ? body.deathMode : null;
  const seedMode =
    body.seedMode === "random" || body.seedMode === "clustered" ? body.seedMode : null;
  const birthModes = ["off", "constant", "adaptive", "homeland"];
  const birthMode = birthModes.includes(body.birthMode as string) ? (body.birthMode as string) : null;
  const dominanceMode = ["cyclic", "random", "chaos"].includes(body.dominanceMode as string)
    ? (body.dominanceMode as string)
    : null;

  // per-species colors: array of [r,g,b] triples (0..1) — optional
  let speciesColors: number[][] | null = null;
  if (Array.isArray(body.speciesColors)) {
    const ok = body.speciesColors.every(
      (c) =>
        Array.isArray(c) &&
        c.length === 3 &&
        c.every((n) => typeof n === "number" && Number.isFinite(n)),
    );
    if (ok) {
      speciesColors = (body.speciesColors as number[][]).map((c) =>
        c.map((n) => parseFloat(Math.max(0, Math.min(1, n)).toFixed(4))),
      );
    }
  }

  let src: string;
  try {
    src = await fs.readFile(CONFIG_PATH, "utf8");
  } catch {
    return NextResponse.json({ ok: false, error: "Cannot read config.ts." }, { status: 500 });
  }

  // isolate only the DEFAULT_CONFIG block (don't touch the interface/MAX_COUNT)
  const start = src.indexOf("export const DEFAULT_CONFIG");
  const braceStart = start >= 0 ? src.indexOf("{", start) : -1;
  const braceEnd = braceStart >= 0 ? src.indexOf("};", braceStart) : -1;
  if (braceStart < 0 || braceEnd < 0) {
    return NextResponse.json(
      { ok: false, error: "DEFAULT_CONFIG block not found." },
      { status: 500 },
    );
  }

  // within the block, replace only the numeric values (comments/structure stay)
  let block = src.slice(braceStart, braceEnd);
  for (const k of KEYS) {
    const re = new RegExp(`(\\n\\s*${k}:\\s*)(-?[\\d.]+)`);
    if (!re.test(block)) {
      return NextResponse.json({ ok: false, error: `Field not found: ${k}` }, { status: 500 });
    }
    block = block.replace(re, `$1${vals[k]}`);
  }

  // replace string fields, if provided
  if (deathMode) {
    const reMode = /(\n\s*deathMode:\s*)"(?:convert|energy)"/;
    if (reMode.test(block)) block = block.replace(reMode, `$1"${deathMode}"`);
  }
  if (seedMode) {
    const reSeed = /(\n\s*seedMode:\s*)"(?:random|clustered)"/;
    if (reSeed.test(block)) block = block.replace(reSeed, `$1"${seedMode}"`);
  }
  if (birthMode) {
    const reBirth = /(\n\s*birthMode:\s*)"(?:off|constant|adaptive|homeland)"/;
    if (reBirth.test(block)) block = block.replace(reBirth, `$1"${birthMode}"`);
  }
  if (dominanceMode) {
    const reDom = /(\n\s*dominanceMode:\s*)"(?:cyclic|random|chaos)"/;
    if (reDom.test(block)) block = block.replace(reDom, `$1"${dominanceMode}"`);
  }
  if (speciesColors) {
    // replace the whole speciesColors value (literal or the DEFAULT_COLORS expression) with a literal
    const literal = `[${speciesColors.map((c) => `[${c.join(", ")}]`).join(", ")}]`;
    const reCol = /(\n\s*speciesColors:\s*)[^\n]*/;
    if (reCol.test(block)) block = block.replace(reCol, `$1${literal},`);
  }

  const newSrc = src.slice(0, braceStart) + block + src.slice(braceEnd);
  try {
    await fs.writeFile(CONFIG_PATH, newSrc, "utf8");
  } catch {
    return NextResponse.json({ ok: false, error: "Write failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, values: vals });
}

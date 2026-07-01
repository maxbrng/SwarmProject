// Dev-only: schreibt die aktuellen Boids-Werte als neue DEFAULT_CONFIG in config.ts zurück.
// → "Als Standard speichern" im Panel verankert die Werte fest im Code (überlebt Reload, geht in Git).
// Im Production-/Static-Export gibt es keine API-Routes; dort sind die Defaults ohnehin schon eingebrannt.

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "src", "webgpu", "boids", "config.ts");

// Genau die Felder, die das Panel steuert (background bleibt unangetastet).
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
] as const;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Im Production-Build deaktiviert." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ungültiges JSON." }, { status: 400 });
  }

  // Validieren + auf saubere Präzision runden
  const vals: Record<string, number> = {};
  for (const k of KEYS) {
    const v = body[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return NextResponse.json({ ok: false, error: `Wert fehlt/ungültig: ${k}` }, { status: 400 });
    }
    vals[k] = k === "count" ? Math.max(1, Math.round(v)) : parseFloat(v.toFixed(4));
  }

  let src: string;
  try {
    src = await fs.readFile(CONFIG_PATH, "utf8");
  } catch {
    return NextResponse.json({ ok: false, error: "config.ts nicht lesbar." }, { status: 500 });
  }

  // Nur den DEFAULT_CONFIG-Block isolieren (Interface/MAX_COUNT nicht anfassen)
  const start = src.indexOf("export const DEFAULT_CONFIG");
  const braceStart = start >= 0 ? src.indexOf("{", start) : -1;
  const braceEnd = braceStart >= 0 ? src.indexOf("};", braceStart) : -1;
  if (braceStart < 0 || braceEnd < 0) {
    return NextResponse.json(
      { ok: false, error: "DEFAULT_CONFIG-Block nicht gefunden." },
      { status: 500 },
    );
  }

  // Innerhalb des Blocks nur die Zahlenwerte ersetzen (Kommentare/Struktur bleiben)
  let block = src.slice(braceStart, braceEnd);
  for (const k of KEYS) {
    const re = new RegExp(`(\\n\\s*${k}:\\s*)(-?[\\d.]+)`);
    if (!re.test(block)) {
      return NextResponse.json({ ok: false, error: `Feld nicht gefunden: ${k}` }, { status: 500 });
    }
    block = block.replace(re, `$1${vals[k]}`);
  }

  const newSrc = src.slice(0, braceStart) + block + src.slice(braceEnd);
  try {
    await fs.writeFile(CONFIG_PATH, newSrc, "utf8");
  } catch {
    return NextResponse.json({ ok: false, error: "Schreiben fehlgeschlagen." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, values: vals });
}

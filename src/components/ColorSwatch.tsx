"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── color math (hex ↔ rgb 0..1 ↔ hsv 0..1) ────────────────────────────────────
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

interface Props {
  /** current color as #rrggbb */
  value: string;
  /** called with a new #rrggbb while editing */
  onChange: (hex: string) => void;
  /** short label under the swatch (e.g. "S1") */
  label: string;
  title?: string;
}

const POP_W = 188;
const POP_H = 208;

/** A round color swatch that opens a small modern HSV picker popover. */
export default function ColorSwatch({ value, onChange, label, title }: Props) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const [r, g, b] = hexToRgb(value);
    return rgbToHsv(r, g, b);
  });
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [hexText, setHexText] = useState(value);

  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const dragSV = useRef(false);
  const dragHue = useRef(false);

  const [h, s, v] = hsv;

  function emit(nh: number, ns: number, nv: number) {
    setHsv([nh, ns, nv]);
    const [r, g, b] = hsvToRgb(nh, ns, nv);
    const hex = rgbToHex(r, g, b);
    setHexText(hex);
    onChange(hex);
  }

  function openPop() {
    const [r, g, b] = hexToRgb(value);
    setHsv(rgbToHsv(r, g, b));
    setHexText(value);
    setOpen(true);
  }

  // position the fixed popover near the swatch, clamped to the viewport
  useLayoutEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    let left = rect.left + rect.width / 2 - POP_W / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - POP_W - 8));
    let top = rect.bottom + 8;
    if (top + POP_H > window.innerHeight - 8) top = rect.top - POP_H - 8;
    setPos({ left, top });
  }, [open]);

  // close on Escape (outside clicks are handled by the backdrop below)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function svAt(clientX: number, clientY: number, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    emit(h, clamp01((clientX - r.left) / r.width), clamp01(1 - (clientY - r.top) / r.height));
  }
  function hueAt(clientX: number, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    emit(clamp01((clientX - r.left) / r.width), s, v);
  }

  const hueColor = `hsl(${h * 360}, 100%, 50%)`;

  return (
    <label className="swatch" title={title}>
      <button
        ref={btnRef}
        type="button"
        className="swatch__btn"
        style={{ background: value }}
        onClick={() => (open ? setOpen(false) : openPop())}
        aria-label={title ?? label}
      />
      <span className="swatch__label">{label}</span>

      {open &&
        createPortal(
          <>
            <div className="cpick__backdrop" onPointerDown={() => setOpen(false)} />
            <div
              ref={popRef}
              className="cpick"
              style={{ left: pos.left, top: pos.top, width: POP_W }}
              onClick={(e) => e.stopPropagation()}
            >
          <div
            className="cpick__sv"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor}`,
            }}
            onPointerDown={(e) => {
              dragSV.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              svAt(e.clientX, e.clientY, e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (dragSV.current) svAt(e.clientX, e.clientY, e.currentTarget);
            }}
            onPointerUp={(e) => {
              dragSV.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          >
            <span
              className="cpick__svThumb"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }}
            />
          </div>

          <div
            className="cpick__hue"
            onPointerDown={(e) => {
              dragHue.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              hueAt(e.clientX, e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (dragHue.current) hueAt(e.clientX, e.currentTarget);
            }}
            onPointerUp={(e) => {
              dragHue.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          >
            <span className="cpick__hueThumb" style={{ left: `${h * 100}%` }} />
          </div>

          <div className="cpick__foot">
            <span className="cpick__preview" style={{ background: value }} />
            <input
              className="cpick__hex"
              type="text"
              spellCheck={false}
              value={hexText}
              onChange={(e) => {
                const t = e.target.value;
                setHexText(t);
                if (/^#?[0-9a-fA-F]{6}$/.test(t)) {
                  const hex = t.startsWith("#") ? t : `#${t}`;
                  const [r, g, b] = hexToRgb(hex);
                  setHsv(rgbToHsv(r, g, b));
                  onChange(hex.toLowerCase());
                }
              }}
            />
          </div>
            </div>
          </>,
          document.body,
        )}
    </label>
  );
}

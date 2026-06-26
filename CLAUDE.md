# CLAUDE.md — Art+Code Projekt

Kontext-Datei für Claude Code. Diese Datei fasst das ganze Projekt zusammen, damit ein Coding-Agent ohne Vorwissen sofort produktiv ist. Die ausführlichen Quellen liegen in `00`–`03` (siehe Datei-Map unten).

---

## Was das ist

Uni-Vorlesung **„Art+Code"**. Frank baut ein eigenes, **interaktives Kunstwerk**, das auf einem **Touchscreen (55" oder 32")** in einer Ausstellung läuft. Im Kern: ein **autonomes, naturbasiertes komplexes System** (Emergenz aus einfachen lokalen Regeln), in das man per **Geste (u.a. Swirl)** eingreifen kann.

### Drei Leitprinzipien (in dieser Reihenfolge)
1. **Story zuerst.** Eine gute, offen interpretierbare Botschaft ist das Wichtigste. Das System ist Mittel, nicht Zweck.
2. **Autonom fesselnd.** Das Werk muss schon *ohne* Interaktion ein endloses, fesselndes Schauspiel sein. Interaktion ist die Kür, nicht die Grundlage.
3. **Interaktion ist additiv.** Berührung verändert das laufende System nur **lokal und temporär**; danach **heilt** es sich selbst. → Story: *Eingriff & Selbstheilung / Ordnung ↔ Chaos.*

---

## Tech-Stack (final entschieden, 26.06.2026)

Endversion ist performance-kritisch (Swarm + Terrain + Räuber-Beute = tausende bis 100k+ Agenten plus Felder), muss ruckelfrei mit Multi-Touch laufen → **alles auf die GPU**.

- **Framework: Next.js + TypeScript.** Franks Wahl (vertraut, Vercel-Deploy, optionale Info-/Statement-Seite). Performance identisch zu Vite, weil die Sim 100 % clientseitig läuft — Next ist nur die Hülle.
- **Sim + Rendering: WebGPU** (Compute-Shader). Auf dem Ausstellungs-Screen ist ein aktueller Chrome garantiert. WebGL2 nur als optionaler Fallback.
- **Library: three.js (WebGPURenderer)** — oder raw WebGPU / `regl`, falls volle Kontrolle gewünscht. Partikel-Positionen leben in GPU-Buffers/Texturen, fortgeschrieben per Compute-Shader (Ping-Pong).
- **Multi-Touch: Pointer Events API** (`pointerdown/move/up` + `pointerId`) → jeder Finger einzeln, mehrere Swirls gleichzeitig.
- **Sound: Tone.js** (Init erst nach erster Nutzer-Geste wegen Browser-Autoplay-Policy).
- **Versionierung: Git/GitHub** von Anfang an. Das Repo ist zugleich der portable Kontext — diese Doku (`00`–`03`, `CLAUDE.md`) mit committen.

### ⚠️ Next.js + WebGPU — Stolpersteine
- **Canvas-Komponente client-only laden:** `next/dynamic` mit `{ ssr: false }`. Sonst versucht der Server `navigator`/WebGPU zu rendern → Crash. WebGPU-Init immer in `useEffect`, niemals beim Modul-Import.
- **Offline-Build für die Ausstellung:** `output: 'export'` in `next.config` → reiner statischer Export, läuft ohne Server vom USB-Stick. Nicht auf WLAN am Ausstellungstag verlassen.
- **Default-Gesten abschalten:** CSS `touch-action: none` auf dem Canvas + Fullscreen/Kiosk-Mode, sonst zoomt/scrollt der Browser gegen dich.

### ⚠️ Hardware früh testen
Der **Touch-Treiber des konkreten Panels** meldet evtl. nur 1–2 statt 10 Punkte. Multi-Touch früh am echten Gerät prüfen, nicht erst kurz vor Abgabe. Zielauflösung des Screens vorher erfragen.

---

## Das Leitkonzept — geschichtetes Ökosystem (3 Schichten)

Nicht *ein* System, sondern drei voneinander abhängige Schichten (erfüllt die „alle Elemente hängen voneinander ab"-Anforderung):

1. **Hintergrund — lebendiges Terrain.** Berge/Täler, die sich langsam von allein bewegen (Curl-Noise, Reaktions-Diffusions-Höhenkarte oder echte Winddaten). Nicht nur Deko: **beeinflusst den Schwarm** (sammelt sich in Tälern, folgt Strömungen).
2. **Schwarm-Ökosystem.** Mehrere Arten (Beute + Räuber) mit **Räuber-Beute-Dynamik + Population**: jagen, fressen, vermehren, verhungern, nachgeboren werden → oszillierende Populationen (**Lotka-Volterra**), ein nie endendes Auf und Ab.
3. **Eingriff — Swirl + Gesten.** Der Vortex (langes Drücken) **verformt das Terrain** (domain-warp) **und** reißt den Schwarm mit. Beide Schichten heilen danach.

**Sound:** Klangprofil pro Art; Aktionen triggern Klänge (Fressen = tiefer Impuls, Geburt = heller Ton); Population steuert die Musik (Gleichgewicht *hörbar*). Tone.js.

**Echte Daten (optional, starke Story):** Wind/Wetter (NOAA-GFS via earth.nullschool) treibt das Terrain; reale Biodiversitäts-/Klimadaten setzen Populationsgrenzen → Kommentar zu Klima/Artensterben.

**Schichtweise baubar — jede Stufe ist für sich vorzeigbar:**
1. Terrain + ein Schwarm + Swirl
2. zweite Art + Räuber-Beute
3. Population/Geburt/Tod
4. Sound
5. echte Daten

---

## Basissysteme (Bauteile fürs Terrain + Schwarm)

| System | Autonomie | Swirl-Eignung | Story |
|---|---|---|---|
| A Physarum (Schleimpilz-Netz) | sehr stark | exzellent | Netzwerke, Leben findet Wege |
| B Reaktions-Diffusion | sehr stark | exzellent | Morphogenese, Individualität |
| C Boids (Schwarm) | mittel | gut | Individuum vs. Kollektiv |
| D Wellen/Fluid | schwach* | gut | Schmetterlingseffekt |
| E Flussfeld/Turbulenz | sehr stark | sehr gut | Ordnung im Chaos |

\*braucht automatischen Antrieb. **Empfehlung:** B, E oder A für „fesselt allein **und** Swirl wirkt großartig". Terrain aus B/E, Schwarm aus C.

---

## Gesten-Vokabular (2–3 wählen)

Empfohlene Minimal-Kombi: **Tippen = Explosion · Halten = Swirl baut sich auf · Ziehen = Swirl durchziehen.**

- Kurzes Tippen → Impuls/Explosion (Schreckwelle oder Saat).
- Langes Drücken → Swirl baut sich auf (je länger, desto stärker).
- Ziehen/Wischen → Swirl durchziehen (Schliere, die langsam verheilt).
- Zwei Finger spreizen → Wirbel skalieren. Gegenläufig → Doppelwirbel/Scherung. Mehrere Finger → mehrere Störzentren.

Wichtig: Der Swirl ist nur ein **„Pinsel"**, der das vorhandene Bild lokal verdreht — er erzeugt nichts Eigenes und läuft **nicht autonom** (das war früher das „Vertex"-Missverständnis).

---

## Aktueller Stand & nächster Schritt

- ✓ Recherche + Inspirationsgalerie, Konzept, Interaktionsmodell, Technik-Doku, **Stack-Entscheidung**.
- ◻ **Code-Prototyp: offen.** Geplanter erster Schritt: ein **cooler GPU-Swarm-Prototyp** (Stufe 1) als erstes sichtbares Ergebnis — autonome Swarm-Dynamik, die schon allein gut aussieht. Danach Population/Räuber-Beute, dann Terrain + Swirl-Gesten.

Beim Bauen die Schicht-Reihenfolge oben einhalten: erst die autonome Sim, die ohne Interaktion fesselt, dann die Gesten obendrauf.

---

## Datei-Map

- `00_README.md` — Übersicht.
- `01_Wissenssammlung_Komplexe_Systeme.md` — Wissensbasis + große recherchierte **Inspirationsgalerie** (Künstler, Werke, Links; Abschnitt 12).
- `02_Konzeptideen.md` — **zentrale Konzept-Datei**: Leitprinzipien, Leitkonzept (Ökosystem), Basissysteme A–E, Interaktions-Ebene, Empfehlung.
- `03_Technik_Setup_und_Anforderungen.md` — Setup, Struktur, Git, Shader, Sound, Deployment + Stack-Entscheidung (★-Sektion) + Anforderungsliste fürs Miro-Board.

## Sprache & Stil
Frank kommuniziert auf **Deutsch**. Knapp und direkt, wenig Floskeln. Story und „fesselt-von-allein" sind die wichtigsten Qualitätskriterien — bei Design-Entscheidungen immer daran messen.

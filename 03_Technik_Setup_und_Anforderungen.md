# Technik-Setup & technische Anforderungen

> Zwei Teile: (1) **Wie** man von p5-Web-Editor zu einem "richtigen", größeren Projekt kommt. (2) Die **technischen Anforderungen**, die du laut Aufgabe ins Miro-Board schreiben sollst.

---

## ★ Stack-Entscheidung (final, 26.06.2026)

Entschieden für die **anspruchsvolle, ruckelfreie Endversion** mit Multi-Touch. Begründung: Swarm + Terrain + Räuber-Beute = tausende bis 100k+ Agenten plus Felder → muss auf die GPU, CPU-Rendering (klassisches p5-2D) reicht nicht.

**Stack:**
- **Rendering/Sim auf der GPU per WebGPU** (aktueller Chrome ist auf dem Ausstellungs-Screen garantiert → Compute-Shader nutzbar). Compute-Shader sind das ideale Werkzeug für Partikel-Swarm, Reaktions-Diffusion und Flussfelder. WebGL2 nur als optionaler Fallback.
- **three.js (WebGPURenderer)** als Library — oder schlank raw WebGPU / `regl`, falls volle Kontrolle gewünscht. Partikel-Positionen leben in Buffers/Texturen, fortgeschrieben per Compute-Shader (Ping-Pong).
- **Next.js + TypeScript** als Framework (Franks Wahl — vertraut, Vercel-Deploy, optionale Info-/Statement-Seite dazu). Performance identisch zu Vite: die WebGPU-Sim läuft eh 100 % clientseitig, Next ist nur die Hülle. **Wichtig:** Canvas-Komponente client-only laden — `next/dynamic` mit `{ ssr: false }` (sonst rendert der Server `navigator`/WebGPU → Crash). Für den Offline-Build `output: 'export'` in `next.config` → statischer Export, läuft ohne Server vom Stick.
- **Multi-Touch über die Pointer Events API** (`pointerdown/move/up` + `pointerId`) → jeder Finger einzeln, mehrere Swirls gleichzeitig. CSS `touch-action: none` + Fullscreen/Kiosk gegen Browser-Default-Gesten.
- **Sound: Tone.js** (Init nach erster Nutzer-Geste).
- **Git/GitHub von Anfang an** — das Repo ist zugleich der portable Kontext: Design-Docs (00–03) mit reinlegen, dann kann jeder Coding-Agent (Codex/Cursor/Claude Code) darauf zeigen und hat die volle Historie.

**Risiken / früh testen:**
- **Touch-Treiber des konkreten Panels** meldet evtl. nur 1–2 statt 10 Punkte → am echten Gerät früh prüfen.
- **Offline-Build bereithalten** (statischer Build vom Stick) — nicht auf WLAN am Ausstellungstag verlassen.

> Hinweis: Teil 1 unten beschreibt noch den p5.js-Weg. Der bleibt gültig zum **Prototypen/Skizzieren** einzelner Ideen, ist aber nicht der Stack der Endversion.

---

## Teil 1 — Vom Web-Editor zum echten Projekt

Der p5-Web-Editor ist super zum Skizzieren, aber für ein größeres Werk (mehrere Dateien, Shader, Sound, Versionierung, Touchscreen-Deployment) arbeitest du besser lokal. Der Sprung ist kleiner als du denkst.

### Lokales Setup (Minimalweg)

1. **Editor:** VS Code (kostenlos). Erweiterungen: "Live Server" (startet die Seite lokal mit Auto-Reload), "p5.js Snippets", optional "Shader languages support" für `.glsl`.
2. **Projektordner:** `index.html`, `sketch.js`, `style.css`, Ordner `/shaders`, `/assets`. p5.js entweder per CDN-`<script>` einbinden oder als Datei ablegen.
3. **Starten:** in VS Code Rechtsklick auf `index.html` → "Open with Live Server". Fertig. Kein Build nötig.

Minimal-`index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
  <script src="https://cdn.jsdelivr.net/npm/p5@1.11.0/lib/p5.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.11.0/lib/addons/p5.sound.min.js"></script>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <script src="sketch.js"></script>
</body>
</html>
```

### Komfort-Setup (empfohlen, wenn es wächst)

- **Vite** als Dev-Server/Bundler: `npm create vite@latest`, dann `npm i p5`. Gibt dir blitzschnellen Hot-Reload, ES-Module (`import p5 from 'p5'`) und einen sauberen `npm run build` fürs Deployment. Lohnt sich, sobald du mehrere JS-Dateien oder npm-Pakete (Tone.js etc.) nutzt.
- **Instance Mode** statt globalem p5: kapselt deinen Sketch in eine Funktion `(p) => { p.setup = ...; p.draw = ... }`. Verhindert Namenskonflikte und ist Pflicht, wenn mehrere Sketches/Module zusammenspielen.

### Code strukturieren (wichtig fürs Wachsen)

Zerlege in Dateien/Klassen statt einer 800-Zeilen-`sketch.js`:
- `Agent.js` / `Particle.js` — eine Klasse pro Element (Position, Velocity, `update()`, `display()`).
- `System.js` — verwaltet das Array aller Elemente, die Nachbarschafts-/Feldlogik.
- `sketch.js` — nur `setup()`, `draw()`, Input-Handling.
- `sound.js`, `ui.js` getrennt.

### Versionierung — Git

Nutze **Git + GitHub** von Anfang an. Das ist der eigentliche Unterschied zwischen "Skizze im Editor" und "Projekt": du kannst Varianten in Branches erkunden (passt perfekt zur "Erforschen statt Planen"-Philosophie), jederzeit zurück, und hast ein Backup. `git init`, regelmäßig `commit`, auf GitHub `push`. Für die Abgabe ohnehin Gold wert.

### Performance — wenn es ruckelt

Reihenfolge der Hebel, von leicht zu schwer:
1. **Weniger zeichnen:** kein `background()` jeden Frame (Spuren entstehen durch leichtes Überzeichnen mit Alpha), `noStroke`, einfache Shapes.
2. **WebGL-Modus** (`createCanvas(w, h, WEBGL)`) statt 2D — nutzt die GPU fürs Rendern, Voraussetzung für 3D/Vertices.
3. **Shader** (`.vert` + `.frag`, geladen via `loadShader()`): die Simulation läuft komplett auf der GPU. Das ist der Weg zu Millionen Partikeln (Physarum) oder vollen Reaktions-Diffusions-Feldern in Echtzeit. Daten leben dann in Texturen (Ping-Pong zwischen zwei `createGraphics`/Framebuffers).
4. **Wenn p5 an Grenzen stößt:** für sehr aufwändige GPU-Arbeit ist **openFrameworks** (C++) oder **TouchDesigner** (visuell, sehr beliebt für Installationen) eine Stufe darüber. Für dein Uni-Projekt aber fast sicher unnötig — p5 + Shader reicht.

### Sound einbinden

- **p5.sound** (kommt mit p5): schnell für Samples, Oszillatoren, FFT/Amplitude-Analyse. Reicht für einfache Sonifikation.
- **Tone.js** (`npm i tone`): mächtiger für generative Musik — Synths, Effekte, Sequencer, Skalen. Empfohlen, wenn Sound mehr als ein Effekt sein soll. Wichtig: Audio im Browser startet erst nach einer **Nutzer-Geste** (erster Touch/Klick) — also Audio in `mousePressed`/`touchStarted` initialisieren (`Tone.start()`).

### Aufs Touchscreen bringen (Deployment)

- Läuft als Webseite → einfach im **Vollbild-Browser (Kiosk-Modus)** öffnen. Chrome: `--kiosk --app=file:///pfad/index.html`. Verhindert Adressleiste, Gesten, versehentliches Verlassen.
- `touch-action: none;` in CSS und `e.preventDefault()` auf `gesturestart`/`touchmove`, damit der Browser nicht zoomt/scrollt.
- Auf Bildschirmgröße/-auflösung skalieren: `createCanvas(windowWidth, windowHeight)` + `windowResized()`. Vorher die Zielauflösung des 55"/32"-Screens erfragen und testen.
- Vorab mit der Maus entwickeln; `touches`-Array funktioniert auch mit einem Touchpoint. Echten Multitouch erst am Schluss am Gerät testen (Folien sagen: Touchscreens zum späteren Testen verfügbar).

---

## Teil 2 — Technische Anforderungen fürs Miro-Board

Hier eine fertige, anpassbare Liste der technischen Anforderungen, die du laut Aufgabe 2 dokumentieren sollst. Streiche, was nicht zu deinem gewählten Konzept passt.

**Plattform & Sprache**
- p5.js (JavaScript), läuft im Browser — keine Installation beim Betrachter nötig.
- Rendering im WebGL-Modus (für 3D / Vertex-Displacement / Shader).
- Ziel-Hardware: Touchscreen (55" oder 32"), Vollbild/Kiosk-Modus in Chrome.

**Kern-Simulation (je nach Konzept)**
- [Boids / Physarum / Reaktions-Diffusion / Wellenfeld] als zentrales komplexes System.
- Zahl der Elemente: Prototyp ~[500–2000] Agenten in p5; Endversion ~[10⁴–10⁶] via GPU-Shader.
- Zeitschritt-Update pro Frame, Ziel: stabile 60 FPS bei Zielauflösung.

**Interaktion**
- Multitouch über das `touches`-Array (mehrere gleichzeitige Berührungspunkte).
- Touch-Mapping: [z.B. Tippen = Saat/Räuber, Halten = Attraktor, Wischen = Strömung].
- `gesturestart`/Default-Gesten unterdrückt (kein Browser-Zoom).

**Sound**
- [p5.sound / Tone.js] für generative Sonifikation, abhängig vom Systemzustand (z.B. Dichte, Geschwindigkeit, Aktivität).
- Audio-Init nach erster Nutzer-Geste (Browser-Autoplay-Policy).

**Visuals / Vertex-World**
- Vertex-Displacement eines Gitters/Meshes anhand des Simulationsfeldes (Spur-/Konzentrations-/Höhenkarte).
- Farb-/Lichtmodell, Spur-/Trail-Rendering mit Alpha-Akkumulation.

**Architektur & Workflow**
- Modularer Code (Klassen pro Element, getrennte Sound-/UI-Module), Instance Mode.
- Versionierung mit Git/GitHub; Varianten in Branches.
- Build/Dev mit [Live Server / Vite].

**Performance & Risiken**
- GPU-Shader (Ping-Pong-Framebuffer) als Skalierungspfad; Fallback: weniger Partikel.
- Test auf Ziel-Touchscreen (Auflösung, Multitouch, Dauerbetrieb/Stabilität für Ausstellung).

**Assets & Lizenzen**
- Verwendete Libraries (p5.js, p5.sound/Tone.js) + Lizenzen notieren.
- Geliehene Algorithmen/Code (z.B. 36 Points ist CC BY-NC-SA) korrekt attribuieren.

---

## Nächste Schritte (Vorschlag)

1. Konzept aus `02_Konzeptideen.md` wählen.
2. Lokales Setup (VS Code + Live Server) oder ich gebe dir ein fertiges Starter-Template.
3. Ersten lauffähigen Sketch bauen (Prototyp), Screenshots/Captures fürs Miro-Board.
4. Diese Anforderungsliste auf das gewählte Konzept zuschneiden und ins Board übertragen.
5. 90-Sek-Talk: Problem/Idee → das System & die eine Regel → die Geste → die Message.

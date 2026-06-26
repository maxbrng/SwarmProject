# Wissenssammlung — Komplexe Systeme & Naturmuster mit Code

> Knowledge-Base für das Art+Code-Projekt. Methoden, Erklärungen, Künstler:innen und Links — recherchiert aus den Vorlesungsfolien plus ergänzende Quellen.
> Leitidee der Vorlesung: *Aus einfachen, lokalen Regeln entstehen komplexe, globale Muster (Emergenz). Gestalten mit Systemen ist eher Erforschen als Planen.*

---

## 0. Die zwei großen Denkmodelle

Fast alle Methoden hier lassen sich in zwei Lager einordnen — das ist die wichtigste Sortierung, die du dir merken solltest:

**Lagrange / partikelbasiert** — du simulierst viele einzelne *Elemente* (Partikel, Agenten, Boids), jedes mit Position und Geschwindigkeit. Das System "lebt" in den Objekten. Gut für: Schwärme, Strömungen aus Sicht der Teilchen, organisch-fließende Strukturen. Beispiel: Boids, Physarum.

**Euler / gitterbasiert** — du simulierst ein festes *Raster* (Grid) aus Zellen, jede Zelle speichert Werte (z.B. chemische Konzentration). Das System "lebt" im Raum. Gut für: Reaktions-Diffusion, Fluidsimulation, zelluläre Automaten. Beispiel: Gray-Scott, Conways Game of Life.

**Semi-Lagrange / hybrid** — kombiniert beides: Partikel *und* Gitter (z.B. Material Point Method, viele moderne Fluid-Sim). Das ist State of the Art bei aufwändigen Simulationen.

Dazu kommt eine dritte, übergeordnete Familie:

**Evolutionäre / genetische Systeme** — nicht "wie bewegt es sich", sondern "wie verändert es sich über Generationen". Du trennst Genom (Code/Parameter) von Phänom (sichtbares Ergebnis), und wendest Reproduktion, Mutation und Selektion an.

---

## 1. Boids — Schwärme aus drei Regeln (Lagrange)

**Craig Reynolds, 1986/87.** Das Lehrbuchbeispiel für Emergenz. Jeder "Boid" (bird-oid) folgt nur drei lokalen Steuerregeln, basierend auf den Nachbarn in einem kleinen Wahrnehmungsbereich (definiert durch *Distanz* + *Blickwinkel*):

1. **Separation** — weiche aus, um Gedränge mit nahen Nachbarn zu vermeiden.
2. **Alignment** — richte dich an der mittleren Flugrichtung der Nachbarn aus.
3. **Cohesion** — bewege dich zum Mittelpunkt der nahen Nachbarn hin.

Kein Boid "weiß" etwas vom Schwarm als Ganzem — trotzdem entsteht das vertraute Vogelschwarm-/Fischschwarm-Verhalten. Genau das ist Emergenz: komplexes globales Verhalten aus einfachen, nichtlinearen lokalen Regeln. Reynolds erweiterte das früh um *obstacle avoidance* und *goal seeking* (Ziel-Anziehung). Das Modell wurde 1992 in *Batman Returns* für Fledermaus- und Pinguinschwärme verwendet.

**Für dich relevant:** Boids sind in p5.js in ~100 Zeilen machbar, super gut interaktiv erweiterbar (Maus/Touch als Anziehung, Hindernis oder Räuber), und liefern sofort eine "Story" (Gemeinschaft, Individuum vs. Masse, Panik, Migration).

- Original + Erklärung: https://www.red3d.com/cwr/boids/
- Steering Behaviors (vertiefend): https://www.red3d.com/cwr/steer/
- Coding Train Tutorial (p5.js, sehr gut für den Einstieg): suche "The Coding Train Flocking Simulation" auf YouTube / thecodingtrain.com
- Anwendung als Skulptur: Corrie Van Sice – Generative Sculpture (https://www.corrievansice.com/projects/generativesculpture-itp)
- Anwendung als Architektur: IAAC – Strange Boids Pavilion (https://www.iaacblog.com/programs/strange-boids-pavilion/)

---

## 2. Physarum — Schleimpilz-Netzwerke (Lagrange, GPU)

**Jeff Jones, 2010.** Simuliert das Verhalten des Schleimpilzes *Physarum polycephalum*. Sehr verwandt mit Boids, aber statt aufeinander reagieren die Agenten auf eine **Spur (trail map)**, die sie selbst hinterlassen — das nennt man *Stigmergie* (indirekte Kommunikation über die Umwelt, wie Ameisen-Pheromone).

**Der Algorithmus pro Schritt:**

1. **Sensing** — jeder Agent "schaut" an drei Stellen: geradeaus, leicht links, leicht rechts (Parameter: Sensor-Distanz SD, Sensor-Winkel SA) und misst dort die Spur-Intensität.
2. **Rotation + Bewegung** — dreht sich zur Stelle mit der höchsten Spur (Parameter: Rotations-Winkel RA), läuft dann vorwärts (Move-Distance MD).
3. **Deposit** — hinterlässt selbst Spur an der neuen Position.
4. **Diffusion + Decay** — die gesamte Spurkarte wird leicht verwischt (Blur) und mit einem Faktor (~0.75) multipliziert, damit das System stabil bleibt.

Mit nur 4 Parametern (SD, SA, RA, MD) entstehen radikal unterschiedliche, lebendig-organische Netzwerke — die wie Adern, Wurzeln, neuronale Netze oder Galaxienfäden aussehen.

**Sage Jenson – *36 Points* (2019–2022):** der berühmte Ausbau. Die Parameter werden *abhängig vom Spurwert x* unter dem Partikel berechnet (z.B. `Sensor-Distanz = p1 + p2·x^p3`). Das ergibt 12+ Parameter statt 4 → enorm vielfältiges Verhalten. Jeder der "36 Punkte" ist ein Parametersatz im ℝ²⁰. Sage spricht selbst von *"speculative biology"* statt Simulation.

**Performance-Realität:** Mit wenigen Agenten in p5.js sieht man wenig. Die schönen Strukturen brauchen *Millionen* Partikel → das läuft nur auf der **GPU via Shader**. Etienne Jacob (bleuje) erreicht mit Compute-Shadern + openFrameworks 5–13 Mio. Partikel bei 60 FPS. In p5.js machbar über `createGraphics` + Shader (`.frag`) oder die WebGL-Pipeline, aber anspruchsvoll.

- Beste Erklärung mit Mathe + Code: Etienne Jacob – https://bleuje.com/physarum-explanation/
- Interaktives 36 Points (Tasten A–Z, 0–9 drücken!): https://www.sagejenson.com/36points/
- Sage Jensons Diagramm + Kommentare: https://cargocollective.com/sagejenson/physarum
- Deniz Bicer interaktive Erklärung: https://denizbicer.com/202408-UnderstandingPhysarum.html
- Web-Implementierung mit Reglern (Amanda Ghassaei): https://apps.amandaghassaei.com/gpu-io/examples/physarum/
- Sebastian Lague Video (Slime Simulation, sehr zugänglich): https://www.youtube.com/watch?v=X-iSQQgOd1A
- Bleuje Open-Source-Installation (mit Gamepad-Interaktion!): https://github.com/Bleuje/interactive-physarum
- Originalpaper Jones 2010: https://arxiv.org/pdf/1511.05869

---

## 3. Reaktions-Diffusion — Gray-Scott (Euler, Grid)

**Idee:** Zwei virtuelle Chemikalien A und B auf einem 2D-Gitter. Drei einfache Vorgänge laufen gleichzeitig:

- **Feed:** A wird mit einer "feed rate" f kontinuierlich hinzugefügt.
- **Reaction:** zwei B verwandeln ein A in B (als ob B sich von A ernährt und vermehrt). B wird mit "kill rate" k entfernt.
- **Diffusion:** beide Chemikalien verteilen sich, aber A diffundiert schneller als B.

Die Update-Gleichung pro Zelle nutzt einen *Laplace-Operator* (3×3-Faltung: Zentrum −1, Kanten-Nachbarn 0.2, Diagonalen 0.05). Typische Werte: DA=1.0, DB=0.5, f=0.055, k=0.062, Δt=1.0. Start: überall A=1, B=0, ein kleiner Fleck mit B=1 als Saat.

**Das Erstaunliche:** Aus diesen simplen Regeln entstehen biologisch aussehende Muster — Flecken (Gepard), Streifen (Zebra), Labyrinthe, Korallen, Fingerabdrücke, sich teilende "Zellen" (Mitose). Kleine Änderungen an f und k springen zwischen völlig verschiedenen Musterwelten. Eng verwandt mit **Turing-Mustern** (Alan Turing, 1952: "The Chemical Basis of Morphogenesis" — erklärt, wie chemische Diffusion Tierfellmuster erzeugt).

**Für dich relevant:** Läuft fantastisch als Shader, ist von Natur aus eine Touch-Leinwand (Berührung = neue Saat / lokale Parameteränderung), und hat eine starke Story (Morphogenese, wie Leben Form findet). Karl Sims' Museums-Installation in Boston (2016–2024) ist genau das: 24-Screen-Wand + Touch-Kiosk, mit dem Besucher feed/kill-rate, Größe und Orientierung steuern.

- Karl Sims Tutorial (klarste Erklärung überhaupt): https://www.karlsims.com/rd.html
- Karl Sims Museums-Installation (dein direktes Vorbild fürs Touchscreen-Setup!): https://www.karlsims.com/rd-exhibit.html
- Karl Sims RD-Tool zum Spielen: https://www.karlsims.com/rdtool.html
- VisualPDE (interaktiv, ohne Code): https://visualpde.com/ und https://visualpde.com/nonlinear-physics/gray-scott
- Wikipedia Turing-Muster: https://en.wikipedia.org/wiki/Turing_pattern
- Anwendung auf 3D-Wachstum / Vertex: Kouhei Nakama (http://kouheinakama.com/diffusion/), Blender Artists Reaction-Diffusion Growth (https://blenderartists.org/t/reaction-diffusion-growth/1451160)

---

## 4. Fluidsimulation — Strömung (Euler & Hybrid)

**Eulerian Fluid:** das Geschwindigkeitsfeld lebt auf einem Gitter. Der Klassiker ist Jos Stams "Stable Fluids" / "Real-Time Fluid Dynamics for Games" — die Vorlage für "How to write an Eulerian fluid simulator with 200 lines of code". Schritte: Advektion (das Feld trägt sich selbst), Diffusion, Druckkorrektur (Inkompressibilität), externe Kräfte.

**Semi-Lagrange / Material Point Method (MPM):** kombiniert Partikel (tragen Masse/Material) mit einem Hintergrundgitter (löst die Kräfte). Standard für moderne Film-/Game-Fluide und für Sand, Schnee, Schaum.

**Für dich relevant:** sehr berührungs-dankbar (Finger = Kraft ins Feld, Farbe wird mitgerissen). Memo Aktens *Bodypaint* (2009) ist genau das als Performance-Tool. Rechenintensiv → Shader.

- Coding Adventure (Sebastian Lague) Fluid Simulation: https://www.youtube.com/watch?v=rSKMYc1CQHE
- Coding Adventure Simulating Smoke: https://www.youtube.com/watch?v=Q78wvrQ9xsU
- Material Point Method: https://en.wikipedia.org/wiki/Material_point_method
- Memo Akten – Bodypaint: in den Folien als Interaktions-Beispiel genannt
- Shadertoy Fluid-Beispiele: https://www.shadertoy.com/results?query=fluid (z.B. https://www.shadertoy.com/view/tsKXR3, https://www.shadertoy.com/view/4tGfDW)

**Memo Akten – Waves (2014–):** kein Echtzeit-Fluid, sondern eine "Daten-Dramatisierung" aufwändiger Ozean-Simulationen, abstrahiert zu Bild + Klang. Inspiriert von Turner, Hokusai, Aivazovsky. Thema: die Spannung zwischen der Macht und der Zerbrechlichkeit der Ozeane. Score von Machinefabriek. Gute Referenz dafür, wie man Simulation + Sound + eine emotionale Botschaft verbindet. https://www.memo.tv/works/waves/

---

## 5. Zelluläre Automaten & Emergenz (Euler, Grid)

**Stephen Wolfram.** Ein zellulärer Automat (CA) ist ein Gitter, in dem jede Zelle nach einer simplen lokalen Regel ihren nächsten Zustand aus dem Zustand ihrer Nachbarn berechnet.

- **Rule 30** (1D-CA): beweist, dass eine streng deterministische, triviale Regel echtes *chaotisches, zufällig wirkendes* Verhalten erzeugt — ohne irgendeinen Zufallsgenerator. Wolframs Lieblingsbeispiel für "Komplexität aus Einfachheit". https://en.wikipedia.org/wiki/Rule_30
- **Conways Game of Life** (2D-CA): vier Regeln, daraus Gleiter, Oszillatoren, ganze "Maschinen". Der Klassiker für emergentes Leben.
- **Wolfram + Connection Machine** (mit Feynman, Mitte 1980er): tausende Gitterzellen mit simplen Regeln simulieren komplexe Fluiddynamik/Turbulenz ("Cellular Automaton Fluids").

**Logistic Map** — Pₜ₊₁ = r · Pₜ · (1 − Pₜ). Eine einzige Zahl, eine simple Formel, und dennoch der Übergang von Ordnung in Chaos, wenn man r erhöht (Verdopplungs-Kaskade, Feigenbaum). Die Wurzel der Chaos-Theorie und ein wunderschönes Bild (Bifurkationsdiagramm). https://www.islandsoforder.com/the-logistic-map.html

- Rule 30 auf Shadertoy: https://www.shadertoy.com/view/4syBzV
- Wolfram Science: https://www.wolframscience.com/

---

## 6. Evolutionäre & Genetische Kunst

**Konzept Genom ↔ Phänom:** das Genom ist der vollständige Bauplan (Code, Parameter, DNA); das Phänom ist das sichtbare Resultat aus dem Zusammenspiel von Genom + Umwelt. Das lässt sich auf alles übertragen:
- Eine Partitur ist das Genom, der Klang das Phänom.
- Ein Rezept ist das Genom für einen Kuchen.
- Eine Bitmap ist das Genom für ein Bild.
- **Code ist das Genom, das Verhalten das Phänom.**

Sobald man Genom + Phänom hat, kann man **Evolution** anwenden: Reproduktion (sexuell/asexuell), **Mutation**, **Cross-over**, und **Selektion** (wer sich fortpflanzen darf).

Zwei große Herausforderungen bei genetischen Algorithmen: (1) eine sinnvolle **Fitness-Funktion** definieren, (2) einen **kontinuierlichen genomischen Raum** definieren.

**Künstler:**
- **William Latham** — "Artist as the Gardener". FormSynth-Zeichnungen (1982–85), dann *FormGrow* und *Mutator* (1987–93): organisch-skulpturale Formen, gezüchtet statt entworfen.
- **Karl Sims** — die zentrale Figur:
  - *Panspermia* (1990): https://www.karlsims.com/panspermia.html
  - *Primordial Dance* (1991): abstrakte Texturen, durch "künstliche Evolution" entstanden — Computer erzeugt Bildkollektion, Künstler wählt die ästhetisch interessantesten, deren "Gene" werden kopiert/mutiert/gekreuzt → nächste Generation. https://www.karlsims.com/primordial-dance.html
  - *Evolved Virtual Creatures* (1994): evolvierte 3D-Kreaturen, die schwimmen/laufen lernen. https://www.karlsims.com/evolved-virtual-creatures.html
- **Jon McCormack** — *Turbulence* (1994): preisgekrönte interaktive Installation, ein "Museum of Unnatural History". Ein symbolisches Entwicklungssystem nimmt eine winzige Spezifikation (wenige hundert Bytes) und lässt daraus komplexe 3D-Geometrie *wachsen* (Morphogenese), evolviert durch künstliche Selektion — bedient über ein **Touchscreen-Interface**. Sehr nahe an deinem Format. https://jonmccormack.info/project/turbulence · Generative Musik-Software *Nodal*: https://nodalmusic.com · Sensilab Monash.
- Sehr empfehlenswert: "The Surprising Creativity of Digital Evolution" (Sammlung verblüffender Anekdoten): https://arxiv.org/abs/1803.03453

---

## 7. Generative Design & Naturmuster (Überblick)

**Nervous System** (Jessica Rosenkrantz & Jesse Louis-Rosenberg) — Studio, das natürliche Wachstums- und Musterprozesse in Schmuck, Möbel, 3D-Druck übersetzt. Top-Referenz für "Natur-Algorithmus → reales Objekt". https://n-e-r-v-o-u-s.com/about_us.php / Blog: https://n-e-r-v-o-u-s.com/blog/

**Patterns in Nature** (Wikipedia-Überblick): die wiederkehrenden Formfamilien der Natur — Symmetrien, Bäume/Verzweigung, Spiralen, Mäander, Wellen, Schäume, Tessellationen (Parkettierungen), Risse/Cracks, Streifen. Eine gute Checkliste, um zu prüfen, welches Muster deine Idee anpeilt. https://en.wikipedia.org/wiki/Patterns_in_nature

Verwandte mathematische Werkzeuge, die oft dazu gehören: **Perlin/Simplex Noise** (organische Zufälligkeit, Basis fast jeder generativen Landschaft), **L-Systeme** (rekursive Grammatiken für Pflanzen/Bäume), **Voronoi/Delaunay** (Zell- und Bruchmuster), **Diffusion-Limited Aggregation** (Kristall-/Blitz-/Korallenwuchs), **Strange Attractors** (Lorenz etc.).

---

## 8. Mimesis — die visuelle Nachahmung der Natur

Zweiter Teil der Vorlesung: nicht nur Muster *aus* der Natur, sondern Bilder, die die reale Welt *perzeptuell darstellen* (Mimesis). 

**Alan Warburton – "Goodbye Uncanny Valley"** — Essay-Film über CGI, Simulation und die Frage, was "echt" aussieht. Gute kritische/konzeptuelle Referenz. https://alanwarburton.co.uk/goodbye-uncanny-valley

**Xavi Bou – Zeitraffer-Fotografie:** macht die unsichtbaren Bewegungspfade von Tieren sichtbar.
- *Ornithographies* (Vogelschwärme als Linienspuren): https://xavibou.com/ornithographies/
- *Fluctus*: https://xavibou.com/fluctus/
- *Entomographies* (Insekten): in den Folien genannt

Konzeptuelle Brücke: Boids/Physarum erzeugen genau solche "Bewegung-über-Zeit-als-Form"-Bilder — Xavi Bou ist die fotografische, reale Entsprechung. Murmuration of Starlings (National Geographic) ist die Naturreferenz für Boids.

---

## 9. Interaktion (aus den Folien, Projekt 2)

**Multitouch in p5.js:** alle aktiven Berührungen liegen im Array `touches`. Über `touches.length` iterieren, `touches[i].x` / `.y` lesen. `gesturestart` per `preventDefault()` abfangen, damit der Browser nicht zoomt. Lässt sich währenddessen mit der Maus testen; echte Touchscreens erst später nötig.

```js
document.addEventListener('gesturestart', (e) => { e.preventDefault(); });

function draw() {
  background(255);
  fill('magenta');
  for (let i = 0; i < touches.length; i++) {
    ellipse(touches[i].x, touches[i].y, 50, 50);
  }
}
```

**ML5.js** — freundliche ML-Bibliothek auf TensorFlow.js, gebaut für p5.js. Muster: Modell in `preload()` laden, Video in `setup()`, Detektor mit Video + Callback starten, Ergebnisse in `draw()` nutzen. Verfügbare Modelle:

| Modell | Liefert | Mögliche Nutzung |
|---|---|---|
| Body Pose | Keypoints auf Gelenken | Kopf, Hände, Glieder tracken |
| Body Segmentation | Maske der Körperteile | Inhalt hinter Person zeigen/verbergen |
| Hand Pose | Keypoints auf Fingern | Gesten-Interaktion |
| Face Mesh | dichtes Punktnetz im Gesicht | gesichtsgesteuerte Effekte |
| Depth Estimation | Tiefenkarte | Nähe zur Installation erkennen |
| Object Detector | Bounding Boxes | Betrachter zählen, Präsenz erkennen |

(Objekterkennung funktioniert gut für Menschen und Smartphones, andere Kategorien unzuverlässig.)

**Installations-Referenzen aus den Folien:** Memo Akten – *Bodypaint* (2009, Körper als Pinsel im Fluid), Interactive Science Lab – *Sandbox* (2024).

---

## 10. Pixel-Plattformen & Tools zum Erkunden

- **Shadertoy** (GPU-Shader im Browser, riesige Fundgrube): https://www.shadertoy.com/
- **Turtletoy** (minimalistische generative Zeichnungen): https://turtletoy.net/
- **VisualPDE** (Reaktions-Diffusion & PDEs ohne Code): https://visualpde.com/
- **p5.js Web Editor** (euer Ausgangspunkt): https://editor.p5js.org/
- **The Coding Train** (Daniel Shiffman, beste p5.js-Tutorials zu Boids, CA, Reaction-Diffusion, GA): https://thecodingtrain.com/
- **The Nature of Code** (Shiffmans Buch, gratis online — DAS Standardwerk für genau dieses Thema): https://natureofcode.com/

---

## 11. Quellenverzeichnis (alle Links kompakt)

Techniken: Boids https://www.red3d.com/cwr/boids/ · Steering https://www.red3d.com/cwr/steer/ · Physarum-Erklärung https://bleuje.com/physarum-explanation/ · 36 Points https://www.sagejenson.com/36points/ · Sage Cargo https://cargocollective.com/sagejenson/physarum · Deniz Bicer https://denizbicer.com/202408-UnderstandingPhysarum.html · Jones Paper https://arxiv.org/pdf/1511.05869 · RD-Tutorial https://www.karlsims.com/rd.html · RD-Installation https://www.karlsims.com/rd-exhibit.html · RD-Tool https://www.karlsims.com/rdtool.html · VisualPDE https://visualpde.com/ · Turing https://en.wikipedia.org/wiki/Turing_pattern · Kouhei Nakama http://kouheinakama.com/diffusion/ · Fluid (Lague) https://www.youtube.com/watch?v=rSKMYc1CQHE · Smoke https://www.youtube.com/watch?v=Q78wvrQ9xsU · MPM https://en.wikipedia.org/wiki/Material_point_method · Rule 30 https://en.wikipedia.org/wiki/Rule_30 · Logistic Map https://www.islandsoforder.com/the-logistic-map.html · Wolfram Science https://www.wolframscience.com/

Künstler:innen: Karl Sims https://www.karlsims.com/ (Panspermia /panspermia.html, Primordial Dance /primordial-dance.html, Evolved Creatures /evolved-virtual-creatures.html) · Jon McCormack Turbulence https://jonmccormack.info/project/turbulence · Nodal https://nodalmusic.com · Nervous System https://n-e-r-v-o-u-s.com/ · Memo Akten Waves https://www.memo.tv/works/waves/ · Xavi Bou https://xavibou.com/ornithographies/ · Alan Warburton https://alanwarburton.co.uk/goodbye-uncanny-valley · Sage Jenson Insta https://www.instagram.com/mxsage/

Anwendung/Skulptur: Corrie Van Sice https://www.corrievansice.com/projects/generativesculpture-itp · IAAC Strange Boids https://www.iaacblog.com/programs/strange-boids-pavilion/ · Bleuje interactive-physarum https://github.com/Bleuje/interactive-physarum

Tools/Lernen: Shadertoy https://www.shadertoy.com/ · Turtletoy https://turtletoy.net/ · Coding Train https://thecodingtrain.com/ · Nature of Code https://natureofcode.com/ · p5 Editor https://editor.p5js.org/

Überblick: Patterns in Nature https://en.wikipedia.org/wiki/Patterns_in_nature · Mimesis https://en.wikipedia.org/wiki/Mimesis · Digital Evolution Anekdoten https://arxiv.org/abs/1803.03453

---

## 12. Inspirationsgalerie — Künstler & Werke (vertiefte Recherche)

Kuratierte, recherchierte Sammlung zum Reinklicken — sortiert nach Thema. Ideal fürs Miro-Board.

### Komplexe Muster & Reaktions-Diffusion / Turing
- **Jonathan McCabe** — *Multi-Scale Turing Patterns*: addiert Turing-Prozesse über viele Größenordnungen, die „miteinander kämpfen" → fraktale, marmorierte, psychedelische Muster. Direkte Brücke zwischen Reaktions-Diffusion und dem Marbling-/Swirl-Look. Profil: https://www.lerandom.art/artists/jonathan-mccabe · Porträt: https://www.itsnicethat.com/articles/art-jonathan-mccabe · Galerie: https://gallery.bridgesmathart.org/exhibitions/2010-bridges-conference/jonathanmccabe
- **Karl Sims** — Reaktions-Diffusion als Touchscreen-Museumswand (24 Screens): https://www.karlsims.com/rd-exhibit.html · Tool: https://www.karlsims.com/rdtool.html
- **Kouhei Nakama** — *Diffusion* (Muster wachsen über 3D-Haut): http://kouheinakama.com/diffusion/

### Wachstum & Morphogenese (komplexe Form aus simplen Regeln)
- **Andy Lomas** — *Cellular Forms / Aggregation / Hybrid Forms*: 3D-Strukturen aus über 1 Mio. „Zellen", gewachsen aus nur ~12 Parametern; inspiriert von Turing, Haeckel, D'Arcy Thompson. Lumen-Prize-Gold. Seite: https://andylomas.com/ · Cellular Forms (Video): https://vimeo.com/105417695 · Ausstellung: https://www.watermans.org.uk/new-media-arts-archive/morphogenetic-creations-andy-lomas/
- **Nervous System** — Naturwachstum → Schmuck/Objekte/3D-Druck: https://n-e-r-v-o-u-s.com/blog/
- **Jon McCormack** — *Turbulence* (1994): gewachsene Kreaturen, Touchscreen-Museum: https://jonmccormack.info/project/turbulence

### Flussfelder, Strömung & Turbulenz (Swirl-Welt)
- **Tyler Hobbs** — *Flow Fields* (Essay, Pflichtlektüre) https://www.tylerxhobbs.com/words/flow-fields · *Fidenza* (berühmtes Flow-Field-Werk) https://www.curated.xyz/editorial/collecting-fidenza
- **Marcus Volz** — Vektor-Flussfeld-Kunst: https://marcusvolz.com/vector-flow-field-generative-art/
- **Charlotte Dann** — „Magical vector fields" (zugänglich): https://charlottedann.com/article/magical-vector-fields
- **Sighack** — „Getting Creative with Perlin Noise Fields" (Tutorial): https://sighack.com/post/getting-creative-with-perlin-noise-fields
- **Refik Anadol** — *Unsupervised* (MoMA): riesige, wirbelnde Daten-/Partikelströme als „Fluid Dreams". Format-Referenz für XXL-Installation. https://refikanadol.com/works/unsupervised/ · https://www.moma.org/calendar/exhibitions/5535
- **Met Museum** — „The Art of Marbled Paper" (die historische Wurzel deines Swirls): https://www.metmuseum.org/perspectives/marbled-paper

### Schwarm & Bewegung-als-Form
- **Sage Jenson** — *36 Points* (Physarum, interaktiv): https://www.sagejenson.com/36points/ · Insta: https://www.instagram.com/mxsage/
- **Xavi Bou** — *Ornithographies* (Vogelschwärme als Linien): https://xavibou.com/ornithographies/
- **Sebastian Lague** — *Coding Adventure: Ant & Slime* (verständlich, mit Code): https://www.youtube.com/watch?v=X-iSQQgOd1A

### Generative-Art-Pioniere & Galerien zum Stöbern
- **Casey Reas** — Mitschöpfer von Processing; *Process Compendium* (Systeme statt Bilder): https://reas.com/ · https://reas.com/process
- **Jared Tarbell** — *Substrate*, *Sand Dollar* (Complexification, Open Source): http://www.complexification.net/ · Interview: https://www.artnome.com/news/2020/8/24/interview-with-generative-artist-jared-tarbell
- **Manolo Gamboa Naon (Manoloide)** — Chaos↔Ordnung, Partikel/Geometrie: https://www.katevassgalerie.com/manoloide · Porträt: https://www.artnome.com/news/2018/8/8/generative-art-finds-its-prodigy
- **Anders Hoff (inconvergent)** — Algorithmen-Essays zu Wachstum/Bruch/Linien: https://inconvergent.net/

### Wirbel & Spiralen in der Natur (für die Story)
- **Von-Kármán-Wirbelstraßen** (Wolkenwirbel hinter Inseln, Strömung um Hindernisse): https://earthsky.org/earth/these-are-von-karman-vortices/ · https://en.wikipedia.org/wiki/K%C3%A1rm%C3%A1n_vortex_street
- **Phyllotaxis / goldener Winkel** (Sonnenblume, Nautilus, Galaxien — 137,5°): https://www.nature.com/articles/srep15358 · https://microbenotes.com/phyllotaxy-and-fibonacci-sequence/
- Weitere Naturwirbel: Strudel/Whirlpools, Hurrikane/Zyklone, Jupiters Großer Roter Fleck, Spiralgalaxien (M51), Rauch-/Tintenwirbel, Fingerabdrücke, Cochlea, DNA-Helix.

### Interaktive Installationen mit komplexen Systemen (Format-Vorbilder)
- **DigiPlay** (Uni Calgary) — drei 80"-Touchscreens mit Open-Source-Simulationen komplexer Systeme; Besucher beeinflussen emergente Schwärme. Genau dein Format. Übersicht: https://amt-lab.org/blog/2021/10/artistic-futures-digital-interactive-installations
- **FLUIDIC – Sculpture in Motion** (WHITEvoid für Hyundai) — Laser-Punktwolke aus 12.000 „Molekülen", von Besuchern geformt.
- **Waves of Connection** — Hokusais Große Welle als ~1 Mio. Partikel, per Kinect von bis zu 6 Personen gesteuert. Ideen-Übersicht: https://www.utsubo.com/blog/interactive-installation-ideas-museums
- **Memo Akten** — *Bodypaint* (Körper als Pinsel im Fluid), *Waves* https://www.memo.tv/works/waves/

### Ökosystem, Räuber-Beute, Population & Echtdaten
- **Lotka-Volterra** (Räuber-Beute-Gleichungen, oszillierende Populationen, 1926): interaktive Simulation https://visualize-it.github.io/lotka_volterra/simulation.html · Virtual Lab https://vlab.amrita.edu/?sub=3&brch=67&sim=185&cnt=1
- **Räuber-Beute-Boids in p5.js:** Tristan Antonsen – „Simulating a Tiny Ecosystem with Boids" https://tristanantonsen.blog/2022/12/28/simulating-a-tiny-ecosystem-with-boids/ · IshanManchanda – Boids mit Räuber, Hunger & Verhungern (Open Source) https://github.com/IshanManchanda/Boids · decentralion – Predator-Flocks (Flocking + Selektion evolviert) https://github.com/decentralion/predator-flocks
- **Mehragenten-Ökosystem als Kunst (Paper):** „Simulacra Naturae" https://arxiv.org/pdf/2509.02924 · Multi-Agent-RL-Räuber-Beute https://arxiv.org/pdf/2002.03267
- **Echtdaten — Wind/Wetter/Ozean:** earth.nullschool.net (NOAA-GFS-Wind, alle 3 h, von Cameron Beccario) https://earth.nullschool.net/ · Open-Source-Code https://github.com/cambecc/earth · NOAA Echtzeit-Daten https://www.noaa.gov/education/resource-collections/data/real-time
- **Sound/Sonifikation:** Tone.js (interaktive Musik im Browser) https://tonejs.github.io/ · Generative Music with JavaScript https://meleyal.github.io/generative-music-with-javascript/introduction

### Terrain-Look — eindeutig als Gelände lesbar (Höhenlinien, Schummerung, Low-Poly)
Ziel: der Untergrund soll sofort als Karte/Gelände erkennbar sein. Drei kombinierbare Techniken:

**a) Höhenlinien / Konturen (Marching Squares).** Ein Höhenfeld (Noise) wird in Linien gleicher Höhe übersetzt — der klassische Wanderkarten-Look mit scharfen, klaren Linien. Algorithmus: jede Gitterzelle nach „über/unter Schwellwert" prüfen → eine von 16 Linien-Konfigurationen; mit Interpolation werden die Linien glatt.
- The Coding Train – Marching Squares (p5-Sketch): https://editor.p5js.org/codingtrain/sketches/MDJ61g-Xg
- JT Nimoy – Isolinien in p5.js + Library `p5.marching.js`: https://medium.com/@jtnimoy/how-to-extract-isolines-in-p5-js-e268b2b046a0
- oliholli – interpolierte Konturlinien (p5): https://editor.p5js.org/oliholli/sketches/NB5Syz-3g
- 0xMoe – „topographic-map" (p5): https://editor.p5js.org/0xMoe/sketches/_TkTYAijy
- Interaktive Topo-Karte (CodePen): https://codepen.io/holodan/pen/RwzjQpj
- Primer/Erklärung: https://ragingnexus.com/creative-code-lab/experiments/algorithms-marching-squares/

**b) Schummerung / Hillshade (Schatten wie auf Reliefkarten).** Aus dem Höhenfeld wird per Lichtquelle ein Schattenbild berechnet: pro Punkt aus Hangneigung (slope) + Ausrichtung (aspect) + Sonnenstand (Azimut + Höhe) der Lichteinfall → helle Sonnen-, dunkle Schattenhänge. Plus „hypsometrische" Farbskala (blau→grün→braun→weiß) = klassischer Atlas-Look. Parameter: Azimut, Sonnenhöhe, Überhöhung.
- Wikipedia – Hillshade/Relief: https://en.wikipedia.org/wiki/Hillshade
- Robert Simmon – „A Gentle Introduction… Shaded Relief" (sehr verständlich): https://medium.com/@robsimmon/a-gentle-introduction-to-gdal-part-5-shaded-relief-ec29601db654
- somethingaboutmaps – Shaded Relief in Blender: https://somethingaboutmaps.wordpress.com/2017/11/16/creating-shaded-relief-in-blender/

**c) Low-Poly mit Flat-Shading (scharfe Kanten + Schatten).** Gelände als Gitter aus Dreiecken; jede Facette eine flache Farbe, schattiert nach ihrer Normalen → harte Kanten, „Stained-Glass"-Effekt, klar dreidimensional. In p5 `WEBGL` oder Three.js (`flatShading: true`).
- Josh Marinacci – Low-Poly Terrain Generation: https://medium.com/@joshmarinacci/low-poly-style-terrain-generation-8a017ab02e7b

**Künstlerische Referenz fürs Karten-Gefühl:** Robert Hodgin – *Meander* (prozedurale Flusskarten im Stil alter US-Army-Corps-Karten, nach Harold Fisks Mississippi-Karten): https://roberthodgin.com/project/meander · Hintergrund: https://kottke.org/20/05/meander-maps-for-imaginary-rivers

**Weitere Look-Idee:** gestapelte Höhenlinien als „Ridgeline/Joy-Division-Plot" (versetzte Profilstriche übereinander) — sehr grafisch und eindeutig als Höhenprofil lesbar.

> Tipp: Die drei Techniken lassen sich überlagern — z.B. Hillshade als Basis + Höhenlinien darüber + optional Low-Poly-Kanten. Genau diese drei Stile zeigt die zugehörige Live-Demo.

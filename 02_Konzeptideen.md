# Konzeptideen & Interaktion

> Zentrale Konzept-Datei. Aufbau: drei Leitprinzipien → die autonomen Basissysteme (der „Star") → die Interaktions-Ebene (Swirl + Gesten) → Empfehlung. Die technischen Details zu jedem System stehen in `01_Wissenssammlung_Komplexe_Systeme.md`, die Inspirationsgalerie ebenfalls dort.

## Drei Leitprinzipien

1. **Story zuerst.** Das Wichtigste ist eine gute, offen interpretierbare Botschaft. Das System ist das Mittel, nicht der Zweck.
2. **Autonom fesselnd.** Das Werk muss schon *ohne* Interaktion ein komplexes, sich endlos veränderndes Schauspiel sein, dem man minutenlang zusehen kann.
3. **Interaktion ist additiv.** Berührung verändert das laufende System nur *lokal und temporär* — u.a. über den **Swirl**. Das System läuft danach von allein weiter.

---

## ★ Leitkonzept — geschichtetes Ökosystem (kombiniert)

Die aktuell stärkste Richtung: nicht *ein* System, sondern **drei Schichten**, die voneinander abhängen — genau die „alle Elemente hängen voneinander ab"-Anforderung aus der Aufgabe.

**Schicht 1 — Hintergrund: lebendiges Terrain.** Statt eines Bildes ein komplexes System als Untergrund: Berge und Täler, die sich langsam von allein bewegen. Quelle wahlweise Curl-Noise, eine Reaktions-Diffusions-Höhenkarte (Konzept B) oder **echte Daten** (s.u.). Das Terrain ist nicht nur Deko: es **beeinflusst den Schwarm** (Tiere sammeln sich in Tälern, gleiten an Hängen, folgen Strömungen).

**Schicht 2 — Schwarm-Ökosystem.** In diesem Terrain lebt ein Schwarm aus **mehreren Arten** (z.B. Beute + Räuber, oder mehrere Beutearten mit verschiedenen Eigenschaften: Größe, Tempo, Farbe, Schwarmverhalten). Es gibt **Räuber-Beute-Dynamik und Population**: Räuber jagen und fressen Beute → die Beute wird weniger; ist genug Beute da, vermehren sich Räuber; verhungern sie, sterben sie; Beute wird nachgeboren. Daraus entstehen die typischen **oszillierenden Populationen** (Lotka-Volterra) — ein nie endendes Auf und Ab, dem man zusehen kann.

**Schicht 3 — Eingriff: Swirl + Gesten.** Der Vortex (langes Drücken) **verformt das Terrain** (domain-warp: Berge/Täler winden sich zur Spirale) **und** reißt gleichzeitig den Schwarm mit. Kurzes Tippen = Explosion/Schreck. Du greifst also in beide Schichten zugleich ein, und beide heilen danach.

**Sound (pro Art).** Jede Art bekommt ein eigenes Klangprofil (Timbre/Tonleiter). **Aktionen lösen Klänge aus:** Beute-Panik = nervöses Flirren, ein Fressen/Treffen = tiefer Impuls, eine Geburt = heller Ton. Die **Population steuert die Musik**: viele Beute = dichtes, harmonisches Klangbett; ein Räuber-Boom = dunkler, dissonanter. So *hört* man das Gleichgewicht kippen. Tool: Tone.js (https://tonejs.github.io/).

**Echte Daten (optional, aber starke Story).** Mögliche Anbindungen:
- **Wind/Wetter** treibt das Terrain/Strömungsfeld: *earth.nullschool.net* (Cameron Beccario) nutzt NOAA-GFS-Winddaten, alle 3 h aktualisiert — Open Source: https://github.com/cambecc/earth · NOAA Echtzeitdaten: https://www.noaa.gov/education/resource-collections/data/real-time
- **Umwelt-/Artendaten** steuern die Populationsgrenzen: z.B. reale Biodiversitäts-/Klimadaten setzen die Obergrenze der Beute → wenn die echte Welt schrumpft, schrumpft dein Ökosystem. Macht die Botschaft konkret.

**Story.** Ein Ökosystem im Gleichgewicht, das du störst und das sich erholt — oder kippt. Räuber & Beute, Werden & Vergehen, Resilienz. Mit echten Umweltdaten wird daraus ein Kommentar zu Klima/Artensterben: deine Geste (der Wirbel) als menschlicher Eingriff in die Natur.

**Warum das ideal für ein wachsendes Projekt ist:** du kannst **schichtweise** bauen und jederzeit abgeben. Stufe 1: Terrain + ein Schwarm + Swirl (läuft schon, siehe Live-Demo). Stufe 2: zweite Art + Räuber-Beute. Stufe 3: Population/Geburt/Tod. Stufe 4: Sound. Stufe 5: echte Daten. Jede Stufe ist für sich vorzeigbar.

**Bausteine & Referenzen:** Lotka-Volterra interaktiv https://visualize-it.github.io/lotka_volterra/simulation.html · Räuber-Beute-Boids (Tutorial) https://tristanantonsen.blog/2022/12/28/simulating-a-tiny-ecosystem-with-boids/ · Boids mit Räuber+Hunger/Verhungern (p5, Open Source) https://github.com/IshanManchanda/Boids · evolvierende Predator-Flocks https://github.com/decentralion/predator-flocks · Echtdaten-Wind https://earth.nullschool.net/ · agentenbasiertes Ökosystem als Kunst (Paper) https://arxiv.org/pdf/2509.02924

→ Die folgenden Basissysteme (Teil 1) sind die **Bauteile** dafür: das Terrain kommt aus B/E, der Schwarm aus C. Du kannst aber auch nur *ein* Basissystem pur nehmen — beides ist möglich.

---

## Teil 1 — Die Basissysteme (der autonome „Star")

Fünf Kandidaten. Alle laufen von allein und sind naturbasiert. Such dir einen als Grundlage aus.

### A — Physarum (Adernnetz / Schleimpilz)
**Was man sieht:** tausende Agenten kriechen, folgen ihren eigenen Spuren und bauen ein lebendiges, verästeltes Netzwerk, das sich endlos umorganisiert — wie Adern, Wurzeln, Neuronen.
**Autonomie:** sehr stark (organisiert sich ewig um, nie statisch).
**Story:** Wie findet Leben optimale Wege? Schwarmintelligenz, Netzwerke, das Internet.
**Inspiration:** Sage Jenson – 36 Points (interaktiv) https://www.sagejenson.com/36points/ · Etienne Jacob – Erklärung+Code https://bleuje.com/physarum-explanation/ · Bleuje – interaktive Installation https://github.com/Bleuje/interactive-physarum · Sebastian Lague – Ant & Slime Video https://www.youtube.com/watch?v=X-iSQQgOd1A

### B — Reaktions-Diffusion (wachsende Muster / Morphogenese)
**Was man sieht:** zwei „Chemikalien" erzeugen biologische Muster — Flecken, Streifen, Korallen, Labyrinthe —, die wachsen, sich teilen und wandern.
**Autonomie:** sehr stark (mit leicht driftenden Parametern morpht es endlos).
**Story:** Wie entsteht Form und Individualität? Schönheit aus simplen Regeln (Turing 1952).
**Inspiration:** Karl Sims – Touchscreen-Museumswand https://www.karlsims.com/rd-exhibit.html · RD-Tool zum Spielen https://www.karlsims.com/rdtool.html · Jonathan McCabe – Multi-Scale-Turing/Marbling https://www.lerandom.art/artists/jonathan-mccabe · Kouhei Nakama – Diffusion (3D-Haut) http://kouheinakama.com/diffusion/

### C — Boids (Schwarm / Murmuration)
**Was man sieht:** ein Schwarm aus drei simplen Nachbarschaftsregeln, der ununterbrochen neue, atmende Formen bildet.
**Autonomie:** mittel (lebendig, aber visuell etwas ruhiger als A/B — gewinnt am meisten durch Interaktion).
**Story:** Individuum vs. Kollektiv; Herdenverhalten, Migration, Gemeinschaft vs. Kontrolle.
**Inspiration:** Craig Reynolds – Original https://www.red3d.com/cwr/boids/ · Xavi Bou – Ornithographies (Schwärme als Linien) https://xavibou.com/ornithographies/ · Coding Train – Flocking-Tutorial https://thecodingtrain.com/

### D — Wellen / Fluid
**Was man sieht:** eine Oberfläche, auf der sich Wellen ausbreiten, überlagern und interferieren.
**Autonomie:** schwächer — braucht einen automatischen „Wind"/Regen als Antrieb, sonst wird es glatt.
**Story:** Schmetterlingseffekt, Macht & Zerbrechlichkeit der Natur (Memo Akten – Waves).
**Inspiration:** Memo Akten – Waves https://www.memo.tv/works/waves/ · Coding Adventure – Fluid Simulation https://www.youtube.com/watch?v=rSKMYc1CQHE

### E — Flussfeld / Turbulenz (neu)
**Was man sieht:** tausende Partikel treiben durch ein sich wandelndes Strömungsfeld (Curl-Noise), in dem überall kleine Wirbel entstehen — lange, nie überlappende Strömungslinien verdichten sich zu Marmor-Strukturen. Das Bild „malt sich selbst".
**Autonomie:** sehr stark, hypnotisch.
**Story:** Turbulenz & Selbstorganisation — dieselbe Spirale von der Kaffeetasse bis zur Galaxie; verborgene Ordnung im Chaos.
**Inspiration:** Tyler Hobbs – Flow Fields (Essay) https://www.tylerxhobbs.com/words/flow-fields · Fidenza https://www.curated.xyz/editorial/collecting-fidenza · Marcus Volz https://marcusvolz.com/vector-flow-field-generative-art/ · Refik Anadol – Unsupervised (Fluid Dreams) https://refikanadol.com/works/unsupervised/

> Hinweis zur früheren „Vertex-World": Das war ein Missverständnis (3D-Mesh). Gemeint war der **Swirl** — der lebt jetzt in Teil 2 als Interaktion, nicht als eigenes System.

---

## Teil 2 — Die Interaktions-Ebene (Swirl + Gesten)

Das gewählte Basissystem läuft autonom. Die Berührung stört es nur **lokal und temporär**; danach **heilt** das System sich selbst. Der **Swirl** ist dabei nur ein „Pinsel", der das vorhandene Bild lokal verdreht — er erzeugt nichts Eigenes und läuft nicht von allein.

**Gesten-Vokabular (wähle 2–3 klar unterscheidbare):**

- **Kurzes Tippen → Impuls / Explosion.** Ein Stoß, der das System wegdrückt (Schreckwelle wie beim Schwarm) oder einen Funken/eine Saat setzt.
- **Langes Drücken → Swirl baut sich auf.** Je länger gehalten, desto stärker/größer der Wirbel. Bei kurzem Antippen entsteht er bewusst noch nicht.
- **Ziehen / Wischen → Swirl durchziehen.** Den Wirbel durch das laufende System ziehen wie einen Löffel durch Milchkaffee; hinterlässt eine Schliere, die langsam verheilt.
- **Halten + Loslassen → Entladung.** Beim Halten staut sich Drehung auf, beim Loslassen entlädt sie sich.
- **Zwei Finger spreizen → Wirbel skalieren** (Reichweite/Stärke regeln).
- **Zwei Finger gegenläufig → Doppelwirbel / Scherung** (Turbulenz, von-Kármán-artig).
- **Mehrere Finger → mehrere Störzentren** (am Touchscreen via `touches`-Array).

**Empfohlene Minimal-Kombi:** Tippen = Explosion · Halten = Swirl · Ziehen = durchziehen. Drei klare, lernbare Gesten.

**Swirl pro Basissystem (kurz):**

- **Physarum/Reaktions-Diffusion:** der Swirl verquirlt Adern bzw. Muster lokal zu einer Spirale; das System wächst/glättet danach wieder hindurch. (Bestes „durchziehen"-Gefühl.)
- **Boids:** Tippen = Explosion, Halten = Vortex (Schwarm umkreist den Finger), Ziehen = Wirbel durch den Schwarm führen.
- **Flussfeld:** der Swirl wird als zusätzlicher Wirbel ins Strömungsfeld eingespeist.

**Story der Interaktion (sehr stark):** *Eingriff & Selbstheilung / Resilienz.* Du störst die Natur, sie absorbiert es und macht weiter — manche Eingriffe verheilen spurlos, manche hinterlassen Narben (je nach Tuning). Daneben: *Spur hinterlassen / Vergänglichkeit*, *Kontrolle vs. Eigenleben* (du kannst anstupsen, aber nicht beherrschen).

**Dramaturgie-Tipps:** kurze Berührung = kleiner Effekt, langes Halten = der große Swirl (belohnt Verweilen) · dezenter Ring/Glow am Finger als Feedback · langsame Heilung (über Sekunden), damit der Eingriff „nachklingt".

**Sound:** Swirl-Aufbau → ansteigendes, kreisendes Drone · Explosion → kurzer perkussiver Impuls · Heilung → harmonische Auflösung (Tone.js: Filter-Cutoff ∝ Turbulenz, Reverb).

---

## Teil 3 — Empfehlung & Entscheidungshilfe

| | Autonomie | „Swirl durchziehen" | Einstieg in p5 | Story |
|---|---|---|---|---|
| A Physarum | sehr stark | exzellent | mittel–schwer | Netzwerke, Leben findet Wege |
| B Reaktions-Diffusion | sehr stark | exzellent | mittel | Morphogenese, Individualität |
| C Boids | mittel | gut | leicht | Individuum vs. Kollektiv |
| D Wellen | schwach* | gut | mittel | Schmetterlingseffekt |
| E Flussfeld | sehr stark | sehr gut | mittel | Turbulenz, Ordnung im Chaos |

\*braucht automatischen Antrieb.

**Empfehlung:** Für „fesselt von allein **und** der Swirl wirkt darauf großartig" sind **B (Reaktions-Diffusion)** und **E (Flussfeld/Turbulenz)** die stärksten Kandidaten, dicht gefolgt von **A (Physarum)**. Alle drei sind dichte, fließende Felder, in denen ein durchgezogener Wirbel richtig zur Geltung kommt — und alle haben eine klare Story plus die zusätzliche „Eingriff & Selbstheilung"-Ebene durch die Interaktion.

**Nächster Schritt:** Sag mir (1) welches **Basissystem** der Star sein soll und (2) welche **2–3 Gesten** du willst. Dann baue ich den ersten lauffähigen p5.js-Sketch: autonomes System + Swirl nur bei Berührung.

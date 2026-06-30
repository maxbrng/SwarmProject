// Zentrale Stellschrauben für das Boids-Verhalten.
// Sim-Raum ist normiert: y ∈ [-1, 1], x ∈ [-aspect, aspect] (aspect = Breite/Höhe).
// Längen/Geschwindigkeiten sind also in "Bildschirm-Halbhöhen", aspekt-korrekt.
//
// Regeln nach Craig Reynolds (wie im Referenz-Repo roholazandie/boids):
//   - alignment  : Richtung an die Nachbarn angleichen
//   - cohesion   : zum Schwerpunkt der Nachbarn ziehen
//   - separation : Abstand zu zu nahen Nachbarn halten

export interface BoidsConfig {
  /** Anzahl der Boids. O(n²) auf der GPU — bis ~5000 problemlos. */
  count: number;
  /** Wahrnehmungsradius für alignment & cohesion. */
  perception: number;
  /** Radius, ab dem separation greift (kleiner als perception). */
  separationDist: number;
  /** Maximale Geschwindigkeit (Einheiten/Sekunde). */
  maxSpeed: number;
  /** Maximale Lenkkraft / Beschleunigung pro Regel. */
  maxForce: number;
  /** Gewichtung der drei Regeln. */
  alignWeight: number;
  cohesionWeight: number;
  separationWeight: number;
  /** Größe des dargestellten Boid-Dreiecks. */
  boidScale: number;
  /** Trail-Verblassen pro Frame (0 = ewige Spur, 1 = keine Spur). */
  trailFade: number;
  /** Hintergrundfarbe (lineares RGB, 0..1). */
  background: [number, number, number];
}

// Obergrenze der vorab allokierten Boid-Buffer. Die aktive Anzahl (cfg.count)
// ist live regelbar bis hierher, ohne Neu-Allokation.
export const MAX_COUNT = 8000;

export const DEFAULT_CONFIG: BoidsConfig = {
  count: 4000,
  perception: 0.2, // GRÖSSE der Schwärme (Referenz: 100px auf 1000px-Welt)
  separationDist: 0.04, // kurze Distanz für Kollisionsvermeidung
  maxSpeed: 0.6,
  maxForce: 2, // begrenzt NUR cohesion/separation (sanft) — alignment ist davon unabhängig
  alignWeight: 0.25, // DOMINANT: Stärke des Heading-Blends → gemeinsames Fließen/Wenden
  cohesionWeight: 1,
  separationWeight: 1.2,
  boidScale: 0.007,
  trailFade: 0.2,
  background: [0.02, 0.025, 0.04],
};

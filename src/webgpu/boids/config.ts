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
  count: 8000,
  perception: 0.1, // GRÖSSE der Schwärme: hoch = wenige große, klein = mehr kleine
  separationDist: 0.06, // weiter als früher → hält Schwärme aufgelockert, kein Kollaps zum Punkt
  maxSpeed: 0.2,
  maxForce: 2, // begrenzt cohesion/separation
  alignWeight: 0.7, // moderat: lokale Schwärme, kein globales Zusammenfließen zu EINEM
  cohesionWeight: 0.35, // niedrig: zieht locker zusammen, ohne zum Punkt zu kollabieren
  separationWeight: 1.7, // hoch: hält Boids auf Abstand → Schwärme bleiben aufgelockert
  boidScale: 0.007,
  trailFade: 0.17,
  background: [0.02, 0.025, 0.04],
};

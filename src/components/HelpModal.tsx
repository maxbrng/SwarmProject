"use client";

/**
 * In-app user guide. Keep this in sync whenever features change — it is the
 * explanation the user reads via the ⓘ button next to "Swarm".
 */
export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="help" onClick={onClose}>
      <div className="help__box" onClick={(e) => e.stopPropagation()}>
        <div className="help__head">
          <span className="help__title">Swarm — Guide</span>
          <button className="help__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="help__body">
          <p>
            An autonomous, living ecosystem of thousands of GPU-simulated “boids”. Several
            species flow like bird flocks and, in a cyclic predator–prey balance, hunt, flee,
            eat and reproduce — an endless rise and fall that runs entirely on its own.
          </p>

          <h4>Swarm behavior</h4>
          <p>Classic flocking (only among the same species):</p>
          <ul>
            <li>
              <b>Alignment</b> — match neighbors’ heading (creates the flowing motion).
            </li>
            <li>
              <b>Cohesion</b> — steer toward the center of nearby neighbors.
            </li>
            <li>
              <b>Separation</b> — keep a minimum distance from close neighbors.
            </li>
            <li>
              <b>Vision</b> sets flock size, <b>Speed</b> the travel speed, <b>Agility</b> how
              sharply they turn. Boids also bank away from the screen edges — they never leave.
            </li>
          </ul>

          <h4>Populations &amp; predator–prey</h4>
          <p>Each species has its own color. Who eats whom is set by the dominance mode:</p>
          <ul>
            <li>
              <b>Cyclic</b> — rock–paper–scissors: A eats B, B eats C, … and the last eats A again.
              Every species is both hunter and hunted, which keeps the system balanced.
            </li>
            <li>
              <b>Random</b> — a fixed random tournament: who beats whom is decided once (re-rolled
              on Restart). Some species may end up much stronger than others.
            </li>
            <li>
              <b>Chaos</b> — no fixed predator or prey at all. Every single encounter is decided by
              chance, so attacks just randomly succeed or fail. No species can permanently dominate;
              instead sheer numbers and luck drive who thrives and who is wiped out.
            </li>
            <li>
              <b>Chase / Flee drive</b> — how hard predators pursue and prey escape.
            </li>
            <li>
              <b>Bite range</b> — how close a predator must get to catch prey.
            </li>
            <li>
              <b>Population colors</b> — pick a custom color for each species (one picker per
              active population). The swarm and the Populations panel update live.
            </li>
            <li>
              <b>Color intensity</b> — overall brightness of the boids. Dense swarms add up and
              can blow out to white; lower this to keep the species colors readable, raise it for
              brighter, whiter peaks.
            </li>
          </ul>
          <p>
            All look-and-feel controls (species count, colors, color intensity, trail length,
            boid size) live together in the <b>Populations &amp; appearance</b> section.
          </p>

          <h4>Death &amp; birth model</h4>
          <ul>
            <li>
              <b>Convert</b> — eaten prey instantly turns into the predator. The total number
              stays constant; only the proportions oscillate. Very stable.
            </li>
            <li>
              <b>Energy</b> — a real ecosystem: eating restores energy, everyone slowly starves
              (<b>Starvation</b>), and being eaten or running out of energy kills a boid (it
              fades out, dimming and reddening). New boids are then born to refill.
            </li>
          </ul>

          <h4>Reproduction (Energy mode)</h4>
          <ul>
            <li>
              <b>Off</b> — no new births; species can truly go extinct.
            </li>
            <li>
              <b>Constant</b> — a steady random trickle of new boids anywhere.
            </li>
            <li>
              <b>Adaptive</b> — well-fed parents reproduce right inside their own swarm (the child
              appears next to a real boid, so the flock stays together — nothing spawns at random).
              The birth <i>rate</i> adapts to swarm size via <b>Adaptive strength</b>: at 0 every
              swarm breeds at the same rate (small ones can die out); higher makes shrinking swarms
              breed faster so they can recover. A fully wiped-out species stays gone unless
              survivors remain.
            </li>
            <li>
              <b>Homeland</b> — each species has a fixed home region (a soft ball) where its
              offspring are born, and a force pulls its members back home → defended territories.
            </li>
          </ul>

          <h4>Start layout &amp; controls</h4>
          <ul>
            <li>
              <b>Random</b> vs <b>Corners</b> — start scattered, or each species as one swarm in
              its own corner. <b>↻ Restart</b> re-seeds the ecosystem any time.
            </li>
            <li>
              <b>Count (capacity)</b> is the maximum number of boids alive at once. The{" "}
              <b>Populations</b> panel (top right) shows how many of each species are currently
              alive, live.
            </li>
            <li>
              <b>Presets</b> — save the current settings under a name and reload them any time with
              one click (great for quickly switching between looks in a demo). Stored in your browser.
            </li>
            <li>
              <b>Reset all values</b> restores the built-in defaults.
            </li>
          </ul>

          <p className="help__foot">
            Tip: hover any slider or button for a short explanation.
          </p>
        </div>
      </div>
    </div>
  );
}

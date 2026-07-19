// Built-in presets shipped WITH the app (baked into code → available in every production build,
// on every device). This is the single source of truth for shipped presets.
//
// In development you edit presets in the ControlPanel and click "Publish presets to code", which
// overwrites this file via /api/save-presets (dev-only). Commit it → the presets ship globally.
// In production the panel shows these read-only (no create/rename/overwrite/delete).
//
// AUTO-GENERATED region: the BUILTIN_PRESETS array below is rewritten by the publish route.
import { BoidsConfig } from "./config";

/** A named, saved configuration (a subset of BoidsConfig). */
export interface Preset {
  name: string;
  config: Partial<BoidsConfig>;
}

export const BUILTIN_PRESETS: Preset[] = [
  {
    "name": "Balanced Trio",
    "config": {
      "count": 8000,
      "perception": 0.1,
      "separationDist": 0.06,
      "maxSpeed": 0.15,
      "maxForce": 2,
      "alignWeight": 1,
      "cohesionWeight": 0.6,
      "separationWeight": 2,
      "boidScale": 0.007,
      "trailFade": 0.17,
      "colorIntensity": 0.8,
      "declump": 0,
      "numSpecies": 3,
      "chaseWeight": 1.2,
      "fleeWeight": 1.1,
      "killRadius": 0.025,
      "birthRate": 1,
      "adaptiveStrength": 1,
      "starveRate": 0.05,
      "deathMode": "energy",
      "seedMode": "clustered",
      "birthMode": "adaptive",
      "dominanceMode": "cyclic",
      "speciesColors": [
        [
          0.25,
          0.65,
          1
        ],
        [
          1,
          0.45,
          0.35
        ],
        [
          0.55,
          1,
          0.5
        ],
        [
          1,
          0.85,
          0.3
        ],
        [
          0.8,
          0.5,
          1
        ],
        [
          1,
          0.5,
          0.85
        ]
      ]
    }
  },
  {
    "name": "6 Full Chaos",
    "config": {
      "count": 20000,
      "perception": 0.1,
      "separationDist": 0.06,
      "maxSpeed": 0.1,
      "maxForce": 2,
      "alignWeight": 1,
      "cohesionWeight": 0.6,
      "separationWeight": 2,
      "boidScale": 0.007,
      "trailFade": 0.45,
      "colorIntensity": 0.9,
      "declump": 0.025,
      "numSpecies": 6,
      "chaseWeight": 1.2,
      "fleeWeight": 1.1,
      "killRadius": 0.025,
      "birthRate": 1,
      "adaptiveStrength": 2,
      "starveRate": 0.05,
      "deathMode": "energy",
      "seedMode": "clustered",
      "birthMode": "adaptive",
      "dominanceMode": "chaos",
      "speciesColors": [
        [
          0.25,
          0.65,
          1
        ],
        [
          1,
          0.45,
          0.35
        ],
        [
          0.55,
          1,
          0.5
        ],
        [
          1,
          0.85,
          0.3
        ],
        [
          0.8,
          0.5,
          1
        ],
        [
          1,
          0.5,
          0.85
        ]
      ]
    }
  },
  {
    "name": "Single Swarm",
    "config": {
      "count": 10000,
      "perception": 0.1,
      "separationDist": 0.06,
      "maxSpeed": 0.15,
      "maxForce": 2,
      "alignWeight": 1,
      "cohesionWeight": 0.6,
      "separationWeight": 2,
      "boidScale": 0.007,
      "trailFade": 0.17,
      "colorIntensity": 0.8,
      "declump": 0,
      "numSpecies": 1,
      "chaseWeight": 1.2,
      "fleeWeight": 1.1,
      "killRadius": 0.025,
      "birthRate": 1,
      "adaptiveStrength": 1,
      "starveRate": 0.05,
      "swirlStrength": 2.5,
      "swirlRadius": 0.4,
      "swirlFalloff": 1.6,
      "swirlInward": 0,
      "swirlDir": 1,
      "swirlRampUp": 0.12,
      "swirlRampDown": 0.5,
      "terrainForce": 6,
      "terrainScale": 2.45,
      "terrainCoverage": 0.65,
      "terrainWarp": 0.5,
      "terrainDrift": 0.06,
      "terrainLineCount": 15,
      "terrainLineWidth": 1,
      "terrainLineBright": 0.5,
      "terrainTint": 1,
      "terrainShade": 0.8,
      "terrainSnowAmount": 0.85,
      "terrainBrushSize": 0.22,
      "terrainBrushStrength": 0.8,
      "terrainBrushDetail": 0,
      "terrainHealRate": 0.02,
      "deathMode": "convert",
      "seedMode": "clustered",
      "birthMode": "off",
      "dominanceMode": "cyclic",
      "speciesColors": [
        [
          1,
          1,
          1
        ],
        [
          1,
          0.45,
          0.35
        ],
        [
          0.55,
          1,
          0.5
        ],
        [
          1,
          0.85,
          0.3
        ],
        [
          0.8,
          0.5,
          1
        ],
        [
          1,
          0.5,
          0.85
        ]
      ],
      "terrainEnabled": true,
      "terrainTool": "off",
      "terrainValley": [
        0.0078,
        0.0078,
        0.0078
      ],
      "terrainMid": [
        0.1529,
        0.1608,
        0.1451
      ],
      "terrainPeak": [
        0.4157,
        0.3882,
        0.3451
      ],
      "terrainSnow": [
        0.9,
        0.92,
        0.96
      ]
    }
  }
];

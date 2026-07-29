<div align="center">

# What We Cannot Destroy

### An interactive artificial ecosystem shaped by touch

Thousands of autonomous creatures form swarms, hunt, reproduce, disappear, and return inside a
procedural landscape. Visitors can disturb the system, but never permanently control it.

`WebGPU` · `WGSL` · `TypeScript` · `Next.js` · `Multi-touch`

## Project Video

[![Watch the project video](https://img.youtube.com/vi/bPigw6eilWA/maxresdefault.jpg)](https://youtu.be/bPigw6eilWA)

</div>

---

## About

**What We Cannot Destroy** is an interactive digital artwork built around an artificial ecosystem, created as part of the **Art+Code** course at **TU Dresden**.
Its creatures follow local flocking rules while three species pursue one another in a continuous
predator–prey cycle. Energy, reproduction, death, terrain, and population recovery turn these simple
behaviours into an unpredictable living system.

Every intervention is temporary. The swarms reorganise, the landscape slowly returns to its original
form, and even an extinct species can be reintroduced by the system. The work asks whether this
guaranteed recovery represents resilience—or creates the dangerous impression that destruction has
no lasting consequences.

## Interaction

- **One finger:** Move and stir a local vortex. A circular gesture determines its direction.
- **Two fingers:** Raise the terrain and create a mountain that repels the creatures.
- **Three or more fingers:** Lower the terrain and open a valley through which the swarms can move.

The size of a terrain intervention follows the distance between the fingers. After release, the
sculpted landscape gradually heals.

## How it works

The simulation runs directly on the GPU. Each creature stores only its position, velocity, species,
energy, age, and a short visual flash state. Every frame, WebGPU compute shaders:

1. update the editable terrain,
2. organise creatures in a spatial grid,
3. calculate flocking, hunting, energy, birth, death, and recovery,
4. render the terrain, creatures, glow, and motion trails.

Ping-pong buffers keep parallel state updates deterministic, while the spatial grid avoids comparing
every creature with every other creature. The default scene contains 8,000 creatures, with GPU
buffers prepared for up to 20,000.

## Technology

- Next.js 16 and React 19
- TypeScript
- WebGPU
- WGSL compute and render shaders
- GPU-based spatial neighbour search
- Procedural terrain with an editable height field
- Pointer Events for multi-touch interaction

WebGPU support and a secure browser context are required. An up-to-date Chrome or Edge browser is
recommended on desktop.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For testing on another device over the local network, WebGPU requires HTTPS:

```bash
npm run dev:https
```

To create and run a production build:

```bash
npm run build
npm run start
```

## Project structure

```text
src/
├── app/                 Next.js application shell
├── components/          Interface, controls, and population monitor
├── lib/viewMode.ts      Full dev panel vs. curated exhibition panel
└── webgpu/boids/
    ├── engine.ts        Orchestrator: GPU resources, frame loop, public handle
    ├── config.ts        Types and default parameters
    ├── presets.ts       Built-in ecosystem configurations
    ├── layout.ts        Uniform-struct field offsets (kept in sync with the WGSL)
    ├── pipelines.ts     Bind-group layouts and compute/render pipelines
    ├── input.ts         Multi-touch pointer tracking
    ├── modes.ts         Config enums → shader numbers, predator-prey matrix
    ├── seeding.ts       Initial boid placement
    ├── shaders.ts       Composes the WGSL programs from shaders/*.wgsl
    └── shaders/         The WGSL compute and render source files
```

## Acknowledgements

The flocking behaviour was informed by Craig Reynolds’ Boids model and the public
[`roholazandie/boids`](https://github.com/roholazandie/boids) Python/p5 implementation, which served
as a practical reference for the first prototype.

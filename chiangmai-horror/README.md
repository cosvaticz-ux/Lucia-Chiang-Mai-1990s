# Lucia in Chiang Mai — concept prototype

A third-person survival-horror vertical slice: one lane in Chiang Mai's old city in the mid 1990s,
one service pistol, five infected. PS2-era looks, modern controls.

Standalone project. No build step is needed to run it and it has no runtime dependencies.

## Run

- **Quickest:** open `dist/index.html` in a desktop browser (Chrome, Edge, Firefox, Safari 15+). It is a single self-contained file.
- **From source:** serve the folder and open `index.html`, which loads `src/main.js` as ES modules:
  `python3 -m http.server 8080` then visit `http://localhost:8080/`.
- **Rebuild `dist/`:** `node build.mjs` (needs `esbuild` on PATH, or `ESBUILD=/path/to/esbuild node build.mjs`).

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move (jog by default) |
| Mouse | Look |
| Shift | Sprint. Drains stamina and unsteadies the next few seconds of aiming |
| X (or hold Left Alt) | Walk. Nearly silent |
| Right mouse | Aim over the right shoulder; movement becomes a strafe walk |
| Left mouse | Fire. Without aiming, Lucia snaps into a short hip-fire stance |
| Shift while aiming | Hold breath: steadies the reticle, drains stamina |
| R | Reload |
| E | Interact (pick up, gate) |
| 1 / 2 | First aid spray / green herb |
| M | Mute |
| Esc / P | Pause |

## Layout

```
index.html              page shell, HUD markup, styles (dev entry)
build.mjs               bundles src/ into dist/
dist/index.html         single-file build
src/
  main.js               boot + menu wiring
  Game.js               frame loop, game rules (pickups, gate, win/lose, restart)
  engine/               small WebGL2 renderer
    Renderer.js           one lit shader: hemisphere + directional + 12 point lights, fog,
                          ordered dither, alpha test, additive/alpha, stencilled planar shadows
    MeshBuilder.js        low-poly primitives with vertex colours
    Node.js               scene graph
    Textures.js           procedural 32-128 px textures + the Thai sign atlas
    math.js               scalars, springs, mat4
  core/
    Input.js              keyboard/mouse, pointer lock with a free-look fallback
    CollisionWorld.js     AABB world: circle movement, ray casts, sight lines, capsule tests
    AudioSystem.js        synthesised placeholder audio (one named cue per sound)
    Effects.js            muzzle flash, tracers, sparks, blood, casings, decals, glows
    PropPhysics.js        the few props that react (cans, bottles, stools, boxes)
  components/
    HealthComponent.js
    HitReaction.js        flinch / stagger / knockdown tiers from stagger power + knockback
    Interactable.js
  characters/
    CharacterRig.js       shared skeleton + pose blending
    models.js             Lucia, pistol, infected (placeholder geometry)
  player/
    PlayerController.js   movement, stamina, health, procedural animation
    ThirdPersonCamera.js  shoulder boom, aim blend, wall collision, recoil
  weapons/
    WeaponController.js   trigger, magazine, reload, sway, spread, recoil
    HitscanWeapon.js      camera ray -> muzzle ray, zones, falloff, pellets
  enemies/
    EnemyController.js    idle / notice / chase / attack / stagger / down / dead
    NavGrid.js            auto-generated A* lattice
  level/
    LevelManager.js       the block: layout, signs, lights, spawns, pickups, mini-map data
    Kit.js                modular pieces: shophouse, vehicles, poles, props
  ui/HUD.js
  data/
    weapons.js            every weapon number (pistol live; shotgun/rifle shape noted)
    enemies.js            senses, attack timings, hit zones, reaction thresholds
    player.js             speeds, stamina, camera booms
```

## Tuning

Almost everything worth feeling out is a number in `src/data/`.

- **Shooting feel:** `weapons.js` — `recoil`, `sway`, `spread`, `fireInterval`, `stagger`, `knockback`.
- **Lethality:** `damage` and `zoneDamage` in `weapons.js`; `health` per spawn in `LevelManager._dynamic()`.
- **Scarcity:** `PLAYER.start` in `player.js` and the `pickups` list in `LevelManager._dynamic()`.
- **Enemy pressure:** `speed.chase`, `attack.*` and `senses.*` in `enemies.js`.
- **Camera:** `CAMERA.explore` / `CAMERA.aim` in `player.js`.

## Adding a weapon

1. Add an entry to `WEAPONS` in `src/data/weapons.js` (the pistol entry documents every field;
   `pellets > 1` already works, and pellets that hit one enemy are summed into a single hit reaction).
2. Give it a model in `characters/models.js` and an icon in `index.html`.
3. Call `weapon.equip('your_id')`. Reaction tiers scale from `stagger`/`knockback` automatically:
   total power >= 1.8 staggers, >= 3.2 knocks down (see `data/enemies.js`).

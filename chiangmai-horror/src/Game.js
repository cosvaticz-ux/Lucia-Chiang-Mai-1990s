// Wires the systems together and owns the frame loop and game rules
// (pickups, the gate objective, win/lose, restart).

import { Renderer, material } from './engine/Renderer.js';
import { Node } from './engine/Node.js';
import { buildTextures } from './engine/Textures.js';
import { clamp, damp, DEG } from './engine/math.js';
import { Input } from './core/Input.js';
import { CollisionWorld } from './core/CollisionWorld.js';
import { AudioSystem } from './core/AudioSystem.js';
import { Effects } from './core/Effects.js';
import { PropPhysics } from './core/PropPhysics.js';
import { Interactable, InteractableSystem } from './components/Interactable.js';
import { buildLucia, buildInfected } from './characters/models.js';
import { PlayerController } from './player/PlayerController.js';
import { ThirdPersonCamera } from './player/ThirdPersonCamera.js';
import { WeaponController } from './weapons/WeaponController.js';
import { EnemyController } from './enemies/EnemyController.js';
import { LevelManager } from './level/LevelManager.js';
import { HUD } from './ui/HUD.js';
import { PLAYER, CAMERA } from './data/player.js';
import { ENEMY_TYPES, INFECTED_LOOKS } from './data/enemies.js';
import { AMMO_TYPES } from './data/weapons.js';
import { makeRng } from './engine/math.js';

const PROP_SHAPES = {
  stool: { radius: 0.17, half: 0.21, mass: 1.6, pitch: 0.6, restitution: 0.3 },
  bottle: { radius: 0.05, half: 0.12, mass: 0.5, pitch: 1.5, restitution: 0.35 },
  can: { radius: 0.05, half: 0.06, mass: 0.3, pitch: 1.9, restitution: 0.45 },
  box: { radius: 0.2, half: 0.13, mass: 1.2, pitch: 0.45, restitution: 0.15, tip: false },
  bucket: { radius: 0.14, half: 0.14, mass: 0.8, pitch: 0.8, restitution: 0.35 },
};

const PICKUP_TEXT = {
  ammo: (n) => `Handgun Ammo (${n})`,
  herb: () => 'Green Herb',
  spray: () => 'First Aid Spray',
  key: () => 'Gate Key',
};

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.textures = buildTextures(this.renderer);
    this.input = new Input(canvas);
    this.audio = new AudioSystem();
    this.world = new CollisionWorld();
    this.root = new Node();
    this.effects = new Effects(this.renderer, this.textures, this.root);
    this.level = new LevelManager(this.renderer, this.textures, this.world, this.effects, this.root).build();
    this.scene = this.level.scene;
    this.hud = new HUD();
    this.hud.buildMap(this.level.minimap);
    this.charMat = material({});
    this.camera = new ThirdPersonCamera(this.world, CAMERA);
    this.props = new PropPhysics(this.world, this.audio);
    this.interactables = new InteractableSystem();
    this.muzzleLight = { x: 0, y: 0, z: 0, range: 10, r: 1, g: 0.78, b: 0.46, intensity: 0, on: true, shadow: false };
    this.scene.lights.push(this.muzzleLight);
    this.settings = { height: 480, shadows: true, grain: true };
    this.state = 'title';
    this.time = 0;
    this.runTime = 0;
    this.last = 0;
    this.fps = 60;
    this.enemies = [];
    this.pickupItems = [];
    this.propNodes = [];
    this.stats = { kills: 0, damageTaken: 0 };
    this.onState = null;
    this._titleAngle = 0;
    this._heart = 0;
    this._bodies = [];

    const rig = buildLucia(this.renderer, this.charMat);
    this.root.add(rig.root);
    this.player = new PlayerController({ world: this.world, input: this.input, camera: this.camera, audio: this.audio, rig, cfg: PLAYER });
    this.weapon = new WeaponController({ player: this.player, camera: this.camera, audio: this.audio, effects: this.effects, input: this.input });
    this.weapon.onFire = (x, z, radius) => this._gunshot(x, z, radius);
    this.weapon.onResult = (results) => {
      for (const r of results) if (r.killed) this.stats.kills++;
    };
    this.player.onHurt = (amount) => { this.stats.damageTaken = Math.min(this.stats.damageTaken + amount, 9999); };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.setState('paused'); });

    this.input.onLockLost = () => { if (this.state === 'playing') this.setState('paused'); };
    this.input.onFallback = () => this.hud.say('Mouse capture is unavailable here. Move the pointer to the screen edges to turn.', 6);

    this.resetRun();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.root.updateWorld(null, false);
  }

  // ----------------------------------------------------------------------
  /** Put every dynamic thing back to its starting state. */
  resetRun() {
    const L = this.level, p = this.player;
    for (const e of this.enemies) this.root.remove(e.rig.root);
    for (const it of this.pickupItems) this._removePickup(it, true);
    for (const n of this.propNodes) this.root.remove(n);
    this.enemies = [];
    this.pickupItems = [];
    this.propNodes = [];
    this.props.props.length = 0;
    this.interactables.items.length = 0;
    this.effects.decals.length = 0;
    this.effects._decalsDirty = true;

    // Lucia
    p.health.reset();
    p.teleport(L.spawn.x, L.spawn.z, Math.PI);
    p.stamina = PLAYER.stamina.max;
    p.exertion = 0;
    p.items.spray = PLAYER.items.spray.start;
    p.items.herb = PLAYER.items.herb.start;
    p.hasKey = false;
    p.deadTime = 0;
    p.stance = 0;
    p.aimPose = 0;
    p.rig.root.visible = true;
    this.camera.yaw = L.spawn.yaw;
    this.camera.pitch = -0.03;
    this.weapon.mag = PLAYER.start.mag;
    this.weapon.reserve = { [this.weapon.cfg.ammoType]: PLAYER.start.reserve };
    this.weapon.reloadT = -1;
    this.weapon.stats = { shots: 0, hits: 0, headshots: 0 };
    this.stats = { kills: 0, damageTaken: 0 };
    this.runTime = 0;

    // Infected
    const rnd = makeRng(4242);
    L.enemySpawns.forEach((s, i) => {
      const rig = buildInfected(this.renderer, this.charMat, INFECTED_LOOKS[s.look % INFECTED_LOOKS.length], rnd);
      this.root.add(rig.root);
      this.enemies.push(new EnemyController({
        type: ENEMY_TYPES.infected, rig, spawn: s, world: this.world, nav: L.nav, audio: this.audio, effects: this.effects, id: i,
      }));
    });

    // Pickups
    for (const def of L.pickups) this._addPickup(def);

    // Loose props
    for (const def of L.props) {
      const shape = PROP_SHAPES[def.type];
      const node = L.makeModel(def.type, def.color);
      this.root.add(node);
      this.propNodes.push(node);
      const prop = this.props.add({ node, x: def.x, z: def.z, ...shape });
      if (def.y0) { prop.y = def.y0 + shape.half; prop.asleep = true; prop.restY = shape.half; prop.onShelf = def.y0; node.setPos(prop.x, prop.y, prop.z); }
    }

    // Gate
    const g = L.gate;
    g.open = false;
    g.t = 0;
    g.collider.enabled = true;
    g.lock.visible = true;
    g.leafL.ry = 0;
    g.leafR.ry = 0;
    this.interactables.add(new Interactable({
      x: g.x, z: g.z + 0.5, radius: 1.9, kind: 'gate',
      prompt: () => (p.hasKey ? 'Unlock the gate' : 'Examine the gate'),
      onInteract: (ctx, self) => {
        if (!p.hasKey) {
          this.audio.play('deny');
          this.hud.say('Chained and padlocked. The caretaker kept a key somewhere off the back lane.');
          this.hud.setObjective('Find the gate key');
          return;
        }
        L.openGate();
        self.enabled = false;
        this.audio.play('gate', { pos: { x: g.x, z: g.z } });
        this.hud.say('The padlock gives. The gate swings open.');
        this.hud.setObjective('Leave through the gate');
      },
    }));
    this.hud.setObjective('Reach the gate at the end of the lane');
    this.hud.messages.length = 0;
  }

  _addPickup(def) {
    const L = this.level;
    const node = L.makeModel(def.type);
    node.setPos(def.x, def.y, def.z);
    node.ry = (def.x * 7 + def.z * 3) % 6.28;
    this.root.add(node);
    const glint = this.effects.addGlow({ x: def.x, y: def.y + 0.16, z: def.z, size: 0.2, r: 1, g: 0.95, b: 0.8, a: 0.8, pulse: 3.2 });
    const item = { def, node, glint, taken: false, it: null };
    item.it = this.interactables.add(new Interactable({
      x: def.x, z: def.z, radius: 1.45, kind: 'pickup',
      prompt: `Take ${PICKUP_TEXT[def.type](def.amount)}`,
      onInteract: () => this._take(item),
    }));
    this.pickupItems.push(item);
  }

  _removePickup(item, silent) {
    if (item.taken && !silent) return;
    item.taken = true;
    this.root.remove(item.node);
    this.effects.removeGlow(item.glint);
    this.interactables.remove(item.it);
  }

  _take(item) {
    const { def } = item, p = this.player;
    if (def.type === 'ammo') {
      this.weapon.addAmmo('9mm', def.amount);
      this.hud.say(`Took ${AMMO_TYPES['9mm'].name} x${def.amount}.`);
    } else if (def.type === 'herb') {
      p.items.herb++;
      this.hud.say('Took a Green Herb. Press 2 to use it.');
    } else if (def.type === 'spray') {
      p.items.spray++;
      this.hud.say('Took a First Aid Spray. Press 1 to use it.');
    } else if (def.type === 'key') {
      p.hasKey = true;
      this.hud.say('Took the Gate Key.');
      this.hud.setObjective('Unlock the gate at the end of the lane');
    }
    this.audio.play('pickup');
    this._removePickup(item, false);
  }

  _gunshot(x, z, radius) {
    for (const e of this.enemies) {
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      // Walls muffle a shot, but not by much.
      const clear = this.world.lineClear(x, 1.4, z, e.pos.x, 1.4, e.pos.z);
      if (d < radius * (clear ? 1 : 0.65)) e.hear(x, z);
    }
  }

  // ----------------------------------------------------------------------
  setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (s === 'playing') {
      this.audio.init();
      this.audio.resume();
      this.input.capture();
      this.hud.show(true);
    } else {
      this.input.release();
      if (s === 'paused') this.audio.suspend();
      this.hud.show(s === 'paused');
    }
    if (this.onState) this.onState(s);
  }

  start() {
    if (this.state === 'dead' || this.state === 'won') this.resetRun();
    this.setState('playing');
  }

  restart() {
    this.resetRun();
    this.setState('playing');
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetH = this.settings.height === 0 ? Math.round(h * dpr) : Math.min(this.settings.height, Math.round(h * dpr));
    const targetW = Math.max(2, Math.round((targetH * w) / Math.max(1, h)));
    this.renderer.setSize(targetW, targetH);
    this.viewW = w;
    this.viewH = h;
  }

  applySettings() {
    this.renderer.shadowsEnabled = this.settings.shadows;
    this.renderer.ditherLevels = this.settings.height === 0 ? 0 : 40;
    const grain = document.getElementById('grain');
    if (grain) grain.hidden = !this.settings.grain;
    this.resize();
  }

  /** Results screen numbers. */
  summary() {
    const w = this.weapon.stats;
    return {
      time: this.runTime,
      shots: w.shots,
      hits: w.hits,
      headshots: w.headshots,
      accuracy: w.shots ? Math.round((w.hits / w.shots) * 100) : 0,
      kills: this.stats.kills,
      total: this.enemies.length,
      damage: Math.round(this.stats.damageTaken),
      ammoLeft: this.weapon.mag + this.weapon.reserveAmmo,
    };
  }

  // ----------------------------------------------------------------------
  run() {
    const frame = (now) => {
      const dt = clamp((now - this.last) / 1000 || 0.016, 0.001, 0.05);
      this.last = now;
      this.fps = damp(this.fps, 1 / dt, 2, dt);
      this.step(dt);
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  step(dt) {
    this.time += dt;
    const playing = this.state === 'playing';
    if (playing || this.state === 'dead') this.update(dt, playing);
    else if (this.state === 'title' || this.state === 'won') this.idleCamera(dt);
    this.level.update(this.state === 'paused' ? 0 : dt, this.camera);
    this.effects.update(this.state === 'paused' ? 0 : dt, this.camera, this.time);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  /** Slow drift over Lucia's shoulder behind the title card. */
  idleCamera(dt) {
    const p = this.player, cam = this.camera;
    this._titleAngle += dt;
    cam.yaw = this.level.spawn.yaw + Math.sin(this._titleAngle * 0.13) * 0.16;
    cam.pitch = -0.02 + Math.sin(this._titleAngle * 0.09) * 0.03;
    p.update(dt, this.weapon, false);
    cam.update(dt, p.pos.x, p.pos.z, false, 0);
    this.weapon.update(dt, null, false);
    for (const e of this.enemies) { e.time += dt; e._animate(dt, p); }
    this._shadows(dt);
  }

  update(dt, playing) {
    const { input, player: p, camera: cam, weapon, level: L } = this;
    if (playing) this.runTime += dt;

    if (playing) {
      const look = input.consumeLook(dt);
      cam.look(look.dx, look.dy, p.aiming);
      if (input.pressed('Escape') || input.pressed('KeyP')) { this.setState('paused'); return; }
      if (input.pressed('KeyM')) this.audio.setMuted(!this.audio.muted);
    }

    p.update(dt, weapon, playing);
    cam.update(dt, p.pos.x, p.pos.z, p.aiming && !p.dead, p.sprintBlend);
    const ctx = { world: this.world, enemies: this.enemies, props: this.props, effects: this.effects, audio: this.audio, time: this.time, player: p };
    weapon.update(dt, ctx, playing && !p.dead);

    for (const e of this.enemies) e.update(dt, ctx);
    this._separate();

    // Props get shoved by anything alive.
    const bodies = this._bodies;
    bodies.length = 0;
    bodies.push({ x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z, radius: p.radius });
    for (const e of this.enemies) if (!e.dead) bodies.push({ x: e.pos.x, z: e.pos.z, vx: e.vel.x, vz: e.vel.z, radius: e.radius });
    this.props.update(dt, bodies);
    for (const pr of this.props.props) {
      // Things knocked off a table fall to the floor.
      if (pr.onShelf && !pr.asleep) pr.onShelf = 0;
      if (pr.onShelf) pr.y = pr.onShelf + pr.half;
    }

    // Interaction and items.
    if (playing && !p.dead) {
      const focus = this.interactables.update(p.pos.x, p.pos.z, cam.fx, cam.fz);
      if (focus && input.pressed('KeyE')) this.interactables.interact(ctx);
      if (p.pendingItem) {
        const res = p.useItem(p.pendingItem);
        const name = p.pendingItem === 'spray' ? 'First Aid Spray' : 'Green Herb';
        if (res === 'none') { this.hud.say(`No ${name}.`, 1.6); this.audio.play('deny'); }
        else if (res === 'full') this.hud.say('Health is already full.', 1.6);
        else this.hud.say(`Used ${name}.`, 1.8);
        p.pendingItem = null;
      }
    }

    // Enemies become known to the map once Lucia has a clear look at them.
    for (const e of this.enemies) {
      if (e.seen || e.dead) continue;
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (d < 22 && e.canSee) {
        const facing = ((e.pos.x - cam.x) * cam.fx + (e.pos.z - cam.z) * cam.fz) / (Math.hypot(e.pos.x - cam.x, e.pos.z - cam.z) || 1);
        if (facing > 0.6 || e.alerted) e.seen = true;
      }
    }

    // Muzzle flash light.
    const ml = this.muzzleLight;
    ml.intensity = weapon.muzzleLight * weapon.cfg.muzzleFlash.light;
    if (weapon.muzzlePos) { ml.x = weapon.muzzlePos[0]; ml.y = weapon.muzzlePos[1]; ml.z = weapon.muzzlePos[2]; }

    p.rig.root.visible = !cam.tooClose;
    this._shadows(dt);

    // Audio.
    this.audio.setListener(cam.x, cam.z, cam.yaw);
    this.audio.update(dt, L.humPos);
    if (!p.dead && p.health.ratio < 0.35) {
      this._heart -= dt;
      if (this._heart <= 0) { this._heart = 0.75 + p.health.ratio; this.audio.play('heartbeat'); }
    }

    this._hud(dt);

    // Outcomes.
    if (playing && p.dead && p.deadTime > 0.1) this.setState('dead');
    if (playing && !p.dead && p.pos.z < L.exitZ) this.setState('won');
  }

  /** Soft body-to-body collision so nobody overlaps. */
  _separate() {
    const p = this.player, es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.dead || a.fall > 0.5) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.dead || b.fall > 0.5) continue;
        this._push(a.pos, b.pos, a.radius + b.radius, 0.5);
      }
      if (!p.dead) this._push(p.pos, a.pos, p.radius + a.radius, 0.6);
      this.world.resolveCircle(a.pos, a.radius);
    }
    this.world.resolveCircle(p.pos, p.radius);
  }

  _push(a, b, minDist, shareA) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minDist * minDist) return;
    const d = Math.sqrt(d2) || 0.001;
    const push = minDist - d;
    const nx = dx / d, nz = dz / d;
    a.x -= nx * push * shareA; a.z -= nz * push * shareA;
    b.x += nx * push * (1 - shareA); b.z += nz * push * (1 - shareA);
  }

  /** Aim each character's planar shadow away from the light that dominates it. */
  _shadows(dt) {
    const lights = this.scene.lights;
    const apply = (rig, x, z) => {
      let best = null, bs = 0;
      for (const L of lights) {
        if (!L.on || L.shadow === false) continue;
        const d = Math.hypot(L.x - x, L.y - 1, L.z - z);
        if (d >= L.range) continue;
        const k = 1 - d / L.range;
        const sc = L.intensity * k * k;
        if (sc > bs) { bs = sc; best = L; }
      }
      const s = rig.shadow;
      s.cx = x; s.cz = z;
      if (best) {
        s.lx = damp(s.lx, best.x, 5, dt);
        s.lz = damp(s.lz, best.z, 5, dt);
        s.ly = damp(s.ly, Math.max(best.y, 2.5), 5, dt);
      }
      s.strength = damp(s.strength, clamp(bs * 1.3, 0, 0.62), 4, dt);
      s.radius = 5.5;
    };
    apply(this.player.rig, this.player.pos.x, this.player.pos.z);
    for (const e of this.enemies) apply(e.rig, e.pos.x, e.pos.z);
  }

  _hud(dt) {
    const p = this.player, w = this.weapon, cam = this.camera, L = this.level;
    // Reticle offset in CSS pixels from the same angles the bullet uses.
    const focal = this.viewH / 2 / Math.tan(cam.fov / 2);
    const show = !p.dead && (cam.aim > 0.5 || p.stance > 0) && w.reloadProgress < 0;
    const enemies = [];
    for (const e of this.enemies) if (!e.dead && e.seen) enemies.push({ x: e.pos.x, z: e.pos.z });
    const pickups = [];
    for (const it of this.pickupItems) {
      if (!it.taken && Math.hypot(it.def.x - p.pos.x, it.def.z - p.pos.z) < 9) pickups.push({ x: it.def.x, z: it.def.z });
    }
    const focus = this.interactables.focus;
    this.hud.update({
      dt,
      health: p.health.ratio,
      stamina: p.stamina / PLAYER.stamina.max,
      mag: w.mag,
      reserve: w.reserveAmmo,
      magSize: w.cfg.magSize,
      reloading: w.reloadProgress >= 0,
      items: p.items,
      hasKey: p.hasKey,
      reticle: {
        show,
        x: Math.tan(w.swayX) * focal,
        y: -Math.tan(w.swayY) * focal,
        gap: Math.max(3, Math.tan(w.spreadDeg * DEG) * focal + 2),
        steady: p.holdingBreath,
      },
      prompt: focus && !p.dead ? focus.label : '',
      hurt: p.hurtFlash,
      lowHealth: !p.dead && p.health.ratio < 0.35,
      map: {
        px: p.pos.x, pz: p.pos.z, yaw: cam.yaw, time: this.time, enemies, pickups,
        goal: p.hasKey || L.gate.open ? { x: L.gate.x, z: L.gate.z } : null,
      },
    });
  }
}

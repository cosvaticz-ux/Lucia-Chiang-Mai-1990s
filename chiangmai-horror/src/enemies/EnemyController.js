// Infected: idle -> notice -> chase -> attack, with stagger / knockdown / death
// driven by HitReaction. Movement, senses and timings come from data/enemies.js.

import { clamp, damp, dampAngle, lerp, saturate, wrapAngle, DEG } from '../engine/math.js';
import { clearPose } from '../characters/CharacterRig.js';
import { HealthComponent } from '../components/HealthComponent.js';
import { HitReaction } from '../components/HitReaction.js';
import { rayCapsule, raySphere, SIGHT } from '../core/CollisionWorld.js';

const TAU = Math.PI * 2;
const _a = [0, 0, 0], _b = [0, 0, 0];

/** Distance from a point to the segment a-b. */
function segDist(px, py, pz, a, b) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / (bx * bx + by * by + bz * bz || 1)));
  return Math.hypot(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t);
}

export class EnemyController {
  constructor({ type, rig, spawn, world, nav, audio, effects, id }) {
    this.cfg = type;
    this.rig = rig;
    this.world = world;
    this.nav = nav;
    this.audio = audio;
    this.effects = effects;
    this.id = id;
    this.pos = { x: spawn.x, z: spawn.z };
    this.home = { x: spawn.x, z: spawn.z };
    this.vel = { x: 0, z: 0 };
    this.yaw = spawn.yaw;
    this.radius = type.radius;
    this.speedScale = spawn.speed || 1;
    this.wanders = !!spawn.wander;
    this.health = new HealthComponent(spawn.health || type.health);
    this.reaction = new HitReaction(type.reaction);
    this.state = 'idle';
    this.stateTime = 0;
    this.alerted = false;
    this.seen = false; // has Lucia had a clear view of it (for the map)
    this.lastKnown = { x: spawn.x, z: spawn.z };
    this.sinceSensed = 99;
    this.senseTimer = Math.random() * 0.2;
    this.canSee = false;
    this.path = null;
    this.pathIndex = 0;
    this.repath = 0;
    this.goal = { x: spawn.x, z: spawn.z };
    this.phase = Math.random() * TAU;
    this.time = Math.random() * 10;
    this.voice = 2 + Math.random() * 6;
    this.attackPhase = 'none';
    this.attackCooldown = 0;
    this.didHit = false;
    this.fallDir = -1; // -1 onto its back, +1 face down
    this.fall = 0; // 0 standing .. 1 on the ground
    this.downTimer = 0;
    this.deadTime = 0;
    this.wanderTimer = 1 + Math.random() * 3;
    this.wanderGoal = null;
    this.speed = 0;
    this.pitchSeed = 0.85 + Math.random() * 0.4;
    this._bled = false;
    this._thud = false;
    this.rig.root.setPos(this.pos.x, 0, this.pos.z);
    this.rig.root.ry = this.yaw;
    this._animate(0, null);
    this.rig.snap();
  }

  get dead() {
    return this.health.dead;
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  /** A loud event (gunshot) at a position. */
  hear(x, z) {
    if (this.dead) return;
    this.lastKnown.x = x;
    this.lastKnown.z = z;
    this.sinceSensed = 0;
    if (this.state === 'idle' || this.state === 'search') {
      this.alerted = true;
      this.setState('notice');
      this.audio.play('groan', { pos: this.pos, pitch: this.pitchSeed });
    }
  }

  /** Bullet test against the animated body. Returns { t, zone } or null. */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const z = this.cfg.zones, rig = this.rig;
    // Quick reject against a bounding sphere around the torso.
    rig.spine.worldPoint(_a, 0, 0.1, 0);
    const lx = _a[0] - ox, ly = _a[1] - oy, lz = _a[2] - oz;
    const along = lx * dx + ly * dy + lz * dz;
    if (along < -1.5 || along > maxT + 1.5) return null;
    const perp2 = lx * lx + ly * ly + lz * lz - along * along;
    if (perp2 > 1.5 * 1.5) return null;

    // A shot that starts inside a zone (muzzle pressed into the target) still hits.
    let best = maxT, zone = null;
    rig.head.worldPoint(_a, 0, 0.14, 0);
    if (Math.hypot(ox - _a[0], oy - _a[1], oz - _a[2]) < z.headRadius) return { t: 0, zone: 'head' };
    // The head is tested first and wins outright: a round through the skull
    // should never be credited to the shoulders behind it.
    let t = raySphere(ox, oy, oz, dx, dy, dz, _a[0], _a[1], _a[2], z.headRadius);
    if (t >= 0 && t < best) return { t, zone: 'head' };
    rig.hips.worldPoint(_a, 0, 0.04, 0);
    rig.head.worldPoint(_b, 0, -0.2, 0);
    if (segDist(ox, oy, oz, _a, _b) < z.torsoRadius) return { t: 0, zone: 'torso' };
    t = rayCapsule(ox, oy, oz, dx, dy, dz, _a[0], _a[1], _a[2], _b[0], _b[1], _b[2], z.torsoRadius);
    if (t >= 0 && t < best) { best = t; zone = 'torso'; }
    for (const side of ['L', 'R']) {
      rig['leg' + side].worldPoint(_a, 0, -0.1, 0);
      rig['shin' + side].worldPoint(_b, 0, -0.42, 0);
      t = rayCapsule(ox, oy, oz, dx, dy, dz, _a[0], _a[1], _a[2], _b[0], _b[1], _b[2], z.legRadius * 0.62);
      if (t >= 0 && t < best) { best = t; zone = 'legs'; }
    }
    return zone ? { t: best, zone } : null;
  }

  /** hit: { damage, power, knockback, zone, x,y,z, dirX,dirY,dirZ, time } */
  onHit(hit) {
    if (this.dead) return { killed: false, tier: null };
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const hl = Math.hypot(hit.dirX, hit.dirZ) || 1;
    const hx = hit.dirX / hl, hz = hit.dirZ / hl;
    const front = -(hx * fx + hz * fz); // +1 when shot from the front
    const side = clamp(((hit.x - this.pos.x) * fz - (hit.z - this.pos.z) * fx) / 0.25, -1, 1);
    const tier = this.reaction.apply({ zone: hit.zone, power: hit.power, knockback: hit.knockback, dirX: hx, dirZ: hz, front, side });
    this.alerted = true;
    this.sinceSensed = 0;
    this.fallDir = front >= 0 ? -1 : 1;
    const killed = this.health.damage(hit.damage, { time: hit.time, zone: hit.zone });
    if (killed) {
      // Death throws the body harder along the shot.
      this.reaction.vx += hx * hit.knockback * 0.9;
      this.reaction.vz += hz * hit.knockback * 0.9;
      this.setState('dead');
      this.attackPhase = 'none';
      this.audio.play('snarl', { pos: this.pos, pitch: this.pitchSeed * 0.8 });
      return { killed: true, tier: 'death' };
    }
    if (tier === 'knockdown') {
      this.setState('down');
      this.downTimer = this.cfg.reaction.knockdownTime;
      this.attackPhase = 'none';
    } else if (tier === 'stagger') {
      if (this.state !== 'down' && this.state !== 'getup') this.setState('stagger');
      this.attackPhase = 'none';
      this.audio.play('snarl', { pos: this.pos, pitch: this.pitchSeed });
    } else if (this.state === 'attack' && this.attackPhase === 'windup') {
      // Even a body shot breaks a wind-up: one bullet buys breathing room.
      this.attackPhase = 'none';
      this.attackCooldown = 0.6;
      this.setState('chase');
    } else if (this.state === 'idle' || this.state === 'notice' || this.state === 'search') {
      this.setState('chase');
    }
    return { killed: false, tier };
  }

  // ----------------------------------------------------------------------
  _sense(player) {
    const s = this.cfg.senses;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const los = this.world.lineClear(this.pos.x, 1.55, this.pos.z, player.pos.x, 1.25, player.pos.z, SIGHT);
    this.canSee = los;
    if (player.dead) return false;
    if (d < 1.2) return true;
    if (los && d < s.proximity) return true;
    if (los && d < s.viewDist) {
      const facing = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (d || 1);
      // Once alerted they keep track of Lucia all around.
      if (this.alerted || facing > Math.cos((s.viewAngle * DEG) / 2)) return true;
    }
    const hear = player.noise === 3 ? s.hearSprint : player.noise === 2 ? s.hearRun : player.noise === 1 ? s.hearWalk : 0;
    if (hear > 0 && d < hear * (los ? 1 : 0.6)) return true;
    return false;
  }

  _steer(dt, tx, tz, speed) {
    const w = this.world, r = this.radius;
    // Straight line if nothing is in the way, otherwise follow the nav path.
    let gx = tx, gz = tz;
    if (!w.sweepClear(this.pos.x, this.pos.z, tx, tz, r * 0.9)) {
      this.repath -= dt;
      if (!this.path || this.repath <= 0) {
        this.path = this.nav.path(this.pos.x, this.pos.z, tx, tz);
        this.pathIndex = 0;
        this.repath = 0.5 + Math.random() * 0.3;
      }
      if (this.path) {
        // Skip ahead to the furthest waypoint we can walk straight to.
        const p = this.path;
        let i = Math.min(this.pathIndex, p.length - 1);
        for (let k = Math.min(p.length - 1, i + 3); k > i; k--) {
          if (w.sweepClear(this.pos.x, this.pos.z, p[k].x, p[k].z, r * 0.9)) { i = k; break; }
        }
        while (i < p.length - 1 && Math.hypot(p[i].x - this.pos.x, p[i].z - this.pos.z) < 0.5) i++;
        this.pathIndex = i;
        gx = p[i].x; gz = p[i].z;
      }
    } else this.path = null;
    this.goal.x = gx; this.goal.z = gz;

    const dx = gx - this.pos.x, dz = gz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this._move(dt, 0); return d; }
    const want = Math.atan2(dx, dz);
    this.yaw = wrapAngle(dampAngle(this.yaw, want, this.cfg.turnRate, dt));
    const align = Math.max(0, Math.cos(wrapAngle(want - this.yaw)));
    // Lurching gait: speed surges on each step.
    const lurch = 0.62 + 0.55 * Math.max(0, Math.sin(this.phase * 2 + 0.6));
    this._move(dt, speed * align * align * lurch * this.reaction.moveScale);
    return d;
  }

  _move(dt, speed) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.vel.x = damp(this.vel.x, fx * speed, 9, dt);
    this.vel.z = damp(this.vel.z, fz * speed, 9, dt);
  }

  _faceTowards(dt, x, z, rate) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw = wrapAngle(dampAngle(this.yaw, want, rate, dt));
    return Math.abs(wrapAngle(want - this.yaw));
  }

  update(dt, ctx) {
    const { player } = ctx;
    const c = this.cfg;
    this.time += dt;
    this.stateTime += dt;
    this.reaction.update(dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.dead) {
      this.deadTime += dt;
      this.fall = Math.min(1, this.fall + dt / 0.75);
      this._move(dt, 0);
      this._integrate(dt);
      if (!this._thud && this.fall > 0.8) { this._thud = true; this.audio.play('bodyFall', { pos: this.pos }); }
      if (!this._bled && this.deadTime > 1.1) {
        this._bled = true;
        const bx = this.pos.x + Math.sin(this.yaw) * 1.1 * this.fallDir, bz = this.pos.z + Math.cos(this.yaw) * 1.1 * this.fallDir;
        this.effects.bloodPool(bx, bz, 0.55 + Math.random() * 0.2);
      }
      this._animate(dt, player);
      return;
    }

    // Senses run a few times a second, staggered between enemies.
    this.senseTimer -= dt;
    this.sinceSensed += dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.14;
      if (this._sense(player)) {
        this.sinceSensed = 0;
        this.lastKnown.x = player.pos.x;
        this.lastKnown.z = player.pos.z;
      }
    }
    const sensed = this.sinceSensed < 0.2;
    const px = player.pos.x, pz = player.pos.z;
    const dist = Math.hypot(px - this.pos.x, pz - this.pos.z);

    switch (this.state) {
      case 'idle': {
        if (sensed) {
          this.alerted = true;
          this.setState('notice');
          this.audio.play('groan', { pos: this.pos, pitch: this.pitchSeed });
          break;
        }
        if (this.wanders) {
          this.wanderTimer -= dt;
          if (this.wanderTimer <= 0) {
            this.wanderTimer = 3 + Math.random() * 5;
            const a = Math.random() * TAU, d = 1 + Math.random() * 2.2;
            const gx = this.home.x + Math.sin(a) * d, gz = this.home.z + Math.cos(a) * d;
            this.wanderGoal = this.world.sweepClear(this.pos.x, this.pos.z, gx, gz, this.radius) ? { x: gx, z: gz } : null;
          }
          if (this.wanderGoal) {
            if (this._steer(dt, this.wanderGoal.x, this.wanderGoal.z, c.speed.wander) < 0.3) this.wanderGoal = null;
          } else this._move(dt, 0);
        } else this._move(dt, 0);
        break;
      }
      case 'notice': {
        this._move(dt, 0);
        this._faceTowards(dt, this.lastKnown.x, this.lastKnown.z, 3.5);
        if (this.stateTime > c.senses.noticeTime) this.setState('chase');
        break;
      }
      case 'chase': {
        if (this.sinceSensed > c.senses.forgetTime) { this.setState('search'); break; }
        const tracking = this.sinceSensed < 1.5;
        const tx = tracking ? px : this.lastKnown.x, tz = tracking ? pz : this.lastKnown.z;
        this._steer(dt, tx, tz, c.speed.chase * this.speedScale);
        if (!player.dead && tracking && dist < c.attack.range && this.attackCooldown <= 0 && this.canSee) {
          const off = Math.abs(wrapAngle(Math.atan2(px - this.pos.x, pz - this.pos.z) - this.yaw));
          if (off < 0.9) {
            this.setState('attack');
            this.attackPhase = 'windup';
            this.didHit = false;
            this.audio.play('snarl', { pos: this.pos, pitch: this.pitchSeed * 1.1 });
          }
        }
        break;
      }
      case 'search': {
        const d = this._steer(dt, this.lastKnown.x, this.lastKnown.z, c.speed.search * this.speedScale);
        if (sensed) { this.setState('chase'); break; }
        if (d < 0.8 || this.stateTime > 12) {
          this.alerted = false;
          this.home.x = this.pos.x; this.home.z = this.pos.z;
          this.setState('idle');
        }
        break;
      }
      case 'attack': {
        const a = c.attack;
        if (this.attackPhase === 'windup') {
          this._move(dt, 0);
          this._faceTowards(dt, px, pz, 5);
          if (this.stateTime >= a.windup) {
            this.attackPhase = 'lunge';
            this.stateTime = 0;
            this.audio.play('swing', { pos: this.pos });
          }
        } else if (this.attackPhase === 'lunge') {
          const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
          this.vel.x = fx * a.lungeSpeed;
          this.vel.z = fz * a.lungeSpeed;
          if (!this.didHit && this.stateTime >= a.lunge * 0.5) {
            this.didHit = true;
            const ang = Math.abs(wrapAngle(Math.atan2(px - this.pos.x, pz - this.pos.z) - this.yaw));
            if (dist < a.reach && ang < (a.arc * DEG) / 2 + 0.2 && this.canSee) {
              if (player.takeHit(a.damage, fx, fz, ctx.time)) this.audio.play('hitFlesh', { pos: player.pos, gain: 0.8 });
            }
          }
          if (this.stateTime >= a.lunge) { this.attackPhase = 'recover'; this.stateTime = 0; }
        } else {
          this._move(dt, 0);
          if (this.stateTime >= a.recover) {
            this.attackPhase = 'none';
            this.attackCooldown = 0.25;
            this.setState('chase');
          }
        }
        break;
      }
      case 'stagger': {
        // Stumbling: no control, just the knockback and a few unsteady steps.
        this._move(dt, 0);
        if (this.reaction.tier !== 'stagger' && this.stateTime > 0.3) this.setState('chase');
        break;
      }
      case 'down': {
        this._move(dt, 0);
        this.fall = Math.min(1, this.fall + dt / 0.7);
        if (!this._thud && this.fall > 0.85) { this._thud = true; this.audio.play('bodyFall', { pos: this.pos }); }
        this.downTimer -= dt;
        if (this.downTimer <= 0) { this.setState('getup'); this._thud = false; }
        break;
      }
      case 'getup': {
        this._move(dt, 0);
        this.fall = Math.max(0, this.fall - dt / c.reaction.getupTime);
        if (this.fall <= 0) this.setState('chase');
        break;
      }
      default:
        break;
    }

    this._integrate(dt);

    // Voice.
    this.voice -= dt;
    if (this.voice <= 0) {
      const active = this.state === 'chase' || this.state === 'attack';
      this.voice = active ? 2.5 + Math.random() * 3.5 : 6 + Math.random() * 9;
      if (this.state !== 'down') this.audio.play('groan', { pos: this.pos, pitch: this.pitchSeed, gain: active ? 1 : 0.5 });
    }
    this._animate(dt, player);
  }

  _integrate(dt) {
    const r = this.reaction;
    this.pos.x += (this.vel.x + r.vx) * dt;
    this.pos.z += (this.vel.z + r.vz) * dt;
    this.world.resolveCircle(this.pos, this.radius);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }

  // ----------------------------------------------------------------------
  _animate(dt, player) {
    const rig = this.rig, t = rig.target, add = rig.add, r = this.reaction;
    clearPose(t);
    clearPose(add);
    rig.root.setPos(this.pos.x, 0, this.pos.z);
    rig.root.ry = this.yaw;
    const time = this.time;
    const spd = this.speed;
    const prev = this.phase;
    this.phase += dt * TAU * (spd / 1.15 + (this.state === 'stagger' ? 1.6 : 0));
    if (spd > 0.3 && Math.floor(this.phase / Math.PI) !== Math.floor(prev / Math.PI)) {
      this.audio.play('shuffle', { pos: this.pos, pitch: 0.8 + Math.random() * 0.4, gain: 0.7 });
    }
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const mv = saturate(spd / 0.6);
    const active = this.state === 'chase' || this.state === 'attack' || this.state === 'search';
    const reach = this.state === 'chase' ? saturate(1.6 - (player ? Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) / 4 : 9)) : 0;

    // Base: hunched, head hanging, uneven weight.
    const sway = Math.sin(time * 0.8 + this.id) * 0.06;
    t.hipsY = -0.05 - Math.abs(s) * 0.03 * mv;
    t.spineRx = 0.32 + (active ? 0.12 : 0) + Math.sin(time * 1.3 + this.id) * 0.03;
    t.spineRz = sway + s * 0.09 * mv;
    t.spineRy = s * 0.14 * mv;
    t.hipsRz = -s * 0.1 * mv;
    t.headRx = active ? -0.28 : 0.3;
    t.headRz = 0.22 + Math.sin(time * 0.55 + this.id * 2) * 0.1;
    t.headRy = Math.sin(time * 0.37 + this.id) * (active ? 0.1 : 0.35);
    // Dragging gait: the left leg does the work, the right trails.
    t.legLx = -s * 0.5 * mv - 0.08;
    t.legRx = s * 0.32 * mv + 0.05;
    t.shinLx = 0.18 + Math.max(0, c) * 0.7 * mv;
    t.shinRx = 0.12 + Math.max(0, -c) * 0.3 * mv;
    t.legLz = 0.05; t.legRz = -0.07;
    // Arms hang when idle and come up to grab as it closes in.
    const up = active ? 0.55 + reach * 0.5 : 0;
    t.armLx = lerp(0.1 + s * 0.2 * mv, -1.25 + s * 0.14, up);
    t.armRx = lerp(0.05 - s * 0.2 * mv, -0.95 - s * 0.14, up);
    t.armLz = 0.14; t.armRz = -0.2;
    t.foreLx = lerp(-0.25, -0.5, up);
    t.foreRx = lerp(-0.3, -0.75, up);

    if (this.state === 'notice') {
      const k = saturate(this.stateTime / 0.4);
      t.headRx = lerp(0.3, -0.35, k);
      t.spineRx = 0.2;
      t.armLx = -0.3 * k; t.armRx = -0.2 * k;
    }

    if (this.state === 'attack') {
      const a = this.cfg.attack;
      if (this.attackPhase === 'windup') {
        const k = saturate(this.stateTime / a.windup);
        t.spineRx = lerp(0.4, -0.18, k);
        t.armLx = lerp(-1.2, -2.5, k); t.armRx = lerp(-1.0, -2.35, k);
        t.armLz = 0.35; t.armRz = -0.35;
        t.foreLx = -0.7; t.foreRx = -0.8;
        t.headRx = -0.4;
      } else if (this.attackPhase === 'lunge') {
        t.spineRx = 0.75;
        t.armLx = -1.25; t.armRx = -1.1;
        t.foreLx = -0.15; t.foreRx = -0.2;
        t.legLx = -0.7; t.shinRx = 0.5;
        t.headRx = -0.5;
      } else {
        const k = saturate(this.stateTime / a.recover);
        t.spineRx = lerp(0.75, 0.4, k);
        t.armLx = lerp(-1.0, -0.4, k); t.armRx = lerp(-0.9, -0.3, k);
      }
    }

    if (this.state === 'stagger') {
      t.spineRx = -0.12;
      t.armLz = 0.75; t.armRz = -0.85;
      t.armLx = -0.5 + s * 0.4; t.armRx = -0.3 - s * 0.4;
      t.headRx = -0.35;
      t.legLx = -s * 0.5; t.legRx = s * 0.5;
      t.shinLx = 0.3 + Math.max(0, c) * 0.5; t.shinRx = 0.3 + Math.max(0, -c) * 0.5;
      t.hipsY = -0.1;
    }

    // Falling, lying and getting up share one parameter.
    if (this.fall > 0) {
      const f = this.fall;
      const e = f * f;
      const bounce = f > 0.85 ? Math.sin(((f - 0.85) / 0.15) * Math.PI) * 0.06 : 0;
      t.rootRx = this.fallDir * (Math.PI / 2 - 0.04) * e - this.fallDir * bounce;
      t.rootY = 0.13 * e;
      const buckle = Math.sin(Math.min(1, f * 1.3) * Math.PI);
      t.hipsY = -0.3 * buckle;
      t.spineRx = lerp(0.2, this.fallDir < 0 ? -0.1 : 0.15, e);
      t.shinLx = 0.25 + buckle * 0.9; t.shinRx = 0.1 + buckle * 0.6;
      t.legLx = -0.5 * buckle + (this.fallDir < 0 ? -0.15 : 0.05) * e; t.legRx = -0.2 * buckle;
      t.legLz = 0.12 * e; t.legRz = -0.2 * e;
      t.armLx = lerp(-0.6, this.fallDir < 0 ? -0.3 : -2.6, e);
      t.armRx = lerp(-0.4, this.fallDir < 0 ? -0.15 : -2.2, e);
      t.armLz = 0.3 + 0.9 * e; t.armRz = -0.3 - 0.6 * e;
      t.foreLx = -0.4; t.foreRx = -0.7;
      t.headRx = this.fallDir < 0 ? -0.3 * e : 0.2 * e;
      t.headRz = 0.35 * e; t.headRy = 0.5 * e;
      t.spineRz = 0.08 * e; t.spineRy = 0; t.hipsRz = 0;
    }

    // Spring-driven hit response on top of whatever the body is doing.
    add.spineRx = r.pitch.x;
    add.spineRy = r.twist.x;
    add.headRx = r.head.x * 0.7;
    add.hipsRx = r.pitch.x * 0.25;
    if (r.legSlow > 0 && this.fall === 0) {
      add.hipsY = -0.09;
      add.shinRx = 0.35;
    }
    rig.update(dt, this.state === 'attack' ? 20 : this.dead || this.fall > 0 ? 16 : 10);
  }
}

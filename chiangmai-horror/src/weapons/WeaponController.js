// Owns the equipped weapon: trigger, magazine, reload, aim sway, spread,
// recoil. Works with any entry in data/weapons.js; the pistol is the only one
// equipped for now.
//
// Accuracy model: there are no dice-roll misses. The reticle is the weapon's
// true line of fire. Sway moves the reticle on screen; spread is a small cone
// around it whose size the reticle gap shows.

import { DEG, damp, clamp, Spring } from '../engine/math.js';
import { HitscanWeapon } from './HitscanWeapon.js';
import { WEAPONS } from '../data/weapons.js';

export class WeaponController {
  constructor({ player, camera, audio, effects, input }) {
    this.player = player;
    this.camera = camera;
    this.audio = audio;
    this.effects = effects;
    this.input = input;
    this.reserve = {}; // ammoType -> rounds carried
    this.cooldown = 0;
    this.reloadT = -1;
    this.bloom = 0;
    this.swayAmp = 0;
    this.swayT = Math.random() * 10;
    this.aimTime = 0;
    this.swayX = 0; // radians, + right
    this.swayY = 0; // radians, + up
    this.kickX = new Spring(120, 13);
    this.kickY = new Spring(120, 13);
    this.armKick = new Spring(260, 20);
    this.muzzleLight = 0;
    this.dryFlash = 0;
    this.stats = { shots: 0, hits: 0, headshots: 0 };
    this.onFire = null; // (x, z, noiseRadius) => void
    this.onResult = null; // (results) => void
    this._reloadCue = 0;
    this.equip('service_pistol');
  }

  equip(id) {
    this.cfg = WEAPONS[id];
    this.weapon = new HitscanWeapon(this.cfg);
    this.mag = this.cfg.magSize;
    if (this.reserve[this.cfg.ammoType] === undefined) this.reserve[this.cfg.ammoType] = 0;
  }

  get reserveAmmo() {
    return this.reserve[this.cfg.ammoType] || 0;
  }

  addAmmo(type, n) {
    this.reserve[type] = (this.reserve[type] || 0) + n;
  }

  /** -1 when not reloading, otherwise 0..1. */
  get reloadProgress() {
    return this.reloadT < 0 ? -1 : this.reloadT / this.cfg.reloadTime;
  }

  /** Total cone half-angle in degrees right now. */
  get spreadDeg() {
    const s = this.cfg.spread, p = this.player;
    const aimed = this.camera.aim;
    const base = s.hip + (s.aimed - s.hip) * aimed;
    const move = s.moveAdd * clamp(p.speed / this.cfg.aim.moveSpeed, 0, 1.5);
    return base + move + this.bloom;
  }

  startReload() {
    if (this.reloadT >= 0 || this.mag >= this.cfg.magSize || this.reserveAmmo <= 0) return false;
    this.reloadT = 0;
    this._reloadCue = 0;
    return true;
  }

  update(dt, ctx, enabled) {
    const c = this.cfg, p = this.player, cam = this.camera, input = this.input;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - c.spread.bloomDecay * dt);
    this.muzzleLight = Math.max(0, this.muzzleLight - dt * 22);
    this.dryFlash = Math.max(0, this.dryFlash - dt * 3);
    this.kickX.update(dt);
    this.kickY.update(dt);
    this.armKick.update(dt);

    // --- Sway -------------------------------------------------------------
    const sw = c.sway;
    const raised = p.aiming || p.stance > 0;
    this.aimTime = raised ? this.aimTime + dt : 0;
    let amp = sw.base
      + sw.moveAdd * clamp(p.speed / c.aim.moveSpeed, 0, 1.6)
      + sw.exertionAdd * p.exertion
      + sw.injuredAdd * (1 - p.health.ratio)
      + sw.settleAdd * Math.exp(-this.aimTime / sw.settleTime);
    if (p.holdingBreath) amp *= sw.breathScale;
    else if (p.gasp > 0) amp *= sw.gaspScale;
    this.swayAmp = damp(this.swayAmp, amp, p.holdingBreath ? 9 : 5, dt);
    // Breathing drives the rhythm; exertion speeds it up.
    this.swayT += dt * sw.speed * (1 + p.exertion * 0.9) * (p.holdingBreath ? 0.45 : 1);
    const t = this.swayT;
    const nx = Math.sin(t * 1.13) * 0.55 + Math.sin(t * 2.71 + 1.3) * 0.3 + Math.sin(t * 4.9 + 0.7) * 0.15;
    const ny = Math.sin(t * 1.57 + 2.0) * 0.55 + Math.cos(t * 3.3) * 0.3 + Math.sin(t * 5.7 + 4.0) * 0.15;
    this.swayX = nx * this.swayAmp * DEG + this.kickX.x;
    this.swayY = ny * this.swayAmp * DEG + this.kickY.x;

    if (p.dead) return;

    // --- Reload -----------------------------------------------------------
    if (this.reloadT >= 0) {
      const before = this.reloadT / c.reloadTime;
      this.reloadT += dt;
      const now = this.reloadT / c.reloadTime;
      if (before < 0.14 && now >= 0.14) this.audio.play('magOut');
      if (before < c.reloadInsertAt && now >= c.reloadInsertAt) {
        const need = c.magSize - this.mag;
        const take = Math.min(need, this.reserveAmmo);
        this.mag += take;
        this.reserve[c.ammoType] -= take;
        this.audio.play('magIn');
      }
      if (before < 0.86 && now >= 0.86) this.audio.play('slide');
      if (now >= 1) this.reloadT = -1;
    }

    if (!enabled) return;
    if (input.pressed('KeyR')) this.startReload();

    // --- Trigger ----------------------------------------------------------
    const pull = c.fireMode === 'auto' ? input.mouse(0) : input.mousePressed(0);
    if (pull && this.cooldown <= 0 && this.reloadT < 0) {
      if (this.mag <= 0) {
        this.audio.play(c.audio.dry);
        this.dryFlash = 1;
        this.cooldown = 0.2;
      } else this._fire(ctx);
    }
  }

  _fire(ctx) {
    const c = this.cfg, p = this.player, cam = this.camera;
    // Firing without aiming snaps Lucia into a short hip-fire stance.
    if (!p.aiming) p.stance = 0.85;
    this.mag--;
    this.cooldown = c.fireInterval;
    this.stats.shots++;

    // Line of fire = view direction offset by the current sway.
    const tx = Math.tan(this.swayX), ty = Math.tan(this.swayY);
    let dx = cam.fx + cam.rx * tx + cam.ux * ty;
    let dy = cam.fy + cam.ry * tx + cam.uy * ty;
    let dz = cam.fz + cam.rz * tx + cam.uz * ty;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;

    // Muzzle position from the animated hand. If the arm has not come up yet
    // (snap shot), use where the muzzle will be so the tracer looks right.
    const rig = p.rig;
    const m = rig.foreR.worldPoint([0, 0, 0], rig.muzzleLocal[0], rig.muzzleLocal[1], rig.muzzleLocal[2]);
    if (p.aimPose < 0.6) {
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      m[0] = p.pos.x + sy * 0.55 - cy * 0.05;
      m[1] = 1.38 + cam.fy * 0.5;
      m[2] = p.pos.z + cy * 0.55 + sy * 0.05;
    }
    // Never let the muzzle start inside a wall Lucia is pressed against.
    const cx = p.pos.x, cyy = 1.3, cz = p.pos.z;
    const mdx = m[0] - cx, mdy = m[1] - cyy, mdz = m[2] - cz;
    const ml = Math.hypot(mdx, mdy, mdz) || 1;
    const wall = ctx.world.raycast(cx, cyy, cz, mdx / ml, mdy / ml, mdz / ml, ml, 2);
    if (wall) { m[0] = cx + (mdx / ml) * Math.max(0, wall.t - 0.06); m[1] = cyy + (mdy / ml) * Math.max(0, wall.t - 0.06); m[2] = cz + (mdz / ml) * Math.max(0, wall.t - 0.06); }

    const results = this.weapon.fire({
      ox: cam.x, oy: cam.y, oz: cam.z, dx, dy, dz, minT: cam.minRayT, spreadDeg: this.spreadDeg,
      mx: m[0], my: m[1], mz: m[2],
      rx: cam.rx, ry: cam.ry, rz: cam.rz, ux: cam.ux, uy: cam.uy, uz: cam.uz,
    }, ctx);
    for (const r of results) {
      if (r.type === 'enemy') {
        this.stats.hits++;
        if (r.zone === 'head') this.stats.headshots++;
      }
    }

    // Feedback.
    this.effects.muzzleFlash(m[0] + dx * 0.08, m[1] + dy * 0.08, m[2] + dz * 0.08, c.muzzleFlash.size);
    this.muzzleLight = 1;
    this.muzzlePos = m;
    this.audio.play(c.audio.fire, { pitch: 1 });
    this.audio.play('shell', { pos: p.pos, pitch: 0.9 + Math.random() * 0.2 });
    // Casing flips out to the right.
    this.effects.shell(m[0] - dx * 0.12, m[1], m[2] - dz * 0.12, cam.rx * 2.2 + dx * 0.4, 2.4 + Math.random(), cam.rz * 2.2 + dz * 0.4);

    const rc = c.recoil;
    const steady = p.holdingBreath ? 0.8 : 1;
    cam.kick(rc.pitch * DEG * steady, (Math.random() - 0.5) * 2 * rc.yaw * DEG, rc.recover, rc.returnRate);
    cam.addShake(rc.shake);
    this.kickX.kick((Math.random() - 0.5) * rc.swayKick);
    this.kickY.kick(rc.swayKick * (0.5 + Math.random() * 0.5));
    this.armKick.kick(rc.armKick * 22);
    this.bloom = Math.min(c.spread.bloomMax, this.bloom + c.spread.bloomPerShot);

    if (this.onFire) this.onFire(p.pos.x, p.pos.z, c.noiseRadius);
    if (this.onResult) this.onResult(results);
  }
}

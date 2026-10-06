// Lucia: camera-relative movement with real acceleration, three gaits,
// stamina, strafing aim walk, health, and a procedural animation layer.

import { clamp, damp, dampAngle, lerp, saturate, smoothstep, wrapAngle, Spring } from '../engine/math.js';
import { clearPose } from '../characters/CharacterRig.js';
import { HealthComponent } from '../components/HealthComponent.js';

const TAU = Math.PI * 2;

export class PlayerController {
  constructor({ world, input, camera, audio, rig, cfg }) {
    this.world = world;
    this.input = input;
    this.camera = camera;
    this.audio = audio;
    this.rig = rig;
    this.cfg = cfg;
    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.radius = cfg.radius;
    this.yaw = Math.PI; // facing; PI looks up the lane (-Z)
    this.health = new HealthComponent(cfg.health);
    this.stamina = cfg.stamina.max;
    this.staminaDelay = 0;
    this.exertion = 0; // 0..1, lingers after sprinting and unsteadies the aim
    this.mode = 'idle'; // idle | walk | run | sprint | aim
    this.walkToggle = false;
    this.aiming = false;
    this.stance = 0; // seconds left in the shoot-from-the-hip stance
    this.aimPose = 0; // 0..1 blend of the raised-weapon pose
    this.holdingBreath = false;
    this.gasp = 0;
    this.sprintBlend = 0;
    this.speed = 0;
    this.phase = 0;
    this.time = 0;
    this.noise = 0; // 0 silent, 1 walk, 2 run, 3 sprint
    this.items = { spray: cfg.items.spray.start, herb: cfg.items.herb.start };
    this.hasKey = false;
    this.pendingItem = null;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.flinch = new Spring(90, 10);
    this.ponySpring = new Spring(40, 5);
    this.lean = 0;
    this.deadTime = 0;
    this.onHurt = null;
    this.onStep = null;
    this._lastStep = 0;
    this._prevSpeed = 0;
  }

  get dead() {
    return this.health.dead;
  }

  teleport(x, z, yaw) {
    this.pos.x = x;
    this.pos.z = z;
    this.vel.x = this.vel.z = 0;
    this.yaw = yaw;
  }

  /** dir: world-space direction the blow travels in. */
  takeHit(amount, dirX, dirZ, time) {
    if (this.dead || this.invuln > 0) return false;
    this.invuln = 0.55;
    this.hurtFlash = 1;
    this.flinch.kick(6);
    this.vel.x += dirX * 3.2;
    this.vel.z += dirZ * 3.2;
    this.camera.addShake(0.07);
    this.audio.play('hurt');
    const before = this.health.hp;
    this.health.damage(amount, { time });
    if (this.onHurt) this.onHurt(before - this.health.hp);
    return true;
  }

  useItem(kind) {
    if (this.dead || this.items[kind] <= 0) return 'none';
    if (this.health.hp >= this.health.max) return 'full';
    this.items[kind]--;
    this.health.heal(this.cfg.items[kind].heal);
    this.audio.play('heal');
    return 'used';
  }

  /** weapon: WeaponController (for aim speed, reload progress, recoil kick). */
  update(dt, weapon, enabled) {
    const { input, camera, cfg } = this;
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    this.gasp = Math.max(0, this.gasp - dt);
    this.flinch.update(dt);

    if (this.dead) {
      this.deadTime += dt;
      this.vel.x = damp(this.vel.x, 0, 6, dt);
      this.vel.z = damp(this.vel.z, 0, 6, dt);
      this._integrate(dt);
      this.noise = 0;
      this._animate(dt, weapon);
      return;
    }

    // --- Intent ---------------------------------------------------------
    let ix = 0, iz = 0;
    if (enabled) {
      if (input.down('KeyW') || input.down('ArrowUp')) iz += 1;
      if (input.down('KeyS') || input.down('ArrowDown')) iz -= 1;
      if (input.down('KeyD') || input.down('ArrowRight')) ix += 1;
      if (input.down('KeyA') || input.down('ArrowLeft')) ix -= 1;
      if (input.pressed('KeyX')) this.walkToggle = !this.walkToggle;
      if (input.pressed('Digit1')) this.pendingItem = 'spray';
      if (input.pressed('Digit2')) this.pendingItem = 'herb';
    }
    const moving = ix !== 0 || iz !== 0;
    const il = Math.hypot(ix, iz) || 1;
    ix /= il; iz /= il;
    this.aiming = enabled && input.mouse(2);
    this.stance = Math.max(0, this.stance - dt);
    const weaponUp = this.aiming || this.stance > 0;
    const shift = enabled && (input.down('ShiftLeft') || input.down('ShiftRight'));
    const st = cfg.stamina;

    // Sprint needs stamina, forward-ish input, and no raised weapon.
    let wantSprint = shift && moving && iz > -0.1 && !weaponUp;
    if (wantSprint && this.mode !== 'sprint' && this.stamina < st.minToSprint) wantSprint = false;
    if (wantSprint && this.stamina <= 0) wantSprint = false;

    // Holding breath steadies the aim and burns stamina.
    this.holdingBreath = this.aiming && shift && this.stamina > 0 && this.gasp <= 0;

    let target = 0;
    if (moving) {
      if (weaponUp) { target = weapon.cfg.aim.moveSpeed; this.mode = 'aim'; }
      else if (wantSprint) { target = cfg.speed.sprint; this.mode = 'sprint'; }
      else if (this.walkToggle || (enabled && input.down('AltLeft'))) { target = cfg.speed.walk; this.mode = 'walk'; }
      else { target = cfg.speed.run; this.mode = 'run'; }
    } else this.mode = weaponUp ? 'aim' : 'idle';

    // Stamina bookkeeping.
    if (this.mode === 'sprint') {
      this.stamina = Math.max(0, this.stamina - st.sprintDrain * dt);
      this.staminaDelay = st.regenDelay;
      this.exertion = Math.min(1, this.exertion + dt * 0.55);
    } else if (this.holdingBreath) {
      this.stamina = Math.max(0, this.stamina - st.breathDrain * dt);
      this.staminaDelay = st.regenDelay;
      if (this.stamina <= 0) {
        this.gasp = 1.8;
        this.holdingBreath = false;
        this.audio.play('swing', { gain: 0.25 });
      }
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(st.max, this.stamina + st.regen * dt);
      this.exertion = Math.max(0, this.exertion - cfg.exertionDecay * dt);
    }
    this.sprintBlend = damp(this.sprintBlend, this.mode === 'sprint' ? 1 : 0, 6, dt);

    // --- Velocity: constant-rate approach to the wanted velocity -----------
    const cy = camera.yaw;
    const fwx = -Math.sin(cy), fwz = -Math.cos(cy);
    const rtx = Math.cos(cy), rtz = -Math.sin(cy);
    const wx = (fwx * iz + rtx * ix) * target;
    const wz = (fwz * iz + rtz * ix) * target;
    let dx = wx - this.vel.x, dz = wz - this.vel.z;
    const dl = Math.hypot(dx, dz);
    const rate = (moving ? cfg.accel : cfg.decel) * dt;
    if (dl > rate) { dx *= rate / dl; dz *= rate / dl; }
    this.vel.x += dx;
    this.vel.z += dz;
    this._integrate(dt);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // --- Facing ---------------------------------------------------------
    let yawTarget = this.yaw;
    // With the weapon up she squares to the point the camera is aiming at, which
    // sits to her right because the camera rides her right shoulder.
    if (weaponUp) yawTarget = cy + Math.PI - camera.shoulder * 0.46;
    else if (this.speed > 0.25) yawTarget = Math.atan2(this.vel.x, this.vel.z);
    const before = this.yaw;
    this.yaw = wrapAngle(dampAngle(this.yaw, yawTarget, weaponUp ? cfg.aimTurnRate : cfg.turnRate, dt));
    const turn = wrapAngle(this.yaw - before) / Math.max(dt, 1e-4);
    this.lean = damp(this.lean, clamp(-turn * 0.035, -0.22, 0.22) * saturate(this.speed / cfg.speed.run), 8, dt);
    this.aimPose = damp(this.aimPose, weaponUp ? 1 : 0, 14, dt);

    // How loud Lucia is, for the infected.
    this.noise = this.speed < 0.5 ? 0 : this.mode === 'sprint' ? 3 : this.mode === 'run' ? 2 : 1;

    this._animate(dt, weapon);
  }

  _integrate(dt) {
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (this.world.resolveCircle(this.pos, this.radius) && dt > 0) {
      // Keep only the motion that actually happened, so she slides along walls.
      this.vel.x = (this.pos.x - px) / dt;
      this.vel.z = (this.pos.z - pz) / dt;
    }
  }

  // ----------------------------------------------------------------------
  _animate(dt, weapon) {
    const rig = this.rig, t = rig.target, cfg = this.cfg, cam = this.camera;
    clearPose(t);
    clearPose(rig.add);
    rig.root.setPos(this.pos.x, 0, this.pos.z);
    rig.root.ry = this.yaw;

    if (this.dead) {
      const k = saturate(this.deadTime / 0.9);
      const e = k * k;
      t.rootRx = -1.5 * e; t.rootY = 0.11 * e;
      t.hipsY = -0.25 * Math.sin(k * Math.PI);
      t.shinLx = 0.9 * Math.sin(k * Math.PI) + 0.1; t.shinRx = 0.6 * Math.sin(k * Math.PI) + 0.25;
      t.legLx = -0.3 * (1 - k); t.legRx = -0.1;
      t.armLz = 1.0 * e; t.armRz = -0.8 * e; t.armLx = -0.3; t.armRx = -0.5;
      t.headRx = -0.25; t.headRz = 0.3 * e;
      rig.update(dt, 9);
      return;
    }

    const spd = this.speed;
    const sp = cfg.speed;
    const moving = saturate(spd / 0.7);
    const runB = saturate((spd - sp.walk) / (sp.run - sp.walk));
    const sprB = saturate((spd - sp.run) / (sp.sprint - sp.run));
    const a = this.aimPose;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const inv = 1 / Math.max(spd, 0.001);
    const fwd = (this.vel.x * sy + this.vel.z * cy) * inv; // along facing
    const side = (this.vel.x * cy - this.vel.z * sy) * inv; // towards her left

    const stride = lerp(1.2, 2.05, runB) + sprB * 0.75;
    const prev = this.phase;
    this.phase += dt * TAU * (spd / stride) * (fwd < -0.35 ? -1 : 1);
    // Footfalls land twice per cycle.
    if (spd > 0.4 && Math.floor(this.phase / Math.PI) !== Math.floor(prev / Math.PI)) {
      this.audio.play('step', { gain: 0.22 + runB * 0.3 + sprB * 0.35, pitch: 0.9 + Math.random() * 0.25 });
      if (this.onStep) this.onStep();
    }
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = (0.36 + 0.36 * runB + 0.24 * sprB) * moving * lerp(1, 0.8, a);
    const fw = Math.max(Math.abs(fwd), 0.3);
    const knee = (0.45 + 0.65 * runB + 0.35 * sprB) * moving;

    // Legs
    t.legLx = -s * amp * fw;
    t.legRx = s * amp * fw;
    t.shinLx = 0.06 + Math.max(0, c) * knee;
    t.shinRx = 0.06 + Math.max(0, -c) * knee;
    t.legLz = side * s * 0.2 * moving + 0.015;
    t.legRz = side * s * 0.2 * moving - 0.015;
    // Pelvis
    t.hipsY = -(0.02 + 0.03 * runB) * Math.abs(s) * moving;
    t.hipsRy = -s * 0.08 * moving * (1 - a);
    t.hipsRz = c * 0.035 * moving;
    // Torso leans into speed and into turns.
    const br = Math.sin(this.time * 1.7);
    t.spineRx = 0.03 + 0.1 * runB + 0.15 * sprB + br * 0.012;
    t.spineRy = s * 0.13 * moving;
    t.spineRz = this.lean;
    // Arms swing opposite the legs; the pistol hand swings less.
    t.armLx = s * amp * 0.85 + br * 0.01;
    t.armRx = -s * amp * 0.5;
    t.armLz = 0.08; t.armRz = -0.08;
    t.foreLx = -(0.1 + 0.95 * runB) * (0.4 + 0.6 * moving) - 0.06;
    t.foreRx = -(0.18 + 0.7 * runB) * (0.4 + 0.6 * moving) - 0.1;
    // Head stays level and glances where the camera looks.
    const lookYaw = clamp(wrapAngle(cam.yaw + Math.PI - this.yaw), -1.1, 1.1);
    t.headRx = -t.spineRx * 0.7 - clamp(cam.pitch, -0.5, 0.5) * 0.3;
    t.headRy = lookYaw * 0.65 - t.spineRy * 0.6;

    // --- Raised weapon ---------------------------------------------------
    if (a > 0.001) {
      const pitch = cam.pitch + cam.kickPitch;
      const spine = 0.1 - pitch * 0.28;
      const armPitch = -Math.PI / 2 - pitch - spine;
      t.spineRx = lerp(t.spineRx, spine, a);
      t.spineRy = lerp(t.spineRy, 0, a);
      t.armRx = lerp(t.armRx, armPitch, a);
      t.armRy = 0.16 * a;
      t.armRz = lerp(t.armRz, 0, a);
      t.foreRx = lerp(t.foreRx, -0.05, a);
      t.armLx = lerp(t.armLx, armPitch + 0.04, a);
      t.armLy = -0.56 * a;
      t.armLz = lerp(t.armLz, 0, a);
      t.foreLx = lerp(t.foreLx, -0.05, a);
      t.headRx = lerp(t.headRx, -pitch * 0.45 - spine * 0.8, a);
      t.headRy = lerp(t.headRy, cam.shoulder * 0.3, a);
      t.headRz = -0.07 * a;
      // Braced stance.
      t.hipsY -= 0.04 * a;
      t.legLx -= 0.2 * a; t.legRx += 0.08 * a;
      t.shinLx += 0.24 * a; t.shinRx += 0.2 * a;
      t.legLz += 0.07 * a; t.legRz -= 0.07 * a;
    }

    // --- Reload ----------------------------------------------------------
    const r = weapon.reloadProgress;
    if (r >= 0) {
      const w = smoothstep(0, 0.12, r) * (1 - smoothstep(0.86, 1, r));
      const up = smoothstep(0.3, 0.55, r); // left hand travels from belt to pistol
      t.armRx = lerp(t.armRx, -0.8, w);
      t.armRy = lerp(t.armRy, 0.3, w);
      t.foreRx = lerp(t.foreRx, -1.2, w);
      t.armLx = lerp(t.armLx, lerp(0.2, -0.75, up), w);
      t.armLy = lerp(t.armLy, lerp(0, -0.5, up), w);
      t.foreLx = lerp(t.foreLx, lerp(-0.7, -1.3, up), w);
      t.headRx = lerp(t.headRx, 0.2, w * 0.6);
    }

    // --- Springs: recoil, flinch, ponytail -------------------------------
    const kick = weapon.armKick.x;
    rig.add.armRx = -kick;
    rig.add.armLx = -kick * 0.9;
    rig.add.foreRx = -kick * 0.4;
    rig.add.spineRx = -kick * 0.12 - this.flinch.x * 0.25;
    rig.add.headRx = this.flinch.x * 0.2;
    const accel = (spd - this._prevSpeed) / Math.max(dt, 1e-4);
    this._prevSpeed = spd;
    this.ponySpring.update(dt, clamp(spd * 0.11 - accel * 0.006, -0.3, 0.8));
    if (rig.pony) {
      rig.pony.rx = 0.3 + this.ponySpring.x + Math.abs(s) * 0.08 * moving;
      rig.pony.rz = c * 0.16 * moving - this.lean;
    }

    rig.update(dt, 17);
  }
}

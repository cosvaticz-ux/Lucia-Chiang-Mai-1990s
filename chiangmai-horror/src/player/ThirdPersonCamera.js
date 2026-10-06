// Over-the-shoulder orbit camera. Blends between an exploration boom and a
// tight right-shoulder aim boom, pulls in when geometry is in the way, and
// carries recoil and shake as offsets so the crosshair always marks the centre
// of the view.

import { clamp, damp, lerp, DEG } from '../engine/math.js';
import { CAMERA as CAM_FLAG } from '../core/CollisionWorld.js';

export class ThirdPersonCamera {
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    this.yaw = 0;
    this.pitch = -0.04;
    this.aim = 0; // 0 exploring .. 1 aiming
    this.dist = cfg.explore.dist;
    this.shoulder = cfg.explore.shoulder;
    this.fov = cfg.explore.fov * DEG;
    this.fovAdd = 0;
    this.kickPitch = 0; // recoil that settles back on its own
    this.kickYaw = 0;
    this.kickReturn = 7;
    this.shake = 0;
    this.sensitivity = cfg.sensitivity;
    this.tooClose = false;
    // Outputs
    this.x = 0; this.y = 2; this.z = 5;
    this.fx = 0; this.fy = 0; this.fz = -1;
    this.rx = 1; this.ry = 0; this.rz = 0;
    this.ux = 0; this.uy = 1; this.uz = 0;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.px = 0; this.py = 0; this.pz = 0; // pivot
    this.near = cfg.near;
    this.far = cfg.far;
    this._sx = 0; this._sy = 0;
  }

  look(dx, dy, aiming) {
    const s = this.sensitivity * (aiming ? this.cfg.aimSensitivityScale : 1);
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, this.cfg.pitchMin, this.cfg.pitchMax);
  }

  /** Recoil: part of the kick stays (the player corrects it), part springs back. */
  kick(pitch, yaw, recover, returnRate) {
    this.pitch = clamp(this.pitch + pitch * (1 - recover), this.cfg.pitchMin, this.cfg.pitchMax);
    this.yaw += yaw * (1 - recover);
    this.kickPitch += pitch * recover;
    this.kickYaw += yaw * recover;
    this.kickReturn = returnRate;
  }

  addShake(amount) {
    this.shake = Math.min(0.12, this.shake + amount);
  }

  update(dt, playerX, playerZ, aiming, sprintBlend) {
    const c = this.cfg, w = this.world;
    this.aim = damp(this.aim, aiming ? 1 : 0, c.blendRate, dt);
    const a = this.aim;
    this.kickPitch = damp(this.kickPitch, 0, this.kickReturn, dt);
    this.kickYaw = damp(this.kickYaw, 0, this.kickReturn, dt);
    this.shake = damp(this.shake, 0, 9, dt);
    this._sx = damp(this._sx, (Math.random() - 0.5) * 2 * this.shake, 40, dt);
    this._sy = damp(this._sy, (Math.random() - 0.5) * 2 * this.shake, 40, dt);

    const yaw = this.yaw + this.kickYaw + this._sx;
    const pitch = clamp(this.pitch + this.kickPitch + this._sy, -1.4, 1.4);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = -Math.sin(yaw) * cp, fy = sp, fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    this.fx = fx; this.fy = fy; this.fz = fz;
    this.rx = rx; this.ry = 0; this.rz = rz;
    // up = right x forward
    this.ux = -rz * fy; this.uy = rz * fx - rx * fz; this.uz = rx * fy;

    const wantShoulder = lerp(c.explore.shoulder, c.aim.shoulder, a);
    const wantDist = lerp(c.explore.dist, c.aim.dist, a);
    const height = lerp(c.explore.height, c.aim.height, a);

    const px = playerX, py = c.pivotHeight, pz = playerZ;
    this.px = px; this.py = py; this.pz = pz;

    // 1) Slide the pivot out to the shoulder, stopping at walls.
    let sh = wantShoulder;
    const hs = w.raycast(px, py, pz, rx, 0, rz, wantShoulder + 0.2, CAM_FLAG);
    if (hs) sh = Math.max(0, hs.t - 0.2);
    this.shoulder = sh < this.shoulder ? sh : damp(this.shoulder, sh, 10, dt);
    const sx = px + rx * this.shoulder, sy = py + height, sz = pz + rz * this.shoulder;

    // 2) Boom back from the shoulder; three rays keep the near plane out of corners.
    let allowed = wantDist;
    const m = c.collisionMargin;
    for (let i = -1; i <= 1; i++) {
      const ox = sx + rx * i * 0.16, oz = sz + rz * i * 0.16;
      const h = w.raycast(ox, sy + (i === 0 ? 0.12 : 0), oz, -fx, -fy, -fz, wantDist + m, CAM_FLAG);
      if (h) allowed = Math.min(allowed, h.t - m);
    }
    allowed = Math.max(0.2, allowed);
    this.dist = allowed < this.dist ? allowed : damp(this.dist, allowed, 6, dt);
    this.tooClose = this.dist < 0.55;

    this.x = sx - fx * this.dist;
    this.y = Math.max(0.18, sy - fy * this.dist);
    this.z = sz - fz * this.dist;
    this.tx = this.x + fx; this.ty = this.y + fy; this.tz = this.z + fz;

    this.fovAdd = damp(this.fovAdd, sprintBlend * c.sprintFovAdd, 5, dt);
    this.fov = (lerp(c.explore.fov, c.aim.fov, a) + this.fovAdd * (1 - a)) * DEG;
  }

  /** Distance along the view ray at which bullets start counting (just past Lucia). */
  get minRayT() {
    const d = (this.px - this.x) * this.fx + (this.py - this.y) * this.fy + (this.pz - this.z) * this.fz;
    return Math.max(0, d) + 0.05;
  }
}

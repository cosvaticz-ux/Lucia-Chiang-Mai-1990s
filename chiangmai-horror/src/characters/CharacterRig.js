// Shared low-poly humanoid skeleton. Characters face local +Z; their right side
// is local -X. Animation is procedural: controllers fill a target pose every
// frame and the rig eases towards it, then adds spring offsets (recoil, flinch).

import { Node } from '../engine/Node.js';
import { damp } from '../engine/math.js';

export const POSE_KEYS = [
  'rootRx', 'rootY',
  'hipsY', 'hipsRx', 'hipsRy', 'hipsRz',
  'spineRx', 'spineRy', 'spineRz',
  'headRx', 'headRy', 'headRz',
  'armLx', 'armLy', 'armLz', 'foreLx',
  'armRx', 'armRy', 'armRz', 'foreRx',
  'legLx', 'legLz', 'shinLx',
  'legRx', 'legRz', 'shinRx',
];

export function blankPose() {
  const p = {};
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

export function clearPose(p) {
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

export class CharacterRig {
  /**
   * dim: { hipY, spineY, neckY, shoulderX, shoulderY, hipX, upperArm, thigh }
   */
  constructor(dim) {
    this.dim = dim;
    this.root = new Node();
    this.body = this.root.add(new Node());
    this.hips = this.body.add(new Node());
    this.spine = this.hips.add(new Node().setPos(0, dim.spineY, 0));
    this.head = this.spine.add(new Node().setPos(0, dim.neckY, 0));
    // Left = +X, right = -X.
    this.armL = this.spine.add(new Node().setPos(dim.shoulderX, dim.shoulderY, 0));
    this.armR = this.spine.add(new Node().setPos(-dim.shoulderX, dim.shoulderY, 0));
    this.foreL = this.armL.add(new Node().setPos(0, -dim.upperArm, 0));
    this.foreR = this.armR.add(new Node().setPos(0, -dim.upperArm, 0));
    this.legL = this.hips.add(new Node().setPos(dim.hipX, 0, 0));
    this.legR = this.hips.add(new Node().setPos(-dim.hipX, 0, 0));
    this.shinL = this.legL.add(new Node().setPos(0, -dim.thigh, 0));
    this.shinR = this.legR.add(new Node().setPos(0, -dim.thigh, 0));

    this.target = blankPose();
    this.cur = blankPose();
    this.add = blankPose(); // additive offsets, cleared by the owner each frame
    this.meshes = [];
    /** Planar shadow parameters, filled in by the game each frame. */
    this.shadow = { lx: 0, ly: 6, lz: 0, planeY: 0.03, cx: 0, cz: 0, radius: 5, strength: 0 };
    this.root.shadowCaster = this.shadow;
  }

  /** Attach geometry to a joint. */
  skin(joint, builder, renderer, material) {
    if (builder.empty) return null;
    const n = new Node(builder.build(renderer), material);
    n.castShadow = true;
    this[joint].add(n);
    this.meshes.push(n);
    return n;
  }

  /** Jump straight to the target pose (used on spawn). */
  snap() {
    for (const k of POSE_KEYS) this.cur[k] = this.target[k];
    this._write();
  }

  /** Ease towards the target pose. rate: higher = snappier. */
  update(dt, rate = 16) {
    const t = this.target, c = this.cur;
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const k = POSE_KEYS[i];
      c[k] = damp(c[k], t[k], rate, dt);
    }
    this._write();
  }

  _write() {
    const c = this.cur, a = this.add, d = this.dim;
    this.body.rx = c.rootRx + a.rootRx;
    this.body.y = c.rootY + a.rootY;
    this.hips.y = d.hipY + c.hipsY + a.hipsY;
    this.hips.rx = c.hipsRx + a.hipsRx;
    this.hips.ry = c.hipsRy + a.hipsRy;
    this.hips.rz = c.hipsRz + a.hipsRz;
    this.spine.rx = c.spineRx + a.spineRx;
    this.spine.ry = c.spineRy + a.spineRy;
    this.spine.rz = c.spineRz + a.spineRz;
    this.head.rx = c.headRx + a.headRx;
    this.head.ry = c.headRy + a.headRy;
    this.head.rz = c.headRz + a.headRz;
    this.armL.rx = c.armLx + a.armLx;
    this.armL.ry = c.armLy + a.armLy;
    this.armL.rz = c.armLz + a.armLz;
    this.foreL.rx = c.foreLx + a.foreLx;
    this.armR.rx = c.armRx + a.armRx;
    this.armR.ry = c.armRy + a.armRy;
    this.armR.rz = c.armRz + a.armRz;
    this.foreR.rx = c.foreRx + a.foreRx;
    this.legL.rx = c.legLx + a.legLx;
    this.legL.rz = c.legLz + a.legLz;
    this.shinL.rx = c.shinLx + a.shinLx;
    this.legR.rx = c.legRx + a.legRx;
    this.legR.rz = c.legRz + a.legRz;
    this.shinR.rx = c.shinRx + a.shinRx;
  }
}

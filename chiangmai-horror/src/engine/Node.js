// Scene-graph node: translation + YXZ euler rotation, optional mesh/material.

import { m4 } from './math.js';

const _local = m4.create();

export class Node {
  constructor(mesh = null, material = null) {
    this.x = 0; this.y = 0; this.z = 0;
    this.rx = 0; this.ry = 0; this.rz = 0;
    this.scale = 1;
    this.mesh = mesh;
    this.material = material;
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.castShadow = false;
    /** Set on a subtree root to give its castShadow meshes a planar shadow. */
    this.shadowCaster = null;
    /** Static nodes compute their world matrix once. */
    this.isStatic = false;
    this._built = false;
    this.world = m4.create();
  }

  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parent = null;
  }

  setPos(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  setRot(rx, ry, rz) {
    this.rx = rx; this.ry = ry; this.rz = rz;
    return this;
  }

  updateWorld(parentWorld, parentDirty) {
    if (!this.visible) return;
    let dirty = parentDirty;
    if (!this.isStatic || !this._built || parentDirty) {
      m4.fromTRS(_local, this.x, this.y, this.z, this.rx, this.ry, this.rz, this.scale);
      if (parentWorld) m4.multiply(this.world, parentWorld, _local);
      else this.world.set(_local);
      this._built = true;
      dirty = true;
    }
    const ch = this.children;
    for (let i = 0; i < ch.length; i++) ch[i].updateWorld(this.world, dirty);
  }

  /** World-space position of a point given in this node's local space. */
  worldPoint(out, x = 0, y = 0, z = 0) {
    return m4.transformPoint(out, this.world, x, y, z);
  }
}

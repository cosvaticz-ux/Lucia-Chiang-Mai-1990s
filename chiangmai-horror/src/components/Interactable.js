// World objects the player can use with E: pickups, the gate, notes.

export class Interactable {
  /**
   * opts: { x, z, y, radius, prompt (string | () => string), onInteract (ctx) => void,
   *         enabled, node (optional visual), kind }
   */
  constructor(opts) {
    this.x = opts.x;
    this.z = opts.z;
    this.y = opts.y === undefined ? 0.9 : opts.y;
    this.radius = opts.radius || 1.3;
    this.prompt = opts.prompt || 'Use';
    this.onInteract = opts.onInteract || (() => {});
    this.enabled = opts.enabled !== false;
    this.node = opts.node || null;
    this.kind = opts.kind || 'generic';
    this.mapIcon = opts.mapIcon || null;
  }

  get label() {
    return typeof this.prompt === 'function' ? this.prompt() : this.prompt;
  }
}

export class InteractableSystem {
  constructor() {
    this.items = [];
    this.focus = null;
  }

  add(item) {
    this.items.push(item);
    return item;
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    if (this.focus === item) this.focus = null;
  }

  /** Pick the best candidate: in range, roughly in front of the camera, nearest first. */
  update(px, pz, fx, fz) {
    let best = null, bestScore = Infinity;
    for (const it of this.items) {
      if (!it.enabled) continue;
      const dx = it.x - px, dz = it.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      const facing = d > 0.4 ? (dx * fx + dz * fz) / d : 1;
      if (facing < -0.25) continue;
      const score = d - facing * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.focus = best;
    return best;
  }

  interact(ctx) {
    if (!this.focus) return false;
    this.focus.onInteract(ctx, this.focus);
    return true;
  }
}

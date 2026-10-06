// Coarse navigation lattice generated from the collision world at load time.
// Enemies walk straight at their target when the way is clear and fall back
// to an A* path over this grid when a wall is in the way.

export class NavGrid {
  constructor(world, bounds, spacing = 1.25, radius = 0.42) {
    this.world = world;
    this.b = bounds;
    this.s = spacing;
    this.radius = radius;
    this.cols = Math.floor((bounds.x1 - bounds.x0) / spacing) + 1;
    this.rows = Math.floor((bounds.z1 - bounds.z0) / spacing) + 1;
    this.nodes = new Array(this.cols * this.rows).fill(null);
    this.list = [];
  }

  /** seed: a point known to be walkable; unreachable pockets are discarded. */
  build(seed) {
    const { world, s, radius } = this;
    for (let gz = 0; gz < this.rows; gz++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const x = this.b.x0 + gx * s, z = this.b.z0 + gz * s;
        if (!world.pointFree(x, z, radius)) continue;
        this.nodes[gz * this.cols + gx] = { x, z, gx, gz, links: [], g: 0, f: 0, parent: null, mark: 0, reach: false };
      }
    }
    const N = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const n of this.nodes) {
      if (!n) continue;
      for (const [dx, dz] of N) {
        const gx = n.gx + dx, gz = n.gz + dz;
        if (gx < 0 || gz < 0 || gx >= this.cols || gz >= this.rows) continue;
        const m = this.nodes[gz * this.cols + gx];
        if (!m || !world.sweepClear(n.x, n.z, m.x, m.z, radius)) continue;
        const d = Math.hypot(m.x - n.x, m.z - n.z);
        n.links.push([m, d]);
        m.links.push([n, d]);
      }
    }
    // Flood fill from the seed.
    const start = this._closest(seed.x, seed.z, false);
    if (start) {
      const q = [start];
      start.reach = true;
      while (q.length) {
        const n = q.pop();
        for (const [m] of n.links) if (!m.reach) { m.reach = true; q.push(m); }
      }
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n && !n.reach) this.nodes[i] = null;
      else if (n) this.list.push(n);
    }
    this._stamp = 0;
    return this;
  }

  _closest(x, z, needSweep) {
    let best = null, bd = Infinity;
    const gx0 = Math.round((x - this.b.x0) / this.s), gz0 = Math.round((z - this.b.z0) / this.s);
    for (let r = 0; r <= 4 && !best; r++) {
      for (let gz = gz0 - r; gz <= gz0 + r; gz++) {
        for (let gx = gx0 - r; gx <= gx0 + r; gx++) {
          if (gx < 0 || gz < 0 || gx >= this.cols || gz >= this.rows) continue;
          const n = this.nodes[gz * this.cols + gx];
          if (!n) continue;
          const d = Math.hypot(n.x - x, n.z - z);
          if (d >= bd) continue;
          if (needSweep && !this.world.sweepClear(x, z, n.x, n.z, this.radius * 0.8)) continue;
          bd = d;
          best = n;
        }
      }
    }
    return best;
  }

  /** A* from a to b. Returns [{x,z}, ...] ending at b, or null. */
  path(ax, az, bx, bz) {
    const start = this._closest(ax, az, true) || this._closest(ax, az, false);
    const goal = this._closest(bx, bz, true) || this._closest(bx, bz, false);
    if (!start || !goal) return null;
    const stamp = ++this._stamp;
    const open = [start];
    start.g = 0;
    start.f = Math.hypot(goal.x - start.x, goal.z - start.z);
    start.parent = null;
    start.mark = stamp;
    start.closed = false;
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const n = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (n === goal) break;
      n.closed = true;
      for (const [m, d] of n.links) {
        const g = n.g + d;
        if (m.mark === stamp && (m.closed || g >= m.g)) continue;
        const fresh = m.mark !== stamp || m.closed;
        m.mark = stamp;
        m.closed = false;
        m.g = g;
        m.f = g + Math.hypot(goal.x - m.x, goal.z - m.z);
        m.parent = n;
        if (fresh || !open.includes(m)) open.push(m);
      }
    }
    if (goal.mark !== stamp) return null;
    const out = [{ x: bx, z: bz }];
    for (let n = goal; n; n = n.parent) out.push({ x: n.x, z: n.z });
    out.reverse();
    return out;
  }
}

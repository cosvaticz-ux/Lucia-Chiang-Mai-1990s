// Tiny rigid-ish bodies for the handful of props that should react: cans,
// bottles, small boxes, plastic stools. Each is a bouncing circle with a
// tumble animation; everything else in the level is static.

export class PropPhysics {
  constructor(world, audio) {
    this.world = world;
    this.audio = audio;
    this.props = [];
  }

  /**
   * opts: { node, x, z, radius, half (half height when upright), mass, restitution,
   *         friction, sound pitch, tip (can it fall on its side) }
   */
  add(opts) {
    const p = {
      node: opts.node,
      x: opts.x, y: opts.half, z: opts.z,
      vx: 0, vy: 0, vz: 0,
      radius: opts.radius, half: opts.half,
      mass: opts.mass || 1,
      restitution: opts.restitution === undefined ? 0.35 : opts.restitution,
      friction: opts.friction === undefined ? 5 : opts.friction,
      pitch: opts.pitch || 1,
      tip: opts.tip !== false,
      spin: 0, tumble: 0, tumbleAxis: 0,
      tipped: false, restY: opts.half,
      asleep: true, quiet: 0,
    };
    p.node.setPos(p.x, p.y, p.z);
    this.props.push(p);
    return p;
  }

  impulse(p, ix, iy, iz) {
    p.vx += ix / p.mass;
    p.vy += iy / p.mass;
    p.vz += iz / p.mass;
    p.spin += (Math.random() - 0.5) * 14;
    p.asleep = false;
    if (p.tip && !p.tipped && Math.hypot(ix, iz) / p.mass > 1.6) {
      p.tipped = true;
      p.tumbleAxis = Math.atan2(ix, iz);
      p.restY = p.radius;
    }
  }

  /** Bullet test. Returns { prop, t } for the nearest prop hit by the ray. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null, bt = maxDist;
    for (const p of this.props) {
      const r = Math.max(p.radius, p.half) * 1.05;
      const lx = ox - p.x, ly = oy - p.y, lz = oz - p.z;
      const b = lx * dx + ly * dy + lz * dz;
      const c = lx * lx + ly * ly + lz * lz - r * r;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t >= 0 && t < bt) { bt = t; best = p; }
    }
    return best ? { prop: best, t: bt } : null;
  }

  /** bodies: [{x, z, vx, vz, radius}] - characters that can kick props around. */
  update(dt, bodies) {
    const pos = { x: 0, z: 0 };
    for (const p of this.props) {
      // Characters walking into a prop shove it.
      for (const b of bodies) {
        const dx = p.x - b.x, dz = p.z - b.z;
        const rr = p.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || p.y > 1.2) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        const push = rr - d;
        p.x += nx * push;
        p.z += nz * push;
        const speed = Math.hypot(b.vx, b.vz);
        const into = Math.max(0, b.vx * nx + b.vz * nz);
        if (into > 0.2) {
          const wasAsleep = p.asleep;
          this.impulse(p, nx * into * 1.15 * p.mass, speed > 3 ? 1.2 * p.mass : 0, nz * into * 1.15 * p.mass);
          if (wasAsleep && this.audio) this.audio.play('prop', { pos: p, pitch: p.pitch, gain: Math.min(1, into / 3) });
        }
      }
      if (p.asleep) {
        p.node.setPos(p.x, p.y, p.z);
        continue;
      }
      p.vy -= 12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // Ground
      if (p.y < p.restY) {
        p.y = p.restY;
        if (p.vy < -1.2) {
          p.vy = -p.vy * p.restitution;
          if (this.audio) this.audio.play('prop', { pos: p, pitch: p.pitch, gain: Math.min(1, -p.vy / 3 + 0.2) });
        } else p.vy = 0;
        const f = Math.exp(-p.friction * dt);
        p.vx *= f;
        p.vz *= f;
        p.spin *= f;
      }
      // Walls
      pos.x = p.x; pos.z = p.z;
      if (this.world.resolveCircle(pos, p.radius, Math.max(0.02, p.y - p.half * 0.5), p.y + p.half)) {
        const nx = pos.x - p.x, nz = pos.z - p.z;
        const nl = Math.hypot(nx, nz);
        if (nl > 1e-5) {
          const vn = (p.vx * nx + p.vz * nz) / nl;
          if (vn < 0) {
            p.vx -= (1 + p.restitution) * vn * (nx / nl);
            p.vz -= (1 + p.restitution) * vn * (nz / nl);
            if (vn < -1 && this.audio) this.audio.play('prop', { pos: p, pitch: p.pitch * 0.9, gain: 0.5 });
          }
        }
        p.x = pos.x; p.z = pos.z;
      }
      // Visuals: spin, and lie down once tipped.
      const n = p.node;
      n.setPos(p.x, p.y, p.z);
      n.ry += p.spin * dt;
      if (p.tipped) {
        p.tumble += (Math.PI / 2 - p.tumble) * (1 - Math.exp(-9 * dt));
        n.rx = Math.cos(p.tumbleAxis) * p.tumble;
        n.rz = -Math.sin(p.tumbleAxis) * p.tumble;
      }
      const moving = Math.hypot(p.vx, p.vz) > 0.05 || Math.abs(p.vy) > 0.05 || p.y > p.restY + 0.01;
      p.quiet = moving ? 0 : p.quiet + dt;
      if (p.quiet > 0.4) {
        p.asleep = true;
        p.vx = p.vz = p.vy = 0;
      }
    }
  }
}

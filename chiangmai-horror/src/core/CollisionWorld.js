// Static collision made of axis-aligned boxes. Characters are circles in the
// XZ plane; bullets, sight lines and the camera use 3D ray casts. Analytic
// tests keep this fast and deterministic without a physics engine.

export const SOLID = 1; // blocks walking
export const BULLET = 2; // stops bullets
export const CAMERA = 4; // camera boom collides
export const SIGHT = 8; // blocks enemy vision
export const ALL = SOLID | BULLET | CAMERA | SIGHT;
export const WALL = ALL;
export const PROP = SOLID | BULLET | CAMERA; // low prop: blocks movement and shots, not sight
export const FENCE = SOLID | CAMERA; // see-through, shoot-through barrier

export class CollisionWorld {
  constructor() {
    this.boxes = [];
  }

  addBox(x0, x1, y0, y1, z0, z1, flags = ALL, tag = null) {
    const b = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      y0: Math.min(y0, y1), y1: Math.max(y0, y1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      flags, tag, enabled: true,
    };
    this.boxes.push(b);
    return b;
  }

  /**
   * Push a circle out of every SOLID box that overlaps the given height band.
   * pos is mutated ({x, z}). Returns true if anything was touched.
   */
  resolveCircle(pos, radius, yLow = 0.25, yHigh = 1.6) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (!b.enabled || !(b.flags & SOLID) || b.y1 <= yLow || b.y0 >= yHigh) continue;
        if (pos.x < b.x0 - radius || pos.x > b.x1 + radius || pos.z < b.z0 - radius || pos.z > b.z1 + radius) continue;
        const cx = pos.x < b.x0 ? b.x0 : pos.x > b.x1 ? b.x1 : pos.x;
        const cz = pos.z < b.z0 ? b.z0 : pos.z > b.z1 ? b.z1 : pos.z;
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // Centre is inside the box: leave through the nearest face.
          const l = pos.x - b.x0, r = b.x1 - pos.x, n = pos.z - b.z0, f = b.z1 - pos.z;
          const m = Math.min(l, r, n, f);
          if (m === l) pos.x = b.x0 - radius;
          else if (m === r) pos.x = b.x1 + radius;
          else if (m === n) pos.z = b.z0 - radius;
          else pos.z = b.z1 + radius;
        }
        moved = true;
        hit = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Nearest ray hit against boxes matching mask, or null. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = BULLET) {
    let best = maxDist, bestBox = null, bnx = 0, bny = 0, bnz = 0;
    const ix = 1 / (Math.abs(dx) < 1e-9 ? 1e-9 : dx);
    const iy = 1 / (Math.abs(dy) < 1e-9 ? 1e-9 : dy);
    const iz = 1 / (Math.abs(dz) < 1e-9 ? 1e-9 : dz);
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.enabled || !(b.flags & mask)) continue;
      let t1 = (b.x0 - ox) * ix, t2 = (b.x1 - ox) * ix;
      let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1;
      let axis = 0;
      t1 = (b.y0 - oy) * iy; t2 = (b.y1 - oy) * iy;
      let lo = t1 < t2 ? t1 : t2, hi = t1 < t2 ? t2 : t1;
      if (lo > tmin) { tmin = lo; axis = 1; }
      if (hi < tmax) tmax = hi;
      if (tmin > tmax) continue;
      t1 = (b.z0 - oz) * iz; t2 = (b.z1 - oz) * iz;
      lo = t1 < t2 ? t1 : t2; hi = t1 < t2 ? t2 : t1;
      if (lo > tmin) { tmin = lo; axis = 2; }
      if (hi < tmax) tmax = hi;
      if (tmin > tmax || tmax < 0) continue;
      const t = tmin < 0 ? 0 : tmin;
      if (t < best) {
        best = t;
        bestBox = b;
        bnx = axis === 0 ? (dx > 0 ? -1 : 1) : 0;
        bny = axis === 1 ? (dy > 0 ? -1 : 1) : 0;
        bnz = axis === 2 ? (dz > 0 ? -1 : 1) : 0;
      }
    }
    if (!bestBox) return null;
    return { t: best, nx: bnx, ny: bny, nz: bnz, box: bestBox, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
  }

  /** True if nothing matching mask lies between the two points. */
  lineClear(ax, ay, az, bx, by, bz, mask = SIGHT) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, mask);
  }

  /** Can a circle of this radius slide straight from A to B on the ground? */
  sweepClear(ax, az, bx, bz, radius, yLow = 0.25, yHigh = 1.6) {
    const dx = bx - ax, dz = bz - az;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.enabled || !(b.flags & SOLID) || b.y1 <= yLow || b.y0 >= yHigh) continue;
      const x0 = b.x0 - radius, x1 = b.x1 + radius, z0 = b.z0 - radius, z1 = b.z1 + radius;
      let tmin = 0, tmax = 1;
      if (Math.abs(dx) < 1e-9) {
        if (ax <= x0 || ax >= x1) continue;
      } else {
        let t1 = (x0 - ax) / dx, t2 = (x1 - ax) / dx;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin >= tmax) continue;
      }
      if (Math.abs(dz) < 1e-9) {
        if (az <= z0 || az >= z1) continue;
      } else {
        let t1 = (z0 - az) / dz, t2 = (z1 - az) / dz;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin >= tmax) continue;
      }
      return false;
    }
    return true;
  }

  /** Is this ground point free for a circle of the given radius? */
  pointFree(x, z, radius, yLow = 0.25, yHigh = 1.6) {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.enabled || !(b.flags & SOLID) || b.y1 <= yLow || b.y0 >= yHigh) continue;
      if (x > b.x0 - radius && x < b.x1 + radius && z > b.z0 - radius && z < b.z1 + radius) return false;
    }
    return true;
  }
}

/**
 * Ray vs capsule (segment A-B with radius r). Returns distance along the ray
 * or -1. Used for character hit zones. After Inigo Quilez.
 */
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h >= 0 && a > 1e-9) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    // End caps
    const ocx = y <= 0 ? oax : ox - bx, ocy = y <= 0 ? oay : oy - by, ocz = y <= 0 ? oaz : oz - bz;
    b = dx * ocx + dy * ocy + dz * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = b * b - c;
    if (h > 0) {
      const tc = -b - Math.sqrt(h);
      return tc >= 0 ? tc : -1;
    }
  }
  return -1;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}

// Small math kit: scalars, springs, and column-major 4x4 matrices.
// Rotation order everywhere is Y * X * Z (yaw, then pitch, then roll).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => {
  const t = saturate((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const DEG = Math.PI / 180;

/** Deterministic PRNG so the level looks the same on every load. */
export function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

/** Damped spring used for recoil, flinches and secondary motion. */
export class Spring {
  constructor(stiffness = 120, damping = 14) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }
  kick(impulse) {
    this.v += impulse;
  }
  update(dt, target = 0) {
    // Semi-implicit Euler, sub-stepped so stiff springs stay stable at low fps.
    const steps = dt > 1 / 90 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.v += (-this.k * (this.x - target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

export function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export const m4 = {
  create() {
    const o = new Float32Array(16);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },
  identity(o) {
    o.fill(0);
    o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },
  copy(o, a) {
    o.set(a);
    return o;
  },
  multiply(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },
  /** Translation + YXZ euler rotation (+ optional uniform scale). */
  fromTRS(o, px, py, pz, rx, ry, rz, s = 1) {
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    o[0] = (cy * cz + sy * sx * sz) * s;
    o[1] = cx * sz * s;
    o[2] = (-sy * cz + cy * sx * sz) * s;
    o[3] = 0;
    o[4] = (-cy * sz + sy * sx * cz) * s;
    o[5] = cx * cz * s;
    o[6] = (sy * sz + cy * sx * cz) * s;
    o[7] = 0;
    o[8] = sy * cx * s;
    o[9] = -sx * s;
    o[10] = cy * cx * s;
    o[11] = 0;
    o[12] = px;
    o[13] = py;
    o[14] = pz;
    o[15] = 1;
    return o;
  },
  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = (far + near) / (near - far);
    o[11] = -1;
    o[14] = (2 * far * near) / (near - far);
    return o;
  },
  lookAt(o, ex, ey, ez, tx, ty, tz) {
    let zx = ex - tx, zy = ey - ty, zz = ez - tz;
    let l = Math.hypot(zx, zy, zz) || 1;
    zx /= l; zy /= l; zz /= l;
    // x = up(0,1,0) cross z
    let xx = zz, xy = 0, xz = -zx;
    l = Math.hypot(xx, xy, xz) || 1;
    xx /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez);
    o[13] = -(yx * ex + yy * ey + yz * ez);
    o[14] = -(zx * ex + zy * ey + zz * ez);
    o[15] = 1;
    return o;
  },
  /**
   * Planar projection onto the plane y = h from a point light at (lx,ly,lz).
   * Used for cheap PS2-style character shadows.
   */
  planarShadow(o, lx, ly, lz, h) {
    // plane: (0,1,0,-h), light: (lx,ly,lz,1); M = dot(plane,light) * I - light (x) plane
    const d = ly - h;
    o[0] = d; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = -lx; o[5] = d - ly; o[6] = -lz; o[7] = -1;
    o[8] = 0; o[9] = 0; o[10] = d; o[11] = 0;
    o[12] = lx * h; o[13] = ly * h; o[14] = lz * h; o[15] = d + h;
    return o;
  },
  transformPoint(out, m, x, y, z) {
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
  },
};

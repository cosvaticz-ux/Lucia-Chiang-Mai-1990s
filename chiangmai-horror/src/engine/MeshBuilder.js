// Low-poly geometry builder. Everything in the prototype (level kit, vehicles,
// characters, props) is assembled from these primitives with vertex colours.
// Corner order for quads is always BL, BR, TR, TL as seen from the visible side.

import { m4, hexToRgb } from './math.js';
import { STRIDE } from './Renderer.js';

const WHITE = [1, 1, 1];

export function rgb(c) {
  if (c === undefined || c === null) return WHITE;
  return typeof c === 'number' ? hexToRgb(c) : c;
}

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
    this.n = 0;
    this._stack = [];
    this._m = null;
  }

  get empty() {
    return this.n === 0;
  }

  /** Push a local transform (translation + YXZ euler) for following primitives. */
  push(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
    const local = m4.fromTRS(m4.create(), px, py, pz, rx, ry, rz);
    const m = this._m ? m4.multiply(m4.create(), this._m, local) : local;
    this._stack.push(this._m);
    this._m = m;
    return this;
  }

  pop() {
    this._m = this._stack.pop() || null;
    return this;
  }

  vert(x, y, z, nx, ny, nz, u, v, r, g, b, a = 1) {
    const m = this._m;
    if (m) {
      const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
      const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const tnx = m[0] * nx + m[4] * ny + m[8] * nz;
      const tny = m[1] * nx + m[5] * ny + m[9] * nz;
      const tnz = m[2] * nx + m[6] * ny + m[10] * nz;
      x = tx; y = ty; z = tz; nx = tnx; ny = tny; nz = tnz;
    }
    this.v.push(x, y, z, nx, ny, nz, u, v, r, g, b, a);
    return this.n++;
  }

  /**
   * opts: color, alpha, tile (metres per texture repeat), uv ([u0,v0,u1,v1] fit rect),
   *       ao (darken the two bottom corners), colors (per-corner [c0..c3]), double
   */
  quad(a, b, c, d, opts = {}) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
    const fx = d[0] - a[0], fy = d[1] - a[1], fz = d[2] - a[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (opts.n) { nx = opts.n[0]; ny = opts.n[1]; nz = opts.n[2]; }
    let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
    if (opts.uv) [u0, v0, u1, v1] = opts.uv;
    else if (opts.tile) {
      const w = Math.hypot(ex, ey, ez), h = Math.hypot(fx, fy, fz);
      const ou = opts.uvOffset ? opts.uvOffset[0] : 0, ov = opts.uvOffset ? opts.uvOffset[1] : 0;
      u0 = ou; v0 = ov; u1 = ou + w / opts.tile; v1 = ov + h / opts.tile;
    }
    const col = rgb(opts.color);
    const al = opts.alpha === undefined ? 1 : opts.alpha;
    const k = opts.ao ? 1 - opts.ao : 1;
    const cs = opts.colors;
    const c0 = cs ? rgb(cs[0]) : col, c1 = cs ? rgb(cs[1]) : col, c2 = cs ? rgb(cs[2]) : col, c3 = cs ? rgb(cs[3]) : col;
    const as = opts.alphas;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, u0, v0, c0[0] * k, c0[1] * k, c0[2] * k, as ? as[0] : al);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, u1, v0, c1[0] * k, c1[1] * k, c1[2] * k, as ? as[1] : al);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, u1, v1, c2[0], c2[1], c2[2], as ? as[2] : al);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, u0, v1, c3[0], c3[1], c3[2], as ? as[3] : al);
    this.i.push(i0, i1, i2, i0, i2, i3);
    if (opts.double) this.i.push(i0, i2, i1, i0, i3, i2);
    return this;
  }

  tri(a, b, c, opts = {}) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
    const fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const col = rgb(opts.color);
    const t = opts.tile || 1;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, 0, 0, col[0], col[1], col[2]);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, Math.hypot(ex, ey, ez) / t, 0, col[0], col[1], col[2]);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, 0, Math.hypot(fx, fy, fz) / t, col[0], col[1], col[2]);
    this.i.push(i0, i1, i2);
    if (opts.double) this.i.push(i0, i2, i1);
    return this;
  }

  /**
   * Six-sided solid from 8 corners: bottom ring b0..b3 then top ring t0..t3,
   * each ring ordered (-x,-z) (+x,-z) (+x,+z) (-x,+z).
   * opts.skip: string containing any of "xXzZyY" (lower = negative side) to omit faces.
   */
  hexa(c, opts = {}) {
    const skip = opts.skip || '';
    const side = { color: opts.color, tile: opts.tile, ao: opts.ao };
    const flat = { color: opts.topColor !== undefined ? opts.topColor : opts.color, tile: opts.tile };
    if (!skip.includes('Z')) this.quad(c[3], c[2], c[6], c[7], side);
    if (!skip.includes('z')) this.quad(c[1], c[0], c[4], c[5], side);
    if (!skip.includes('X')) this.quad(c[2], c[1], c[5], c[6], side);
    if (!skip.includes('x')) this.quad(c[0], c[3], c[7], c[4], side);
    if (!skip.includes('Y')) this.quad(c[7], c[6], c[5], c[4], flat);
    if (!skip.includes('y')) {
      const k = opts.ao ? 1 - opts.ao : 1;
      const cc = rgb(opts.color);
      this.quad(c[0], c[1], c[2], c[3], { color: [cc[0] * k, cc[1] * k, cc[2] * k], tile: opts.tile });
    }
    return this;
  }

  /** Axis-aligned box by centre and size. */
  box(cx, cy, cz, sx, sy, sz, opts = {}) {
    return this.tbox(cx, cy, cz, sx, sz, sx, sz, sy, opts);
  }

  /** Box by min/max extents. */
  boxMM(x0, x1, y0, y1, z0, z1, opts = {}) {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, opts);
  }

  /** Tapered box: bottom footprint (bx,bz) and top footprint (tx,tz), height h. */
  tbox(cx, cy, cz, bx, bz, tx, tz, h, opts = {}) {
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const ox = opts.topOffsetX || 0, oz = opts.topOffsetZ || 0;
    const hb = bx / 2, db = bz / 2, ht = tx / 2, dt = tz / 2;
    return this.hexa(
      [
        [cx - hb, y0, cz - db], [cx + hb, y0, cz - db], [cx + hb, y0, cz + db], [cx - hb, y0, cz + db],
        [cx - ht + ox, y1, cz - dt + oz], [cx + ht + ox, y1, cz - dt + oz],
        [cx + ht + ox, y1, cz + dt + oz], [cx - ht + ox, y1, cz + dt + oz],
      ],
      opts,
    );
  }

  /**
   * Surface of revolution around +Y. profile: [[radius, y], ...] bottom to top.
   * opts: color, colors (per profile point), seg, capTop, capBottom, tile, sx/sz (ellipse scale)
   */
  lathe(cx, cy, cz, profile, opts = {}) {
    const seg = opts.seg || 8;
    const ex = opts.sx || 1, ez = opts.sz || 1;
    const base = rgb(opts.color);
    const tile = opts.tile || 1;
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, y0] = profile[j];
      const [r1, y1] = profile[j + 1];
      const dr = r1 - r0, dy = y1 - y0;
      const pl = Math.hypot(dr, dy) || 1;
      const nr = dy / pl, nyy = -dr / pl;
      const ca = opts.colors ? rgb(opts.colors[j]) : base;
      const cb = opts.colors ? rgb(opts.colors[j + 1]) : base;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const u0 = (i / seg) * (opts.uWrap || 1), u1 = ((i + 1) / seg) * (opts.uWrap || 1);
        const v0 = y0 / tile, v1 = y1 / tile;
        // BL = (a1, j), BR = (a0, j), TR = (a0, j+1), TL = (a1, j+1)
        const i0 = this.vert(cx + r0 * c1 * ex, cy + y0, cz + r0 * s1 * ez, nr * c1, nyy, nr * s1, u1, v0, ca[0], ca[1], ca[2]);
        const i1 = this.vert(cx + r0 * c0 * ex, cy + y0, cz + r0 * s0 * ez, nr * c0, nyy, nr * s0, u0, v0, ca[0], ca[1], ca[2]);
        const i2 = this.vert(cx + r1 * c0 * ex, cy + y1, cz + r1 * s0 * ez, nr * c0, nyy, nr * s0, u0, v1, cb[0], cb[1], cb[2]);
        const i3 = this.vert(cx + r1 * c1 * ex, cy + y1, cz + r1 * s1 * ez, nr * c1, nyy, nr * s1, u1, v1, cb[0], cb[1], cb[2]);
        if (r0 > 1e-5) this.i.push(i0, i1, i2);
        if (r1 > 1e-5) this.i.push(i0, i2, i3);
      }
    }
    const cap = (r, y, top, col) => {
      const c = rgb(col);
      const ic = this.vert(cx, cy + y, cz, 0, top ? 1 : -1, 0, 0.5, 0.5, c[0], c[1], c[2]);
      const ring = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.vert(cx + r * Math.cos(a) * ex, cy + y, cz + r * Math.sin(a) * ez, 0, top ? 1 : -1, 0,
          0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, c[0], c[1], c[2]));
      }
      for (let i = 0; i < seg; i++) {
        const p = ring[i], q = ring[(i + 1) % seg];
        if (top) this.i.push(ic, q, p);
        else this.i.push(ic, p, q);
      }
    };
    const last = profile[profile.length - 1];
    if (opts.capTop !== false && last[0] > 1e-5) cap(last[0], last[1], true, opts.capColor !== undefined ? opts.capColor : (opts.colors ? opts.colors[profile.length - 1] : opts.color));
    if (opts.capBottom && profile[0][0] > 1e-5) cap(profile[0][0], profile[0][1], false, opts.colors ? opts.colors[0] : opts.color);
    return this;
  }

  /** Upright cylinder, base at (cx, y0, cz). */
  cyl(cx, y0, cz, r, h, opts = {}) {
    return this.lathe(cx, y0, cz, [[r, 0], [opts.rTop !== undefined ? opts.rTop : r, h]], opts);
  }

  /** Low-poly ellipsoid with smooth normals. */
  sphere(cx, cy, cz, rx, ry, rz, opts = {}) {
    const seg = opts.seg || 8, rings = opts.rings || 5;
    const c = rgb(opts.color);
    const grid = [];
    for (let j = 0; j <= rings; j++) {
      const ph = (j / rings) * Math.PI - Math.PI / 2;
      const row = [];
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const nx = Math.cos(ph) * Math.cos(th), ny = Math.sin(ph), nz = Math.cos(ph) * Math.sin(th);
        row.push(this.vert(cx + nx * rx, cy + ny * ry, cz + nz * rz, nx, ny, nz, i / seg, j / rings, c[0], c[1], c[2]));
      }
      grid.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = grid[j][i + 1], b = grid[j][i], cc = grid[j + 1][i], d = grid[j + 1][i + 1];
        if (j > 0) this.i.push(a, b, cc);
        if (j < rings - 1) this.i.push(a, cc, d);
      }
    }
    return this;
  }

  /** Two crossed alpha-tested quads: plants, grass tufts, hanging laundry. */
  cross(cx, y0, cz, w, h, opts = {}) {
    const hw = w / 2;
    const o = { ...opts, double: true, n: [0, 1, 0] };
    const rot = opts.rot || 0;
    for (let k = 0; k < (opts.planes || 2); k++) {
      const a = rot + (k * Math.PI) / (opts.planes || 2);
      const dx = Math.cos(a) * hw, dz = Math.sin(a) * hw;
      this.quad([cx - dx, y0, cz - dz], [cx + dx, y0, cz + dz], [cx + dx, y0 + h, cz + dz], [cx - dx, y0 + h, cz - dz], o);
    }
    return this;
  }

  /** Thin line segment (only valid in a builder that is uploaded with lines:true). */
  line(a, b, color) {
    const c = rgb(color);
    this.vert(a[0], a[1], a[2], 0, 1, 0, 0, 0, c[0], c[1], c[2]);
    this.vert(b[0], b[1], b[2], 0, 1, 0, 0, 0, c[0], c[1], c[2]);
    return this;
  }

  build(renderer, opts = {}) {
    const verts = new Float32Array(this.v);
    if (opts.lines) return renderer.createMesh(verts, null, { lines: true });
    return renderer.createMesh(verts, new Uint32Array(this.i), opts);
  }
}

export { STRIDE };

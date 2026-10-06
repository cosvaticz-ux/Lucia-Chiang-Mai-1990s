// Modular level kit. All static scenery is appended to one MeshBuilder per
// material, so the whole neighbourhood draws in roughly twenty calls.
// A Frame lets a building be authored once in "facade space" (u along the
// front, y up, d outward) and placed facing any of the four street directions.

import { MeshBuilder } from '../engine/MeshBuilder.js';
import { Node } from '../engine/Node.js';
import { material } from '../engine/Renderer.js';
import { WALL, PROP, FENCE, CAMERA, BULLET, SOLID } from '../core/CollisionWorld.js';

const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };

export function shade(hex, k) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) * k)) | 0;
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) * k)) | 0;
  const b = Math.max(0, Math.min(255, (hex & 255) * k)) | 0;
  return (r << 16) | (g << 8) | b;
}

export class Kit {
  constructor(renderer, textures, world, signs, rnd) {
    this.r = renderer;
    this.T = textures;
    this.world = world;
    this.signs = signs;
    this.rnd = rnd;
    this.builders = new Map();
    this.lineBuilder = new MeshBuilder();
    this.lights = [];
    this.glows = [];
    const T = textures;
    // key -> [material, default tile size in metres]
    this.defs = {
      plaster: [material({ tex: T.plaster }), 2.4],
      concrete: [material({ tex: T.concrete }), 2.6],
      shutter: [material({ tex: T.shutter }), 1.7],
      street: [material({ tex: T.street }), 4],
      paver: [material({ tex: T.paver }), 1.3],
      wood: [material({ tex: T.wood }), 1.3],
      roof: [material({ tex: T.roof }), 1.1],
      metal: [material({ tex: T.metal }), 1.3],
      tile: [material({ tex: T.tile }), 1.0],
      crate: [material({ tex: T.crate }), 1],
      awning: [material({ tex: T.awning, cull: false }), 1.1],
      grate: [material({ tex: T.grate }), 0.45],
      flat: [material({}), 1],
      emit: [material({ unlit: true }), 1],
      window: [material({ tex: T.window }), 0],
      windowLit: [material({ tex: T.windowLit, unlit: true }), 0],
      foliage: [material({ tex: T.foliage, alphaTest: 0.5, cull: false }), 0],
      fern: [material({ tex: T.fern, alphaTest: 0.5, cull: false }), 0],
      bars: [material({ tex: T.bars, alphaTest: 0.5, cull: false }), 0],
      chain: [material({ tex: T.chain, alphaTest: 0.5, cull: false }), 0.35],
      poster: [material({ tex: T.poster }), 0],
      signs: [material({ tex: null, alphaTest: 0.5, emissive: 0.22 }), 0],
      signsLit: [material({ tex: null, alphaTest: 0.5, unlit: true }), 0],
      pool: [material({ tex: T.glow, unlit: true, blend: 'add', pass: 2, depthWrite: false, offset: true, dither: false }), 0],
      stain: [material({ tex: T.blob, blend: 'alpha', pass: 2, depthWrite: false, offset: true }), 0],
      far: [material({ unlit: true, fog: 0.45 }), 1],
      gold: [material({ emissive: 0.8, fog: 0.4 }), 1],
      beam: [material({ tex: T.glow, unlit: true, blend: 'add', pass: 3, depthWrite: false, cull: false, dither: false }), 0],
    };
  }

  b(key) {
    let m = this.builders.get(key);
    if (!m) {
      if (!this.defs[key]) throw new Error('Unknown kit material: ' + key);
      m = new MeshBuilder();
      this.builders.set(key, m);
    }
    return m;
  }

  tile(key) {
    return this.defs[key][1] || undefined;
  }

  /** World-aligned box by extents. opts.collide adds a matching collider. */
  box(key, x0, x1, y0, y1, z0, z1, opts = {}) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const o = opts.tile === undefined ? { ...opts, tile: this.tile(key) } : opts;
    this.b(key).boxMM(x0, x1, y0, y1, z0, z1, o);
    if (opts.collide) this.world.addBox(x0, x1, y0, y1, z0, z1, opts.collide, opts.tag || null);
    return this;
  }

  collide(x0, x1, y0, y1, z0, z1, flags = WALL, tag = null) {
    return this.world.addBox(x0, x1, y0, y1, z0, z1, flags, tag);
  }

  frame(ox, oz, dir) {
    return new Frame(this, ox, oz, dir);
  }

  /** Horizontal ground decal (additive light pool or dark stain). */
  groundDecal(key, x, z, rx, rz, color, alpha, y = 0.012) {
    this.b(key).quad([x - rx, y, z + rz], [x + rx, y, z + rz], [x + rx, y, z - rz], [x - rx, y, z - rz], { color, alpha });
  }

  light(x, y, z, range, hex, intensity, extra = {}) {
    const L = {
      x, y, z, range,
      r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255,
      intensity, base: intensity, on: true, shadow: true, ...extra,
    };
    this.lights.push(L);
    return L;
  }

  glow(x, y, z, size, hex, a, extra = {}) {
    const g = { x, y, z, size, r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, a, ...extra };
    this.glows.push(g);
    return g;
  }

  /** Sagging cable between two points. */
  cable(a, b, sag = 0.5, color = 0x0c0c10, segs = 6) {
    let prev = a;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
      this.lineBuilder.line(prev, p, color);
      prev = p;
    }
  }

  /** Bake every builder into a static node under root. */
  finish(root) {
    this.defs.signs[0].tex = this.defs.signsLit[0].tex = this.r.createTexture(this.signs.canvas, { repeat: false });
    for (const [key, builder] of this.builders) {
      if (builder.empty) continue;
      const n = new Node(builder.build(this.r), this.defs[key][0]);
      n.isStatic = true;
      root.add(n);
    }
    if (!this.lineBuilder.empty) {
      const n = new Node(this.lineBuilder.build(this.r, { lines: true }), material({ unlit: true, fog: 1 }));
      n.isStatic = true;
      root.add(n);
    }
  }
}

export class Frame {
  constructor(kit, ox, oz, dir) {
    this.kit = kit;
    this.ox = ox;
    this.oz = oz;
    this.dir = dir;
    const [fx, fz] = DIRS[dir];
    this.fx = fx;
    this.fz = fz;
    // right = up x forward, so u always runs to the viewer's right.
    this.rx = fz;
    this.rz = -fx;
  }

  pt(u, y, d) {
    return [this.ox + this.rx * u + this.fx * d, y, this.oz + this.rz * u + this.fz * d];
  }

  /** Local extents -> world extents [x0,x1,z0,z1]. */
  ext(u0, u1, d0, d1) {
    const a = this.pt(u0, 0, d0), b = this.pt(u1, 0, d1);
    return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[2], b[2])];
  }

  box(key, u0, u1, y0, y1, d0, d1, opts = {}) {
    const [x0, x1, z0, z1] = this.ext(u0, u1, d0, d1);
    this.kit.box(key, x0, x1, y0, y1, z0, z1, opts);
    return this;
  }

  collide(u0, u1, y0, y1, d0, d1, flags = WALL, tag = null) {
    const [x0, x1, z0, z1] = this.ext(u0, u1, d0, d1);
    return this.kit.collide(x0, x1, y0, y1, z0, z1, flags, tag);
  }

  /** Vertical quad parallel to the facade, facing outward. */
  wall(key, u0, u1, y0, y1, d, opts = {}) {
    const t = this.kit.tile(key);
    const o = opts.uv || opts.tile !== undefined || !t ? opts : { ...opts, tile: t };
    this.kit.b(key).quad(this.pt(u0, y0, d), this.pt(u1, y0, d), this.pt(u1, y1, d), this.pt(u0, y1, d), o);
    return this;
  }

  /** Arbitrary quad from four local [u,y,d] corners (BL, BR, TR, TL). */
  quad(key, pts, opts = {}) {
    const t = this.kit.tile(key);
    const o = opts.uv || opts.tile !== undefined || !t ? opts : { ...opts, tile: t };
    this.kit.b(key).quad(this.pt(...pts[0]), this.pt(...pts[1]), this.pt(...pts[2]), this.pt(...pts[3]), o);
    return this;
  }

  /** Flat sign on the facade, centred at (u, y). */
  sign(ref, u, y, d, w, h, lit = false, opts = {}) {
    this.kit.b(lit ? 'signsLit' : 'signs').quad(
      this.pt(u - w / 2, y - h / 2, d), this.pt(u + w / 2, y - h / 2, d),
      this.pt(u + w / 2, y + h / 2, d), this.pt(u - w / 2, y + h / 2, d),
      { uv: ref.uv, color: opts.color },
    );
    return this;
  }

  /** Projecting blade sign, readable from both directions along the street. */
  blade(ref, u, y, w, h, lit = false, opts = {}) {
    const d0 = opts.d0 === undefined ? 0.22 : opts.d0, d1 = d0 + w;
    const t = 0.05;
    const key = lit ? 'signsLit' : 'signs';
    const b = this.kit.b(key);
    const y0 = y - h / 2, y1 = y + h / 2;
    // Face looking back along -right, then the face looking along +right.
    b.quad(this.pt(u - t, y0, d0), this.pt(u - t, y0, d1), this.pt(u - t, y1, d1), this.pt(u - t, y1, d0), { uv: ref.uv });
    b.quad(this.pt(u + t, y0, d1), this.pt(u + t, y0, d0), this.pt(u + t, y1, d0), this.pt(u + t, y1, d1), { uv: ref.uv });
    this.box('flat', u - t + 0.005, u + t - 0.005, y0 - 0.04, y1 + 0.04, d0 - 0.04, d1 + 0.04, { color: opts.frame || 0x2a2622 });
    this.box('flat', u - 0.02, u + 0.02, y1 - 0.15, y1 - 0.1, 0, d0, { color: 0x2a2622 });
    this.box('flat', u - 0.02, u + 0.02, y0 + 0.1, y0 + 0.15, 0, d0, { color: 0x2a2622 });
    return this;
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

const GROUND_H = 3.3;
const FLOOR_H = 3.1;

/**
 * Thai shophouse. The facade spans u in [0, W] at d = 0, the body extends to d = -D.
 * o: { floors, tint, ground: 'shutter'|'half'|'door'|'none', shutter, sign, signLit,
 *      blade, bladeLit, canopy: 'slab'|'awning'|'none', awning, roof: 'flat'|'tile',
 *      balcony, lit (chance of a lit window), noCollide, trim }
 */
export function shophouse(kit, f, W, D, o = {}) {
  const rnd = kit.rnd;
  const floors = o.floors || 2;
  const H = GROUND_H + (floors - 1) * FLOOR_H + 0.55;
  const tint = o.tint || 0xcfc8b8;
  const trim = o.trim || shade(tint, 0.78);

  f.box('plaster', 0, W, 0, H, -D, 0, { color: tint, ao: 0.42, collide: o.noCollide ? 0 : WALL });

  // Pilasters and plinth.
  f.box('plaster', 0, 0.3, 0, GROUND_H, 0, 0.14, { color: trim, ao: 0.4 });
  f.box('plaster', W - 0.3, W, 0, GROUND_H, 0, 0.14, { color: trim, ao: 0.4 });
  f.box('concrete', 0.3, W - 0.3, 0, 0.09, 0, 0.3, { color: 0x8c877c });

  const g = o.ground || 'shutter';
  if (g === 'shutter') {
    f.wall('shutter', 0.3, W - 0.3, 0.09, 2.78, 0.03, { color: o.shutter || 0x86909a, ao: 0.35 });
  } else if (g === 'half') {
    // Shutter stuck half way: black interior below.
    f.wall('flat', 0.3, W - 0.3, 0.09, 1.25, 0.02, { color: 0x060607 });
    f.wall('shutter', 0.3, W - 0.3, 1.25, 2.78, 0.05, { color: o.shutter || 0x86909a });
    f.box('flat', 0.3, W - 0.3, 1.2, 1.3, 0.03, 0.09, { color: 0x3a3a3c });
  } else if (g === 'door') {
    const du = W * 0.3;
    f.wall('wood', du - 0.5, du + 0.5, 0.09, 2.25, 0.03, { color: o.door || 0x6a5240, ao: 0.3 });
    f.box('flat', du - 0.58, du + 0.58, 2.25, 2.33, 0, 0.06, { color: trim });
    f.wall('window', W * 0.68 - 0.65, W * 0.68 + 0.65, 1.05, 2.3, 0.03, {});
    f.box('concrete', W * 0.68 - 0.75, W * 0.68 + 0.75, 0.95, 1.05, 0, 0.1, { color: 0x9a958a });
    f.wall('bars', W * 0.68 - 0.65, W * 0.68 + 0.65, 1.05, 2.3, 0.07, { uv: [0, 0, 4, 1], color: 0x5a554c });
  }

  // Fascia with the shop sign.
  f.box('flat', 0.3, W - 0.3, 2.78, GROUND_H - 0.02, 0, 0.07, { color: shade(trim, 0.6) });
  if (o.sign) {
    const sw = Math.min(W - 0.9, 0.42 * o.sign.aspect);
    f.sign(o.sign, W / 2, 3.03, 0.085, sw, sw / o.sign.aspect, !!o.signLit);
  }

  const canopy = o.canopy || 'slab';
  if (canopy === 'slab') {
    f.box('concrete', -0.04, W + 0.04, GROUND_H, GROUND_H + 0.13, 0, 1.15, { color: 0x9c978c, collide: CAMERA | BULLET });
  } else if (canopy === 'awning') {
    const c = o.awning || 0x9a4038;
    f.quad('awning', [[0.2, GROUND_H - 0.62, 1.35], [W - 0.2, GROUND_H - 0.62, 1.35], [W - 0.2, GROUND_H, 0.05], [0.2, GROUND_H, 0.05]], { color: c });
    f.wall('awning', 0.2, W - 0.2, GROUND_H - 0.82, GROUND_H - 0.62, 1.35, { color: shade(c, 0.85), double: true });
    for (const u of [0.25, W - 0.25]) f.box('flat', u - 0.02, u + 0.02, GROUND_H - 0.64, GROUND_H - 0.6, 0.05, 1.35, { color: 0x30302e });
    f.collide(0.2, W - 0.2, GROUND_H - 0.7, GROUND_H, 0, 1.35, CAMERA);
  }

  // Upper floors.
  for (let fl = 1; fl < floors; fl++) {
    const y0 = GROUND_H + (fl - 1) * FLOOR_H;
    const n = W >= 5.6 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const uc = (W * (i + 0.5)) / n;
      const lit = rnd.chance(o.lit === undefined ? 0.16 : o.lit);
      const ww = 0.52, wy0 = y0 + 0.95, wy1 = y0 + 2.3;
      f.wall(lit ? 'windowLit' : 'window', uc - ww, uc + ww, wy0, wy1, 0.02, lit ? { color: [0.85, 0.8, 0.7] } : {});
      f.box('concrete', uc - ww - 0.1, uc + ww + 0.1, wy0 - 0.1, wy0, 0, 0.11, { color: shade(trim, 0.95) });
      if (rnd.chance(0.3)) f.box('flat', uc - ww - 0.05, uc + ww + 0.05, wy1, wy1 + 0.06, 0, 0.3, { color: shade(trim, 0.7) });
      if (lit) kit.glow(...f.pt(uc, (wy0 + wy1) / 2, 0.25), 1.5, 0xffb060, 0.2);
    }
    f.box('plaster', 0, W, y0 + FLOOR_H - 0.14, y0 + FLOOR_H, 0, 0.06, { color: trim });
    if (o.balcony && fl === 1) {
      f.box('concrete', 0.25, W - 0.25, y0 + 0.02, y0 + 0.14, 0, 0.75, { color: 0x938e84, collide: CAMERA });
      f.wall('bars', 0.25, W - 0.25, y0 + 0.14, y0 + 1.0, 0.73, { uv: [0, 0, (W - 0.5) / 0.45, 1], color: 0x4a4640, double: true });
      for (const u of [0.25, W - 0.25]) {
        f.quad('bars', [[u, y0 + 0.14, 0], [u, y0 + 0.14, 0.73], [u, y0 + 1.0, 0.73], [u, y0 + 1.0, 0]], { uv: [0, 0, 1.6, 1], color: 0x4a4640, double: true });
      }
      // Laundry on the rail: a classic.
      if (rnd.chance(0.6)) {
        for (let k = 0; k < 3; k++) {
          const u = 0.6 + rnd() * (W - 1.6);
          f.wall('flat', u, u + 0.45, y0 + 0.5, y0 + 1.02, 0.76, { color: rnd.pick([0xb8b0a0, 0x7d8ea0, 0xa07068, 0xc8c2b0]), double: true });
        }
      }
    }
    // Air conditioner or drip stain under some windows.
    if (rnd.chance(0.45)) {
      const u = rnd.range(0.5, W - 1.2);
      f.box('flat', u, u + 0.75, y0 + 0.3, y0 + 0.8, 0, 0.32, { color: 0xb0ad9f });
      f.wall('grate', u + 0.06, u + 0.69, y0 + 0.35, y0 + 0.75, 0.325, { color: 0x7a786e, tile: 0.2 });
      f.wall('flat', u + 0.3, u + 0.36, y0 - 0.9, y0 + 0.3, 0.012, { color: shade(tint, 0.55) });
    }
  }

  // Roofline.
  if (o.roof === 'tile') {
    const yb = H - 0.55, rise = Math.min(1.9, D * 0.3);
    f.quad('roof', [[-0.25, yb, 0.5], [W + 0.25, yb, 0.5], [W + 0.25, yb + rise, -D / 2], [-0.25, yb + rise, -D / 2]], { color: o.roofTint || 0x9a5a44 });
    f.quad('roof', [[W + 0.25, yb, -D - 0.3], [-0.25, yb, -D - 0.3], [-0.25, yb + rise, -D / 2], [W + 0.25, yb + rise, -D / 2]], { color: shade(o.roofTint || 0x9a5a44, 0.8) });
    f.box('wood', -0.25, W + 0.25, yb - 0.1, yb, 0, 0.5, { color: 0x4a3c30 });
    // Gable ends.
    kit.b('plaster').tri(f.pt(0, yb, 0), f.pt(0, yb, -D), f.pt(0, yb + rise, -D / 2), { color: shade(tint, 0.85), tile: 2.4, double: true });
    kit.b('plaster').tri(f.pt(W, yb, -D), f.pt(W, yb, 0), f.pt(W, yb + rise, -D / 2), { color: shade(tint, 0.85), tile: 2.4, double: true });
  } else {
    f.box('concrete', -0.05, W + 0.05, H - 0.2, H, -D, 0.1, { color: shade(trim, 0.9) });
    if (rnd.chance(0.55)) {
      // Rooftop water tank on a stand.
      const u = rnd.range(1, W - 1), d = -rnd.range(1.2, Math.max(1.3, D - 1.5));
      const p = f.pt(u, H, d);
      kit.b('flat').cyl(p[0], H + 0.5, p[2], 0.5, 1.1, { color: 0x8d9296, seg: 8 });
      kit.b('flat').lathe(p[0], H + 1.6, p[2], [[0.5, 0], [0.0, 0.25]], { color: 0x7d8286, seg: 8 });
      kit.b('flat').box(p[0], H + 0.25, p[2], 0.8, 0.5, 0.8, { color: 0x3a3632 });
    }
    if (rnd.chance(0.6)) {
      // TV aerial.
      const p = f.pt(rnd.range(0.6, W - 0.6), H, -rnd.range(0.4, 1.5));
      kit.b('flat').box(p[0], H + 1.2, p[2], 0.04, 2.4, 0.04, { color: 0x1c1c20 });
      for (let k = 0; k < 4; k++) kit.b('flat').box(p[0], H + 1.5 + k * 0.25, p[2], 0.9 - k * 0.15, 0.02, 0.02, { color: 0x1c1c20 });
    }
  }

  if (o.blade) f.blade(o.blade, o.bladeU === undefined ? W - 0.6 : o.bladeU, o.bladeY || GROUND_H + 1.9, o.blade.w || 0.55, o.blade.h || 2.2, !!o.bladeLit);

  // Drain pipe down one edge.
  if (rnd.chance(0.7)) f.box('flat', 0.34, 0.42, 0.1, H - 0.2, 0.14, 0.22, { color: shade(tint, 0.5) });
  return H;
}

// ---------------------------------------------------------------------------
// Props (world space)
// ---------------------------------------------------------------------------

function wheel(g, x, y, z, r, w, hub = 0x5c5c5a) {
  g.push(x, y, z, 0, 0, Math.PI / 2);
  g.lathe(0, -w / 2, 0, [[r * 0.86, 0], [r, w * 0.2], [r, w * 0.8], [r * 0.86, w]], { seg: 10, color: 0x16161a, capColor: 0x0c0c0e, capTop: true, capBottom: true });
  g.lathe(0, -w / 2 - 0.004, 0, [[r * 0.4, 0], [r * 0.4, w + 0.008]], { seg: 6, color: hub, capTop: true, capBottom: true });
  g.pop();
}

/** Dark wheel-well panels so wheels read as sitting inside the body. */
function arches(g, halfW, zs, r) {
  for (const zw of zs) for (const sx of [-1, 1]) g.box(sx * halfW, r * 0.75, zw, 0.012, r * 1.15, r * 2.2, { color: 0x09090b });
}

function vehicleCollider(kit, x, z, ry, halfW, halfL, h, flags = WALL) {
  const along = Math.abs(Math.sin(ry)) > 0.7;
  const hx = along ? halfL : halfW, hz = along ? halfW : halfL;
  kit.collide(x - hx, x + hx, 0, h, z - hz, z + hz, flags, 'metal');
  kit.groundDecal('stain', x, z, hx * 1.25, hz * 1.15, 0x000000, 0.62);
}

/** Compact 1990s pickup. opts.songthaew adds the covered passenger box. */
export function pickup(kit, x, z, ry, color, opts = {}) {
  const g = kit.b('flat');
  const glass = 0x141a20, chrome = 0x6c6e70, dark = shade(color, 0.7);
  g.push(x, 0, z, 0, ry, 0);
  for (const zw of [1.45, -1.42]) for (const sx of [-1, 1]) wheel(g, sx * 0.75, 0.31, zw, 0.31, 0.2);
  arches(g, 0.812, [1.45, -1.42], 0.31);
  g.box(0, 0.53, 0, 1.62, 0.42, 4.5, { color, ao: 0.3 });
  g.tbox(0, 0.85, 1.62, 1.6, 1.3, 1.52, 1.2, 0.22, { color });
  g.box(0, 0.87, 0.3, 1.6, 0.26, 1.4, { color });
  g.tbox(0, 1.27, 0.25, 1.56, 1.38, 1.36, 0.95, 0.54, { color: glass });
  g.box(0, 1.56, 0.25, 1.38, 0.045, 0.98, { color });
  for (const sx of [-1, 1]) {
    g.box(sx * 0.7, 1.27, 0.25, 0.06, 0.54, 0.07, { color });
    g.box(sx * 0.62, 0.77, 2.26, 0.3, 0.13, 0.03, { color: 0xa9a27c });
    g.box(sx * 0.7, 0.82, -2.26, 0.14, 0.2, 0.03, { color: 0x6a1410 });
  }
  g.box(0, 0.4, 2.29, 1.66, 0.15, 0.1, { color: chrome });
  g.box(0, 0.4, -2.29, 1.66, 0.15, 0.1, { color: chrome });
  g.box(0, 0.62, 2.265, 0.9, 0.16, 0.02, { color: 0x1a1a1c });
  g.box(0, 0.5, -2.3, 0.4, 0.12, 0.02, { color: 0xd8d2b8 });
  if (opts.songthaew) {
    g.box(0, 1.33, -1.33, 1.64, 1.02, 1.92, { color });
    g.box(0, 1.87, -1.33, 1.7, 0.06, 2.0, { color: dark });
    for (const sx of [-1, 1]) {
      g.box(sx * 0.825, 1.42, -1.33, 0.012, 0.5, 1.6, { color: 0x0c0c0e });
      g.box(sx * 0.83, 1.02, -1.33, 0.012, 0.09, 1.9, { color: 0xc8b040 });
      g.box(sx * 0.6, 1.95, -1.33, 0.04, 0.1, 1.9, { color: 0x30302e });
    }
    g.box(0, 1.35, -2.295, 1.1, 0.95, 0.012, { color: 0x09090a });
    g.box(0, 0.36, -2.5, 1.0, 0.05, 0.36, { color: 0x30302e });
  } else {
    for (const sx of [-1, 1]) g.box(sx * 0.77, 0.9, -1.38, 0.07, 0.34, 1.85, { color });
    g.box(0, 0.9, -2.26, 1.6, 0.34, 0.07, { color });
    g.box(0, 0.9, -0.45, 1.6, 0.34, 0.07, { color });
    g.box(0, 0.76, -1.38, 1.5, 0.04, 1.8, { color: dark });
  }
  g.pop();
  vehicleCollider(kit, x, z, ry, 0.84, 2.32, opts.songthaew ? 1.9 : 1.5);
}

export function sedan(kit, x, z, ry, color) {
  const g = kit.b('flat');
  const glass = 0x12181e, chrome = 0x66686a;
  g.push(x, 0, z, 0, ry, 0);
  for (const zw of [1.32, -1.3]) for (const sx of [-1, 1]) wheel(g, sx * 0.75, 0.29, zw, 0.29, 0.19);
  arches(g, 0.812, [1.32, -1.3], 0.29);
  g.box(0, 0.56, 0, 1.62, 0.42, 4.25, { color, ao: 0.3 });
  g.tbox(0, 1.02, -0.15, 1.56, 2.45, 1.3, 1.45, 0.5, { color: glass });
  g.box(0, 1.29, -0.15, 1.32, 0.045, 1.48, { color });
  for (const sx of [-1, 1]) {
    g.box(sx * 0.66, 1.02, -0.15, 0.05, 0.5, 0.07, { color });
    g.box(sx * 0.6, 0.62, 2.13, 0.32, 0.12, 0.03, { color: 0xa9a27c });
    g.box(sx * 0.58, 0.64, -2.13, 0.4, 0.13, 0.03, { color: 0x6a1410 });
  }
  g.box(0, 0.4, 2.14, 1.66, 0.14, 0.1, { color: chrome });
  g.box(0, 0.4, -2.14, 1.66, 0.14, 0.1, { color: chrome });
  g.box(0, 0.6, 2.13, 0.7, 0.1, 0.02, { color: 0x18181a });
  g.pop();
  vehicleCollider(kit, x, z, ry, 0.84, 2.16, 1.3);
}

/** Step-through motorbike. lean tilts it onto its side stand. */
export function motorbike(kit, x, z, ry, color, lean = 0.14) {
  const g = kit.b('flat');
  const dark = 0x151517, metal = 0x6a6c70;
  g.push(x, 0, z, 0, ry, lean);
  wheel(g, 0, 0.27, 0.62, 0.27, 0.08, 0x55565a);
  wheel(g, 0, 0.27, -0.6, 0.27, 0.08, 0x55565a);
  g.box(0, 0.5, -0.28, 0.2, 0.2, 0.78, { color });
  g.box(0, 0.66, -0.22, 0.25, 0.08, 0.72, { color: dark });
  g.tbox(0, 0.56, 0.3, 0.36, 0.06, 0.3, 0.06, 0.5, { color: 0xc9c5b8 });
  g.push(0, 0.62, 0.52, -0.38, 0, 0).box(0, 0, 0, 0.07, 0.78, 0.07, { color: metal }).pop();
  g.box(0, 0.98, 0.4, 0.58, 0.04, 0.05, { color: dark });
  g.box(0, 0.86, 0.47, 0.17, 0.15, 0.1, { color });
  g.box(0, 0.87, 0.525, 0.11, 0.09, 0.012, { color: 0xb8b490 });
  g.box(0, 0.62, -0.72, 0.18, 0.1, 0.14, { color: 0x6a1410 });
  g.box(0.13, 0.3, -0.42, 0.07, 0.07, 0.62, { color: metal });
  g.box(0, 0.36, 0.02, 0.24, 0.16, 0.32, { color: 0x2c2c30 });
  g.pop();
  const along = Math.abs(Math.sin(ry)) > 0.7;
  const hx = along ? 0.9 : 0.28, hz = along ? 0.28 : 0.9;
  kit.collide(x - hx, x + hx, 0, 1.0, z - hz, z + hz, PROP, 'metal');
  kit.groundDecal('stain', x, z, hx * 1.3, hz * 1.3, 0x000000, 0.5);
}

/** Concrete utility pole with crossarms; returns the cable attachment points. */
export function pole(kit, x, z, opts = {}) {
  const h = opts.h || 8.2;
  kit.box('concrete', x - 0.13, x + 0.13, 0, h, z - 0.13, z + 0.13, { color: 0x8a867c, ao: 0.4, collide: WALL });
  const along = opts.along || 'x'; // crossarm axis
  const arms = [h - 0.5, h - 1.3];
  const tips = [];
  for (const ay of arms) {
    if (along === 'x') kit.box('wood', x - 0.9, x + 0.9, ay - 0.05, ay + 0.05, z - 0.05, z + 0.05, { color: 0x3c3229 });
    else kit.box('wood', x - 0.05, x + 0.05, ay - 0.05, ay + 0.05, z - 0.9, z + 0.9, { color: 0x3c3229 });
    for (const s of [-0.8, -0.3, 0.3, 0.8]) {
      const px = along === 'x' ? x + s : x, pz = along === 'x' ? z : z + s;
      kit.b('flat').cyl(px, ay + 0.05, pz, 0.035, 0.12, { color: 0x9fa6a0, seg: 5 });
      tips.push([px, ay + 0.17, pz]);
    }
  }
  if (opts.transformer) {
    const tx = x + (opts.transformer > 0 ? 0.38 : -0.38);
    kit.b('flat').cyl(tx, h - 3.3, z, 0.3, 0.95, { color: 0x666c70, seg: 8 });
    kit.b('flat').cyl(tx, h - 2.35, z, 0.06, 0.25, { color: 0xb8b8b0, seg: 5 });
    kit.box('flat', tx - 0.35, tx + 0.35, h - 3.42, h - 3.3, z - 0.3, z + 0.3, { color: 0x2c2a28 });
  }
  // A drooping tangle of low-voltage lines junctions here.
  tips.push([x, h - 2.2, z], [x, h - 2.45, z], [x, h - 2.6, z]);
  if (opts.lamp) {
    const sx = opts.lamp.dx || 0, sz = opts.lamp.dz || 0;
    const ly = opts.lamp.y || 5.6;
    const hx = x + sx, hz = z + sz;
    // Arm
    kit.box('flat', Math.min(x, hx) - 0.03, Math.max(x, hx) + 0.03, ly + 0.12, ly + 0.18, Math.min(z, hz) - 0.03, Math.max(z, hz) + 0.03, { color: 0x2c2c2e });
    kit.box('flat', hx - 0.2, hx + 0.2, ly, ly + 0.14, hz - 0.2, hz + 0.2, { color: 0x3a3a3c });
    const col = opts.lamp.color || 0xffb45e;
    if (opts.lamp.on !== false) {
      kit.box('emit', hx - 0.15, hx + 0.15, ly - 0.05, ly, hz - 0.15, hz + 0.15, { color: col });
      const L = kit.light(hx, ly - 0.5, hz, opts.lamp.range || 13, col, opts.lamp.intensity || 1.25, { flicker: opts.lamp.flicker || 0 });
      L.glow = kit.glow(hx, ly - 0.05, hz, 1.25, col, 0.6);
      L.pool = null;
      kit.groundDecal('pool', hx, hz, 4.2, 4.2, col, 0.16);
      // Fake volumetric cone.
      const b = kit.b('beam');
      for (let k = 0; k < 2; k++) {
        const a = k * Math.PI / 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        b.quad([hx - dx * 2.6, 0.05, hz - dz * 2.6], [hx + dx * 2.6, 0.05, hz + dz * 2.6], [hx + dx * 0.25, ly, hz + dz * 0.25], [hx - dx * 0.25, ly, hz - dz * 0.25],
          { uv: [0, 0.5, 1, 0.5], color: col, alphas: [0, 0, 0.1, 0.1] });
      }
      return { tips, light: L };
    }
    kit.box('flat', hx - 0.15, hx + 0.15, ly - 0.05, ly, hz - 0.15, hz + 0.15, { color: 0x4a4840 });
  }
  return { tips, light: null };
}

export function crate(kit, x, z, s, y0 = 0, tint = 0xa89674) {
  kit.box('crate', x - s / 2, x + s / 2, y0, y0 + s, z - s / 2, z + s / 2, { color: tint, tile: s, ao: 0.25, collide: PROP });
}

export function cardboard(kit, x, z, sx, sy, sz, y0 = 0) {
  kit.box('flat', x - sx / 2, x + sx / 2, y0, y0 + sy, z - sz / 2, z + sz / 2, { color: 0x9a7c54, ao: 0.3, collide: PROP });
  kit.box('flat', x - sx / 2 - 0.004, x + sx / 2 + 0.004, y0 + sy - 0.02, y0 + sy + 0.004, z - 0.03, z + 0.03, { color: 0xb8a070 });
}

export function garbageBag(kit, x, z, s = 0.4, color = 0x121214) {
  const rnd = kit.rnd;
  kit.b('flat').sphere(x, s * 0.62, z, s, s * 0.7, s * 0.9, { color, seg: 6, rings: 4 });
  kit.b('flat').lathe(x + rnd.range(-0.05, 0.05), s * 1.2, z, [[0.07, 0], [0.02, 0.1], [0.07, 0.16]], { color: shade(color, 1.6), seg: 5 });
}

export function trashCan(kit, x, z, color = 0x3d5a4a) {
  kit.b('flat').lathe(x, 0, z, [[0.26, 0], [0.31, 0.82]], { color, seg: 8, capColor: 0x0a0a0a });
  kit.b('flat').lathe(x, 0.8, z, [[0.33, 0], [0.33, 0.05]], { color: shade(color, 0.7), seg: 8, capTop: false });
  kit.collide(x - 0.3, x + 0.3, 0, 0.85, z - 0.3, z + 0.3, PROP, 'metal');
  kit.groundDecal('stain', x, z, 0.6, 0.6, 0x000000, 0.5);
}

export function trafficCone(kit, x, z) {
  kit.b('flat').box(x, 0.02, z, 0.36, 0.04, 0.36, { color: 0x8a3a18 });
  kit.b('flat').lathe(x, 0.04, z, [[0.15, 0], [0.11, 0.2], [0.09, 0.32], [0.035, 0.6]], { seg: 6, colors: [0xc24a18, 0xd8d2c0, 0xc24a18, 0xc24a18] });
}

export function pottedPlant(kit, x, z, s = 1, kind = 'fern') {
  kit.b('flat').lathe(x, 0, z, [[0.16 * s, 0], [0.24 * s, 0.34 * s]], { color: 0x8a4a32, seg: 7, capColor: 0x2a1c14 });
  if (kind === 'fern') {
    kit.b('fern').cross(x, 0.3 * s, z, 1.05 * s, 1.0 * s, { planes: 3, rot: kit.rnd() * 3, color: [0.4, 0.52, 0.38] });
  } else {
    kit.b('flat').cyl(x, 0.3 * s, z, 0.03, 0.6 * s, { color: 0x3a2c20, seg: 4 });
    kit.b('foliage').cross(x, 0.6 * s, z, 1.0 * s, 1.0 * s, { planes: 3, rot: kit.rnd() * 3, color: [0.42, 0.54, 0.4] });
  }
  kit.collide(x - 0.2 * s, x + 0.2 * s, 0, 0.5, z - 0.2 * s, z + 0.2 * s, SOLID);
}

/** Background tree: trunk plus blobby canopy. No collision. */
export function tree(kit, x, z, h = 6, r = 2.4, tint = 0x24382a) {
  const rnd = kit.rnd;
  kit.b('flat').cyl(x, 0, z, 0.2, h * 0.6, { color: 0x2c241c, seg: 5, rTop: 0.12 });
  for (let i = 0; i < 4; i++) {
    const a = rnd() * 6.28, d = rnd() * r * 0.5;
    kit.b('flat').sphere(x + Math.cos(a) * d, h * (0.62 + rnd() * 0.3), z + Math.sin(a) * d, r * (0.55 + rnd() * 0.3), r * (0.4 + rnd() * 0.25), r * (0.55 + rnd() * 0.3),
      { color: shade(tint, 0.8 + rnd() * 0.5), seg: 6, rings: 4 });
  }
  for (let i = 0; i < 5; i++) {
    const a = rnd() * 6.28, d = r * (0.5 + rnd() * 0.5);
    kit.b('foliage').cross(x + Math.cos(a) * d, h * (0.45 + rnd() * 0.4), z + Math.sin(a) * d, r * 1.1, r * 1.1, { planes: 2, rot: rnd() * 3, color: [0.36, 0.5, 0.36] });
  }
}

export function sandbags(kit, x, z, n, alongX = true) {
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n - row; i++) {
      const o = (i - (n - row - 1) / 2) * 0.62;
      const px = alongX ? x + o : x, pz = alongX ? z : z + o;
      kit.b('flat').sphere(px, 0.14 + row * 0.25, pz, alongX ? 0.34 : 0.2, 0.15, alongX ? 0.2 : 0.34, { color: row ? 0x7d7458 : 0x6f684e, seg: 6, rings: 4 });
    }
  }
  const half = (n * 0.62) / 2;
  if (alongX) kit.collide(x - half, x + half, 0, 0.55, z - 0.22, z + 0.22, PROP);
  else kit.collide(x - 0.22, x + 0.22, 0, 0.55, z - half, z + half, PROP);
}

/** Thai spirit house on a pillar, with a red votive glow. */
export function spiritHouse(kit, x, z, facing = 'S') {
  const g = kit.b('flat');
  g.cyl(x, 0, z, 0.09, 1.25, { color: 0xc9c2b0, seg: 6 });
  g.box(x, 1.29, z, 0.7, 0.08, 0.7, { color: 0xd4ccb8 });
  g.box(x, 1.5, z, 0.44, 0.34, 0.4, { color: 0xb03a2a });
  g.lathe(x, 1.67, z, [[0.4, 0], [0.16, 0.2], [0.07, 0.36], [0.0, 0.62]], { seg: 4, colors: [0xc8a038, 0xc8a038, 0xd8b84a, 0xd8b84a] });
  const [fx, fz] = DIRS[facing];
  g.box(x + fx * 0.21, 1.47, z + fz * 0.21, fx ? 0.01 : 0.18, 0.22, fz ? 0.01 : 0.18, { color: 0x1a0c08 });
  // Offerings: garland and a soda bottle with a straw.
  g.box(x + fx * 0.28 + fz * 0.15, 1.38, z + fz * 0.28 + fx * 0.15, 0.05, 0.12, 0.05, { color: 0xa82c20 });
  g.box(x + fx * 0.28 - fz * 0.12, 1.36, z + fz * 0.28 - fx * 0.12, 0.12, 0.05, 0.12, { color: 0xd8c040 });
  kit.box('emit', x + fx * 0.3 - 0.02, x + fx * 0.3 + 0.02, 1.34, 1.4, z + fz * 0.3 - 0.02, z + fz * 0.3 + 0.02, { color: 0xff5030 });
  kit.glow(x + fx * 0.3, 1.42, z + fz * 0.3, 0.42, 0xff4020, 0.5, { flicker: 9 });
  kit.collide(x - 0.3, x + 0.3, 0, 2.0, z - 0.3, z + 0.3, PROP);
}

/** Glazed water jar, common in northern Thai yards. */
export function waterJar(kit, x, z, s = 1) {
  kit.b('flat').lathe(x, 0, z, [[0.2 * s, 0], [0.36 * s, 0.3 * s], [0.38 * s, 0.55 * s], [0.24 * s, 0.8 * s], [0.27 * s, 0.86 * s]],
    { seg: 8, colors: [0x4a2e1e, 0x5c3a24, 0x6a4428, 0x5c3a24, 0x5c3a24], capColor: 0x0a0c10 });
  kit.collide(x - 0.34 * s, x + 0.34 * s, 0, 0.86 * s, z - 0.34 * s, z + 0.34 * s, PROP);
}

/** Noodle cart with a parasol. */
export function foodCart(kit, x, z, signRef) {
  const g = kit.b('flat');
  for (const sx of [-1, 1]) wheel(g, x + sx * 0.54, 0.3, z + 0.1, 0.3, 0.05, 0x777777);
  kit.box('metal', x - 0.5, x + 0.5, 0.45, 0.95, z - 0.6, z + 0.6, { color: 0xb9b6a8, collide: PROP, tag: 'metal' });
  kit.box('flat', x - 0.52, x + 0.52, 0.95, 0.99, z - 0.62, z + 0.62, { color: 0x8a8a86 });
  // Glass case with a lit tube.
  kit.box('flat', x - 0.45, x + 0.45, 0.99, 1.02, z - 0.55, z + 0.1, { color: 0x3a3a3a });
  for (const [px, pz] of [[-0.45, -0.55], [0.45, -0.55], [-0.45, 0.1], [0.45, 0.1]]) g.box(x + px, 1.3, z + pz, 0.03, 0.6, 0.03, { color: 0x8a8a86 });
  kit.box('flat', x - 0.47, x + 0.47, 1.6, 1.64, z - 0.57, z + 0.12, { color: 0x8a8a86 });
  kit.box('emit', x - 0.4, x + 0.4, 1.56, 1.6, z - 0.26, z - 0.2, { color: 0xdfe8d0 });
  kit.glow(x, 1.5, z - 0.22, 0.7, 0xd8f0d0, 0.28, { flicker: 23 });
  g.box(x - 0.2, 1.12, z - 0.3, 0.3, 0.2, 0.3, { color: 0x9aa0a0 });
  g.cyl(x + 0.2, 0.99, z + 0.35, 0.17, 0.26, { color: 0x8e9498, seg: 7, capColor: 0x2a2a2a });
  // Parasol
  g.cyl(x, 0.99, z + 0.5, 0.025, 1.6, { color: 0x4a4a4c, seg: 4 });
  g.lathe(x, 2.42, z + 0.5, [[1.25, 0], [0.5, 0.26], [0.0, 0.4]], { seg: 8, colors: [0x9a3a30, 0xc8c0a8, 0x9a3a30] });
  if (signRef) {
    kit.b('signs').quad([x - 0.5, 0.5, z + 0.605], [x + 0.5, 0.5, z + 0.605], [x + 0.5, 0.9, z + 0.605], [x - 0.5, 0.9, z + 0.605], { uv: signRef.uv });
    kit.b('signs').quad([x + 0.5, 0.5, z - 0.605], [x - 0.5, 0.5, z - 0.605], [x - 0.5, 0.9, z - 0.605], [x + 0.5, 0.9, z - 0.605], { uv: signRef.uv });
  }
  kit.groundDecal('stain', x, z, 1.1, 1.2, 0x000000, 0.55);
}

/** Coin phone under a hood on a post. */
export function phoneBooth(kit, x, z, facing, signRef) {
  const f = kit.frame(x, z, facing);
  f.box('flat', -0.06, 0.06, 0, 2.1, -0.06, 0.06, { color: 0x4a4e52 });
  f.box('flat', -0.42, 0.42, 1.05, 2.15, -0.1, -0.04, { color: 0x3d6a8a });
  f.box('flat', -0.45, -0.39, 1.05, 2.15, -0.1, 0.42, { color: 0x3d6a8a });
  f.box('flat', 0.39, 0.45, 1.05, 2.15, -0.1, 0.42, { color: 0x3d6a8a });
  f.box('flat', -0.47, 0.47, 2.15, 2.22, -0.12, 0.46, { color: 0xc8a030 });
  f.box('flat', -0.16, 0.16, 1.25, 1.75, -0.04, 0.1, { color: 0x24262a });
  f.box('flat', -0.12, -0.05, 1.3, 1.62, 0.1, 0.15, { color: 0x0e0e10 });
  if (signRef) f.sign(signRef, 0, 1.95, -0.03, 0.6, 0.18);
  f.collide(-0.45, 0.45, 0, 2.2, -0.12, 0.3, PROP | 8, 'metal');
}

/** Red pillar post box. */
export function postBox(kit, x, z) {
  kit.b('flat').lathe(x, 0, z, [[0.24, 0], [0.24, 0.1], [0.2, 0.12], [0.2, 1.05], [0.23, 1.08], [0.23, 1.16], [0.1, 1.28]],
    { seg: 8, colors: [0x1c1c1c, 0x1c1c1c, 0xa82018, 0xa82018, 0xd0a828, 0xa82018, 0xa82018] });
  kit.b('flat').box(x, 0.86, z - 0.2, 0.2, 0.03, 0.03, { color: 0x0a0a0a });
  kit.collide(x - 0.22, x + 0.22, 0, 1.2, z - 0.22, z + 0.22, PROP, 'metal');
}

/** Striped road barrier. */
export function barrier(kit, x, z, alongX, signRef) {
  const g = kit.b('flat');
  const L = 1.9;
  for (const s of [-1, 1]) {
    const px = alongX ? x + s * 0.8 : x, pz = alongX ? z : z + s * 0.8;
    for (const t of [-1, 1]) {
      g.push(px, 0.5, pz, alongX ? t * 0.3 : 0, 0, alongX ? 0 : t * 0.3).box(0, 0, 0, 0.05, 1.05, 0.05, { color: 0xbcb6a4 }).pop();
    }
  }
  for (let i = 0; i < 6; i++) {
    const o = -L / 2 + (i + 0.5) * (L / 6);
    const c = i % 2 ? 0xd8d2c0 : 0xb03a20;
    if (alongX) g.box(x + o, 0.88, z, L / 6, 0.2, 0.05, { color: c });
    else g.box(x, 0.88, z + o, 0.05, 0.2, L / 6, { color: c });
  }
  if (signRef) {
    const f = kit.frame(x, z, alongX ? 'S' : 'E');
    f.sign(signRef, 0, 0.5, 0.04, 0.9, 0.34);
    const f2 = kit.frame(x, z, alongX ? 'N' : 'W');
    f2.sign(signRef, 0, 0.5, 0.04, 0.9, 0.34);
  }
  if (alongX) kit.collide(x - L / 2, x + L / 2, 0, 1.0, z - 0.15, z + 0.15, FENCE);
  else kit.collide(x - 0.15, x + 0.15, 0, 1.0, z - L / 2, z + L / 2, FENCE);
}

/** Iron fence run between two points on the same axis. */
export function fence(kit, x0, z0, x1, z1, h = 1.5, color = 0x3a3a3c) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  kit.b('bars').quad([x0, 0.12, z0], [x1, 0.12, z1], [x1, h, z1], [x0, h, z0], { uv: [0, 0, len / 0.45, 1], color, double: true });
  // Low kerb wall under the bars.
  if (alongX) kit.box('concrete', Math.min(x0, x1), Math.max(x0, x1), 0, 0.14, z0 - 0.07, z0 + 0.07, { color: 0x8c877c });
  else kit.box('concrete', x0 - 0.07, x0 + 0.07, 0, 0.14, Math.min(z0, z1), Math.max(z0, z1), { color: 0x8c877c });
  const posts = Math.max(2, Math.round(len / 2.2) + 1);
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
    kit.box('concrete', px - 0.1, px + 0.1, 0, h + 0.12, pz - 0.1, pz + 0.1, { color: 0x9a958a, ao: 0.3 });
  }
  if (alongX) kit.collide(Math.min(x0, x1), Math.max(x0, x1), 0, h, z0 - 0.08, z0 + 0.08, FENCE);
  else kit.collide(x0 - 0.08, x0 + 0.08, 0, h, Math.min(z0, z1), Math.max(z0, z1), FENCE);
}

/** Random flyers pasted on a wall. */
export function posters(kit, f, u, y, n) {
  const rnd = kit.rnd;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rnd() * 4);
    const cu = (k % 2) * 0.5, cv = Math.floor(k / 2) * 0.5;
    const w = rnd.range(0.36, 0.52), h = w * 1.35;
    const pu = u + i * 0.5 + rnd.range(-0.06, 0.06), py = y + rnd.range(-0.15, 0.15);
    f.wall('poster', pu, pu + w, py, py + h, 0.015 + i * 0.002, { uv: [cu + 0.01, cv + 0.01, cu + 0.49, cv + 0.49], color: [0.7, 0.68, 0.64] });
  }
}

/** Wall-mounted air conditioner condenser. */
export function condenser(kit, f, u, y) {
  f.box('flat', u, u + 0.8, y, y + 0.55, 0, 0.32, { color: 0xb0ad9f, ao: 0.2 });
  f.wall('grate', u + 0.08, u + 0.72, y + 0.06, y + 0.49, 0.325, { color: 0x6f6d64, tile: 0.2 });
  f.box('flat', u + 0.1, u + 0.7, y - 0.1, y, 0.04, 0.28, { color: 0x34322e });
}

export { WALL, PROP, FENCE, CAMERA, BULLET, SOLID, GROUND_H, FLOOR_H };

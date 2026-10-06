// Cheap transient visuals: muzzle flash, tracers, impact sparks, dust, blood,
// shell casings, bullet-hole and blood decals, and camera-facing glows.
// Everything is written into three small dynamic meshes each frame.

import { Node } from '../engine/Node.js';
import { material, STRIDE } from '../engine/Renderer.js';

const MAX_PARTICLES = 220;
const MAX_QUADS_ADD = 160;
const MAX_QUADS_ALPHA = 240;
const MAX_DECALS = 56;
const CORNERS = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];

export class Effects {
  constructor(renderer, textures, root) {
    this.r = renderer;
    // Additive sheet: soft glow on the left half, muzzle star on the right.
    const sheet = document.createElement('canvas');
    sheet.width = 64;
    sheet.height = 32;
    const sc = sheet.getContext('2d');
    sc.drawImage(textures.glowCanvas, 0, 0);
    sc.drawImage(textures.flashCanvas, 32, 0);
    const addTex = renderer.createTexture(sheet, { repeat: false, smooth: true, mips: false });

    this.addBuf = new Float32Array(MAX_QUADS_ADD * 6 * STRIDE);
    this.alphaBuf = new Float32Array(MAX_QUADS_ALPHA * 6 * STRIDE);
    this.decalBuf = new Float32Array(MAX_DECALS * 6 * STRIDE);
    this.addMesh = renderer.createMesh(this.addBuf, null, { dynamic: true });
    this.alphaMesh = renderer.createMesh(this.alphaBuf, null, { dynamic: true });
    this.decalMesh = renderer.createMesh(this.decalBuf, null, { dynamic: true });
    this.addMesh.count = this.alphaMesh.count = this.decalMesh.count = 0;

    this.addNode = root.add(new Node(this.addMesh, material({
      tex: addTex, unlit: true, pass: 3, blend: 'add', depthWrite: false, cull: false, fog: 1,
    })));
    this.alphaNode = root.add(new Node(this.alphaMesh, material({
      tex: textures.blob, unlit: false, pass: 3, blend: 'alpha', depthWrite: false, cull: false, emissive: 0.25,
    })));
    this.decalNode = root.add(new Node(this.decalMesh, material({
      tex: textures.blob, pass: 2, blend: 'alpha', depthWrite: false, offset: true, cull: false,
    })));

    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.push({ life: 0 });
    this._pi = 0;
    this.tracers = [];
    this.decals = [];
    this._decalsDirty = false;
    /** Persistent glows: { x,y,z,size,r,g,b,a, flicker } - lamp halos, item glints. */
    this.glows = [];
    this.flash = { t: 0, x: 0, y: 0, z: 0, size: 0.4, rot: 0 };
    this._na = 0;
    this._nb = 0;
  }

  spawn(p) {
    const q = this.particles[this._pi];
    this._pi = (this._pi + 1) % MAX_PARTICLES;
    q.x = p.x; q.y = p.y; q.z = p.z;
    q.vx = p.vx || 0; q.vy = p.vy || 0; q.vz = p.vz || 0;
    q.life = q.max = p.life || 0.5;
    q.size = p.size || 0.05;
    q.grow = p.grow || 0;
    q.r = p.r; q.g = p.g; q.b = p.b;
    q.a = p.a === undefined ? 1 : p.a;
    q.add = !!p.add;
    q.gravity = p.gravity === undefined ? 9.8 : p.gravity;
    q.drag = p.drag || 0;
    q.bounce = p.bounce || 0;
    return q;
  }

  muzzleFlash(x, y, z, size) {
    const f = this.flash;
    f.t = 0.055;
    f.x = x; f.y = y; f.z = z;
    f.size = size;
    f.rot = Math.random() * Math.PI;
  }

  tracer(ax, ay, az, bx, by, bz) {
    this.tracers.push({ ax, ay, az, bx, by, bz, t: 0.07, max: 0.07 });
  }

  /** Sparks + dust where a bullet meets a wall. */
  impactWorld(x, y, z, nx, ny, nz, metal) {
    for (let i = 0; i < (metal ? 9 : 5); i++) {
      const s = 2 + Math.random() * 4;
      this.spawn({
        x, y, z,
        vx: nx * s + (Math.random() - 0.5) * 3.5, vy: ny * s + Math.random() * 2.5, vz: nz * s + (Math.random() - 0.5) * 3.5,
        life: 0.18 + Math.random() * 0.25, size: 0.035, r: 1, g: 0.78, b: 0.4, a: 1, add: true, gravity: 12,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.spawn({
        x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05,
        vx: nx * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.8, vy: 0.3 + Math.random() * 0.6, vz: nz * (0.4 + Math.random()) + (Math.random() - 0.5) * 0.8,
        life: 0.5 + Math.random() * 0.5, size: 0.09, grow: 0.5, r: 0.5, g: 0.47, b: 0.43, a: 0.5, gravity: -0.3, drag: 2.5,
      });
    }
    this.decal(x, y, z, nx, ny, nz, 0.055 + Math.random() * 0.025, 0.04, 0.035, 0.03, 0.95);
  }

  /** Blood burst at a hit, sprayed along the bullet's direction. */
  impactFlesh(x, y, z, dx, dy, dz, heavy) {
    const n = heavy ? 16 : 8;
    for (let i = 0; i < n; i++) {
      const back = i < n * 0.3 ? -0.5 : 1;
      const s = (1 + Math.random() * (heavy ? 4.5 : 3)) * back;
      this.spawn({
        x, y, z,
        vx: dx * s + (Math.random() - 0.5) * 2.2, vy: dy * s + Math.random() * 2.4, vz: dz * s + (Math.random() - 0.5) * 2.2,
        life: 0.35 + Math.random() * 0.4, size: 0.03 + Math.random() * 0.045, r: 0.42, g: 0.03, b: 0.03, a: 0.95, gravity: 10,
      });
    }
    this.spawn({ x, y, z, life: 0.22, size: heavy ? 0.24 : 0.15, grow: 1.4, r: 0.5, g: 0.04, b: 0.04, a: 0.6, gravity: 0 });
  }

  bloodPool(x, z, size) {
    this.decal(x, 0.012, z, 0, 1, 0, size, 0.2, 0.012, 0.012, 0.85);
  }

  shell(x, y, z, vx, vy, vz) {
    this.spawn({ x, y, z, vx, vy, vz, life: 1.4, size: 0.022, r: 0.85, g: 0.66, b: 0.25, a: 1, gravity: 11, bounce: 0.4 });
  }

  decal(x, y, z, nx, ny, nz, size, r, g, b, a) {
    this.decals.push({ x, y, z, nx, ny, nz, size, r, g, b, a });
    if (this.decals.length > MAX_DECALS) this.decals.shift();
    this._decalsDirty = true;
  }

  addGlow(g) {
    this.glows.push(g);
    return g;
  }

  removeGlow(g) {
    const i = this.glows.indexOf(g);
    if (i >= 0) this.glows.splice(i, 1);
  }

  _quad(buf, n, x, y, z, ax, ay, az, bx, by, bz, u0, u1, r, g, b, a) {
    // Two triangles spanning +-a and +-b around (x,y,z).
    let o = n * 6 * STRIDE;
    for (let i = 0; i < 6; i++) {
      const p = CORNERS[i];
      buf[o++] = x + ax * p[0] + bx * p[1];
      buf[o++] = y + ay * p[0] + by * p[1];
      buf[o++] = z + az * p[0] + bz * p[1];
      buf[o++] = 0; buf[o++] = 1; buf[o++] = 0;
      buf[o++] = p[2] ? u1 : u0; buf[o++] = p[3];
      buf[o++] = r; buf[o++] = g; buf[o++] = b; buf[o++] = a;
    }
  }

  /** cam: { x,y,z, rx,ry,rz (right), ux,uy,uz (up) } */
  update(dt, cam, time) {
    let na = 0, nb = 0;
    const A = this.addBuf, B = this.alphaBuf;

    // Persistent glows (always face the camera).
    for (const g of this.glows) {
      if (g.hidden || na >= MAX_QUADS_ADD) continue;
      let a = g.a;
      if (g.flicker) a *= 0.86 + 0.14 * Math.sin(time * g.flicker + g.x * 3);
      if (g.pulse) a *= 0.55 + 0.45 * Math.sin(time * g.pulse + g.z);
      const s = g.size;
      this._quad(A, na++, g.x, g.y, g.z, cam.rx * s, cam.ry * s, cam.rz * s, cam.ux * s, cam.uy * s, cam.uz * s, 0, 0.5, g.r, g.g, g.b, a);
    }

    // Muzzle flash: star + soft core.
    const f = this.flash;
    if (f.t > 0 && na < MAX_QUADS_ADD - 2) {
      f.t -= dt;
      const s = f.size, c = Math.cos(f.rot), sn = Math.sin(f.rot);
      const ax = (cam.rx * c + cam.ux * sn) * s, ay = (cam.ry * c + cam.uy * sn) * s, az = (cam.rz * c + cam.uz * sn) * s;
      const bx = (-cam.rx * sn + cam.ux * c) * s, by = (-cam.ry * sn + cam.uy * c) * s, bz = (-cam.rz * sn + cam.uz * c) * s;
      this._quad(A, na++, f.x, f.y, f.z, ax, ay, az, bx, by, bz, 0.5, 1, 1, 0.9, 0.7, 1);
      const g = s * 1.5;
      this._quad(A, na++, f.x, f.y, f.z, cam.rx * g, cam.ry * g, cam.rz * g, cam.ux * g, cam.uy * g, cam.uz * g, 0, 0.5, 1, 0.7, 0.35, 0.7);
    }

    // Tracers: a thin camera-facing ribbon along the bullet path.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.tracers.splice(i, 1); continue; }
      if (na >= MAX_QUADS_ADD) continue;
      const dx = t.bx - t.ax, dy = t.by - t.ay, dz = t.bz - t.az;
      const len = Math.hypot(dx, dy, dz) || 1;
      const mx = (t.ax + t.bx) / 2, my = (t.ay + t.by) / 2, mz = (t.az + t.bz) / 2;
      // side = dir x toCamera
      const cx = cam.x - mx, cy = cam.y - my, cz = cam.z - mz;
      let sx = dy * cz - dz * cy, sy = dz * cx - dx * cz, sz = dx * cy - dy * cx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = 0.012;
      sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
      this._quad(A, na++, mx, my, mz, dx / 2, dy / 2, dz / 2, sx, sy, sz, 0.2, 0.3, 1, 0.88, 0.6, 0.55 * (t.t / t.max));
      void len;
    }

    // Particles.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.015) {
        p.y = 0.015;
        if (p.bounce && Math.abs(p.vy) > 0.6) {
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.6; p.vz *= 0.6;
        } else {
          p.vy = 0; p.vx *= 0.5; p.vz *= 0.5;
          if (!p.bounce) p.gravity = 0;
        }
      }
      const k = p.life / p.max;
      const s = p.size * (1 + p.grow * (1 - k));
      const a = p.a * Math.min(1, k * 2.5);
      if (p.add) {
        if (na < MAX_QUADS_ADD) this._quad(A, na++, p.x, p.y, p.z, cam.rx * s, cam.ry * s, cam.rz * s, cam.ux * s, cam.uy * s, cam.uz * s, 0, 0.5, p.r, p.g, p.b, a);
      } else if (nb < MAX_QUADS_ALPHA) {
        this._quad(B, nb++, p.x, p.y, p.z, cam.rx * s, cam.ry * s, cam.rz * s, cam.ux * s, cam.uy * s, cam.uz * s, 0, 1, p.r, p.g, p.b, a);
      }
    }

    this.r.updateMesh(this.addMesh, A, na * 6);
    this.r.updateMesh(this.alphaMesh, B, nb * 6);

    if (this._decalsDirty) {
      this._decalsDirty = false;
      const D = this.decalBuf;
      let nd = 0;
      for (const d of this.decals) {
        // Build a tangent frame on the surface.
        let tx, ty, tz;
        if (Math.abs(d.ny) > 0.9) { tx = 1; ty = 0; tz = 0; } else { tx = -d.nz; ty = 0; tz = d.nx; }
        const bx = d.ny * tz - d.nz * ty, by = d.nz * tx - d.nx * tz, bz = d.nx * ty - d.ny * tx;
        const s = d.size;
        this._quad(D, nd, d.x + d.nx * 0.004, d.y + d.ny * 0.004, d.z + d.nz * 0.004, tx * s, ty * s, tz * s, bx * s, by * s, bz * s, 0, 1, d.r, d.g, d.b, d.a);
        // Give decals their surface normal so they are lit like the wall.
        for (let v = 0; v < 6; v++) {
          const o = (nd * 6 + v) * STRIDE;
          D[o + 3] = d.nx; D[o + 4] = d.ny; D[o + 5] = d.nz;
        }
        nd++;
      }
      this.r.updateMesh(this.decalMesh, D, nd * 6);
    }
  }
}

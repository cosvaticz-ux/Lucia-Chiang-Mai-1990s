// Builds the one playable block: a narrow old-town lane in Chiang Mai, mid 1990s.
//
// Axes: +X is the right-hand side of the lane as Lucia first sees it, -Z runs
// "up the street" towards the chedi (compass west, where the sun has just set).
// Frame directions (N/S/E/W) are just labels for -Z/+Z/+X/-X.
//
//            far gate (exit, locked)                       z = -26
//   W6b gold | lane | E3a laundry
//   W6a barb |      | E3b photo lab
//   W5 rice  |      |== alley B ==+                        z = -14
//   W4 house |      | E2a grocery |  back lane  [ courtyard: dead-end loot ]
//   (fenced) |      | E2b rooms   |      |
//   W3 pharm |      | E2c garage  |      |
//   CAFE  <- interior             |      |
//   W1 tv    |      |== alley A ==+                        z = +4
//            | spawn| walled garden
//            blocked by a crashed songthaew                z = +13

import { Node } from '../engine/Node.js';
import { MeshBuilder } from '../engine/MeshBuilder.js';
import { material } from '../engine/Renderer.js';
import { SignAtlas } from '../engine/Textures.js';
import { makeRng } from '../engine/math.js';
import { NavGrid } from '../enemies/NavGrid.js';
import {
  Kit, shophouse, pickup, sedan, motorbike, pole, crate, cardboard, garbageBag, trashCan,
  trafficCone, pottedPlant, tree, sandbags, spiritHouse, waterJar, foodCart, phoneBooth,
  postBox, barrier, fence, posters, condenser, shade,
  WALL, PROP, FENCE, CAMERA, BULLET, SOLID,
} from './Kit.js';

const STREET_X = 3.5;

export class LevelManager {
  constructor(renderer, textures, world, effects, root) {
    this.r = renderer;
    this.T = textures;
    this.world = world;
    this.fx = effects;
    this.root = root;
    this.rnd = makeRng(1996);
    this.lights = [];
    this.spawn = { x: -0.5, z: 9.9, yaw: 0 };
    this.enemySpawns = [];
    this.pickups = [];
    this.props = [];
    this.bounds = { x0: -10.5, x1: 16.5, z0: -29, z1: 16 };
    this.exitZ = -27.4;
    this.humPos = { x: -6.5, z: 5.75 };
    this.time = 0;
    this.gate = { open: false, t: 0, collider: null, leafL: null, leafR: null, x: 0, z: -26 };
    this.propMat = material({});
    this.scene = {
      root,
      lights: this.lights,
      sky: [0.2, 0.19, 0.31],
      ground: [0.085, 0.07, 0.065],
      dirDir: norm([-0.25, 0.55, -0.8]),
      dirCol: [0.2, 0.13, 0.17],
      fogCol: [0.115, 0.085, 0.14],
      fogNear: 7,
      fogFar: 62,
      fogMax: 0.94,
    };
  }

  build() {
    const signs = new SignAtlas(2048, 1280);
    const kit = new Kit(this.r, this.T, this.world, signs, this.rnd);
    this.kit = kit;
    this.sg = this._signs(signs);
    this._sky();
    this._ground(kit);
    this._westRow(kit);
    this._cafe(kit);
    this._eastRow(kit);
    this._backLane(kit);
    this._courtyard(kit);
    this._streetDressing(kit);
    this._ends(kit);
    this._backdrop(kit);
    kit.finish(this.root);
    for (const L of kit.lights) this.lights.push(L);
    for (const g of kit.glows) this.fx.addGlow(g);
    this._dynamic();
    this.nav = new NavGrid(this.world, this.bounds, 1.25, 0.42).build(this.spawn);
    this.minimap = this._minimap();
    return this;
  }

  // -------------------------------------------------------------------------
  _signs(S) {
    const cream = '#dccba2', red = '#8c2318', green = '#1f6a44', blue = '#1f3f7a', gold = '#e6c35a';
    const lat = '"Arial Narrow","Helvetica Neue",Arial,sans-serif';
    return {
      cafe: S.add('กาแฟ เชียงใหม่', 640, 112, { bg: cream, fg: red, wear: 0.9 }),
      cafeBlade: S.add('กาแฟ', 80, 288, { vertical: true, bg: '#9a2a22', fg: '#f2e4ba' }),
      tv: S.add('ซ่อมวิทยุ โทรทัศน์', 512, 96, { bg: '#d8d4c4', fg: blue, border: blue, sub: 'RADIO - T.V. SERVICE', subFont: lat }),
      pharmacy: S.add('ร้านขายยา', 512, 96, { bg: '#eef0e6', fg: green, border: green, sub: 'PHARMACY', subFont: lat, wear: 0.25 }),
      cross: S.add('', 96, 96, {
        bg: '#f2f4ec', wear: 0.15,
        draw: (c, w, h) => { c.fillStyle = '#1f9a55'; c.fillRect(w * 0.38, h * 0.14, w * 0.24, h * 0.72); c.fillRect(w * 0.14, h * 0.38, w * 0.72, h * 0.24); },
      }),
      rice: S.add('ข้าวมันไก่', 512, 96, { bg: '#e8d48a', fg: '#a02818', border: '#a02818' }),
      barber: S.add('ตัดผมชาย', 448, 96, { bg: '#e4e2d8', fg: blue, sub: 'BARBER', subFont: lat }),
      goldShop: S.add('ร้านทอง', 448, 96, { bg: '#a01c16', fg: gold, border: gold, wear: 0.3 }),
      goldBlade: S.add('ทอง', 80, 224, { vertical: true, bg: '#a01c16', fg: gold, wear: 0.3 }),
      laundry: S.add('ซักอบรีด', 448, 96, { bg: '#cfe0e4', fg: '#205a80', border: '#205a80' }),
      photo: S.add('ล้างอัดรูป', 448, 96, { bg: '#f0e060', fg: '#b02a20', sub: 'COLOR LAB 1 HR.', subFont: lat, subColor: '#1f3f7a' }),
      grocery: S.add('ขายของชำ', 448, 96, { bg: cream, fg: green, border: green }),
      rooms: S.add('ห้องเช่า', 80, 256, { vertical: true, bg: '#e8e4d4', fg: red }),
      garage: S.add('อู่ซ่อมรถ', 448, 96, { bg: '#d8d0b8', fg: '#2a2a2a', border: '#2a2a2a', wear: 0.9 }),
      noodle: S.add('ก๋วยเตี๋ยว', 256, 96, { bg: '#f0e8d0', fg: red, wear: 0.4 }),
      phone: S.add('โทรศัพท์', 192, 56, { bg: '#c8a030', fg: '#1a1a1a', wear: 0.3 }),
      road: S.add('ถ. ราชดำเนิน', 320, 96, { bg: '#1f3f7a', fg: '#f0f0e8', border: '#f0f0e8', wear: 0.3 }),
      soi: S.add('ซอย ๓', 192, 72, { bg: '#1f3f7a', fg: '#f0f0e8', border: '#f0f0e8', wear: 0.4 }),
      danger: S.add('อันตราย', 320, 128, { bg: '#d8c020', fg: '#1a1a1a', border: '#1a1a1a', sub: 'ห้ามเข้า', subColor: '#a01c16', wear: 0.5 }),
      dog: S.add('ระวังสุนัขดุ', 256, 80, { bg: '#e8e4d8', fg: red, border: red }),
      ice: S.add('น้ำแข็ง', 80, 208, { vertical: true, bg: '#d8e8f0', fg: blue }),
      open: S.add('เปิด', 128, 80, { bg: '#f0e8d0', fg: green, border: green }),
      menu: S.add('', 256, 256, {
        bg: '#20302a', wear: 0.2,
        draw: (c, w, h) => {
          c.fillStyle = '#e8e4d0';
          c.font = `600 26px "Chonburi","Kanit","Noto Sans Thai","Leelawadee UI","Thonburi","Tahoma",sans-serif`;
          const rows = [['กาแฟร้อน', '๑๐'], ['กาแฟเย็น', '๑๒'], ['ชาเย็น', '๑๐'], ['โอเลี้ยง', '๘'], ['นมสด', '๑๐'], ['ขนมปังปิ้ง', '๕']];
          c.textAlign = 'left';
          rows.forEach((r, i) => { c.textAlign = 'left'; c.fillText(r[0], 22, 44 + i * 38); c.textAlign = 'right'; c.fillText(r[1], w - 22, 44 + i * 38); });
        },
      }),
      noEntry: S.add('', 128, 128, {
        bg: 'none',
        draw: (c, w, h) => {
          c.fillStyle = '#e8e4dc'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.48, 0, 7); c.fill();
          c.fillStyle = '#b0261c'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.43, 0, 7); c.fill();
          c.fillStyle = '#eeeae0'; c.fillRect(w * 0.2, h * 0.42, w * 0.6, h * 0.16);
        },
      }),
      chalk: S.add('', 128, 192, {
        bg: '#262c2a', border: '#6a5240', wear: 0.3,
        draw: (c, w, h) => {
          c.fillStyle = '#d8d8cc';
          c.font = `600 30px "Chonburi","Kanit","Noto Sans Thai","Leelawadee UI","Thonburi","Tahoma",sans-serif`;
          c.textAlign = 'center';
          c.fillText('กาแฟสด', w / 2, 52);
          c.fillText('๑๐ บาท', w / 2, 104);
          c.strokeStyle = '#d8d8cc'; c.lineWidth = 2; c.beginPath(); c.moveTo(24, 132); c.lineTo(w - 24, 132); c.stroke();
          c.font = `600 24px "Chonburi","Kanit","Noto Sans Thai","Tahoma",sans-serif`;
          c.fillText('ชาเย็น', w / 2, 162);
        },
      }),
    };
  }

  // -------------------------------------------------------------------------
  _sky() {
    const b = new MeshBuilder();
    const R = 300, seg = 24;
    // Elevation bands: [degrees, colour]
    const bands = [
      [-12, [0.1, 0.075, 0.125]], [0, [0.78, 0.42, 0.31]], [4, [0.66, 0.31, 0.3]], [10, [0.42, 0.2, 0.31]],
      [22, [0.2, 0.12, 0.26]], [45, [0.09, 0.075, 0.18]], [90, [0.04, 0.04, 0.1]],
    ];
    const sunAz = Math.atan2(-0.5, -1); // glow sits up the street, slightly left
    const dim = [0.13, 0.1, 0.19];
    const colAt = (band, az) => {
      const el = band[0], c = band[1];
      if (el < 0 || el >= 25) return c;
      // Afterglow only near the horizon and towards the sunset; elsewhere the sky is dusky.
      let d = az - sunAz;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const glow = Math.max(0, Math.cos(d * 0.75)) ** 2;
      const low = 1 - el / 25;
      const m = 1 - low * (1 - (0.28 + 0.72 * glow));
      return [dim[0] + (c[0] - dim[0]) * m, dim[1] + (c[1] - dim[1]) * m, dim[2] + (c[2] - dim[2]) * m];
    };
    for (let j = 0; j < bands.length - 1; j++) {
      const e0 = (bands[j][0] * Math.PI) / 180, e1 = (bands[j + 1][0] * Math.PI) / 180;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (el, az) => [Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R];
        const cA0 = colAt(bands[j], a0), cA1 = colAt(bands[j], a1), cB0 = colAt(bands[j + 1], a0), cB1 = colAt(bands[j + 1], a1);
        b.quad(P(e0, a0), P(e0, a1), P(e1, a1), P(e1, a0), { colors: [cA0, cA1, cB1, cB0], double: true });
      }
    }
    // A handful of early stars.
    const rnd = makeRng(77);
    for (let i = 0; i < 70; i++) {
      const az = rnd() * Math.PI * 2, el = 0.45 + rnd() * 1.0;
      const p = [Math.sin(az) * Math.cos(el) * (R - 2), Math.sin(el) * (R - 2), Math.cos(az) * Math.cos(el) * (R - 2)];
      const s = 0.5 + rnd() * 0.5, v = 0.5 + rnd() * 0.5;
      b.quad([p[0] - s, p[1] - s, p[2]], [p[0] + s, p[1] - s, p[2]], [p[0] + s, p[1] + s, p[2]], [p[0] - s, p[1] + s, p[2]], { color: [v, v, v * 0.95], double: true });
    }
    this.skyNode = new Node(b.build(this.r), material({ unlit: true, fog: 0, pass: 0, depthTest: false, depthWrite: false, cull: false }));
    this.root.add(this.skyNode);
  }

  // -------------------------------------------------------------------------
  _ground(kit) {
    const S = STREET_X;
    const street = kit.b('street');
    const q = (key, x0, x1, z0, z1, y, color, tile) =>
      kit.b(key).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], { color, tile: tile || kit.tile(key) });
    // Lane surface, broken into strips so vertex tint can vary along its length.
    for (let z = -60; z < 32; z += 4) {
      const k = 0.82 + this.rnd() * 0.16;
      q('street', -S, S, z, z + 4, 0, [0.62 * k, 0.57 * k, 0.53 * k]);
    }
    void street;
    // Footpath on the shop side, kerb, and a drain channel on the other.
    q('paver', -S, -2.65, -28, 15.5, 0.02, 0x8f8a80);
    kit.box('concrete', -2.65, -2.55, 0, 0.035, -28, 15.5, { color: 0x77726a });
    q('concrete', 2.85, S, -28, 15.5, 0.015, 0x6f6a62);
    for (let z = -27; z < 13; z += 3.2) q('grate', 2.95, 3.3, z, z + 1.1, 0.022, 0x8a8a84, 0.36);
    // Side routes.
    q('concrete', S, 10, 3, 5.5, 0.004, 0x5f5a54);
    q('concrete', S, 10, -15.5, -13, 0.004, 0x5a5650);
    q('concrete', 7.5, 10, -15.5, 5.5, 0.006, 0x55514c);
    q('paver', 10, 15.5, -8, -2, 0.004, 0x7a746a);
    // Worn patches, oil and damp.
    const spots = [[-1.2, 8.5, 1.6, 0.4], [1.9, 2.5, 2.2, 0.45], [0.5, -3.5, 1.8, 0.35], [-2, -7.5, 2.4, 0.4], [1.2, -11.5, 2.0, 0.5],
      [-0.6, -17, 2.6, 0.4], [2.2, -21, 1.6, 0.45], [8.7, -3, 1.3, 0.5], [8.6, -11, 1.5, 0.55], [6, 4.2, 1.4, 0.5], [5.5, -14.2, 1.5, 0.55], [12.5, -5, 2.2, 0.35]];
    for (const [x, z, r, a] of spots) kit.groundDecal('stain', x, z, r, r * (0.6 + this.rnd() * 0.6), 0x0a0808, a, 0.008);
    // Manhole.
    kit.b('flat').lathe(0.6, 0.006, -6.2, [[0.42, 0], [0.42, 0.006]], { seg: 10, color: 0x2e2c2a, capColor: 0x383634 });
  }

  // -------------------------------------------------------------------------
  _westRow(kit) {
    const sg = this.sg;
    const x = -STREET_X;
    let f;
    // W1: radio & TV repair.
    f = kit.frame(x, 15.5, 'E');
    shophouse(kit, f, 6.5, 7, { floors: 2, tint: 0xcabf9e, shutter: 0x8a5d48, sign: sg.tv, canopy: 'awning', awning: 0x5a6d7c, lit: 0, roof: 'flat' });
    posters(kit, f, 0.5, 1.1, 3);
    // W3: pharmacy, green cross still lit.
    f = kit.frame(x, 2.5, 'E');
    shophouse(kit, f, 6.5, 7, { floors: 3, tint: 0xa7b59a, shutter: 0x7c8a92, sign: sg.pharmacy, signLit: true, balcony: true, lit: 0.12 });
    f.blade(sg.cross, 0.75, 4.6, 0.7, 0.7, true, { frame: 0x1c1c1c });
    kit.light(-2.6, 3.9, 1.75, 6, 0x66ffa0, 0.5, { shadow: false, flicker: 31 });
    kit.glow(-2.9, 4.6, 1.75, 1.3, 0x40ff90, 0.32, { flicker: 31 });
    posters(kit, f, 4.6, 1.0, 2);
    // W4: old concrete house behind a fence.
    f = kit.frame(x - 2.3, -4, 'E');
    shophouse(kit, f, 6.5, 5, { floors: 2, tint: 0xbdb7a6, ground: 'door', canopy: 'none', roof: 'tile', lit: 1, trim: 0x8f8a7c });
    kit.light(-4.9, 4.9, -8.6, 5, 0xffb060, 0.25, { shadow: false });
    kit.b('paver').quad([x - 2.3, 0.015, -4], [x, 0.015, -4], [x, 0.015, -10.5], [x - 2.3, 0.015, -10.5], { color: 0x6f6a5e, tile: 1.3 });
    fence(kit, x, -4.1, x, -10.4, 1.7, 0x35363a);
    kit.collide(x - 2.3, x, 0, 3, -4.15, -4, WALL);
    kit.collide(x - 2.3, x, 0, 3, -10.5, -10.35, WALL);
    kit.frame(x, -6.2, 'E').sign(sg.dog, 0, 1.1, 0.05, 0.7, 0.22);
    pottedPlant(kit, x - 1.7, -5.0, 1.2, 'fern');
    pottedPlant(kit, x - 0.6, -9.6, 1.0, 'bush');
    pottedPlant(kit, x - 1.6, -9.8, 0.8, 'fern');
    waterJar(kit, x - 0.7, -5.2, 0.9);
    tree(kit, x - 1.2, -7.4, 5.5, 1.9, 0x263a2a);
    // W5: chicken rice, shutter jammed half open.
    f = kit.frame(x, -10.5, 'E');
    shophouse(kit, f, 6.5, 7, { floors: 2, tint: 0xc49a84, ground: 'half', shutter: 0x9a9480, sign: sg.rice, canopy: 'awning', awning: 0xa23a2e, lit: 0.1 });
    f.blade(sg.ice, 5.7, 5.2, 0.5, 1.5);
    // W6a: barber.
    f = kit.frame(x, -17, 'E');
    shophouse(kit, f, 5.5, 7, { floors: 3, tint: 0x9aa7ae, shutter: 0x6a7480, sign: sg.barber, lit: 0.14, balcony: true });
    // Barber pole.
    {
      const p = f.pt(0.5, 0, 0.26);
      kit.b('flat').lathe(p[0], 1.5, p[2], [[0.09, 0], [0.09, 0.14], [0.07, 0.14], [0.07, 0.34], [0.07, 0.54], [0.07, 0.74], [0.09, 0.74], [0.09, 0.88]],
        { seg: 6, colors: [0x8a8a88, 0x8a8a88, 0xb02820, 0xe0dcd0, 0x284a90, 0xe0dcd0, 0x8a8a88, 0x8a8a88] });
    }
    // W6b: gold shop.
    f = kit.frame(x, -22.5, 'E');
    shophouse(kit, f, 5.5, 7, { floors: 2, tint: 0xc5ab6a, shutter: 0x8c2c24, sign: sg.goldShop, blade: sg.goldBlade, bladeU: 0.7, bladeY: 5.0, lit: 0, canopy: 'slab' });
  }

  // -------------------------------------------------------------------------
  _cafe(kit) {
    const sg = this.sg;
    const wall = 0xd6c08c, inner = 0xd9c9a2;
    const x0 = -10, x1 = -STREET_X, z0 = 2.5, z1 = 9, H = 3.0;
    // Upper floor sits on the ground-floor walls; its underside is the ceiling.
    kit.box('plaster', x0, x1, H, 6.95, z0, z1, { color: wall, ao: 0.25, collide: WALL });
    kit.box('concrete', x0 - 0.05, x1 + 0.1, 6.75, 6.95, z0, z1, { color: 0xa39a84 });
    // Ground-floor shell.
    kit.box('plaster', x0, x0 + 0.25, 0, H, z0, z1, { color: inner, ao: 0.3, collide: WALL });
    kit.box('plaster', x0, x1, 0, H, z1 - 0.25, z1, { color: inner, ao: 0.3, collide: WALL });
    kit.box('plaster', x0, x1, 0, H, z0, z0 + 0.25, { color: inner, ao: 0.3, collide: WALL });
    kit.box('plaster', x1 - 0.25, x1, 0, H, z0, 3.5, { color: wall, ao: 0.35, collide: WALL });
    kit.box('plaster', x1 - 0.25, x1, 0, H, 8.0, z1, { color: wall, ao: 0.35, collide: WALL });
    kit.box('plaster', x1 - 0.25, x1, 2.62, H, 3.5, 8.0, { color: wall, collide: CAMERA | BULLET });
    // Tiled floor and doorstep.
    kit.b('tile').quad([x0 + 0.25, 0.03, z1 - 0.25], [x1, 0.03, z1 - 0.25], [x1, 0.03, z0 + 0.25], [x0 + 0.25, 0.03, z0 + 0.25], { color: 0xb9a98c, tile: 1 });
    kit.box('concrete', x1, x1 + 0.3, 0, 0.035, 3.5, 8.0, { color: 0x8a857a });
    // Facade: sign board, canopy, upstairs windows.
    const f = kit.frame(x1, z1, 'E');
    f.box('wood', 0.5, 6.0, 3.08, 3.86, 0, 0.07, { color: 0x6a5846 });
    f.sign(sg.cafe, 3.25, 3.47, 0.085, 5.2, 0.72);
    f.box('concrete', -0.04, 6.54, H, H + 0.1, 0, 0.95, { color: 0x9c978c, collide: CAMERA | BULLET });
    f.blade(sg.cafeBlade, 6.1, 5.3, 0.5, 1.8);
    for (const u of [1.7, 4.8]) {
      f.wall('window', u - 0.55, u + 0.55, 4.5, 5.9, 0.02, {});
      f.box('concrete', u - 0.65, u + 0.65, 4.4, 4.5, 0, 0.11, { color: 0xa39a84 });
    }
    f.box('emit', 1.2, 5.3, 2.88, 2.94, 0.25, 0.31, { color: 0xfff0c8 });
    kit.glow(x1 + 0.3, 2.9, 5.75, 1.6, 0xffd9a0, 0.35, { flicker: 27 });
    // Orange and white pennant by the door, like the reference.
    f.wall('flat', 6.3, 6.5, 1.5, 2.9, 0.16, { color: 0xb04a26, double: true });
    f.wall('flat', 6.3, 6.5, 2.2, 2.55, 0.165, { color: 0xe6dcc4, double: true });

    // Interior lighting.
    const L = kit.light(-6.6, 2.55, 5.75, 12.5, 0xffd49a, 1.55, { flicker: 0 });
    this.cafeLight = L;
    for (const z of [4.4, 7.1]) {
      kit.box('emit', -8.2, -5.0, 2.9, 2.95, z - 0.04, z + 0.04, { color: 0xfff2d0 });
      kit.box('flat', -8.3, -4.9, 2.95, 3.0, z - 0.08, z + 0.08, { color: 0x8a8880 });
    }
    kit.groundDecal('pool', -1.9, 5.75, 2.6, 3.0, 0xffc880, 0.2);

    // Counter with the back bar behind it.
    kit.box('wood', -8.4, -7.75, 0, 1.02, 3.7, 7.2, { color: 0x7a5c44, ao: 0.3, collide: PROP });
    kit.box('flat', -8.48, -7.67, 1.02, 1.07, 3.62, 7.28, { color: 0x3c3632 });
    kit.box('wood', -9.75, -9.42, 0.85, 0.9, 3.0, 8.0, { color: 0x5a4636 });
    kit.box('wood', -9.75, -9.42, 1.45, 1.5, 3.0, 8.0, { color: 0x5a4636 });
    kit.box('wood', -9.75, -9.42, 2.05, 2.1, 3.0, 8.0, { color: 0x5a4636 });
    kit.box('wood', -9.75, -9.42, 0, 0.85, 3.0, 8.0, { color: 0x4e3d30, ao: 0.3, collide: PROP });
    const g = kit.b('flat');
    const jar = [0xb8a070, 0x7a3a2a, 0x3a5a3c, 0xc8c0a8, 0x8a6a30, 0x51402e, 0xa8502e];
    for (const sy of [0.9, 1.5, 2.1]) {
      for (let z = 3.2; z < 7.9; z += 0.34) {
        if (this.rnd.chance(0.22)) continue;
        const h = 0.16 + this.rnd() * 0.2;
        if (this.rnd.chance(0.5)) g.cyl(-9.58, sy, z, 0.07 + this.rnd() * 0.04, h, { color: this.rnd.pick(jar), seg: 6 });
        else g.box(-9.58, sy + h / 2, z, 0.16, h, 0.2, { color: this.rnd.pick(jar) });
      }
    }
    // On the counter: urn, glass jars, register.
    g.cyl(-8.07, 1.07, 6.5, 0.17, 0.42, { color: 0xa0a4a8, seg: 8 });
    g.lathe(-8.07, 1.49, 6.5, [[0.17, 0], [0.05, 0.1], [0.03, 0.16]], { color: 0x8a8e92, seg: 8 });
    g.box(-8.05, 1.2, 4.2, 0.36, 0.26, 0.4, { color: 0x4a4c50 });
    g.box(-8.05, 1.36, 4.2, 0.3, 0.07, 0.3, { color: 0x2a2c30 });
    for (const z of [5.5, 5.8]) g.cyl(-8.08, 1.07, z, 0.08, 0.2, { color: 0xb8c0b8, seg: 6 });
    // Fridge, shelving, sacks.
    kit.box('flat', -9.7, -9.05, 0, 1.85, 8.05, 8.72, { color: 0xc8cac4, ao: 0.25, collide: WALL, tag: 'metal' });
    kit.box('flat', -9.06, -9.04, 0.95, 0.97, 8.05, 8.72, { color: 0x6a6a68 });
    kit.box('wood', -7.4, -4.6, 0, 2.0, 8.43, 8.75, { color: 0x5e4a3a, ao: 0.3, collide: WALL });
    for (const sy of [0.55, 1.1, 1.62]) {
      for (let x = -7.25; x < -4.7; x += 0.36) {
        if (this.rnd.chance(0.25)) continue;
        g.box(x, sy + 0.14, 8.38, 0.24, 0.26 + this.rnd() * 0.1, 0.16, { color: this.rnd.pick(jar) });
      }
    }
    for (const [sx, sz, s] of [[-4.5, 3.2, 0.3], [-4.05, 3.15, 0.27], [-4.3, 3.2, 0.24]]) {
      g.sphere(sx, s * 0.75 + (s === 0.24 ? 0.4 : 0), sz, s, s * 0.8, s * 0.75, { color: 0x9a8760, seg: 6, rings: 4 });
    }
    kit.collide(-4.85, -3.8, 0, 0.75, 2.75, 3.5, PROP);
    // Two tables.
    for (const [tx, tz] of [[-5.7, 4.6], [-5.5, 7.2]]) {
      kit.box('wood', tx - 0.38, tx + 0.38, 0.7, 0.75, tz - 0.38, tz + 0.38, { color: 0x86664c });
      g.box(tx, 0.35, tz, 0.07, 0.7, 0.07, { color: 0x2c2a28 });
      g.box(tx, 0.02, tz, 0.4, 0.04, 0.4, { color: 0x2c2a28 });
      kit.collide(tx - 0.3, tx + 0.3, 0, 0.76, tz - 0.3, tz + 0.3, PROP);
    }
    // Wall dressing: menu, calendar, clock.
    kit.frame(-6.6, z0 + 0.25, 'S').sign(sg.menu, 0, 1.75, 0.02, 1.2, 1.2);
    const fs = kit.frame(-8.6, z1 - 0.25, 'N');
    posters(kit, fs, -0.4, 1.3, 2);
    kit.box('flat', -9.75, -9.72, 2.2, 2.52, 5.44, 5.76, { color: 0xe8e4d8 });
    kit.box('flat', -9.72, -9.715, 2.34, 2.38, 5.52, 5.62, { color: 0x1a1a1a });
    // Out front: chalkboard, plants.
    {
      const a = kit.frame(-2.98, 8.35, 'S');
      a.quad('signs', [[-0.3, 0.02, 0.22], [0.3, 0.02, 0.22], [0.3, 0.98, 0.0], [-0.3, 0.98, 0.0]], { uv: sg.chalk.uv });
      const b2 = kit.frame(-2.98, 8.35, 'N');
      b2.quad('signs', [[-0.3, 0.02, 0.22], [0.3, 0.02, 0.22], [0.3, 0.98, 0.0], [-0.3, 0.98, 0.0]], { uv: sg.chalk.uv });
      kit.collide(-3.28, -2.68, 0, 0.95, 8.15, 8.55, SOLID);
    }
    pottedPlant(kit, -3.12, 3.15, 1.25, 'fern');
    pottedPlant(kit, -3.05, 2.45, 0.9, 'bush');
    pottedPlant(kit, -3.15, 8.95, 1.05, 'fern');
    pottedPlant(kit, -4.2, 8.3, 0.8, 'fern');
  }

  // -------------------------------------------------------------------------
  _eastRow(kit) {
    const sg = this.sg;
    const x = STREET_X;
    let f;
    f = kit.frame(x, -28, 'W');
    shophouse(kit, f, 6.5, 7, { floors: 3, tint: 0xcfc3a2, shutter: 0x5f7c68, sign: sg.laundry, lit: 0.12, balcony: true });
    f = kit.frame(x, -21.5, 'W');
    shophouse(kit, f, 6, 7, { floors: 2, tint: 0x9db0ba, shutter: 0x8a8e90, sign: sg.photo, canopy: 'awning', awning: 0xb89a2c, lit: 0.1 });
    posters(kit, f, 3.4, 0.9, 3);
    f = kit.frame(x, -13, 'W');
    shophouse(kit, f, 5.5, 4, { floors: 2, tint: 0xc8ae6c, shutter: 0xb0a88e, sign: sg.grocery, balcony: true, lit: 0.2 });
    f = kit.frame(x, -7.5, 'W');
    shophouse(kit, f, 5, 4, { floors: 3, tint: 0xa9a59b, ground: 'door', canopy: 'slab', blade: sg.rooms, bladeU: 0.6, bladeY: 5.4, lit: 0.22 });
    f = kit.frame(x, -2.5, 'W');
    shophouse(kit, f, 5.5, 4, { floors: 2, tint: 0xc79f88, shutter: 0x777d82, sign: sg.garage, canopy: 'awning', awning: 0x4c5a48, lit: 0 });
    posters(kit, f, 0.6, 1.0, 2);

    // Walled garden opposite the café: mossy wall, trees and a palm over the top.
    kit.box('concrete', x, x + 0.3, 0, 2.55, 5.5, 15.5, { color: 0x8f927f, ao: 0.45, collide: WALL });
    kit.box('concrete', x - 0.04, x + 0.34, 2.55, 2.67, 5.5, 15.5, { color: 0x77786c });
    kit.box('concrete', x, 10.3, 0, 2.55, 5.5, 5.8, { color: 0x8f927f, ao: 0.45, collide: WALL });
    kit.box('concrete', x, 10.3, 2.55, 2.67, 5.46, 5.84, { color: 0x77786c });
    // Creeper spilling over.
    for (let z = 6.2; z < 15.2; z += 1.1) {
      if (this.rnd.chance(0.3)) continue;
      const fz = kit.frame(x - 0.02, z, 'W');
      fz.wall('foliage', -0.7, 0.7, 1.5 + this.rnd() * 0.5, 2.95, 0.03, { color: [0.42, 0.56, 0.4], double: true });
    }
    tree(kit, 6.2, 8.2, 7.2, 2.7, 0x22382a);
    tree(kit, 8.6, 11.8, 8.2, 3.0, 0x1e3226);
    tree(kit, 5.4, 12.6, 6.2, 2.2, 0x284030);
    this._palm(kit, 7.4, 6.9, 10.5);
    kit.box('plaster', 11, 18, 0, 6.6, 6.5, 15.5, { color: 0xb5ad98, ao: 0.4 });
    // Street name and no-entry sign on a post by the wall.
    kit.frame(3.12, 10.74, 'S').sign(sg.noEntry, 0.0, 2.65, 0.01, 0.72, 0.72);
    kit.frame(3.12, 10.46, 'N').sign(sg.noEntry, 0.0, 2.65, 0.01, 0.72, 0.72, false, { color: [0.5, 0.5, 0.52] });
    kit.frame(x - 0.02, 7.9, 'W').sign(sg.road, 0, 2.05, 0.02, 1.25, 0.38);
    // Alley name plates.
    kit.frame(x + 0.5, 3, 'S').sign(sg.soi, 0, 2.4, 0.02, 0.7, 0.26);
  }

  _palm(kit, x, z, h) {
    kit.b('flat').lathe(x, 0, z, [[0.2, 0], [0.13, h * 0.5], [0.11, h]], { seg: 5, color: 0x3a3228 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + this.rnd() * 0.4;
      const len = 3.2 + this.rnd();
      const dx = Math.cos(a), dz = Math.sin(a);
      const p0 = [x, h, z], p1 = [x + dx * len * 0.55, h + 0.6, z + dz * len * 0.55], p2 = [x + dx * len, h - 1.1, z + dz * len];
      const wv = [-dz * 0.55, 0, dx * 0.55];
      const o = { color: [0.3, 0.44, 0.3], double: true, uv: [0, 0, 1, 1] };
      kit.b('fern').quad([p0[0] - wv[0], p0[1], p0[2] - wv[2]], [p0[0] + wv[0], p0[1], p0[2] + wv[2]], [p1[0] + wv[0], p1[1], p1[2] + wv[2]], [p1[0] - wv[0], p1[1], p1[2] - wv[2]], o);
      kit.b('fern').quad([p1[0] - wv[0], p1[1], p1[2] - wv[2]], [p1[0] + wv[0], p1[1], p1[2] + wv[2]], [p2[0] + wv[0] * 0.3, p2[1], p2[2] + wv[2] * 0.3], [p2[0] - wv[0] * 0.3, p2[1], p2[2] - wv[2] * 0.3], o);
    }
  }

  // -------------------------------------------------------------------------
  _backLane(kit) {
    const sg = this.sg;
    // East boundary: corrugated sheet and concrete, with the courtyard doorway.
    kit.box('metal', 10, 10.3, 0, 3.1, -4.2, 5.8, { color: 0x8a8c86, ao: 0.4, collide: WALL, tag: 'metal' });
    kit.box('concrete', 10, 10.3, 0, 3.3, -15.5, -6, { color: 0x86827a, ao: 0.45, collide: WALL });
    kit.box('concrete', 10, 10.3, 2.3, 3.3, -6, -4.2, { color: 0x86827a, collide: CAMERA | BULLET });
    kit.box('wood', 9.96, 10.0, 0.1, 2.2, -4.25, -4.15, { color: 0x4a3a2c });
    // Open wooden door leaf swung into the yard.
    kit.box('wood', 10.3, 11.15, 0.05, 2.2, -4.22, -4.14, { color: 0x6a523c, collide: PROP });
    // Buildings behind the boundary.
    kit.box('plaster', 10.3, 17.5, 0, 7.4, -15.5, -8.3, { color: 0xb0a890, ao: 0.4, collide: WALL });
    kit.box('plaster', 10.3, 17.5, 0, 6.6, -1.7, 5.8, { color: 0xbcae96, ao: 0.4, collide: WALL });
    for (const [z, lit] of [[-13.5, false], [-10.8, true], [0.5, false], [3.4, false]]) {
      const f = kit.frame(10.3 - 0.3, z, 'W');
      f.wall(lit ? 'windowLit' : 'window', -0.5, 0.5, 4.4, 5.7, -0.28, lit ? { color: [0.7, 0.75, 0.9] } : {});
    }
    // Backs of the east shophouses: doors, pipes, condensers, clutter.
    const f = kit.frame(7.5, 3, 'E');
    for (const u of [2.2, 7.8, 13.2]) {
      f.wall('wood', u, u + 0.9, 0.05, 2.1, 0.02, { color: 0x4f4034, ao: 0.3 });
      f.box('flat', u - 0.06, u + 0.96, 2.1, 2.18, 0, 0.05, { color: 0x6a655c });
    }
    condenser(kit, f, 4.0, 2.5);
    condenser(kit, f, 10.2, 2.7);
    condenser(kit, f, 14.6, 0.25);
    for (const u of [0.6, 6.4, 11.6]) f.box('flat', u, u + 0.09, 0, 6.4, 0.02, 0.11, { color: 0x4c4a46 });
    f.box('flat', 0.6, 15.5, 3.2, 3.28, 0.02, 0.1, { color: 0x4c4a46 });
    posters(kit, f, 5.2, 1.0, 3);
    for (const [u, y] of [[3.3, 4.5], [9, 4.5], [12.5, 4.6]]) f.wall('window', u - 0.45, u + 0.45, y, y + 1.2, 0.02, {});
    // Laundry line across the lane.
    kit.cable([7.5, 3.4, 1.4], [10, 3.3, 1.2], 0.18, 0x1a1a1c, 4);
    for (const [t, c] of [[0.2, 0xb9b3a2], [0.42, 0x6f8296], [0.62, 0xa66a5e], [0.82, 0xc9c4b2]]) {
      const lx = 7.5 + 2.5 * t;
      kit.b('flat').quad([lx - 0.22, 2.55, 1.32], [lx + 0.22, 2.55, 1.32], [lx + 0.22, 3.25, 1.3], [lx - 0.22, 3.25, 1.3], { color: c, double: true });
    }
    // Bare bulb on the boundary wall.
    kit.box('flat', 9.78, 10, 2.86, 2.92, -1.56, -1.44, { color: 0x2a2a2a });
    kit.box('emit', 9.72, 9.82, 2.72, 2.86, -1.55, -1.45, { color: 0xffe0a0 });
    kit.light(9.3, 2.6, -1.5, 8.5, 0xffc878, 0.95, { flicker: 0 });
    kit.glow(9.76, 2.78, -1.5, 0.8, 0xffd090, 0.6, { flicker: 13 });
    kit.groundDecal('pool', 8.9, -1.5, 2.2, 2.6, 0xffc070, 0.14);
    // Clutter. Left side keeps a walkable channel.
    crate(kit, 9.55, 3.6, 0.8);
    crate(kit, 9.6, 2.75, 0.62);
    crate(kit, 9.55, 3.6, 0.55, 0.8, 0x968462);
    cardboard(kit, 7.9, 0.4, 0.55, 0.42, 0.6);
    cardboard(kit, 7.88, 0.42, 0.44, 0.34, 0.46, 0.42);
    trashCan(kit, 9.6, -7.6, 0x3a4c5c);
    trashCan(kit, 9.62, -8.4, 0x3d5a4a);
    for (const [gx, gz, s] of [[9.5, -9.3, 0.42], [9.2, -9.8, 0.36], [9.65, -10.1, 0.4], [7.95, -11.6, 0.4], [7.9, -12.3, 0.34], [9.6, -14.9, 0.44], [9.1, -15.0, 0.36], [8.5, -15.05, 0.4]]) garbageBag(kit, gx, gz, s);
    kit.collide(9.1, 10, 0, 0.7, -10.5, -8.9, PROP);
    kit.collide(8.2, 10, 0, 0.7, -15.5, -14.6, PROP);
    kit.box('wood', 7.55, 7.75, 0, 1.9, -3.4, -2.4, { color: 0x5a4838, collide: PROP }); // leaning pallet
    waterJar(kit, 7.95, -6.6, 0.85);
    // Alley mouths.
    cardboard(kit, 4.3, 5.1, 0.6, 0.5, 0.5);
    cardboard(kit, 4.95, 5.12, 0.5, 0.36, 0.44);
    garbageBag(kit, 6.3, 5.15, 0.36);
    crate(kit, 6.9, -13.45, 0.7);
    garbageBag(kit, 5.9, -13.35, 0.4);
    garbageBag(kit, 5.3, -13.4, 0.33);
    kit.frame(STREET_X + 0.6, -15.5, 'S').sign(sg.open, 0, 1.9, 0.02, 0.5, 0.3, false, { color: [0.6, 0.6, 0.6] });
    // Faint pool where alley B meets the lane, so silhouettes read against it.
    kit.groundDecal('pool', 5.2, -14.2, 2.0, 1.2, 0x8090c0, 0.05);
  }

  // -------------------------------------------------------------------------
  _courtyard(kit) {
    // Dead-end yard behind the back lane: the loot room.
    kit.box('concrete', 10.3, 15.8, 0, 3.2, -8.3, -8, { color: 0x8a867c, ao: 0.45, collide: WALL });
    kit.box('concrete', 10.3, 15.8, 0, 3.2, -2, -1.7, { color: 0x8a867c, ao: 0.45, collide: WALL });
    kit.box('concrete', 15.5, 15.8, 0, 3.2, -8.3, -1.7, { color: 0x8a867c, ao: 0.45, collide: WALL });
    kit.box('plaster', 15.8, 21, 0, 7.2, -9, -1, { color: 0xa9a08c, ao: 0.4, collide: WALL });
    const f = kit.frame(15.5, -8, 'W');
    f.wall('window', 2.4, 3.5, 4.3, 5.7, -0.28, {});
    posters(kit, f, 4.2, 1.0, 2);
    // Corrugated lean-to roof over the work table.
    kit.b('metal').quad([12.6, 2.35, -2.05], [15.5, 2.35, -2.05], [15.5, 2.75, -4.3], [12.6, 2.75, -4.3], { color: 0x7d7f78, tile: 1.3, double: true });
    for (const px of [12.7, 15.3]) kit.box('wood', px - 0.05, px + 0.05, 0, 2.72, -4.3, -4.2, { color: 0x4a3c30 });
    kit.collide(12.6, 15.5, 2.3, 2.8, -4.3, -2, CAMERA);
    // Work table and stool.
    kit.box('wood', 13.2, 15.1, 0.78, 0.84, -3.0, -2.25, { color: 0x7a6048 });
    for (const [px, pz] of [[13.3, -2.95], [15.0, -2.95], [13.3, -2.3], [15.0, -2.3]]) kit.box('wood', px - 0.04, px + 0.04, 0, 0.78, pz - 0.04, pz + 0.04, { color: 0x4a3c30 });
    kit.collide(13.2, 15.1, 0, 0.84, -3.0, -2.25, PROP);
    const g = kit.b('flat');
    g.box(14.75, 0.95, -2.5, 0.42, 0.22, 0.16, { color: 0x3a3632 }); // radio
    g.box(14.75, 0.95, -2.59, 0.3, 0.12, 0.01, { color: 0x8a8678 });
    g.cyl(14.94, 1.06, -2.5, 0.006, 0.4, { color: 0x9a9a9a, seg: 3 });
    spiritHouse(kit, 14.7, -7.2, 'W');
    waterJar(kit, 11.0, -7.3, 1.1);
    waterJar(kit, 11.85, -7.4, 0.8);
    pottedPlant(kit, 15.0, -5.4, 1.2, 'fern');
    pottedPlant(kit, 10.9, -2.6, 1.0, 'bush');
    crate(kit, 12.1, -2.45, 0.7);
    // Old bicycle against the wall.
    this._bicycle(kit, 13.0, -7.7);
    // Hanging lantern and its light.
    kit.cable([10.3, 3.1, -5], [15.5, 3.1, -5.2], 0.35, 0x1a1a1c, 5);
    kit.b('emit').lathe(12.9, 2.42, -5.1, [[0.05, 0], [0.2, 0.12], [0.2, 0.3], [0.05, 0.42]], { seg: 6, colors: [0xa83a1c, 0xff8a40, 0xff9a4a, 0xa83a1c] });
    kit.light(12.9, 2.35, -5.1, 8.5, 0xff8848, 1.05, { flicker: 7 });
    kit.glow(12.9, 2.62, -5.1, 0.95, 0xff8040, 0.55, { flicker: 7 });
    kit.groundDecal('pool', 12.9, -5.1, 2.4, 2.4, 0xff7030, 0.13);
    tree(kit, 18, -11, 8, 3, 0x1e3226);
  }

  _bicycle(kit, x, z) {
    const g = kit.b('flat');
    g.push(x, 0, z, 0.14, Math.PI / 2, 0);
    for (const wz of [-0.52, 0.52]) {
      g.push(0, 0.33, wz, 0, 0, Math.PI / 2);
      g.lathe(0, -0.015, 0, [[0.33, 0], [0.33, 0.03]], { seg: 10, color: 0x101012, capTop: false });
      g.pop();
    }
    g.push(0, 0.55, 0, 0.9, 0, 0).box(0, 0, 0, 0.03, 0.03, 0.75, { color: 0x4a6a58 }).pop();
    g.push(0, 0.6, 0.02, -0.5, 0, 0).box(0, 0, 0, 0.03, 0.03, 0.7, { color: 0x4a6a58 }).pop();
    g.box(0, 0.86, -0.3, 0.12, 0.05, 0.24, { color: 0x1a1a1a });
    g.box(0, 0.95, 0.42, 0.46, 0.03, 0.03, { color: 0x8a8a88 });
    g.box(0, 0.75, 0.47, 0.03, 0.42, 0.03, { color: 0x8a8a88 });
    g.pop();
    kit.collide(x - 0.85, x + 0.85, 0, 0.9, z - 0.2, z + 0.25, PROP);
  }

  // -------------------------------------------------------------------------
  _streetDressing(kit) {
    const sg = this.sg;
    // Vehicles.
    pickup(kit, 2.25, 7.9, Math.PI, 0xb8b4a6);
    sedan(kit, -1.72, -6.9, 0, 0x4a5a6a);
    motorbike(kit, 2.7, 12.3, Math.PI, 0x9a2420, 0.2);
    motorbike(kit, -2.95, -12.4, 0, 0x2a4a7a, -0.16);
    motorbike(kit, 2.85, -1.0, Math.PI, 0x2f2f33, 0.18);
    // Cover and clutter along the lane.
    trafficCone(kit, 1.25, 5.25);
    cardboard(kit, 2.5, 4.75, 0.9, 0.62, 0.7);
    cardboard(kit, 2.55, 4.7, 0.6, 0.4, 0.5, 0.62);
    kit.box('flat', 3.05, 3.4, 0, 0.9, 4.6, 5.0, { color: 0x8a7a30, ao: 0.3, collide: PROP });
    crate(kit, 2.75, -3.4, 0.85);
    crate(kit, 2.85, -4.25, 0.7);
    crate(kit, 2.72, -3.45, 0.6, 0.85, 0x9a8a6a);
    trashCan(kit, 2.95, -12.2, 0x3d5a4a);
    for (const [gx, gz, s] of [[2.5, -11.6, 0.42], [3.0, -11.3, 0.36], [2.3, -12.3, 0.34], [-3.0, 0.6, 0.38], [-3.05, 1.2, 0.32]]) garbageBag(kit, gx, gz, s);
    foodCart(kit, -2.35, -1.7, sg.noodle);
    kit.box('wood', -1.55, -0.85, 0.66, 0.7, -3.3, -2.6, { color: 0x8a6a4e }); // folding table
    for (const [px, pz] of [[-1.5, -3.25], [-0.9, -3.25], [-1.5, -2.65], [-0.9, -2.65]]) kit.b('flat').box(px, 0.33, pz, 0.03, 0.66, 0.03, { color: 0x6a6a68 });
    kit.collide(-1.55, -0.85, 0, 0.72, -3.3, -2.6, PROP);
    phoneBooth(kit, -3.05, -16.2, 'E', sg.phone);
    postBox(kit, 3.05, -17.3);
    pottedPlant(kit, -3.1, -10.9, 1.0, 'bush');
    pottedPlant(kit, -3.1, -16.9, 0.9, 'fern');
    pottedPlant(kit, 3.1, -20.6, 1.1, 'fern');
    pottedPlant(kit, 3.1, 2.6, 0.9, 'bush');
    pottedPlant(kit, -3.15, 12.2, 1.0, 'fern');
    // Abandoned in a hurry.
    kit.box('flat', -0.9, -0.35, 0, 0.42, -15.0, -14.2, { color: 0x5a3a2a, ao: 0.3, collide: PROP });
    kit.box('flat', -0.66, -0.58, 0.42, 0.5, -14.75, -14.45, { color: 0x2a2220 });
    kit.box('flat', 0.9, 1.3, 0, 0.09, -9.3, -8.7, { color: 0x30404a });

    // Utility poles, street lamps and the cable tangle overhead.
    const P = [];
    P.push(pole(kit, 3.12, 10.6, { transformer: -1, lamp: { dx: -1.5, intensity: 1.35, range: 14 } }));
    P.push(pole(kit, -3.12, 2.4, { lamp: { dx: 1.3, on: false } }));
    P.push(pole(kit, 3.12, -5.3, { lamp: { dx: -1.5, intensity: 1.3, range: 14, flicker: 1 } }));
    P.push(pole(kit, -3.12, -17.6, { transformer: 1, lamp: { dx: 1.5, intensity: 1.25, range: 14 } }));
    P.push(pole(kit, 3.12, -22.4, {}));
    P.push(pole(kit, -3.12, -36, { lamp: { dx: 1.5, intensity: 0.001, range: 1 } }));
    P.push(pole(kit, 3.12, -47, {}));
    P.unshift(pole(kit, -3.12, 22, {}));
    this.streetLamps = P.filter((p) => p.light).map((p) => p.light);
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i].tips, b = P[i + 1].tips;
      for (let k = 0; k < a.length; k++) {
        kit.cable(a[k], b[k], k < 8 ? 0.35 + this.rnd() * 0.5 : 0.9 + this.rnd() * 0.9, 0x08080c, 7);
      }
    }
    // Service drops into buildings.
    const drops = [[P[1].tips[9], [-3.5, 5.2, 8.4]], [P[1].tips[8], [11, 5.6, 8]], [P[2].tips[9], [-3.5, 6.2, 0.5]], [P[2].tips[10], [3.5, 5.4, -0.2]],
      [P[3].tips[9], [-5.8, 5.0, -6.2]], [P[3].tips[8], [-3.5, 6.0, -12]], [P[4].tips[9], [3.5, 6.1, -16.5]], [P[4].tips[10], [3.5, 5.5, -11]], [P[5].tips[8], [-3.5, 6.4, -24]]];
    for (const [a, b] of drops) kit.cable(a, b, 0.4 + this.rnd() * 0.4, 0x08080c, 5);

    // Paper lanterns strung across the lane.
    const strings = [[1.2, 5.3, 0.55], [-11.6, 5.6, 0.6]];
    const lanternCols = [[0xff7a30, 0xa83a1c], [0xffc24a, 0xa8701c], [0xff5a3a, 0x8a2418], [0xffd890, 0xa8843c]];
    for (const [z, y, sag] of strings) {
      kit.cable([-3.5, y, z], [3.5, y - 0.1, z + 0.3], sag, 0x101012, 8);
      for (let i = 1; i < 7; i++) {
        const t = i / 7;
        const lx = -3.5 + 7 * t, ly = y - 0.1 * t - Math.sin(t * Math.PI) * sag - 0.36, lz = z + 0.3 * t;
        const [hot, rim] = lanternCols[i % lanternCols.length];
        kit.b('emit').lathe(lx, ly, lz, [[0.04, 0], [0.15, 0.09], [0.15, 0.22], [0.04, 0.31]], { seg: 6, colors: [rim, hot, hot, rim] });
        kit.glow(lx, ly + 0.15, lz, 0.5, hot, 0.3, { flicker: 3 + i });
      }
    }
  }

  // -------------------------------------------------------------------------
  _ends(kit) {
    const sg = this.sg;
    // South: a songthaew slewed across the lane and a chain-link barricade.
    pickup(kit, -0.9, 14.25, Math.PI / 2, 0x97201c, { songthaew: true });
    barrier(kit, 2.4, 13.9, true, sg.danger);
    sandbags(kit, 2.5, 14.7, 3, true);
    kit.b('chain').quad([-3.5, 0, 15.3], [3.5, 0, 15.3], [3.5, 2.5, 15.3], [-3.5, 2.5, 15.3], { tile: 0.35, color: 0x8a8c90, double: true });
    for (const px of [-3.4, -1.2, 1.2, 3.4]) kit.box('flat', px - 0.04, px + 0.04, 0, 2.6, 15.26, 15.34, { color: 0x4a4c50 });
    kit.collide(-3.5, 3.5, 0, 3, 15.2, 15.5, FENCE | SOLID);
    kit.collide(-3.5, 3.5, 0, 12, 15.9, 16.3, CAMERA);

    // Far end: the gate out. Posts, beacon, barricade in front.
    const gz = this.gate.z;
    for (const s of [-1, 1]) {
      kit.box('concrete', s * 2.9, s * 3.5, 0, 3.0, gz - 0.3, gz + 0.3, { color: 0x8c877c, ao: 0.4, collide: WALL });
      kit.box('concrete', s * 2.85 - (s < 0 ? 0.7 : 0), s * 2.85 + (s > 0 ? 0.7 : 0), 3.0, 3.14, gz - 0.35, gz + 0.35, { color: 0x77726a });
    }
    kit.box('flat', -3.3, -3.1, 3.14, 3.3, gz - 0.1, gz + 0.1, { color: 0x2a2a2a });
    this.beacon = kit.light(-3.0, 3.1, gz + 0.6, 9, 0xff3020, 0, { shadow: false });
    this.beaconGlow = kit.glow(-3.2, 3.42, gz, 1.2, 0xff2a18, 0, {});
    sandbags(kit, -1.9, gz + 2.5, 3, true);
    barrier(kit, 1.7, gz + 2.2, true, sg.danger);
    trafficCone(kit, 0.2, gz + 2.0);
    trafficCone(kit, 2.9, gz + 3.3);
    // Beyond the gate the lane continues but cannot be walked.
    kit.collide(-3.5, 3.5, 0, 4, -31.2, -31, WALL);
    kit.collide(-3.8, -3.5, 0, 6, -31, -28, WALL);
    kit.collide(3.5, 3.8, 0, 6, -31, -28, WALL);
  }

  // -------------------------------------------------------------------------
  _backdrop(kit) {
    const rnd = this.rnd;
    const tints = [0xbdb39a, 0xa7b09e, 0xb9a48c, 0x9ea8ae, 0xc2b07a];
    // The lane carries on past both ends as non-playable silhouettes.
    const strip = (zStart, zEnd, step) => {
      for (let z = zStart; step < 0 ? z > zEnd : z < zEnd; z += step) {
        for (const side of [-1, 1]) {
          const w = Math.abs(step) - 0.02;
          const h = 6.5 + Math.floor(rnd() * 3) * 2.6;
          const z0 = step < 0 ? z + step : z, z1 = step < 0 ? z : z + step;
          const x0 = side < 0 ? -11 : STREET_X, x1 = side < 0 ? -STREET_X : 11;
          kit.box('plaster', x0, x1, 0, h, z0 + 0.01, z0 + w, { color: rnd.pick(tints), ao: 0.5 });
          const f = side < 0 ? kit.frame(-STREET_X, z1, 'E') : kit.frame(STREET_X, z0, 'W');
          f.wall('shutter', 0.3, w - 0.3, 0.1, 2.7, 0.03, { color: rnd.pick([0x7c8a92, 0x8a5d48, 0x5f7c68, 0x9a9480]), ao: 0.4 });
          f.box('concrete', 0, w, 3.3, 3.42, 0, 1.0, { color: 0x8c877c });
          for (let fl = 0; fl * 3.1 + 6.4 < h + 1; fl++) {
            for (const u of [w * 0.28, w * 0.72]) {
              const lit = rnd.chance(0.22);
              f.wall(lit ? 'windowLit' : 'window', u - 0.5, u + 0.5, 4.25 + fl * 3.1, 5.6 + fl * 3.1, 0.02, lit ? { color: [0.8, 0.74, 0.62] } : {});
            }
          }
        }
      }
    };
    strip(-28, -58, -6);
    strip(15.5, 35.5, 6);
    sedan(kit, 2.3, -34.5, Math.PI, 0x6a3a34);
    motorbike(kit, -2.9, -32.5, 0, 0x3a3a3e, 0.15);
    pickup(kit, -2.2, 21, 0, 0x4a5a4c);
    for (const [x, z, h, r] of [[-5, -60, 8, 3.2], [1, -62, 9.5, 3.8], [6, -60, 8.5, 3.4], [-9, -62, 10, 4], [10, -63, 9, 3.6], [0, 36, 8, 3.5], [-5, 37, 9, 3.5], [5, 37, 8.5, 3.2]]) {
      tree(kit, x, z, h, r, 0x1a2a22);
    }
    // Rooftop silhouettes behind the two rows so the skyline is not a flat line.
    for (const [x, z, w, h, d] of [[-17, 6, 7, 13, 8], [-18, -9, 8, 15.5, 9], [-16, -22, 6, 12, 7], [20, -18, 8, 14, 8], [22, 1, 7, 12.5, 9], [-19, -38, 9, 16, 9], [19, -40, 8, 13, 8]]) {
      kit.box('far', x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, { color: [0.075, 0.062, 0.1] });
      for (let k = 0; k < 3; k++) {
        if (!rnd.chance(0.5)) continue;
        const fx = x < 0 ? x + w / 2 + 0.02 : x - w / 2 - 0.02;
        const wy = h - 2 - k * 2.8, wz = z + rnd.range(-d / 3, d / 3);
        kit.b('emit').quad(x < 0 ? [fx, wy, wz + 0.5] : [fx, wy, wz - 0.5], x < 0 ? [fx, wy, wz - 0.5] : [fx, wy, wz + 0.5],
          x < 0 ? [fx, wy + 1.1, wz - 0.5] : [fx, wy + 1.1, wz + 0.5], x < 0 ? [fx, wy + 1.1, wz + 0.5] : [fx, wy + 1.1, wz - 0.5], { color: [0.55, 0.4, 0.2] });
      }
    }
    this._palm(kit, -13.5, -2, 13);
    this._palm(kit, 14.5, -20, 12);
    this._palm(kit, -12.5, -27, 12.5);

    // Forested hill and the chedi, floodlit, at the end of the lane.
    const far = kit.b('far');
    far.sphere(5, -6, -112, 70, 22, 42, { color: [0.05, 0.062, 0.075], seg: 14, rings: 8 });
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI, d = 26 + rnd() * 36;
      const tx = 5 + Math.cos(a) * d, tz = -100 + Math.sin(a) * 12 - 6;
      far.sphere(tx, 9 + rnd() * 6 - Math.abs(tx - 5) * 0.1, tz, 5 + rnd() * 4, 4 + rnd() * 3, 5, { color: [0.045 + rnd() * 0.02, 0.06 + rnd() * 0.02, 0.07], seg: 6, rings: 4 });
    }
    const cx = 4, cz = -98, cy = 13.5;
    const gold = kit.b('gold');
    const G = [0xd9a53a, 0xe8bc4e, 0xf2cc62, 0xc8922e];
    // Square redented base tiers.
    gold.push(cx, cy, cz, 0, Math.PI / 4, 0);
    gold.lathe(0, 0, 0, [[9.4, 0], [9.4, 1.6], [8.2, 1.6], [8.2, 3.2], [7.0, 3.2], [7.0, 4.8], [5.9, 4.8], [5.9, 6.4]], { seg: 4, colors: [G[3], G[0], G[3], G[0], G[3], G[0], G[3], G[0]], capTop: true });
    gold.pop();
    // Octagonal drum, bell and ringed spire.
    gold.lathe(cx, cy + 6.4, cz, [[4.4, 0], [4.4, 1.6], [3.8, 1.9], [3.8, 3.3], [3.3, 3.6], [3.5, 4.2], [3.0, 6.6], [1.5, 8.8], [1.2, 9.3], [1.5, 9.5],
      [0.95, 11.5], [1.15, 11.7], [0.7, 13.6], [0.85, 13.8], [0.42, 15.8], [0.55, 16.0], [0.16, 18.6], [0.0, 21.0]],
    { seg: 8, colors: [G[0], G[1], G[0], G[1], G[0], G[1], G[2], G[1], G[0], G[1], G[1], G[0], G[1], G[0], G[1], G[0], G[2], G[2]] });
    // Four corner parasols, a signature of northern chedis.
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      gold.lathe(cx + sx * 8.2, cy, cz + sz * 8.2, [[0.12, 0], [0.12, 6.2], [1.5, 6.2], [0.9, 6.7], [0.9, 7.0], [0.4, 7.3], [0.0, 8.2]], { seg: 6, color: G[0] });
    }
    kit.glow(cx, cy + 9, cz, 30, 0xff9a40, 0.34, {});
    kit.glow(cx, cy + 2, cz, 16, 0xffb050, 0.3, {});
    // Temple hall roofs stepping down in front of it.
    for (const [x, z, w, h, c] of [[-9, -80, 13, 8.5, 0.07], [16, -84, 11, 7, 0.065]]) {
      far.boxMM(x - w / 2, x + w / 2, 0, h * 0.5, z - 4, z + 4, { color: [c, c * 0.9, c * 1.25] });
      for (let t = 0; t < 3; t++) {
        const ww = w / 2 + 0.8 - t * 1.3, y0 = h * 0.5 + t * 1.1, y1 = h + t * 1.4;
        far.quad([x - ww, y0, z + 5], [x + ww, y0, z + 5], [x + ww * 0.12, y1, z + 5], [x - ww * 0.12, y1, z + 5], { color: [c * 1.4, c * 0.9, c * 0.8], double: true });
      }
    }
    // Distant mountain ridge (Doi Suthep) against the afterglow.
    for (let i = 0; i < 26; i++) {
      const a0 = Math.PI * (0.62 + (i / 26) * 0.9), a1 = Math.PI * (0.62 + ((i + 1) / 26) * 0.9);
      const hgt = (t) => 16 + 30 * Math.max(0, Math.sin(t * Math.PI)) ** 1.5 + Math.sin(t * 31) * 2.5 + Math.sin(t * 13) * 4;
      const R = 250;
      const p = (a, y) => [Math.sin(a) * R, y, Math.cos(a) * R];
      far.quad(p(a1, -10), p(a0, -10), p(a0, hgt(i / 26)), p(a1, hgt((i + 1) / 26)), { color: [0.085, 0.07, 0.125], double: true });
    }
  }

  // -------------------------------------------------------------------------
  /** Things that move: the gate leaves, the café fan. */
  _dynamic() {
    const r = this.r;
    const gz = this.gate.z;
    const barsMat = this.kit.defs.bars[0];
    const signMat = this.kit.defs.signs[0];
    const mk = (hingeX, dir) => {
      const leaf = new Node();
      leaf.setPos(hingeX, 0, gz);
      const b = new MeshBuilder();
      const L = 2.86 * dir;
      const x0 = Math.min(0, L), x1 = Math.max(0, L);
      b.boxMM(x0, x1, 0.12, 0.2, -0.04, 0.04, { color: 0x3a3c40 });
      b.boxMM(x0, x1, 2.3, 2.38, -0.04, 0.04, { color: 0x3a3c40 });
      b.boxMM(x0, x1, 1.2, 1.26, -0.03, 0.03, { color: 0x3a3c40 });
      b.boxMM(x0, x0 + 0.08, 0.12, 2.38, -0.04, 0.04, { color: 0x3a3c40 });
      b.boxMM(x1 - 0.08, x1, 0.12, 2.38, -0.04, 0.04, { color: 0x3a3c40 });
      leaf.add(new Node(b.build(r), this.propMat));
      const bb = new MeshBuilder();
      bb.quad([x0, 0.2, 0], [x1, 0.2, 0], [x1, 2.3, 0], [x0, 2.3, 0], { uv: [0, 0, 2.86 / 0.22, 1], color: 0x55585e, double: true });
      leaf.add(new Node(bb.build(r), barsMat));
      this.root.add(leaf);
      return leaf;
    };
    this.gate.leafL = mk(-2.9, 1);
    this.gate.leafR = mk(2.9, -1);
    // Warning sign and padlock chain on the gate.
    const sb = new MeshBuilder();
    sb.quad([0.75, 1.3, 0.05], [2.15, 1.3, 0.05], [2.15, 1.86, 0.05], [0.75, 1.86, 0.05], { uv: this.sg.danger.uv });
    this.gate.leafL.add(new Node(sb.build(r), signMat));
    const lock = new MeshBuilder();
    lock.box(0, 1.22, 0.07, 0.34, 0.07, 0.05, { color: 0x6a6c70 });
    lock.box(0, 1.1, 0.08, 0.13, 0.16, 0.05, { color: 0xb09030 });
    this.gate.lock = new Node(lock.build(r), this.propMat);
    this.gate.lock.setPos(0, 0, gz);
    this.root.add(this.gate.lock);
    this.gate.collider = this.world.addBox(-2.9, 2.9, 0, 2.5, gz - 0.12, gz + 0.12, FENCE, 'metal');

    // Ceiling fan.
    const fb = new MeshBuilder();
    fb.cyl(0, -0.14, 0, 0.1, 0.14, { color: 0x8a8880, seg: 6 });
    fb.cyl(0, 0, 0, 0.02, 0.2, { color: 0x4a4a48, seg: 4 });
    for (let i = 0; i < 3; i++) {
      fb.push(0, -0.1, 0, 0, (i / 3) * Math.PI * 2, 0.12).box(0.48, 0, 0, 0.72, 0.015, 0.14, { color: 0x6a5846 }).pop();
    }
    this.fan = new Node(fb.build(r), this.propMat);
    this.fan.setPos(-6.4, 2.82, 5.75);
    this.root.add(this.fan);

    // Where things start. Yaw 0 faces up the lane.
    this.enemySpawns = [
      { x: 0.9, z: -1.2, yaw: Math.PI, look: 0, health: 100, speed: 1.0 },
      { x: -0.9, z: -10.6, yaw: Math.PI * 0.75, look: 1, health: 90, speed: 1.1, wander: true },
      { x: 1.3, z: -20.2, yaw: 0, look: 2, health: 120, speed: 0.92 },
      { x: 8.8, z: -10.4, yaw: 0, look: 3, health: 100, speed: 1.05 },
      { x: 13.9, z: -6.0, yaw: Math.PI / 2, look: 4, health: 110, speed: 1.0 },
    ];
    this.pickups = [
      { type: 'ammo', amount: 6, x: -8.06, y: 1.07, z: 5.0 },
      { type: 'herb', amount: 1, x: -5.7, y: 0.75, z: 4.6 },
      { type: 'ammo', amount: 6, x: 9.6, y: 0.62, z: 2.75 },
      { type: 'herb', amount: 1, x: 7.95, y: 0, z: -14.3 },
      { type: 'ammo', amount: 8, x: 13.6, y: 0.84, z: -2.6 },
      { type: 'spray', amount: 1, x: 14.2, y: 0.84, z: -2.55 },
      { type: 'key', amount: 1, x: 12.7, y: 1.5, z: -4.34 },
    ];
    this.props = [
      { type: 'stool', x: -6.35, z: 4.5, color: 0xa83228 },
      { type: 'stool', x: -5.6, z: 5.3, color: 0x2a4a8a },
      { type: 'stool', x: -4.85, z: 7.3, color: 0xa83228 },
      { type: 'stool', x: -0.55, z: -2.3, color: 0x2a4a8a },
      { type: 'stool', x: -1.9, z: -3.6, color: 0xa83228 },
      { type: 'bottle', x: -1.3, z: -3.0, y0: 0.7, color: 0x3a5a3a },
      { type: 'bottle', x: -1.05, z: -2.85, y0: 0.7, color: 0x6a4a20 },
      { type: 'can', x: 2.45, z: -12.9, color: 0xa02a20 },
      { type: 'can', x: 2.1, z: -11.9, color: 0x8a8a88 },
      { type: 'can', x: 1.4, z: 3.3, color: 0x2a5a8a },
      { type: 'can', x: 8.4, z: -8.2, color: 0xa02a20 },
      { type: 'bottle', x: 8.1, z: -4.6, color: 0x3a5a3a },
      { type: 'box', x: 8.3, z: 1.9, color: 0x9a7c54 },
      { type: 'box', x: 1.9, z: -3.9, color: 0x9a7c54 },
      { type: 'bucket', x: 11.6, z: -6.6, color: 0x3a6a8a },
      { type: 'can', x: -0.3, z: -21.5, color: 0x8a8a88 },
    ];
  }

  /** Small models for pickups and physics props. */
  makeModel(type, color = 0xffffff) {
    const b = new MeshBuilder();
    switch (type) {
      case 'ammo':
        b.box(0, 0.045, 0, 0.17, 0.09, 0.11, { color: 0x4d5a3c });
        b.box(0, 0.05, 0.056, 0.13, 0.05, 0.004, { color: 0xc8b450 });
        b.box(0, 0.092, 0, 0.17, 0.006, 0.11, { color: 0x38422c });
        break;
      case 'herb':
        b.lathe(0, 0, 0, [[0.07, 0], [0.1, 0.13]], { color: 0x8a4a32, seg: 6, capColor: 0x2a1c14 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * 6.28;
          b.push(Math.cos(a) * 0.03, 0.12, Math.sin(a) * 0.03, 0.5, a, 0).tbox(0, 0.1, 0, 0.05, 0.01, 0.015, 0.01, 0.2, { color: i % 2 ? 0x3f9a4a : 0x2f7a3a }).pop();
        }
        break;
      case 'spray':
        b.cyl(0, 0, 0, 0.045, 0.19, { color: 0xe4e4dc, seg: 7 });
        b.cyl(0, 0.19, 0, 0.022, 0.04, { color: 0xb02820, seg: 5 });
        b.box(0, 0.11, 0.046, 0.05, 0.016, 0.004, { color: 0xb02820 });
        b.box(0, 0.11, 0.046, 0.016, 0.05, 0.004, { color: 0xb02820 });
        break;
      case 'key':
        b.box(0, 0, 0, 0.012, 0.11, 0.012, { color: 0xc8a84a });
        b.box(0, 0.07, 0, 0.05, 0.05, 0.012, { color: 0xc8a84a });
        b.box(0.016, -0.04, 0, 0.022, 0.016, 0.012, { color: 0xc8a84a });
        b.box(0, 0.13, 0, 0.004, 0.08, 0.004, { color: 0x8a2a20 });
        break;
      case 'stool':
        b.lathe(0, -0.21, 0, [[0.17, 0], [0.13, 0.4]], { seg: 6, color, capTop: false });
        b.lathe(0, 0.19, 0, [[0.15, 0], [0.15, 0.03]], { seg: 6, color: shade(color, 1.15) });
        break;
      case 'bottle':
        b.lathe(0, -0.12, 0, [[0.034, 0], [0.034, 0.14], [0.014, 0.19], [0.014, 0.24]], { seg: 6, color });
        break;
      case 'can':
        b.lathe(0, -0.06, 0, [[0.033, 0], [0.033, 0.12]], { seg: 6, color, capColor: 0x9a9a98, capBottom: true });
        break;
      case 'box':
        b.box(0, 0, 0, 0.34, 0.26, 0.3, { color, ao: 0.2 });
        b.box(0, 0.131, 0, 0.345, 0.004, 0.04, { color: 0xb8a070 });
        break;
      case 'bucket':
        b.lathe(0, -0.14, 0, [[0.1, 0], [0.14, 0.28]], { seg: 7, color, capColor: 0x0c1014, capBottom: true });
        break;
      default:
        b.box(0, 0, 0, 0.1, 0.1, 0.1, { color });
    }
    const n = new Node(b.build(this.r), this.propMat);
    n.castShadow = false;
    return n;
  }

  // -------------------------------------------------------------------------
  /** Top-down walkability bitmap for the HUD map. */
  _minimap() {
    const b = this.bounds, res = 0.5;
    const w = Math.round((b.x1 - b.x0) / res), h = Math.round((b.z1 - b.z0) / res);
    const cells = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = b.x0 + (i + 0.5) * res, z = b.z0 + (j + 0.5) * res;
        // Tall obstacles only, so parked cars and crates do not clutter the map.
        cells[j * w + i] = this.world.pointFree(x, z, 0.05, 1.7, 2.2) && this._inside(x, z) ? 1 : 0;
      }
    }
    return { w, h, res, x0: b.x0, z0: b.z0, cells };
  }

  /** Is this point part of the playable footprint (not a roof or sealed yard)? */
  _inside(x, z) {
    if (z < -28 || z > 15.3) return false;
    if (Math.abs(x) <= STREET_X) return true;
    if (x < -STREET_X) return x > -9.75 && z > 2.75 && z < 8.75;
    if (x <= 10) return (z >= 3 && z <= 5.5) || (z >= -15.5 && z <= -13) || (x >= 7.5 && z >= -15.5 && z <= 5.5);
    return x <= 15.5 && z >= -8 && z <= -2;
  }

  openGate() {
    if (this.gate.open) return;
    this.gate.open = true;
    this.gate.collider.enabled = false;
    this.gate.lock.visible = false;
  }

  update(dt, camera) {
    this.time += dt;
    const t = this.time;
    this.skyNode.setPos(camera.x, camera.y * 0.2, camera.z);
    this.fan.ry += dt * 2.4;
    // Lamp flicker.
    for (const L of this.lights) {
      if (!L.flicker) continue;
      if (L.flicker === 1) {
        // A failing sodium lamp: mostly on, with nervous dropouts.
        const n = Math.sin(t * 13.7) * Math.sin(t * 7.3 + 1.3) + Math.sin(t * 41) * 0.3;
        const k = n > 0.82 ? 0.25 : n > 0.7 ? 0.7 : 1;
        L.intensity = L.base * k;
        if (L.glow) L.glow.a = 0.6 * k;
      } else {
        L.intensity = L.base * (0.92 + 0.08 * Math.sin(t * L.flicker + L.x));
      }
    }
    // Gate beacon: slow red pulse marks the objective from the far end of the lane.
    const pulse = Math.max(0, Math.sin(t * 2.6)) ** 3;
    this.beacon.intensity = pulse * 1.2;
    this.beaconGlow.a = 0.25 + pulse * 0.75;
    // Gate swing.
    const g = this.gate;
    if (g.open && g.t < 1) {
      g.t = Math.min(1, g.t + dt / 1.5);
      const e = 1 - (1 - g.t) ** 3;
      g.leafL.ry = e * 1.75;
      g.leafR.ry = -e * 1.65;
    }
  }
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

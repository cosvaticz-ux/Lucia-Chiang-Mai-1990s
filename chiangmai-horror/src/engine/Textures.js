// Procedural low-resolution textures drawn to canvases at load time.
// Nothing here is loaded from disk; every surface is 32-128 px, greyscale-ish,
// and tinted per-vertex so one texture serves many differently coloured walls.

import { makeRng, clamp } from './math.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Fill a canvas per-pixel. fn(x, y) -> [r,g,b] or [r,g,b,a] in 0..255. */
function pixels(size, fn, h = size) {
  const c = canvas(size, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const p = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = clamp(p[0], 0, 255);
      img.data[i + 1] = clamp(p[1], 0, 255);
      img.data[i + 2] = clamp(p[2], 0, 255);
      img.data[i + 3] = p.length > 3 ? clamp(p[3], 0, 255) : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Tileable value noise on a size x size lattice. */
function noiseField(size, cells, rnd) {
  const g = [];
  for (let i = 0; i < cells * cells; i++) g.push(rnd());
  const at = (x, y) => g[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

const grey = (v, a) => (a === undefined ? [v, v, v] : [v, v, v, a]);

export function buildTextures(renderer) {
  const T = {};
  const add = (name, cv, opts) => {
    T[name] = renderer.createTexture(cv, opts);
    T[name + 'Canvas'] = cv;
  };

  // Plaster: stained, speckled, with a few hairline cracks.
  {
    const r = makeRng(11);
    const n1 = noiseField(64, 4, r), n2 = noiseField(64, 16, r);
    const crack = new Set();
    for (let k = 0; k < 2; k++) {
      let x = Math.floor(r() * 64), y = Math.floor(r() * 64);
      for (let s = 0; s < 18; s++) {
        crack.add(y * 64 + x);
        y = (y + 1) % 64;
        if (r() < 0.45) x = (x + (r() < 0.5 ? 1 : 63)) % 64;
      }
    }
    add('plaster', pixels(64, (x, y) => {
      let v = 205 + (n1(x, y) - 0.5) * 60 + (n2(x, y) - 0.5) * 26 + (r() - 0.5) * 14;
      if (crack.has(y * 64 + x)) v -= 22;
      return grey(v);
    }));
  }

  // Raw concrete: darker blotches, form-work seams, rain streaks.
  {
    const r = makeRng(23);
    const n1 = noiseField(64, 5, r), n2 = noiseField(64, 20, r);
    const streak = [];
    for (let x = 0; x < 64; x++) streak.push(r() < 0.16 ? r() * 36 : 0);
    add('concrete', pixels(64, (x, y) => {
      let v = 170 + (n1(x, y) - 0.5) * 70 + (n2(x, y) - 0.5) * 30 + (r() - 0.5) * 18;
      if (y % 32 === 0) v -= 28;
      v -= streak[x] * (1 - y / 64);
      return grey(v);
    }));
  }

  // Roller shutter: horizontal slats with grime.
  {
    const r = makeRng(31);
    const n = noiseField(64, 6, r);
    add('shutter', pixels(64, (x, y) => {
      const s = y % 8;
      let v = s === 0 ? 96 : s === 1 ? 236 : s < 5 ? 198 : 160;
      v += (n(x, y) - 0.5) * 46 + (r() - 0.5) * 10;
      if (x % 32 === 0) v -= 26;
      return grey(v);
    }));
  }

  // Street: worn concrete pavers with dark joints, like old-town lanes.
  {
    const r = makeRng(41);
    const n1 = noiseField(128, 6, r), n2 = noiseField(128, 32, r);
    const tone = [];
    for (let i = 0; i < 64; i++) tone.push((r() - 0.5) * 34);
    add('street', pixels(128, (x, y) => {
      const row = Math.floor(y / 16);
      const xo = (x + (row % 2) * 16) % 128;
      const col = Math.floor(xo / 32);
      let v = 150 + tone[(row * 4 + col) % 64] + (n1(x, y) - 0.5) * 50 + (n2(x, y) - 0.5) * 24 + (r() - 0.5) * 16;
      if (y % 16 === 0 || xo % 32 === 0) v -= 52;
      return grey(v);
    }));
  }

  // Sidewalk slabs.
  {
    const r = makeRng(47);
    const n = noiseField(64, 8, r);
    add('paver', pixels(64, (x, y) => {
      let v = 182 + (n(x, y) - 0.5) * 44 + (r() - 0.5) * 16;
      if (x % 32 === 0 || y % 32 === 0) v -= 56;
      return grey(v);
    }));
  }

  // Wood planks.
  {
    const r = makeRng(53);
    const n = noiseField(64, 3, r);
    add('wood', pixels(64, (x, y) => {
      const plank = Math.floor(y / 16);
      let v = 176 + (plank % 2) * 16 + Math.sin((x + plank * 17) * 0.5 + n(x, y) * 6) * 12 + (r() - 0.5) * 16;
      if (y % 16 === 0) v -= 70;
      if ((x + plank * 23) % 64 === 0) v -= 40;
      return [v, v * 0.94, v * 0.86];
    }));
  }

  // Clay roof tiles.
  {
    const r = makeRng(59);
    add('roof', pixels(32, (x, y) => {
      const row = Math.floor(y / 8);
      const xx = (x + (row % 2) * 4) % 8;
      let v = 150 + (y % 8) * 9 + (r() - 0.5) * 22;
      if (xx === 0) v -= 50;
      if (y % 8 === 7) v -= 40;
      return grey(v);
    }));
  }

  // Corrugated sheet with rust.
  {
    const r = makeRng(61);
    const n = noiseField(64, 5, r);
    add('metal', pixels(64, (x, y) => {
      const s = x % 8;
      let v = s < 2 ? 228 : s < 4 ? 196 : s < 6 ? 150 : 176;
      const rust = Math.max(0, n(x, y) - 0.56) * 2.4;
      v += (r() - 0.5) * 12;
      return [v - rust * 40, v - rust * 110, v - rust * 150];
    }));
  }

  // Interior floor tile.
  {
    const r = makeRng(67);
    add('tile', pixels(32, (x, y) => {
      const chk = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
      let v = (chk ? 206 : 168) + (r() - 0.5) * 14;
      if (x % 16 === 0 || y % 16 === 0) v -= 40;
      return grey(v);
    }));
  }

  // Drain grate.
  add('grate', pixels(16, (x, y) => {
    const bar = x % 4 < 2;
    const edge = y === 0 || y === 15;
    return bar || edge ? grey(120) : grey(14);
  }));

  // Striped awning canvas.
  {
    const r = makeRng(71);
    add('awning', pixels(32, (x, y) => {
      const s = Math.floor(x / 8) % 2;
      const v = (s ? 236 : 120) + (r() - 0.5) * 20 - (y % 16 === 0 ? 30 : 0);
      return grey(v);
    }));
  }

  // Crate: boarded box with a frame.
  {
    const r = makeRng(73);
    add('crate', pixels(32, (x, y) => {
      let v = 186 + (r() - 0.5) * 26 + (Math.floor(y / 6) % 2) * 12;
      if (y % 6 === 0) v -= 54;
      if (x < 3 || x > 28 || y < 3 || y > 28) v = 138 + (r() - 0.5) * 20;
      if (x === 3 || x === 28 || y === 3 || y === 28) v -= 40;
      return [v, v * 0.9, v * 0.74];
    }));
  }

  // Shuttered window, dark glass and louvres. Fits one quad.
  const windowTex = (lit) => pixels(32, (x, y) => {
    const frame = x < 2 || x > 29 || y < 2 || y > 29 || x === 15 || x === 16;
    if (frame) return [92, 74, 58];
    const louvre = y % 4 === 0;
    if (lit) {
      const g = 1 - Math.abs(y - 14) / 30;
      return louvre ? [120, 82, 40] : [255 * g, 206 * g, 120 * g];
    }
    return louvre ? [26, 30, 38] : [50 + (y % 4) * 5, 58 + (y % 4) * 5, 72 + (y % 4) * 6];
  });
  add('window', windowTex(false), { repeat: false });
  add('windowLit', windowTex(true), { repeat: false });

  // Leaf clump with alpha.
  {
    const r = makeRng(79);
    const n = noiseField(32, 6, r);
    add('foliage', pixels(32, (x, y) => {
      const dx = (x - 16) / 16, dy = (y - 16) / 16;
      const d = Math.hypot(dx, dy);
      const a = n(x, y) + (1 - d) * 0.9 > 1.02 ? 255 : 0;
      const v = 120 + n(y, x) * 110 + (r() - 0.5) * 30;
      return [v * 0.6, v, v * 0.45, a];
    }), { repeat: false });
  }

  // Broad tropical leaves for potted plants (fan of blades).
  {
    const r = makeRng(83);
    add('fern', pixels(32, (x, y) => {
      const dx = x - 16, dy = y; // root at bottom centre (canvas y grows down, texture is flipped)
      const yy = 31 - dy;
      const ang = Math.atan2(dx, yy + 0.01);
      const rad = Math.hypot(dx, yy);
      const blade = Math.abs(Math.sin(ang * 4.5 + 0.4)) > 0.52;
      const a = blade && rad < 30 - Math.abs(ang) * 5 && yy > 0 ? 255 : 0;
      const v = 110 + (rad / 30) * 80 + (r() - 0.5) * 30;
      return [v * 0.55, v, v * 0.42, a];
    }), { repeat: false });
  }

  // Soft radial glow for light pools, lamp halos and item glints.
  add('glow', pixels(32, (x, y) => {
    const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
    const a = clamp(1 - d, 0, 1);
    return [255, 255, 255, a * a * 255];
  }), { repeat: false, smooth: true });

  // Ground shadow / stain blob.
  {
    const r = makeRng(89);
    const n = noiseField(32, 5, r);
    add('blob', pixels(32, (x, y) => {
      const d = Math.hypot(x - 15.5, y - 15.5) / 15.5;
      const a = clamp(1.25 - d - n(x, y) * 0.4, 0, 1);
      return [255, 255, 255, Math.min(1, a * 1.6) * 255];
    }), { repeat: false, smooth: true });
  }

  // Four-point muzzle flash.
  add('flash', pixels(32, (x, y) => {
    const dx = Math.abs(x - 15.5) / 15.5, dy = Math.abs(y - 15.5) / 15.5;
    const star = Math.max(0, 1 - (dx * 5 + dy * 0.9)) + Math.max(0, 1 - (dy * 5 + dx * 0.9));
    const core = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2);
    const a = clamp(star * 0.8 + core * 1.4, 0, 1);
    return [255, 236, 190, a * 255];
  }), { repeat: false });

  // Poster / flyer sheet: faded blocks of colour with scribbled "text" rows.
  {
    const r = makeRng(97);
    add('poster', pixels(64, (x, y) => {
      const cellX = Math.floor(x / 32), cellY = Math.floor(y / 32);
      const hues = [[214, 196, 150], [188, 92, 74], [120, 150, 170], [206, 178, 96]];
      const base = hues[cellY * 2 + cellX];
      const lx = x % 32, ly = y % 32;
      if (lx < 2 || lx > 29 || ly < 2 || ly > 29) return [230, 224, 206];
      let k = 1 + (r() - 0.5) * 0.12;
      if (ly > 6 && ly < 26 && ly % 4 < 2 && lx > 5 && lx < 27 - ((ly * 7) % 9)) k *= 0.42;
      return [base[0] * k, base[1] * k, base[2] * k];
    }), { repeat: false });
  }

  // Iron fence bars (alpha tested). Tile horizontally, fit vertically.
  add('bars', pixels(16, (x, y) => {
    const bar = x % 8 < 2;
    const rail = y === 1 || y === 2 || y === 12 || y === 13;
    const spike = y === 15 && x % 8 < 2;
    if (bar || rail || spike) return [150, 150, 156, 255];
    return [0, 0, 0, 0];
  }));

  // Chain-link mesh (alpha tested).
  add('chain', pixels(16, (x, y) => {
    const on = (x + y) % 8 === 0 || (x - y + 16) % 8 === 0;
    return on ? [170, 172, 176, 255] : [0, 0, 0, 0];
  }));

  // Film grain tile for the CSS overlay.
  {
    const r = makeRng(101);
    T.grainCanvas = pixels(96, () => {
      const v = r() * 255;
      return [v, v, v, 34];
    });
  }

  return T;
}

/**
 * Sign atlas. Signs are painted with canvas text (Thai where it matters) into
 * one shared texture, so every sign in the level costs a single draw call.
 */
export class SignAtlas {
  constructor(width = 2048, height = 1280) {
    this.size = width;
    this.height = height;
    this.canvas = canvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.x = 0;
    this.y = 0;
    this.rowH = 0;
    this.rnd = makeRng(303);
  }

  _alloc(w, h) {
    if (this.x + w > this.size) {
      this.x = 0;
      this.y += this.rowH + 2;
      this.rowH = 0;
    }
    const r = { x: this.x, y: this.y, w, h };
    if (r.y + h > this.height) console.warn('SignAtlas is full; enlarge it.');
    this.x += w + 2;
    this.rowH = Math.max(this.rowH, h);
    return r;
  }

  /**
   * style: { bg, fg, border, font (css family), weight, vertical, sub (second line),
   *          subColor, wear (0..1), draw (custom painter) }
   * Returns { uv:[u0,v0,u1,v1], aspect } for use as a quad's fit rect.
   */
  add(text, w, h, style = {}) {
    const r = this._alloc(w, h);
    const c = this.ctx;
    c.save();
    c.translate(r.x, r.y);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    if (style.bg !== 'none') {
      c.fillStyle = style.bg || '#e8dcc0';
      c.fillRect(0, 0, w, h);
    }
    if (style.border) {
      c.strokeStyle = style.border;
      c.lineWidth = Math.max(2, Math.round(h * 0.06));
      c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, w - c.lineWidth, h - c.lineWidth);
    }
    const family = style.font || '"Chonburi","Kanit","Noto Sans Thai","Leelawadee UI","Thonburi","Tahoma",sans-serif';
    c.fillStyle = style.fg || '#8a2318';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (style.draw) style.draw(c, w, h);
    if (text) {
      if (style.vertical) {
        // Stack whole grapheme clusters so Thai vowels and tone marks stay attached.
        const parts = splitGraphemes(text.replace(/\s+/g, ''));
        const step = h / (parts.length + 0.4);
        const size = Math.min(w * 0.72, step * 0.92);
        c.font = `${style.weight || 700} ${size}px ${family}`;
        parts.forEach((ch, i) => c.fillText(ch, w / 2, step * (i + 0.72)));
      } else {
        const lines = style.sub ? 2 : 1;
        let size = (h * (lines === 2 ? 0.46 : 0.62));
        c.font = `${style.weight || 700} ${size}px ${family}`;
        const tw = c.measureText(text).width;
        if (tw > w * 0.9) {
          size *= (w * 0.9) / tw;
          c.font = `${style.weight || 700} ${size}px ${family}`;
        }
        c.fillText(text, w / 2, lines === 2 ? h * 0.38 : h * 0.53);
        if (style.sub) {
          let s2 = h * 0.2;
          c.font = `${style.subWeight || 600} ${s2}px ${style.subFont || family}`;
          const sw = c.measureText(style.sub).width;
          if (sw > w * 0.88) {
            s2 *= (w * 0.88) / sw;
            c.font = `${style.subWeight || 600} ${s2}px ${style.subFont || family}`;
          }
          c.fillStyle = style.subColor || style.fg || '#333';
          c.fillText(style.sub, w / 2, h * 0.78);
        }
      }
    }
    // Weathering: specks and vertical grime so signs do not look freshly printed.
    const wear = style.bg === 'none' ? 0 : style.wear === undefined ? 0.5 : style.wear;
    if (wear > 0) {
      for (let i = 0; i < w * h * 0.02 * wear; i++) {
        c.fillStyle = `rgba(${this.rnd() < 0.5 ? '20,16,12' : '236,226,204'},${0.12 + this.rnd() * 0.3})`;
        c.fillRect(this.rnd() * w, this.rnd() * h, 1 + this.rnd() * 2, 1 + this.rnd() * 3);
      }
      for (let i = 0; i < 6 * wear; i++) {
        const gx = this.rnd() * w;
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(30,22,14,0.34)');
        g.addColorStop(1, 'rgba(30,22,14,0)');
        c.fillStyle = g;
        c.fillRect(gx, 0, 2 + this.rnd() * 5, h * (0.4 + this.rnd() * 0.6));
      }
    }
    c.restore();
    const S = this.size, V = this.height;
    // Half-texel inset avoids bleeding between neighbours.
    return {
      uv: [(r.x + 0.5) / S, 1 - (r.y + h - 0.5) / V, (r.x + w - 0.5) / S, 1 - (r.y + 0.5) / V],
      aspect: w / h,
    };
  }
}

function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  }
  // Fallback: glue Thai combining marks onto the preceding consonant.
  const out = [];
  for (const ch of text) {
    if (/[ัิ-ฺ็-๎]/.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

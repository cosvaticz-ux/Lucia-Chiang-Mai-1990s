// Retro survival-horror HUD: name + health (top-left), mini-map (top-right),
// reticle (centre), weapon + ammo and three quick slots (bottom-right).
// Plain DOM over the canvas; nothing here touches game rules.

import { clamp } from '../engine/math.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.hp = $('hp');
    this.hpBar = $('hp-bar');
    this.st = $('st');
    this.stBar = $('st-bar');
    this.mag = $('mag');
    this.res = $('res');
    this.ammo = $('ammo');
    this.reticle = $('reticle');
    this.prompt = $('prompt');
    this.message = $('message');
    this.objective = $('objective');
    this.hurt = $('hurt');
    this.slotN = [$('slot-spray'), $('slot-herb'), $('slot-key')];
    this.slotBox = [$('slotbox-spray'), $('slotbox-herb'), $('slotbox-key')];
    this.map = $('minimap');
    this.mctx = this.map.getContext('2d');
    this.mctx.imageSmoothingEnabled = false;
    this.base = null;
    this.messages = [];
    this.msgTime = 0;
    this._last = {};
    this._promptText = '';
    this._mapTimer = 0;
  }

  set(el, key, value) {
    if (this._last[key] !== value) {
      this._last[key] = value;
      el.textContent = value;
    }
  }

  show(on) {
    this.root.hidden = !on;
  }

  /** Queue a line of text in the message box. */
  say(text, seconds = 3.2) {
    // The newest line always wins; stale pickup text is worse than a cut-off one.
    this.messages.length = 0;
    this.messages.push({ text, seconds });
    this.msgTime = 0;
  }

  setObjective(text) {
    this.set(this.objective, 'objective', text);
  }

  /** Pre-render the walkable footprint once. */
  buildMap(mm) {
    const px = 4; // map pixels per cell (cell = 0.5 m)
    const c = document.createElement('canvas');
    c.width = mm.w * px;
    c.height = mm.h * px;
    const g = c.getContext('2d');
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, c.width, c.height);
    const at = (i, j) => (i < 0 || j < 0 || i >= mm.w || j >= mm.h ? 0 : mm.cells[j * mm.w + i]);
    for (let j = 0; j < mm.h; j++) {
      for (let i = 0; i < mm.w; i++) {
        if (!at(i, j)) continue;
        g.fillStyle = '#55606e';
        g.fillRect(i * px, j * px, px, px);
        g.fillStyle = '#aab3bd';
        if (!at(i - 1, j)) g.fillRect(i * px, j * px, 1, px);
        if (!at(i + 1, j)) g.fillRect(i * px + px - 1, j * px, 1, px);
        if (!at(i, j - 1)) g.fillRect(i * px, j * px, px, 1);
        if (!at(i, j + 1)) g.fillRect(i * px, j * px + px - 1, px, 1);
      }
    }
    this.base = { canvas: c, scale: px / mm.res, x0: mm.x0, z0: mm.z0 };
  }

  drawMap(s) {
    const g = this.mctx, W = this.map.width, H = this.map.height, b = this.base;
    if (!b) return;
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, W, H);
    const sc = b.scale;
    // Centre on the player. Up the lane (-Z) is up on the map.
    const ox = Math.round(W / 2 - (s.px - b.x0) * sc), oy = Math.round(H / 2 - (s.pz - b.z0) * sc);
    g.drawImage(b.canvas, ox, oy);
    const to = (x, z) => [Math.round(ox + (x - b.x0) * sc), Math.round(oy + (z - b.z0) * sc)];
    // Objective marker.
    if (s.goal && Math.floor(s.time * 2.5) % 2 === 0) {
      let [gx, gy] = to(s.goal.x, s.goal.z);
      gx = clamp(gx, 5, W - 6); gy = clamp(gy, 5, H - 6);
      g.fillStyle = '#e0b83a';
      g.fillRect(gx - 3, gy - 3, 6, 6);
      g.fillStyle = '#07080b';
      g.fillRect(gx - 1, gy - 1, 2, 2);
    }
    g.fillStyle = '#e9e4d6';
    for (const p of s.pickups) {
      const [x, y] = to(p.x, p.z);
      g.fillRect(x - 1, y - 1, 3, 3);
    }
    g.fillStyle = '#e03a2a';
    for (const e of s.enemies) {
      const [x, y] = to(e.x, e.z);
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    // Player arrow.
    g.save();
    g.translate(Math.round(W / 2), Math.round(H / 2));
    g.rotate(-s.yaw);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(6, 7);
    g.lineTo(0, 3);
    g.lineTo(-6, 7);
    g.closePath();
    g.fill();
    g.restore();
  }

  /**
   * s: { health, stamina, mag, reserve, magSize, dry, reloading, items:{spray,herb}, hasKey,
   *      reticle:{show, x, y, gap, steady}, prompt, hurt, lowHealth, map:{...}, dt }
   */
  update(s) {
    // Health bar shifts from green through amber to red.
    const h = clamp(s.health, 0, 1);
    this.hp.style.transform = `scaleX(${h.toFixed(3)})`;
    const tone = h > 0.6 ? 'fine' : h > 0.3 ? 'caution' : 'danger';
    if (this._last.tone !== tone) {
      this._last.tone = tone;
      this.hpBar.dataset.tone = tone;
    }
    this.st.style.transform = `scaleX(${clamp(s.stamina, 0, 1).toFixed(3)})`;
    const stShow = s.stamina < 0.995;
    if (this._last.stShow !== stShow) {
      this._last.stShow = stShow;
      this.stBar.style.opacity = stShow ? '1' : '0';
    }

    this.set(this.mag, 'mag', String(s.mag));
    this.set(this.res, 'res', String(s.reserve));
    const ammoState = s.reloading ? 'reload' : s.mag === 0 ? 'empty' : s.mag <= Math.ceil(s.magSize / 4) ? 'low' : 'ok';
    if (this._last.ammoState !== ammoState) {
      this._last.ammoState = ammoState;
      this.ammo.dataset.state = ammoState;
    }

    const counts = [s.items.spray, s.items.herb, s.hasKey ? 1 : 0];
    for (let i = 0; i < 3; i++) {
      this.set(this.slotN[i], 'slot' + i, String(counts[i]));
      const empty = counts[i] === 0;
      if (this._last['slotE' + i] !== empty) {
        this._last['slotE' + i] = empty;
        this.slotBox[i].dataset.empty = empty ? '1' : '0';
      }
    }

    // Reticle follows the weapon's real line of fire.
    const r = s.reticle;
    if (this._last.retShow !== r.show) {
      this._last.retShow = r.show;
      this.reticle.style.opacity = r.show ? '1' : '0';
    }
    if (r.show) {
      this.reticle.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
      this.reticle.style.setProperty('--gap', `${r.gap.toFixed(1)}px`);
      const steady = r.steady ? '1' : '0';
      if (this._last.steady !== steady) {
        this._last.steady = steady;
        this.reticle.dataset.steady = steady;
      }
    }

    if (this._promptText !== s.prompt) {
      this._promptText = s.prompt;
      this.prompt.textContent = s.prompt ? `[E]  ${s.prompt}` : '';
      this.prompt.style.opacity = s.prompt ? '1' : '0';
    }

    // Message box.
    if (this.msgTime > 0) {
      this.msgTime -= s.dt;
      if (this.msgTime <= 0) this.message.style.opacity = '0';
    } else if (this.messages.length) {
      const m = this.messages.shift();
      this.message.textContent = m.text;
      this.message.style.opacity = '1';
      this.msgTime = m.seconds;
    }

    // Damage flash and low-health pulse.
    const pulse = s.lowHealth ? 0.22 + 0.16 * Math.sin(s.map.time * 5) : 0;
    this.hurt.style.opacity = Math.max(s.hurt * 0.7, pulse).toFixed(3);

    this._mapTimer -= s.dt;
    if (this._mapTimer <= 0) {
      this._mapTimer = 0.066;
      this.drawMap(s.map);
    }
  }
}

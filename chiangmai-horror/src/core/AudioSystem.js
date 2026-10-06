// Placeholder audio, fully synthesised with Web Audio so the prototype ships
// without sound files. Every cue is a named function; swap in samples later
// by replacing the body of play() for that name.

import { clamp } from '../engine/math.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.muted = false;
    this._ambient = null;
    this._nextCricket = 0;
    this._nextBell = 30;
    this._time = 0;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);
    // Shared white-noise buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._startAmbience();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  /** Output chain for one cue: gain (+ stereo pan / distance falloff if positioned). */
  _out(gain, pos, maxDist = 40) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let vol = gain, pan = 0;
    if (pos) {
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      vol *= clamp(1 - d / maxDist, 0, 1) ** 2;
      // Camera right vector for yaw (forward = (-sin, -cos)).
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan = d > 0.3 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
    }
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _noise(dur, out, { type = 'lowpass', f0 = 2000, f1 = f0, q = 0.7, attack = 0.002, gain = 1, delay = 0, rate = 1 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(env).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  _tone(dur, out, { type = 'sine', f0 = 440, f1 = f0, attack = 0.003, gain = 1, delay = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** name: cue id. opts: { pos:{x,z}, gain, pitch } */
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const g = opts.gain === undefined ? 1 : opts.gain;
    const p = opts.pitch || 1;
    const pos = opts.pos || null;
    switch (name) {
      case 'pistol': {
        const o = this._out(g, pos, 70);
        this._noise(0.2, o, { f0: 7000, f1: 500, gain: 1.5 });
        this._noise(0.05, o, { type: 'highpass', f0: 2500, gain: 0.9 });
        this._tone(0.14, o, { f0: 170, f1: 45, gain: 1.3 });
        this._noise(0.9, o, { f0: 1100, f1: 240, gain: 0.3, attack: 0.03, delay: 0.03 }); // street echo
        break;
      }
      case 'dry': {
        const o = this._out(g * 0.5, pos);
        this._tone(0.03, o, { type: 'square', f0: 1700, f1: 900, gain: 0.5 });
        this._noise(0.03, o, { type: 'highpass', f0: 4000, gain: 0.5 });
        break;
      }
      case 'magOut': {
        const o = this._out(g * 0.45, pos);
        this._noise(0.05, o, { type: 'bandpass', f0: 1800, q: 2, gain: 1 });
        this._tone(0.05, o, { type: 'square', f0: 500, f1: 260, gain: 0.3, delay: 0.03 });
        break;
      }
      case 'magIn': {
        const o = this._out(g * 0.55, pos);
        this._noise(0.04, o, { type: 'bandpass', f0: 2600, q: 2, gain: 1 });
        this._tone(0.06, o, { type: 'square', f0: 320, f1: 520, gain: 0.35 });
        break;
      }
      case 'slide': {
        const o = this._out(g * 0.5, pos);
        this._noise(0.05, o, { type: 'bandpass', f0: 3200, q: 1.5, gain: 1 });
        this._noise(0.05, o, { type: 'bandpass', f0: 2200, q: 1.5, gain: 1, delay: 0.08 });
        break;
      }
      case 'shell': {
        const o = this._out(g * 0.16, pos, 12);
        this._tone(0.09, o, { f0: 5200 * p, f1: 4300, gain: 1, delay: 0.42 });
        this._tone(0.06, o, { f0: 4700 * p, f1: 4000, gain: 0.5, delay: 0.55 });
        break;
      }
      case 'step': {
        const o = this._out(g * 0.5, pos, 16);
        this._noise(0.07, o, { f0: 900 * p, f1: 240, gain: 1 });
        this._tone(0.05, o, { f0: 95 * p, f1: 55, gain: 0.6 });
        break;
      }
      case 'shuffle': {
        const o = this._out(g * 0.3, pos, 16);
        this._noise(0.18, o, { type: 'bandpass', f0: 700 * p, f1: 380, q: 0.9, attack: 0.04, gain: 1 });
        break;
      }
      case 'hitFlesh': {
        const o = this._out(g * 0.9, pos, 40);
        this._noise(0.09, o, { f0: 1500, f1: 220, gain: 1.2 });
        this._tone(0.1, o, { f0: 130, f1: 60, gain: 1 });
        break;
      }
      case 'headshot': {
        const o = this._out(g, pos, 40);
        this._noise(0.12, o, { f0: 2600, f1: 200, gain: 1.3 });
        this._tone(0.16, o, { f0: 210, f1: 50, gain: 1.2 });
        this._noise(0.25, o, { type: 'bandpass', f0: 900, f1: 300, q: 1.2, gain: 0.5, delay: 0.04 });
        break;
      }
      case 'hitWall': {
        const o = this._out(g * 0.5, pos, 40);
        this._noise(0.06, o, { type: 'highpass', f0: 1800, gain: 1 });
        this._tone(0.18, o, { f0: 2400 * p, f1: 900, gain: 0.18 });
        break;
      }
      case 'hitMetal': {
        const o = this._out(g * 0.5, pos, 40);
        this._tone(0.3, o, { type: 'triangle', f0: 1900 * p, f1: 1500, gain: 0.5 });
        this._tone(0.22, o, { type: 'triangle', f0: 2950 * p, f1: 2600, gain: 0.3 });
        this._noise(0.04, o, { type: 'highpass', f0: 3000, gain: 0.8 });
        break;
      }
      case 'groan': {
        // Sawtooth voice through two wandering formants.
        const ctx = this.ctx, t = ctx.currentTime;
        const o = this._out(g * 0.55, pos, 30);
        const dur = 0.8 + Math.random() * 0.9;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const base = (72 + Math.random() * 34) * p;
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.linearRampToValueAtTime(base * (0.72 + Math.random() * 0.2), t + dur);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5 + Math.random() * 9;
        const lg = ctx.createGain();
        lg.gain.value = 7;
        lfo.connect(lg).connect(osc.frequency);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(1, t + 0.12);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        for (const [f, q] of [[520 + Math.random() * 200, 5], [1050 + Math.random() * 300, 7]]) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(f, t);
          bp.frequency.linearRampToValueAtTime(f * 0.75, t + dur);
          bp.Q.value = q;
          osc.connect(bp).connect(env);
        }
        env.connect(o);
        osc.start(t); lfo.start(t);
        osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
        this._noise(dur * 0.8, o, { type: 'bandpass', f0: 900, q: 1, gain: 0.12, attack: 0.1 });
        break;
      }
      case 'snarl': {
        const o = this._out(g * 0.7, pos, 30);
        this._tone(0.34, o, { type: 'sawtooth', f0: 150 * p, f1: 85, gain: 0.5, attack: 0.03 });
        this._noise(0.3, o, { type: 'bandpass', f0: 1300, f1: 600, q: 1.5, gain: 0.6, attack: 0.03 });
        break;
      }
      case 'swing': {
        const o = this._out(g * 0.5, pos, 20);
        this._noise(0.2, o, { type: 'bandpass', f0: 500, f1: 1700, q: 1.2, gain: 1, attack: 0.07 });
        break;
      }
      case 'hurt': {
        const o = this._out(g * 0.9, null);
        this._noise(0.1, o, { f0: 1300, f1: 200, gain: 1.2 });
        this._tone(0.12, o, { f0: 120, f1: 50, gain: 1.2 });
        this._tone(0.22, o, { type: 'triangle', f0: 480, f1: 300, gain: 0.25, attack: 0.02, delay: 0.03 });
        break;
      }
      case 'heartbeat': {
        const o = this._out(g * 0.8, null);
        this._tone(0.12, o, { f0: 68, f1: 42, gain: 1 });
        this._tone(0.12, o, { f0: 60, f1: 38, gain: 0.7, delay: 0.17 });
        break;
      }
      case 'bodyFall': {
        const o = this._out(g * 0.8, pos, 30);
        this._tone(0.2, o, { f0: 90, f1: 38, gain: 1.2 });
        this._noise(0.16, o, { f0: 700, f1: 160, gain: 0.9 });
        break;
      }
      case 'pickup': {
        const o = this._out(g * 0.3, null);
        this._tone(0.07, o, { type: 'square', f0: 660, gain: 0.5 });
        this._tone(0.12, o, { type: 'square', f0: 990, gain: 0.5, delay: 0.07 });
        break;
      }
      case 'heal': {
        const o = this._out(g * 0.3, null);
        this._noise(0.35, o, { type: 'highpass', f0: 3500, gain: 0.5, attack: 0.05 });
        this._tone(0.25, o, { type: 'triangle', f0: 520, f1: 780, gain: 0.5, attack: 0.05 });
        break;
      }
      case 'deny': {
        const o = this._out(g * 0.3, null);
        this._tone(0.09, o, { type: 'square', f0: 180, gain: 0.5 });
        this._tone(0.12, o, { type: 'square', f0: 140, gain: 0.5, delay: 0.1 });
        break;
      }
      case 'gate': {
        const o = this._out(g * 0.8, pos, 40);
        this._noise(0.12, o, { type: 'bandpass', f0: 2400, q: 3, gain: 1 });
        this._tone(1.3, o, { type: 'sawtooth', f0: 240, f1: 330, gain: 0.14, attack: 0.2, delay: 0.1 });
        this._tone(0.4, o, { type: 'triangle', f0: 900, f1: 700, gain: 0.3, delay: 0.1 });
        break;
      }
      case 'prop': {
        const o = this._out(g * 0.35, pos, 18);
        this._tone(0.08, o, { type: 'triangle', f0: 1400 * p, f1: 900, gain: 0.6 });
        this._noise(0.05, o, { type: 'bandpass', f0: 2600 * p, q: 2, gain: 0.7 });
        break;
      }
      case 'bell': {
        const o = this._out(g * 0.12, null);
        for (const [f, a] of [[392, 1], [784.5, 0.4], [1180, 0.22], [1571, 0.12]]) {
          this._tone(5.5, o, { f0: f, gain: a, attack: 0.01 });
        }
        break;
      }
      default:
        break;
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    // Night air: filtered noise that slowly breathes.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.025;
    lfo.connect(lg).connect(wg.gain);
    wind.connect(lp).connect(wg).connect(this.master);
    wind.start();
    lfo.start();
    // Low unease drone.
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 49;
    const drone2 = ctx.createOscillator();
    drone2.type = 'sine';
    drone2.frequency.value = 73.6;
    const dg = ctx.createGain();
    dg.gain.value = 0.035;
    drone.connect(dg);
    drone2.connect(dg);
    dg.connect(this.master);
    drone.start();
    drone2.start();
    // Fluorescent hum, volume driven by distance to the café.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 100;
    const hf = ctx.createBiquadFilter();
    hf.type = 'bandpass';
    hf.frequency.value = 400;
    hf.Q.value = 1;
    this._humGain = ctx.createGain();
    this._humGain.gain.value = 0;
    hum.connect(hf).connect(this._humGain).connect(this.master);
    hum.start();
  }

  /** Per-frame ambience scheduling. humPos: location of the buzzing shop light. */
  update(dt, humPos) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this._time += dt;
    if (humPos && this._humGain) {
      const d = Math.hypot(humPos.x - this.listener.x, humPos.z - this.listener.z);
      this._humGain.gain.value = 0.02 * clamp(1 - d / 11, 0, 1) ** 2;
    }
    if (this._time > this._nextCricket) {
      // A cricket: a burst of quick high chirps from a random direction.
      const pan = Math.random() * 2 - 1;
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0.012 + Math.random() * 0.012;
      let dst = g;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p).connect(this.master);
      } else g.connect(this.master);
      const f = 3900 + Math.random() * 900;
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this._tone(0.035, dst, { f0: f, gain: 1, attack: 0.006, delay: i * 0.06 });
      this._nextCricket = this._time + 0.35 + Math.random() * 1.6;
    }
    if (this._time > this._nextBell) {
      this.play('bell');
      this._nextBell = this._time + 45 + Math.random() * 40;
    }
  }
}

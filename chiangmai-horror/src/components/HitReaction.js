// Animation-driven hit reactions. A hit carries a stagger "power" and a
// knockback impulse taken from the weapon data; this component turns that into
// a reaction tier plus spring-driven body offsets and a sliding knockback.
//
//   flinch     quick torso/head snap, brief slow-down           (pistol body shot)
//   stagger    AI interrupted, stumbles back                    (pistol head shot, or several quick hits)
//   knockdown  thrown off its feet, gets up after a while       (reserved for shotgun-class power)
//
// Nothing here knows about pistols: a future shotgun only needs larger
// `stagger` and `knockback` numbers in its weapon entry.

import { Spring } from '../engine/math.js';

export class HitReaction {
  constructor(cfg) {
    this.cfg = cfg;
    this.meter = 0; // recent stagger build-up
    this.tier = 'none';
    this.timer = 0;
    this.pitch = new Spring(70, 8); // torso lean (+ forward)
    this.twist = new Spring(70, 8); // torso yaw
    this.head = new Spring(110, 9); // head pitch
    this.vx = 0;
    this.vz = 0;
    this.slow = 0; // seconds of reduced move speed
    this.legSlow = 0;
  }

  /**
   * hit: { zone:'head'|'torso'|'legs', power, knockback, dirX, dirZ,
   *        front (-1 hit from behind .. +1 hit from the front), side (-1..1) }
   * Returns the tier that was triggered.
   */
  apply(hit) {
    const c = this.cfg;
    const zoneMult = c.zoneStagger[hit.zone] || 1;
    const eff = hit.power * zoneMult + this.meter * c.meterCarry;
    this.meter += hit.power * zoneMult;

    let tier = 'flinch';
    if (eff >= c.knockdownThreshold) tier = 'knockdown';
    else if (eff >= c.staggerThreshold) tier = 'stagger';

    const kick = Math.min(hit.power, 4);
    // Hit from the front snaps the body backwards, from behind pitches it forward.
    const back = hit.front >= 0 ? -1 : 1;
    this.pitch.kick(back * (hit.zone === 'legs' ? -3.2 : 5.5) * kick);
    this.twist.kick(-hit.side * 7 * kick);
    this.head.kick(back * (hit.zone === 'head' ? 13 : 4) * kick);

    const kbScale = tier === 'flinch' ? 0.55 : tier === 'stagger' ? 1.25 : 2.2;
    this.vx += hit.dirX * hit.knockback * kbScale * c.knockbackScale;
    this.vz += hit.dirZ * hit.knockback * kbScale * c.knockbackScale;

    if (hit.zone === 'legs') this.legSlow = Math.max(this.legSlow, c.legSlowTime);
    this.slow = Math.max(this.slow, c.flinchTime);

    // A stronger tier always replaces a weaker one; equal tiers refresh.
    const rank = { none: 0, flinch: 1, stagger: 2, knockdown: 3 };
    if (rank[tier] >= rank[this.tier]) {
      this.tier = tier;
      this.timer = tier === 'flinch' ? c.flinchTime : tier === 'stagger' ? c.staggerTime : c.knockdownTime;
    }
    return tier;
  }

  update(dt) {
    this.meter = Math.max(0, this.meter - this.cfg.meterDecay * dt);
    this.pitch.update(dt);
    this.twist.update(dt);
    this.head.update(dt);
    const f = Math.exp(-6 * dt);
    this.vx *= f;
    this.vz *= f;
    this.slow = Math.max(0, this.slow - dt);
    this.legSlow = Math.max(0, this.legSlow - dt);
    if (this.tier !== 'none') {
      this.timer -= dt;
      if (this.timer <= 0) this.tier = 'none';
    }
  }

  /** Movement speed multiplier from recent hits. */
  get moveScale() {
    let s = 1;
    if (this.slow > 0) s *= this.cfg.flinchSlow;
    if (this.legSlow > 0) s *= this.cfg.legSlow;
    return s;
  }

  reset() {
    this.meter = 0;
    this.tier = 'none';
    this.timer = 0;
    this.vx = this.vz = 0;
    this.slow = this.legSlow = 0;
    for (const s of [this.pitch, this.twist, this.head]) { s.x = 0; s.v = 0; }
  }
}

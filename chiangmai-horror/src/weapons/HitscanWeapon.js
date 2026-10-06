// Instant-hit firearm driven entirely by a weapon data entry.
// One call to fire() resolves every pellet: aim ray from the camera through
// the (swayed) reticle, then the true bullet path from the muzzle to that point.

import { BULLET } from '../core/CollisionWorld.js';
import { DEG, lerp, saturate } from '../engine/math.js';

export class HitscanWeapon {
  constructor(cfg) {
    this.cfg = cfg;
  }

  damageAt(zone, dist) {
    const c = this.cfg;
    const f = c.falloff;
    const k = f ? lerp(1, f.minScale, saturate((dist - f.start) / (f.end - f.start))) : 1;
    return c.damage * (c.zoneDamage[zone] || 1) * k;
  }

  /**
   * shot: { ox,oy,oz (camera), dx,dy,dz (aim direction, unit), minT, spreadDeg,
   *         mx,my,mz (muzzle), rx,ry,rz / ux,uy,uz (camera right/up for the cone) }
   * ctx:  { world, enemies, props, effects, audio, time }
   * Returns a list of pellet results: { type:'enemy'|'world'|'prop'|'none', zone, killed, tier, x,y,z }
   */
  fire(shot, ctx) {
    const c = this.cfg;
    const results = [];
    const perEnemy = new Map();

    for (let p = 0; p < c.pellets; p++) {
      // Uniform point in the spread cone.
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.tan(shot.spreadDeg * DEG) * Math.sqrt(Math.random());
      let dx = shot.dx + (shot.rx * Math.cos(ang) + shot.ux * Math.sin(ang)) * rad;
      let dy = shot.dy + (shot.ry * Math.cos(ang) + shot.uy * Math.sin(ang)) * rad;
      let dz = shot.dz + (shot.rz * Math.cos(ang) + shot.uz * Math.sin(ang)) * rad;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;

      // 1) What is under the reticle?
      const sx = shot.ox + dx * shot.minT, sy = shot.oy + dy * shot.minT, sz = shot.oz + dz * shot.minT;
      let best = c.range, kind = 'none', target = null, zone = null, wallHit = null;
      const wh = ctx.world.raycast(sx, sy, sz, dx, dy, dz, c.range, BULLET);
      if (wh) { best = wh.t; kind = 'world'; wallHit = wh; }
      for (const e of ctx.enemies) {
        if (e.dead) continue;
        const h = e.raycast(sx, sy, sz, dx, dy, dz, best);
        if (h && h.t < best) { best = h.t; kind = 'enemy'; target = e; zone = h.zone; }
      }
      const ph = ctx.props ? ctx.props.raycast(sx, sy, sz, dx, dy, dz, best) : null;
      if (ph && ph.t < best) { best = ph.t; kind = 'prop'; target = ph.prop; }
      let hx = sx + dx * best, hy = sy + dy * best, hz = sz + dz * best;

      // 2) The bullet really leaves from the muzzle. If cover sits between the
      //    muzzle and the aim point, it stops there instead.
      let bx = hx - shot.mx, by = hy - shot.my, bz = hz - shot.mz;
      const bl = Math.hypot(bx, by, bz) || 1;
      bx /= bl; by /= bl; bz /= bl;
      const block = bl > 0.3 ? ctx.world.raycast(shot.mx, shot.my, shot.mz, bx, by, bz, bl - 0.08, BULLET) : null;
      if (block) {
        kind = 'world'; wallHit = block; target = null;
        hx = block.x; hy = block.y; hz = block.z;
      }

      ctx.effects.tracer(shot.mx, shot.my, shot.mz, hx, hy, hz);

      const res = { type: kind, zone: null, killed: false, tier: null, enemy: kind === 'enemy' ? target : null, x: hx, y: hy, z: hz };
      if (kind === 'enemy') {
        const dist = Math.hypot(hx - shot.mx, hy - shot.my, hz - shot.mz);
        let agg = perEnemy.get(target);
        if (!agg) { agg = { damage: 0, power: 0, knockback: 0, zone, x: hx, y: hy, z: hz, dx: bx, dy: by, dz: bz }; perEnemy.set(target, agg); }
        agg.damage += this.damageAt(zone, dist);
        agg.power += c.stagger;
        agg.knockback += c.knockback;
        if (zone === 'head') agg.zone = 'head';
        res.zone = zone;
        ctx.effects.impactFlesh(hx, hy, hz, bx, by, bz, zone === 'head');
      } else if (kind === 'world') {
        const metal = wallHit.box.tag === 'metal';
        ctx.effects.impactWorld(hx, hy, hz, wallHit.nx, wallHit.ny, wallHit.nz, metal);
        ctx.audio.play(metal ? 'hitMetal' : 'hitWall', { pos: { x: hx, z: hz }, pitch: 0.85 + Math.random() * 0.3 });
      } else if (kind === 'prop') {
        ctx.props.impulse(target, bx * 4.5, 2.2, bz * 4.5);
        ctx.effects.impactWorld(hx, hy, hz, -bx, 0.4, -bz, true);
        ctx.audio.play('hitMetal', { pos: { x: hx, z: hz }, pitch: 1.2 + Math.random() * 0.4 });
      }
      results.push(res);
    }

    // Pellets that struck the same enemy land as one combined hit, so a
    // multi-pellet weapon produces one strong reaction rather than many small ones.
    for (const [enemy, agg] of perEnemy) {
      const out = enemy.onHit({
        damage: agg.damage, power: agg.power, knockback: agg.knockback, zone: agg.zone,
        x: agg.x, y: agg.y, z: agg.z, dirX: agg.dx, dirY: agg.dy, dirZ: agg.dz, time: ctx.time,
      });
      for (const r of results) {
        if (r.enemy === enemy) { r.killed = out.killed; r.tier = out.tier; }
      }
      ctx.audio.play(agg.zone === 'head' ? 'headshot' : 'hitFlesh', { pos: { x: agg.x, z: agg.z } });
    }
    return results;
  }
}

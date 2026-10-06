// Weapon definitions. Everything the weapon code needs is data, so adding a
// gun means adding an entry here (plus a model and a HUD icon).
// Angles are in degrees, distances in metres, times in seconds.

export const WEAPONS = {
  service_pistol: {
    id: 'service_pistol',
    name: 'Service Pistol',
    family: 'handgun',
    type: 'hitscan',
    icon: 'pistol',

    // Fire control
    fireMode: 'semi',
    fireInterval: 0.27,
    pellets: 1,
    range: 70,

    // Damage. Zone multipliers apply on top of the base value.
    damage: 30,
    zoneDamage: { head: 3.5, torso: 1.0, legs: 0.7 },
    falloff: { start: 22, end: 60, minScale: 0.6 },

    // Hit reaction input (see components/HitReaction.js)
    stagger: 1.0,
    knockback: 1.7,

    // Ammunition
    magSize: 12,
    ammoType: '9mm',
    reloadTime: 1.75,
    reloadInsertAt: 0.68, // fraction of reloadTime at which the magazine counts as loaded

    // Cone of fire. Sway moves the reticle; spread is the small residual error around it.
    spread: {
      aimed: 0.1,
      hip: 3.4,
      moveAdd: 0.7,
      bloomPerShot: 0.75,
      bloomMax: 2.6,
      bloomDecay: 4.2,
    },

    // Aim sway: how far the reticle wanders (degrees) and what makes it worse.
    sway: {
      base: 0.3,
      moveAdd: 0.75, // at full aim-walk speed
      exertionAdd: 1.25, // just after sprinting
      injuredAdd: 0.9, // at zero health
      settleAdd: 1.3, // right after raising the weapon
      settleTime: 0.45,
      breathScale: 0.22, // multiplier while holding breath
      gaspScale: 1.9, // multiplier after running out of breath
      speed: 1.0,
    },

    recoil: {
      pitch: 2.3, // camera kick up
      yaw: 0.8, // random horizontal kick
      returnRate: 7.5, // how fast the kick settles
      recover: 0.55, // fraction of the kick that returns on its own
      swayKick: 0.5, // impulse added to the reticle
      shake: 0.035,
      armKick: 0.32, // radians, visual only
    },

    aim: { fov: 45, moveSpeed: 1.55 },
    muzzleFlash: { light: 3.2, size: 0.42 },
    audio: { fire: 'pistol', dry: 'dry' },
    noiseRadius: 22, // how far the shot alerts enemies (65% of this through walls)
  },

  // Future families plug in here. Planned shape, not active yet:
  //
  // pump_shotgun: { family: 'shotgun', type: 'hitscan', pellets: 8, damage: 14,
  //   stagger: 0.55, knockback: 0.7,   // per pellet; HitscanWeapon sums them per target
  //   spread: { aimed: 3.2, hip: 5.5, ... }, magSize: 5, ... }
  // bolt_rifle:   { family: 'rifle', type: 'hitscan', pellets: 1, damage: 95,
  //   stagger: 2.6, knockback: 3.0, spread: { aimed: 0.03, hip: 5, ... }, ... }
};

export const AMMO_TYPES = {
  '9mm': { name: 'Handgun Ammo' },
};

// Enemy tuning. EnemyController reads everything from here.

export const ENEMY_TYPES = {
  infected: {
    health: 100,
    radius: 0.34,
    speed: { wander: 0.4, search: 0.9, chase: 2.1 },
    turnRate: 4.5,

    senses: {
      viewDist: 15,
      viewAngle: 110, // total cone in degrees
      proximity: 2.2, // always noticed inside this radius
      hearWalk: 1.6,
      hearRun: 5.5,
      hearSprint: 9.5,
      noticeTime: 0.75, // delay between spotting and charging
      forgetTime: 9,
    },

    attack: {
      range: 1.3, // starts the wind-up inside this distance
      reach: 1.6, // connects if the player is still this close
      arc: 75,
      windup: 0.45,
      lunge: 0.16,
      recover: 0.8,
      damage: 17,
      lungeSpeed: 3.0,
    },

    // Capsule hit zones, relative to the animated skeleton.
    zones: { headRadius: 0.16, torsoRadius: 0.25, legRadius: 0.2 },

    reaction: {
      zoneStagger: { head: 2.0, torso: 1.0, legs: 1.3 },
      meterCarry: 0.5,
      meterDecay: 0.55,
      staggerThreshold: 1.8,
      knockdownThreshold: 3.2,
      flinchTime: 0.3,
      staggerTime: 0.95,
      knockdownTime: 2.6,
      getupTime: 1.2,
      flinchSlow: 0.2,
      legSlow: 0.45,
      legSlowTime: 1.6,
      knockbackScale: 1,
    },
  },
};

// Clothing palettes for the placeholder infected.
export const INFECTED_LOOKS = [
  { shirt: 0x8a8370, vest: 0x5a5f4a, pants: 0x3a3f44, skin: 0x93a089, hair: 0x1c1a18, cap: 0x4a4038 },
  { shirt: 0x9c7b62, vest: null, pants: 0x4a4334, skin: 0x8f9a8c, hair: 0x221c18, cap: null },
  { shirt: 0x6f7f8c, vest: 0x3d4650, pants: 0x2f3138, skin: 0x9aa390, hair: 0x18161a, cap: 0x2f3a46 },
  { shirt: 0xa39a84, vest: null, pants: 0x5a4a3c, skin: 0x8a968a, hair: 0x2a2420, cap: null },
  { shirt: 0x7a5a50, vest: 0x44372f, pants: 0x34383c, skin: 0x97a08a, hair: 0x1a1816, cap: 0x5a3028 },
];

// Lucia's movement, stamina and camera tuning.

export const PLAYER = {
  radius: 0.3,
  health: 100,
  speed: { walk: 1.55, run: 3.5, sprint: 5.7 },
  accel: 22, // how quickly she reaches the target speed
  decel: 14, // how quickly she stops
  turnRate: 13, // facing follows movement this fast (exploration)
  aimTurnRate: 22,

  stamina: {
    max: 100,
    sprintDrain: 15,
    breathDrain: 24,
    regen: 20,
    regenDelay: 0.9,
    minToSprint: 12,
  },

  // How long the sway penalty from sprinting lingers.
  exertionDecay: 0.32,

  items: {
    spray: { heal: 100, start: 0 },
    herb: { heal: 35, start: 0 },
  },

  start: { mag: 12, reserve: 12 },
};

export const CAMERA = {
  sensitivity: 0.0023,
  aimSensitivityScale: 0.62,
  pitchMin: -1.05,
  pitchMax: 1.1,
  pivotHeight: 1.42,
  explore: { dist: 3.1, shoulder: 0.5, height: 0.28, fov: 60 },
  aim: { dist: 1.25, shoulder: 0.58, height: 0.14, fov: 45 },
  sprintFovAdd: 6,
  blendRate: 11,
  near: 0.08,
  far: 400,
  collisionMargin: 0.22,
};

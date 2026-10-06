// Placeholder character geometry: Lucia, the service pistol, and the infected.
// Built from tapered boxes and low-poly ellipsoids with vertex colours, so each
// character is ~14 tiny meshes and no texture memory.

import { MeshBuilder } from '../engine/MeshBuilder.js';
import { Node } from '../engine/Node.js';
import { CharacterRig } from './CharacterRig.js';

const LUCIA_DIM = {
  hipY: 0.9, spineY: 0.1, neckY: 0.44,
  shoulderX: 0.165, shoulderY: 0.37, hipX: 0.085,
  upperArm: 0.26, thigh: 0.42,
};

const C = {
  skin: 0xe6b08c, skinShade: 0xcf9777,
  hair: 0xe0bd62, hairLight: 0xf3dc8e, hairDark: 0xb8943f,
  top: 0x84302a, topDark: 0x5e211e,
  denim: 0x2e3848, denimLight: 0x3d4a5e,
  leather: 0x3a2a20, leatherLight: 0x54402f,
  boot: 0x2a211d, metal: 0x30343b, metalLight: 0x555b66,
  eye: 0x24303a, lip: 0xa8584c,
};

export function buildLucia(renderer, material) {
  const rig = new CharacterRig(LUCIA_DIM);
  let b;

  // Hips: denim shorts, belt, pouches.
  b = new MeshBuilder();
  b.tbox(0, 0.02, 0, 0.3, 0.19, 0.27, 0.17, 0.2, { color: C.denim });
  b.box(0, 0.115, 0, 0.285, 0.035, 0.185, { color: C.leather });
  b.box(0, 0.115, 0.095, 0.045, 0.04, 0.012, { color: C.metalLight });
  b.box(0.115, 0.05, -0.1, 0.075, 0.095, 0.05, { color: C.leatherLight });
  b.box(-0.105, 0.055, -0.1, 0.06, 0.08, 0.045, { color: C.leatherLight });
  b.box(0.16, 0.045, 0.01, 0.04, 0.09, 0.08, { color: C.leather });
  rig.skin('hips', b, renderer, material);

  // Torso: bare midriff, crop top, crossed harness.
  b = new MeshBuilder();
  b.tbox(0, 0.08, 0, 0.25, 0.16, 0.235, 0.15, 0.15, { color: C.skin });
  b.tbox(0, 0.265, 0, 0.245, 0.165, 0.33, 0.185, 0.22, { color: C.top });
  b.tbox(0, 0.275, 0.075, 0.23, 0.07, 0.2, 0.04, 0.11, { color: C.top });
  b.box(0, 0.16, 0, 0.25, 0.02, 0.17, { color: C.topDark });
  b.cyl(0, 0.36, 0, 0.043, 0.1, { color: C.skinShade, seg: 6, capTop: false });
  for (const s of [1, -1]) {
    b.push(0, 0.265, -0.098, 0, 0, 0.6 * s).box(0, 0, 0, 0.034, 0.38, 0.014, { color: C.leather }).pop();
    b.push(0, 0.265, 0.1, 0, 0, -0.6 * s).box(0, 0, 0, 0.03, 0.36, 0.012, { color: C.leather }).pop();
    b.box(0.12 * s, 0.375, 0, 0.04, 0.02, 0.19, { color: C.leather });
  }
  b.box(0, 0.27, -0.106, 0.05, 0.05, 0.012, { color: C.metalLight });
  rig.skin('spine', b, renderer, material);

  // Head: face, blonde hair with fringe and side locks.
  b = new MeshBuilder();
  b.sphere(0, 0.135, 0.004, 0.097, 0.12, 0.107, { color: C.skin, seg: 8, rings: 6 });
  b.sphere(0, 0.158, -0.02, 0.108, 0.114, 0.116, { color: C.hair, seg: 8, rings: 6 });
  b.push(0, 0.222, 0.082, 0.35, 0, 0).box(0, 0, 0, 0.17, 0.06, 0.035, { color: C.hairLight }).pop();
  b.push(0.055, 0.2, 0.094, 0.25, 0, 0.35).box(0, 0, 0, 0.07, 0.08, 0.02, { color: C.hair }).pop();
  b.push(-0.06, 0.2, 0.094, 0.25, 0, -0.3).box(0, 0, 0, 0.06, 0.07, 0.02, { color: C.hairLight }).pop();
  for (const s of [1, -1]) {
    b.tbox(0.098 * s, 0.11, 0.035, 0.022, 0.04, 0.034, 0.07, 0.2, { color: C.hair });
    b.box(0.04 * s, 0.142, 0.103, 0.03, 0.017, 0.01, { color: C.eye });
    b.box(0.04 * s, 0.166, 0.1, 0.036, 0.007, 0.01, { color: C.hairDark });
  }
  b.box(0, 0.083, 0.1, 0.032, 0.007, 0.01, { color: C.lip });
  rig.skin('head', b, renderer, material);

  // Ponytail on its own joint so it can swing.
  rig.pony = rig.head.add(new Node().setPos(0, 0.215, -0.105));
  b = new MeshBuilder();
  b.box(0, 0, -0.005, 0.06, 0.05, 0.05, { color: C.top });
  b.tbox(0, -0.19, -0.01, 0.055, 0.045, 0.13, 0.1, 0.36, { color: C.hair });
  b.push(0.035, -0.02, -0.02, 0, 0, 0.28).tbox(0, -0.15, 0, 0.03, 0.03, 0.07, 0.07, 0.3, { color: C.hairLight }).pop();
  b.push(-0.035, -0.02, -0.02, 0, 0, -0.3).tbox(0, -0.14, 0, 0.03, 0.03, 0.07, 0.07, 0.28, { color: C.hairDark }).pop();
  b.push(0, -0.02, -0.03, 0.3, 0, 0).tbox(0, -0.13, 0, 0.03, 0.03, 0.08, 0.06, 0.26, { color: C.hairLight }).pop();
  const pony = new Node(b.build(renderer), material);
  pony.castShadow = true;
  rig.pony.add(pony);

  // Arms.
  for (const side of ['L', 'R']) {
    b = new MeshBuilder();
    b.sphere(0, -0.012, 0, 0.056, 0.056, 0.056, { color: C.skin, seg: 6, rings: 4 });
    b.tbox(0, -0.135, 0, 0.068, 0.068, 0.086, 0.086, 0.25, { color: C.skin });
    rig.skin('arm' + side, b, renderer, material);
    b = new MeshBuilder();
    b.tbox(0, -0.105, 0, 0.054, 0.054, 0.07, 0.07, 0.21, { color: C.skin });
    b.box(0, -0.2, 0, 0.066, 0.05, 0.066, { color: C.leather });
    b.box(0, -0.265, 0.004, 0.055, 0.085, 0.07, { color: C.skinShade });
    rig.skin('fore' + side, b, renderer, material);
  }

  // Legs.
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    b = new MeshBuilder();
    b.tbox(0, -0.21, 0, 0.1, 0.1, 0.135, 0.14, 0.42, { color: C.skin });
    b.tbox(0, -0.045, 0, 0.142, 0.148, 0.142, 0.152, 0.13, { color: C.denim });
    b.box(0, -0.112, 0, 0.146, 0.012, 0.15, { color: C.denimLight });
    if (side === 'R') {
      b.box(0, -0.2, 0, 0.128, 0.03, 0.132, { color: C.leather });
      b.box(0, -0.29, 0, 0.118, 0.026, 0.122, { color: C.leather });
      b.box(0.074 * s, -0.24, 0, 0.04, 0.16, 0.085, { color: C.leatherLight });
    }
    rig.skin('leg' + side, b, renderer, material);
    b = new MeshBuilder();
    b.tbox(0, -0.11, 0, 0.086, 0.09, 0.1, 0.1, 0.22, { color: C.skin });
    b.tbox(0, -0.33, 0, 0.092, 0.1, 0.1, 0.106, 0.22, { color: C.boot });
    b.box(0, -0.235, 0, 0.106, 0.025, 0.11, { color: C.leatherLight });
    b.box(0, -0.455, 0.045, 0.096, 0.05, 0.22, { color: C.boot });
    rig.skin('shin' + side, b, renderer, material);
  }

  // Service pistol in the right hand. Barrel runs along the forearm (-Y);
  // local +Z is "up" once the arm is raised.
  b = new MeshBuilder();
  b.box(0, -0.375, 0.056, 0.03, 0.2, 0.042, { color: C.metal });
  b.box(0, -0.375, 0.079, 0.012, 0.19, 0.006, { color: C.metalLight });
  b.box(0, -0.3, 0.0, 0.03, 0.052, 0.105, { color: C.leather });
  b.box(0, -0.335, 0.022, 0.012, 0.04, 0.03, { color: C.metalLight });
  const gun = new Node(b.build(renderer), material);
  gun.castShadow = true;
  rig.foreR.add(gun);
  rig.gun = gun;
  rig.muzzleLocal = [0, -0.49, 0.056];

  return rig;
}

const INFECTED_DIM = {
  hipY: 0.94, spineY: 0.1, neckY: 0.47,
  shoulderX: 0.205, shoulderY: 0.4, hipX: 0.1,
  upperArm: 0.29, thigh: 0.44,
};

/** look: palette from data/enemies.js */
export function buildInfected(renderer, material, look, rnd) {
  const rig = new CharacterRig(INFECTED_DIM);
  const blood = 0x5a1210, bloodDark = 0x3a0c0c, shoe = 0x221e1c;
  const skin = look.skin, skinDark = shade(look.skin, 0.8);
  const jacket = look.vest || look.shirt;
  let b;

  b = new MeshBuilder();
  b.tbox(0, 0.02, 0, 0.33, 0.21, 0.32, 0.2, 0.22, { color: look.pants });
  b.box(0, 0.125, 0, 0.33, 0.03, 0.21, { color: 0x1e1a18 });
  rig.skin('hips', b, renderer, material);

  b = new MeshBuilder();
  b.tbox(0, 0.1, 0, 0.31, 0.2, 0.33, 0.21, 0.2, { color: look.shirt });
  b.tbox(0, 0.305, 0, 0.33, 0.21, 0.43, 0.23, 0.22, { color: look.shirt });
  if (look.vest) {
    // Open vest: two front panels and a back.
    for (const s of [1, -1]) b.tbox(0.125 * s, 0.22, 0.11, 0.11, 0.02, 0.14, 0.02, 0.4, { color: look.vest });
    b.tbox(0, 0.22, -0.112, 0.33, 0.02, 0.42, 0.02, 0.4, { color: look.vest });
  }
  b.cyl(0, 0.4, 0, 0.05, 0.09, { color: skinDark, seg: 6, capTop: false });
  // Blood down the front.
  b.box(0.02 + rnd.range(-0.04, 0.04), 0.3, 0.118, 0.13, 0.17, 0.01, { color: blood });
  b.box(0.05, 0.16, 0.108, 0.07, 0.12, 0.01, { color: bloodDark });
  rig.skin('spine', b, renderer, material);

  b = new MeshBuilder();
  b.sphere(0, 0.14, 0.005, 0.102, 0.125, 0.112, { color: skin, seg: 8, rings: 6 });
  b.sphere(0, 0.17, -0.016, 0.106, 0.1, 0.114, { color: look.hair, seg: 8, rings: 5 });
  if (look.cap) {
    b.sphere(0, 0.19, -0.004, 0.112, 0.085, 0.12, { color: look.cap, seg: 8, rings: 5 });
    b.box(0, 0.178, 0.125, 0.15, 0.014, 0.1, { color: shade(look.cap, 0.8) });
  }
  for (const s of [1, -1]) {
    b.box(0.042 * s, 0.148, 0.106, 0.034, 0.022, 0.012, { color: 0x14100e });
    b.box(0.042 * s, 0.148, 0.112, 0.014, 0.012, 0.006, { color: 0xd8d2b0 });
  }
  b.box(0, 0.082, 0.1, 0.07, 0.036, 0.016, { color: bloodDark });
  b.box(0.012, 0.05, 0.094, 0.06, 0.04, 0.014, { color: blood });
  rig.skin('head', b, renderer, material);

  for (const side of ['L', 'R']) {
    b = new MeshBuilder();
    b.sphere(0, -0.012, 0, 0.07, 0.065, 0.07, { color: jacket, seg: 6, rings: 4 });
    b.tbox(0, -0.15, 0, 0.085, 0.085, 0.105, 0.105, 0.28, { color: jacket });
    rig.skin('arm' + side, b, renderer, material);
    b = new MeshBuilder();
    b.tbox(0, -0.115, 0, 0.066, 0.066, 0.084, 0.084, 0.23, { color: look.vest ? look.shirt : skin });
    b.box(0, -0.29, 0.004, 0.066, 0.11, 0.08, { color: skinDark });
    b.box(0, -0.335, 0.004, 0.068, 0.03, 0.082, { color: blood });
    rig.skin('fore' + side, b, renderer, material);
  }

  for (const side of ['L', 'R']) {
    b = new MeshBuilder();
    b.tbox(0, -0.22, 0, 0.125, 0.125, 0.16, 0.165, 0.44, { color: look.pants });
    rig.skin('leg' + side, b, renderer, material);
    b = new MeshBuilder();
    b.tbox(0, -0.21, 0, 0.105, 0.11, 0.122, 0.122, 0.42, { color: shade(look.pants, 0.9) });
    b.box(0, -0.465, 0.04, 0.11, 0.07, 0.25, { color: shoe });
    rig.skin('shin' + side, b, renderer, material);
  }

  return rig;
}

function shade(hex, k) {
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * k) | 0;
  const b = Math.min(255, (hex & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}

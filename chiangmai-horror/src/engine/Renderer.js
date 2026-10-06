// Minimal WebGL2 forward renderer with a PS2-era feature set:
// one lit/unlit shader, hemisphere + directional + up to 12 point lights,
// linear fog, ordered dithering, alpha test, additive/alpha blending,
// and stencilled planar shadows for selected dynamic objects.
// It renders straight to a low-resolution canvas that CSS scales up unfiltered.

import { m4 } from './math.js';

const MAX_LIGHTS = 12;
export const STRIDE = 12; // pos3 nrm3 uv2 col4

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aCol;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNrm;
out vec2 vUv;
out vec4 vCol;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNrm = mat3(uModel) * aNrm;
  vUv = aUv;
  vCol = aCol;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNrm;
in vec2 vUv;
in vec4 vCol;
uniform sampler2D uTex;
uniform vec3 uCamPos;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uDirDir;
uniform vec3 uDirCol;
uniform int uNumLights;
uniform vec4 uLPos[${MAX_LIGHTS}];
uniform vec3 uLCol[${MAX_LIGHTS}];
uniform vec3 uFogCol;
uniform vec3 uFog;      // near, far, max amount
uniform vec4 uTint;     // rgb tint, opacity
uniform vec4 uParams;   // unlit, alphaTest, fog amount, emissive
uniform vec2 uFx;       // dither levels (0 = off), additive flag
out vec4 o;
const float bayer[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
void main(){
  vec4 t = texture(uTex, vUv) * vCol * uTint;
  if (t.a < uParams.y) discard;
  vec3 c = t.rgb;
  if (uParams.x < 0.5) {
    vec3 n = normalize(vNrm);
    if (!gl_FrontFacing) n = -n;
    vec3 l = mix(uGround, uSky, n.y * 0.5 + 0.5) + uDirCol * max(dot(n, uDirDir), 0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uNumLights) break;
      vec3 d = uLPos[i].xyz - vWorld;
      float dist = length(d);
      float a = clamp(1.0 - dist / uLPos[i].w, 0.0, 1.0);
      a *= a;
      float nd = max(dot(n, d / max(dist, 0.001)) * 0.8 + 0.2, 0.0);
      l += uLCol[i] * (a * nd);
    }
    c = c * l + t.rgb * uParams.w;
  }
  float fd = distance(vWorld, uCamPos);
  float f = clamp((fd - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0) * uFog.z * uParams.z;
  if (uFx.y > 0.5) c *= (1.0 - f); else c = mix(c, uFogCol, f);
  if (uFx.x > 0.0) {
    ivec2 p = ivec2(gl_FragCoord.xy) & 3;
    float b = (bayer[p.y * 4 + p.x] + 0.5) / 16.0;
    c = floor(c * uFx.x + b) / uFx.x;
  }
  o = vec4(c, t.a);
}`;

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uShadow;
uniform mat4 uViewProj;
out vec3 vWorld;
void main(){
  vec4 w = uShadow * (uModel * vec4(aPos, 1.0));
  vWorld = w.xyz / w.w;
  gl_Position = uViewProj * w;
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec4 uCenter;   // caster xz in xy, fade radius in z, strength in w
out vec4 o;
void main(){
  float d = distance(vWorld.xz, uCenter.xy);
  float a = clamp(1.0 - d / uCenter.z, 0.0, 1.0) * uCenter.w;
  o = vec4(0.0, 0.0, 0.02, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function link(gl, vs, fs, names) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  }
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

/** Material description. Plain data so level code can declare them inline. */
export function material(opts = {}) {
  return {
    tex: null,
    unlit: false,
    pass: 1, // 0 sky, 1 opaque, 2 decal, 3 transparent
    blend: 'none', // none | alpha | add
    alphaTest: 0,
    depthWrite: true,
    depthTest: true,
    cull: true,
    fog: 1,
    tint: [1, 1, 1],
    opacity: 1,
    emissive: 0,
    offset: false,
    dither: true,
    ...opts,
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      stencil: true,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.main = link(gl, VS, FS, [
      'uModel', 'uViewProj', 'uTex', 'uCamPos', 'uSky', 'uGround', 'uDirDir', 'uDirCol',
      'uNumLights', 'uLPos', 'uLCol', 'uFogCol', 'uFog', 'uTint', 'uParams', 'uFx',
    ]);
    this.shadow = link(gl, SHADOW_VS, SHADOW_FS, ['uModel', 'uShadow', 'uViewProj', 'uCenter']);
    this.white = this.createTexture(null);
    this.viewProj = m4.create();
    this.view = m4.create();
    this.proj = m4.create();
    this._lpos = new Float32Array(MAX_LIGHTS * 4);
    this._lcol = new Float32Array(MAX_LIGHTS * 3);
    this._lists = [[], [], [], []];
    this._shadowList = [];
    this._shadowM = m4.create();
    this.ditherLevels = 40;
    this.shadowsEnabled = true;
    this.stats = { draws: 0, tris: 0 };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  /** Canvas source -> repeating texture with nearest magnification. */
  createTexture(source, { repeat = true, mips = true, smooth = false } = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (!source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    if (mips) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    }
    return t;
  }

  /** Upload interleaved vertices (STRIDE floats each) and optional indices. */
  createMesh(vertices, indices, { dynamic = false, lines = false } = {}) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const B = 4 * STRIDE;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, B, 32);
    let ibo = null;
    let count = vertices.length / STRIDE;
    if (indices) {
      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      count = indices.length;
    }
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count, mode: lines ? gl.LINES : gl.TRIANGLES };
  }

  /** Replace the contents of a dynamic, non-indexed mesh. */
  updateMesh(mesh, vertices, vertexCount) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, vertexCount * STRIDE);
    mesh.count = vertexCount;
  }

  setSize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  _collect(node, shadowOwner) {
    if (!node.visible) return;
    if (node.shadowCaster) shadowOwner = node.shadowCaster;
    if (node.mesh && node.mesh.count > 0) {
      this._lists[node.material.pass].push(node);
      if (shadowOwner && node.castShadow) {
        node._shadowOwner = shadowOwner;
        this._shadowList.push(node);
      }
    }
    const ch = node.children;
    for (let i = 0; i < ch.length; i++) this._collect(ch[i], shadowOwner);
  }

  /**
   * scene: { root, lights:[{x,y,z,range,r,g,b,on}], sky:[r,g,b], ground:[r,g,b],
   *          dirDir:[x,y,z], dirCol:[r,g,b], fogCol:[r,g,b], fogNear, fogFar, fogMax }
   * camera: { x,y,z, tx,ty,tz, fov(radians), near, far }
   */
  render(scene, camera) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    m4.perspective(this.proj, camera.fov, W / H, camera.near, camera.far);
    m4.lookAt(this.view, camera.x, camera.y, camera.z, camera.tx, camera.ty, camera.tz);
    m4.multiply(this.viewProj, this.proj, this.view);

    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clearColor(scene.fogCol[0], scene.fogCol[1], scene.fogCol[2], 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    for (const l of this._lists) l.length = 0;
    this._shadowList.length = 0;
    scene.root.updateWorld(null, false);
    this._collect(scene.root, null);

    // Pick the lights that matter most to the camera this frame.
    const lights = scene.lights;
    let n = 0;
    for (let i = 0; i < lights.length && n < MAX_LIGHTS; i++) {
      const L = lights[i];
      if (!L.on || L.intensity <= 0.001) continue;
      const d = Math.hypot(L.x - camera.x, L.y - camera.y, L.z - camera.z);
      if (d > L.range + scene.fogFar) continue;
      this._lpos[n * 4] = L.x;
      this._lpos[n * 4 + 1] = L.y;
      this._lpos[n * 4 + 2] = L.z;
      this._lpos[n * 4 + 3] = L.range;
      this._lcol[n * 3] = L.r * L.intensity;
      this._lcol[n * 3 + 1] = L.g * L.intensity;
      this._lcol[n * 3 + 2] = L.b * L.intensity;
      n++;
    }

    const { p, u } = this.main;
    gl.useProgram(p);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniform3f(u.uCamPos, camera.x, camera.y, camera.z);
    gl.uniform3fv(u.uSky, scene.sky);
    gl.uniform3fv(u.uGround, scene.ground);
    gl.uniform3fv(u.uDirDir, scene.dirDir);
    gl.uniform3fv(u.uDirCol, scene.dirCol);
    gl.uniform1i(u.uNumLights, n);
    gl.uniform4fv(u.uLPos, this._lpos);
    gl.uniform3fv(u.uLCol, this._lcol);
    gl.uniform3fv(u.uFogCol, scene.fogCol);
    gl.uniform3f(u.uFog, scene.fogNear, scene.fogFar, scene.fogMax);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    this.stats.draws = 0;
    this.stats.tris = 0;
    this._mat = null;
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);

    this._drawList(this._lists[0]);
    this._drawList(this._lists[1]);
    this._drawList(this._lists[2]);
    if (this.shadowsEnabled && this._shadowList.length) this._drawShadows(camera);
    // Re-bind main program state after the shadow pass.
    gl.useProgram(p);
    this._mat = null;
    this._drawList(this._lists[3]);

    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  _applyMaterial(m) {
    const gl = this.gl, u = this.main.u;
    this._mat = m;
    gl.bindTexture(gl.TEXTURE_2D, m.tex || this.white);
    gl.uniform4f(u.uTint, m.tint[0], m.tint[1], m.tint[2], m.opacity);
    gl.uniform4f(u.uParams, m.unlit ? 1 : 0, m.alphaTest, m.fog, m.emissive);
    gl.uniform2f(u.uFx, m.dither && m.blend !== 'add' ? this.ditherLevels : 0, m.blend === 'add' ? 1 : 0);
    if (m.blend === 'none') gl.disable(gl.BLEND);
    else {
      gl.enable(gl.BLEND);
      if (m.blend === 'add') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.depthMask(m.depthWrite);
    if (m.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (m.cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    if (m.offset) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-2, -4);
    } else gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  _drawList(list) {
    const gl = this.gl, u = this.main.u;
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node.material !== this._mat) this._applyMaterial(node.material);
      gl.uniformMatrix4fv(u.uModel, false, node.world);
      this._drawMesh(node.mesh);
    }
  }

  _drawMesh(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    if (mesh.ibo) gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(mesh.mode, 0, mesh.count);
    this.stats.draws++;
    this.stats.tris += mesh.count / 3;
  }

  _drawShadows() {
    const gl = this.gl;
    const { p, u } = this.shadow;
    gl.useProgram(p);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -4);
    // Stencil keeps overlapping limbs from darkening the ground twice.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    let owner = null;
    for (let i = 0; i < this._shadowList.length; i++) {
      const node = this._shadowList[i];
      const s = node._shadowOwner;
      if (s.strength <= 0.01) continue;
      if (s !== owner) {
        owner = s;
        m4.planarShadow(this._shadowM, s.lx, s.ly, s.lz, s.planeY);
        gl.uniformMatrix4fv(u.uShadow, false, this._shadowM);
        gl.uniform4f(u.uCenter, s.cx, s.cz, s.radius, s.strength);
      }
      gl.uniformMatrix4fv(u.uModel, false, node.world);
      this._drawMesh(node.mesh);
    }
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }
}

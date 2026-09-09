/* ============================================================
 *  renderer.js — 区块渲染 / 选中框 / 破坏进度 / 手持方块
 * ============================================================ */
(function (MC) {
  'use strict';

  const CHUNK = 16, HEIGHT = 128;

  const CHUNK_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec2 aTex;
layout(location=3) in vec3 aLight;
layout(location=4) in vec3 aTint;
uniform mat4 uProj, uView, uModel;
out vec2 vUV; out vec2 vTex; out vec3 vLight; out vec3 vTint; out float vDist;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vec4 vp = uView * wp;
  gl_Position = uProj * vp;
  vUV = aUV; vTex = aTex; vLight = aLight; vTint = aTint;
  vDist = -vp.z;
}`;

  const CHUNK_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV; in vec2 vTex; in vec3 vLight; in vec3 vTint; in float vDist;
uniform sampler2DArray uAtlas0, uAtlas1, uAtlas2, uAtlas3;
uniform sampler2D uWater, uLava;
uniform float uWaterLayer, uLavaLayer, uWaterFrames, uLavaFrames, uAnimTime;
uniform float uDayLight, uAlphaTest, uFogStart, uFogEnd;
uniform vec3 uFogColor;
uniform float uTintOverride;
uniform vec3 uColorMul;
uniform float uDebug;
uniform float uFullBright;
out vec4 fragColor;

vec4 sampleLayer(vec2 uv, float layer, float arr){
  if (arr < 0.5) return texture(uAtlas0, vec3(uv, layer));
  if (arr < 1.5) return texture(uAtlas1, vec3(uv, layer));
  if (arr < 2.5) return texture(uAtlas2, vec3(uv, layer));
  return texture(uAtlas3, vec3(uv, layer));
}

void main(){
  if (uDebug > 0.5) { fragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
  float layer = vTex.x;
  vec2 uv = vUV;
  vec4 tex;
  if (abs(layer - uWaterLayer) < 0.5 && uWaterFrames > 0.5) {
    float fr = floor(mod(uAnimTime * 1.6, uWaterFrames));
    tex = texture(uWater, vec2(uv.x, (uv.y + fr) / uWaterFrames));
  } else if (abs(layer - uLavaLayer) < 0.5 && uLavaFrames > 0.5) {
    float fr = floor(mod(uAnimTime * 1.1, uLavaFrames));
    tex = texture(uLava, vec2(uv.x, (uv.y + fr) / uLavaFrames));
  } else {
    tex = sampleLayer(uv, layer, vTex.y);
  }

  if (tex.a < uAlphaTest) discard;

  float sky = vLight.x * uDayLight;
  float blk = vLight.y;
  float l = max(sky, blk);
  float f = l / (4.0 - 3.0 * l);
  float bright = mix(0.045, 1.0, f);

  vec3 col = tex.rgb * vTint * uColorMul * (vLight.z * bright);
  if (uFullBright > 0.5) col = tex.rgb * vTint;
  float fog = clamp((vDist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
  col = mix(col, uFogColor, fog * fog);
  fragColor = vec4(col, tex.a);
}`;

  const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView, uModel;
void main(){ gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;

  const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main(){ fragColor = uColor; }`;

  /* ---------- 时间 -> 环境 ---------- */
  const Env = MC.Env = {
    compute(time) {
      const t = (time % 24000) / 24000;
      const a = t * Math.PI * 2;
      const sunDir = [Math.cos(a), Math.sin(a), 0];
      const moonDir = [-sunDir[0], -sunDir[1], 0];
      const sh = sunDir[1];
      const day = MC.clamp((sh + 0.16) / 0.42, 0, 1);
      const dayLight = 0.22 + 0.78 * day;
      const sunset = MC.clamp(1 - Math.abs(sh) * 4.5, 0, 1);

      const dayZ = [0.44, 0.62, 1.0], dayH = [0.68, 0.82, 1.0];
      const nightZ = [0.015, 0.025, 0.07], nightH = [0.04, 0.05, 0.12];
      const mixv = (a1, a2, k) => [a1[0] + (a2[0] - a1[0]) * k, a1[1] + (a2[1] - a1[1]) * k, a1[2] + (a2[2] - a1[2]) * k];
      let zenith = mixv(nightZ, dayZ, day);
      let horizon = mixv(nightH, dayH, day);
      if (sunset > 0) {
        horizon = mixv(horizon, [0.95, 0.55, 0.28], sunset * 0.7);
        zenith = mixv(zenith, [0.35, 0.32, 0.55], sunset * 0.35);
      }
      return {
        time, t, sunDir, moonDir, day, dayLight,
        zenith, horizon,
        sunGlow: [1.0 * (0.3 + 0.7 * day) + sunset * 0.6, 0.85 * day + sunset * 0.35, 0.55 * day + sunset * 0.1],
        stars: 1 - day,
        cloudBright: 0.32 + 0.68 * day,
        cloudY: 122,
        underwater: false,
        underColor: [0.09, 0.28, 0.45],
        fog: horizon
      };
    }
  };

  /* ---------- 工具 ---------- */
  function trs(out, tx, ty, tz, rx, ry, rz, s) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + sy * sx * sz, m01 = cx * sz, m02 = -sy * cz + cy * sx * sz;
    const m10 = -cy * sz + sy * sx * cz, m11 = cx * cz, m12 = sy * sz + cy * sx * cz;
    const m20 = sy * cx, m21 = -sx, m22 = cy * cx;
    out[0] = m00 * s; out[1] = m01 * s; out[2] = m02 * s; out[3] = 0;
    out[4] = m10 * s; out[5] = m11 * s; out[6] = m12 * s; out[7] = 0;
    out[8] = m20 * s; out[9] = m21 * s; out[10] = m22 * s; out[11] = 0;
    out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
    return out;
  }

  function quadsToMesh(gl, quads, tintOverride) {
    const verts = [];
    const idx = [];
    let vi = 0;
    for (const q of quads) {
      for (let v = 0; v < 4; v++) {
        verts.push(q.p[v * 3], q.p[v * 3 + 1], q.p[v * 3 + 2]);
        verts.push(q.uv[v * 2], q.uv[v * 2 + 1]);
        verts.push(q.layer, q.arr);
        verts.push(1, 1, q.shade ? [0.5, 1.0, 0.8, 0.8, 0.6, 0.6][q.face] : 1.0);
        verts.push(1, 1, 1);
      }
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
    if (!idx.length) return null;
    return MC.gl.mesh(gl, [
      { loc: 0, size: 3 }, { loc: 1, size: 2 }, { loc: 2, size: 2 }, { loc: 3, size: 3 }, { loc: 4, size: 3 }
    ], new Float32Array(verts), new Uint32Array(idx));
  }

  /* ---------- 渲染器 ---------- */
  class Renderer {
    constructor(gl, textures) {
      this.gl = gl;
      this.textures = textures;
      this.prog = MC.gl.program(gl, CHUNK_VS, CHUNK_FS, 'chunk');
      this.lineProg = MC.gl.program(gl, LINE_VS, LINE_FS, 'line');
      this.layout = [{ loc: 0, size: 3 }, { loc: 1, size: 2 }, { loc: 2, size: 2 }, { loc: 3, size: 3 }, { loc: 4, size: 3 }];
      this.visible = [];
      this.drawCalls = 0;
      this.triangles = 0;

      /* 选中框 (单位立方体线框) */
      const e = [
        [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0],
        [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
        [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1]
      ];
      const lv = new Float32Array(e.length * 6);
      e.forEach((l, i) => { for (let k = 0; k < 6; k++) lv[i * 6 + k] = l[k]; });
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, lv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.lineVao = vao;

      this.overlayMesh = null;
      this.overlayLayer = -1;
      this.itemMesh = null;
      this.itemType = -1;
      this.itemProj = MC.mat4.create();
      this.itemView = MC.mat4.create();
      this.identity = MC.mat4.create();
      this.tmpM = MC.mat4.create();
    }

    /* ---------- 区块网格 ---------- */
    uploadChunk(chunk, meshData) {
      const gl = this.gl;
      const make = (data) => {
        if (!data.indices.length) return null;
        const m = MC.gl.mesh(gl, this.layout, data.verts, data.indices);
        if (!chunk.mesh.sample) {
          chunk.mesh.sample = Array.from(data.verts.slice(0, 26)).map(function (v) { return Math.round(v * 1000) / 1000; });
        }
        return m;
      };
      this.disposeChunk(chunk);
      chunk.mesh.opaque = make(meshData.opaque);
      chunk.mesh.translucent = make(meshData.translucent);
      chunk.mesh.quads = (meshData.opaque.indices.length + meshData.translucent.indices.length) / 6;
    }

    disposeChunk(chunk) {
      const gl = this.gl;
      if (chunk.mesh) {
        MC.gl.deleteMesh(gl, chunk.mesh.opaque);
        MC.gl.deleteMesh(gl, chunk.mesh.translucent);
        chunk.mesh.opaque = null; chunk.mesh.translucent = null;
      }
    }

    /* ---------- 主渲染 ---------- */
    render(cam, world, env, opts) {
      const gl = this.gl;
      const p = this.prog;
      opts = opts || {};
      this.drawCalls = 0; this.triangles = 0;

      const fogColor = opts.fogColor || env.fog;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      /* 天空 */
      if (!opts.noSky) {
        MC.Sky.draw(gl, cam, Object.assign({}, env, {
          fogColor, underwater: opts.underwater
        }));
      }

      /* 区块 */
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      if (opts.noCull) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);

      gl.useProgram(p.program);
      gl.uniformMatrix4fv(p.u.uProj, false, cam.proj);
      gl.uniformMatrix4fv(p.u.uView, false, cam.view);
      gl.uniform1f(p.u.uDayLight, env.dayLight);
      gl.uniform1f(p.u.uAnimTime, env.time / 20);
      gl.uniform1f(p.u.uFogStart, opts.fogStart);
      gl.uniform1f(p.u.uFogEnd, opts.fogEnd);
      gl.uniform3fv(p.u.uFogColor, fogColor);
      gl.uniform1f(p.u.uAlphaTest, opts.noAlpha ? 0.0 : 0.5);
      gl.uniform1f(p.u.uTintOverride, 0);
      gl.uniform3f(p.u.uColorMul, 1, 1, 1);
      gl.uniform1f(p.u.uDebug, opts.debugSolid ? 1 : 0);
      gl.uniform1f(p.u.uFullBright, opts.fullBright ? 1 : 0);

      const anim = this.textures.anim;
      const wl = this.textures.lookup('block/water_still');
      const ll = this.textures.lookup('block/lava_still');
      gl.uniform1f(p.u.uWaterLayer, wl.layer);
      gl.uniform1f(p.u.uLavaLayer, ll.layer);
      gl.uniform1f(p.u.uWaterFrames, anim.water ? anim.water.frames : 0);
      gl.uniform1f(p.u.uLavaFrames, anim.lava ? anim.lava.frames : 0);
      MC.gl.bindTex2D(gl, p, 'uWater', anim.water ? anim.water.tex : this.textures.dummy2D, 4);
      MC.gl.bindTex2D(gl, p, 'uLava', anim.lava ? anim.lava.tex : this.textures.dummy2D, 5);
      const arrs = this.textures.arrays;
      for (let i = 0; i < 4; i++) {
        MC.gl.bindTexArray(gl, p, 'uAtlas' + i, arrs[Math.min(i, arrs.length - 1)], i);
      }

      /* 收集可见区块 */
      const planes = MC.gl.frustum(MC.mat4.mul(MC.mat4.create(), cam.proj, cam.view));
      const list = this.visible;
      list.length = 0;
      const R = world.renderDistance;
      for (const c of world.chunks.values()) {
        if (!c.mesh || (!c.mesh.opaque && !c.mesh.translucent)) continue;
        const dx = c.cx - world.centerCX, dz = c.cz - world.centerCZ;
        if (dx * dx + dz * dz > (R + 2) * (R + 2)) continue;
        const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
        if (!MC.gl.boxInFrustum(planes, x0, 0, z0, x0 + CHUNK, HEIGHT, z0 + CHUNK)) continue;
        const cx = x0 + 8 - cam.pos[0], cz = z0 + 8 - cam.pos[2];
        c._dist = cx * cx + cz * cz;
        list.push(c);
      }
      list.sort((a, b) => a._dist - b._dist);

      /* 不透明 + 裁剪 */
      let tris = 0;
      for (const c of list) {
        if (!c.mesh.opaque) continue;
        const M = this.tmpM;
        MC.mat4.identity(M);
        M[12] = c.cx * CHUNK; M[14] = c.cz * CHUNK;
        gl.uniformMatrix4fv(p.u.uModel, false, M);
        gl.bindVertexArray(c.mesh.opaque.vao);
        gl.drawElements(gl.TRIANGLES, c.mesh.opaque.count, gl.UNSIGNED_INT, 0);
        this.drawCalls++; tris += c.mesh.opaque.count / 3;
      }

      /* 半透明 (由远到近) */
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(p.u.uAlphaTest, 0.02);
      list.sort((a, b) => b._dist - a._dist);
      for (const c of list) {
        if (!c.mesh.translucent) continue;
        const M = this.tmpM;
        MC.mat4.identity(M);
        M[12] = c.cx * CHUNK; M[14] = c.cz * CHUNK;
        gl.uniformMatrix4fv(p.u.uModel, false, M);
        gl.bindVertexArray(c.mesh.translucent.vao);
        gl.drawElements(gl.TRIANGLES, c.mesh.translucent.count, gl.UNSIGNED_INT, 0);
        this.drawCalls++; tris += c.mesh.translucent.count / 3;
      }
      gl.disable(gl.BLEND);
      this.triangles = tris;

      /* 破坏进度 */
      if (opts.breakInfo && opts.breakInfo.stage >= 0) {
        this.drawBreakOverlay(cam, opts.breakInfo);
      }

      /* 选中框 */
      if (opts.highlight) {
        this.drawHighlight(cam, opts.highlight);
      }

      /* 手持方块 */
      if (opts.heldType) {
        this.drawHeldItem(cam, opts.heldType, opts.heldSwing || 0);
      }

      gl.bindVertexArray(null);
    }

    drawHighlight(cam, hl) {
      const gl = this.gl, p = this.lineProg;
      gl.useProgram(p.program);
      const M = MC.mat4.create();
      const b = hl.box || [0, 0, 0, 1, 1, 1];
      const e = 0.0025;   // 略微外扩, 避免与方块面 z-fighting 导致闪烁
      M[0] = (b[3] - b[0]) + e * 2; M[5] = (b[4] - b[1]) + e * 2; M[10] = (b[5] - b[2]) + e * 2;
      M[12] = hl.x + b[0] - e; M[13] = hl.y + b[1] - e; M[14] = hl.z + b[2] - e;
      gl.uniformMatrix4fv(p.u.uProj, false, cam.proj);
      gl.uniformMatrix4fv(p.u.uView, false, cam.view);
      gl.uniformMatrix4fv(p.u.uModel, false, M);
      gl.uniform4f(p.u.uColor, 0, 0, 0, 0.42);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
      this.drawCalls++;
    }

    drawBreakOverlay(cam, info) {
      const gl = this.gl, p = this.prog;
      const stage = MC.clamp(info.stage, 0, 9);
      const name = 'block/destroy_stage_' + stage;
      const look = this.textures.lookup(name);
      if (this.overlayLayer !== look.index) {
        const layer = this.textures.lookup(name);
        const quads = [];
        const mk = (n, verts, uv) => quads.push({
          p: new Float32Array(verts), uv: new Float32Array(uv),
          layer: layer.layer, arr: layer.arr, tint: -1, shade: true, face: n
        });
        // 简单立方体 (略放大避免 z-fighting)
        const E = 0.002;
        const f = [
          // down
          { v: [0, -E, 1, 1, -E, 1, 1, -E, 0, 0, -E, 0], u: [0, 1, 1, 1, 1, 0, 0, 0], n: 0 },
          { v: [0, 1 + E, 0, 1, 1 + E, 0, 1, 1 + E, 1, 0, 1 + E, 1], u: [0, 1, 1, 1, 1, 0, 0, 0], n: 1 },
          { v: [0, 1 + E, 0, 1, 1 + E, 0, 1, -E, 0, 0, -E, 0], u: [0, 1, 1, 1, 1, 0, 0, 0], n: 2 },
          { v: [1, 1 + E, 1, 0, 1 + E, 1, 0, -E, 1, 1, -E, 1], u: [0, 1, 1, 1, 1, 0, 0, 0], n: 3 },
          { v: [0, 1 + E, 1, 0, 1 + E, 0, 0, -E, 0, 0, -E, 1], u: [0, 1, 1, 1, 1, 0, 0, 0], n: 4 },
          { v: [1, 1 + E, 0, 1, 1 + E, 1, 1, -E, 1, 1, -E, 0], u: [0, 1, 1, 1, 1, 0, 0, 0], n: 5 }
        ];
        for (const q of f) mk(q.n, q.v, q.u);
        this.overlayMesh = quadsToMesh(gl, quads);
        this.overlayLayer = look.index;
      }
      if (!this.overlayMesh) return;
      gl.useProgram(p.program);
      const M = MC.mat4.create();
      M[0] = 1.0; M[5] = 1.0; M[10] = 1.0;
      M[12] = info.x; M[13] = info.y; M[14] = info.z;
      gl.uniformMatrix4fv(p.u.uModel, false, M);
      gl.uniform1f(p.u.uAlphaTest, 0.02);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(this.overlayMesh.vao);
      gl.drawElements(gl.TRIANGLES, this.overlayMesh.count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      this.drawCalls++;
    }

    drawHeldItem(cam, type, swing) {
      const gl = this.gl, p = this.prog;
      if (this.itemType !== type) {
        const geo = MC.Blocks.geo(type, 0);
        this.itemMesh = geo ? quadsToMesh(gl, geo.quads) : null;
        this.itemType = type;
      }
      if (!this.itemMesh) return;

      const aspect = cam.aspect;
      MC.mat4.perspective(this.itemProj, cam.fov, aspect, 0.02, 6);
      MC.mat4.identity(this.itemView);
      const M = MC.mat4.create();
      const s = 1.0;
      // 位于右下角, 略微旋转
      trs(M, 0.58, -0.52 - Math.sin(swing * Math.PI) * 0.18, -0.72,
        0.12, Math.PI * 0.25 + 0.25, 0.06, 0.42);
      M[12] += Math.sin(swing * Math.PI) * 0.06;

      gl.useProgram(p.program);
      gl.uniformMatrix4fv(p.u.uProj, false, this.itemProj);
      gl.uniformMatrix4fv(p.u.uView, false, this.itemView);
      gl.uniformMatrix4fv(p.u.uModel, false, M);
      gl.uniform1f(p.u.uAlphaTest, 0.5);
      gl.uniform1f(p.u.uFogStart, 100);
      gl.uniform1f(p.u.uFogEnd, 200);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.bindVertexArray(this.itemMesh.vao);
      gl.drawElements(gl.TRIANGLES, this.itemMesh.count, gl.UNSIGNED_INT, 0);
      this.drawCalls++;
      /* 恢复雾参数 */
      gl.uniform1f(p.u.uFogStart, cam.fogStart);
      gl.uniform1f(p.u.uFogEnd, cam.fogEnd);
      gl.uniformMatrix4fv(p.u.uProj, false, cam.proj);
      gl.uniformMatrix4fv(p.u.uView, false, cam.view);
    }
  }

  MC.Renderer = Renderer;
})(window.MC);

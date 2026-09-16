/* ============================================================
 *  sky.js — 天空 / 太阳 / 月亮 / 星空 / 云
 * ============================================================ */
(function (MC) {
  'use strict';

  const SKY_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform vec3 uForward, uRight, uUp;
uniform vec2 uTanHalf;
out vec3 vDir;
void main(){
  gl_Position = vec4(aPos, 0.0, 1.0);
  vDir = normalize(uForward + uRight * (aPos.x * uTanHalf.x) + uUp * (aPos.y * uTanHalf.y));
}`;

  const SKY_FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uMoonDir, uSunGlow;
uniform float uNight, uTime, uStars, uUnderwater;
uniform vec3 uUnderColor;
out vec4 fragColor;

float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }

void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);

  // 基础渐变
  float t = pow(clamp(h * 1.5, 0.0, 1.0), 0.7);
  vec3 col = mix(uHorizon, uZenith, t);

  // 地平线以下略暗
  if (h < 0.0) col = mix(col, uHorizon * 0.72, clamp(-h * 2.2, 0.0, 1.0));

  // 太阳光晕
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunGlow * pow(sd, 6.0) * 0.75;
  col += uSunGlow * pow(sd, 90.0) * 2.4;

  // 太阳圆盘
  float sunAng = acos(clamp(sd, -1.0, 1.0));
  if (sunAng < 0.052) {
    float e = smoothstep(0.052, 0.040, sunAng);
    col = mix(col, vec3(1.0, 0.97, 0.88), e);
  }

  // 月亮
  float md = max(dot(d, uMoonDir), 0.0);
  float moonAng = acos(clamp(md, -1.0, 1.0));
  if (moonAng < 0.045) {
    float e = smoothstep(0.045, 0.036, moonAng);
    // 简易月相: 依据 uNight 变化 (uTime 提供相位)
    float phase = fract(uTime * 0.0416667);
    vec3 mp = d - uMoonDir * 0.0;
    vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    float px = dot(d - uMoonDir, side) / 0.045;
    float shadow = smoothstep(-0.2, 0.55, px - (phase * 2.0 - 1.0) * 1.15);
    vec3 moonCol = mix(vec3(0.98, 0.98, 0.92), vec3(0.22, 0.24, 0.30), shadow * 0.92);
    col = mix(col, moonCol, e);
  }

  // 星星
  if (uStars > 0.01) {
    vec3 sp = d * 190.0;
    vec3 cell = floor(sp);
    float rnd = hash(cell);
    if (rnd > 0.9955) {
      vec3 c = (cell + 0.5) / 190.0;
      float dd = 1.0 - length(d - normalize(c)) * 55.0;
      float tw = 0.55 + 0.45 * sin(uTime * 2.2 + rnd * 40.0);
      col += vec3(0.9, 0.93, 1.0) * clamp(dd, 0.0, 1.0) * tw * uStars * 1.5;
    }
  }

  // 水下
  col = mix(col, uUnderColor, uUnderwater);

  fragColor = vec4(col, 1.0);
}`;

  const CLOUD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView, uModel;
uniform vec2 uOffset;
out vec2 vUV;
out float vDist;
void main(){
  vUV = aPos.xz * 0.00390625 + uOffset;   // 256 方块 = 1 贴图
  vDist = length(aPos.xz);
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}`;

  const CLOUD_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vDist;
uniform sampler2D uTex;
uniform float uBright;
uniform vec3 uFogColor;
uniform float uFogStart, uFogEnd;
out vec4 fragColor;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.35) discard;
  float fog = clamp((vDist - uFogStart) / (uFogEnd - uFogStart), 0.0, 1.0);
  fog *= fog;
  vec3 col = mix(t.rgb * uBright, uFogColor, fog);
  fragColor = vec4(col, t.a * 0.86 * (1.0 - fog));
}`;

  const Sky = MC.Sky = {
    init(gl, textures) {
      this.gl = gl;
      this.prog = MC.gl.program(gl, SKY_VS, SKY_FS, 'sky');
      this.cloudProg = MC.gl.program(gl, CLOUD_VS, CLOUD_FS, 'clouds');
      /* 云贴图已修正透明像素 RGB, 可以安全地使用 mipmap 消除远处闪烁 */
      this.cloudTex = MC.gl.texture2D(gl, textures.gui.cloudsFixed || textures.gui.clouds,
        { repeat: true, mipmap: true, linear: true });

      const quad = gl.createVertexArray();
      gl.bindVertexArray(quad);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.quad = quad;

      /* 云平面 (相机跟随) */
      const S = 1400;
      const cv = new Float32Array([
        -S, 0, -S, S, 0, -S, S, 0, S,
        -S, 0, -S, S, 0, S, -S, 0, S
      ]);
      const cvb = gl.createBuffer();
      const cvao = gl.createVertexArray();
      gl.bindVertexArray(cvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cvb);
      gl.bufferData(gl.ARRAY_BUFFER, cv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.cloudVao = cvao;
      return this;
    },

    draw(gl, cam, env) {
      const p = this.prog;
      gl.useProgram(p.program);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);

      gl.uniform3fv(p.u.uForward, cam.forward);
      gl.uniform3fv(p.u.uRight, cam.right);
      gl.uniform3fv(p.u.uUp, cam.up);
      gl.uniform2f(p.u.uTanHalf, cam.tanHalf.x, cam.tanHalf.y);
      gl.uniform3fv(p.u.uZenith, env.zenith);
      gl.uniform3fv(p.u.uHorizon, env.horizon);
      gl.uniform3fv(p.u.uSunDir, env.sunDir);
      gl.uniform3fv(p.u.uMoonDir, env.moonDir);
      gl.uniform3fv(p.u.uSunGlow, env.sunGlow);
      gl.uniform1f(p.u.uNight, env.night);
      gl.uniform1f(p.u.uTime, env.time);
      gl.uniform1f(p.u.uStars, env.stars);
      gl.uniform1f(p.u.uUnderwater, env.underwater ? 0.55 : 0);
      gl.uniform3fv(p.u.uUnderColor, env.underColor || [0.1, 0.25, 0.45]);

      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* 云 */
      if (env.clouds !== false) {
        const cp = this.cloudProg;
        gl.useProgram(cp.program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const M = MC.mat4.create();
        M[12] = cam.pos[0]; M[13] = env.cloudY; M[14] = cam.pos[2];
        gl.uniformMatrix4fv(cp.u.uProj, false, cam.proj);
        gl.uniformMatrix4fv(cp.u.uView, false, cam.view);
        gl.uniformMatrix4fv(cp.u.uModel, false, M);
        gl.uniform2f(cp.u.uOffset, cam.pos[0] / 256 + env.time * 0.0008, cam.pos[2] / 256);
        gl.uniform1f(cp.u.uBright, env.cloudBright);
        gl.uniform3fv(cp.u.uFogColor, env.fogColor || env.fog || [0.5, 0.6, 0.8]);
        gl.uniform1f(cp.u.uFogStart, env.fogStart != null ? env.fogStart : 1e5);
        gl.uniform1f(cp.u.uFogEnd, env.fogEnd != null ? env.fogEnd : 2e5);
        gl.uniform1i(cp.u.uTex, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
        gl.bindVertexArray(this.cloudVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
    }
  };
})(window.MC);

/* ============================================================
 *  util.js — 数学 / 噪声 / 随机数 / 小工具
 * ============================================================ */
window.MC = window.MC || {};
(function (MC) {
  'use strict';

  /* ---------- 随机数 ---------- */
  MC.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- 2D / 3D Simplex 噪声 ---------- */
  const GRAD3 = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
  ];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const F3 = 1 / 3, G3 = 1 / 6;

  MC.Simplex = function (seed) {
    const rnd = MC.mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }

    function noise2(xin, yin) {
      let n0 = 0, n1 = 0, n2 = 0;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s), j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const X0 = i - t, Y0 = j - t;
      const x0 = xin - X0, y0 = yin - Y0;
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      const gi0 = permMod12[ii + perm[jj]], gi1 = permMod12[ii + i1 + perm[jj + j1]], gi2 = permMod12[ii + 1 + perm[jj + 1]];
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) { t0 *= t0; const g = GRAD3[gi0]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) { t1 *= t1; const g = GRAD3[gi1]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) { t2 *= t2; const g = GRAD3[gi2]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }
      return 70 * (n0 + n1 + n2);
    }

    function noise3(xin, yin, zin) {
      let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
      const s = (xin + yin + zin) * F3;
      const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3;
      const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      const gi0 = permMod12[ii + perm[jj + perm[kk]]];
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 >= 0) { t0 *= t0; const g = GRAD3[gi0]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
      let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 >= 0) { t1 *= t1; const g = GRAD3[gi1]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
      let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 >= 0) { t2 *= t2; const g = GRAD3[gi2]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
      let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 >= 0) { t3 *= t3; const g = GRAD3[gi3]; n3 = t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
      return 32 * (n0 + n1 + n2 + n3);
    }

    this.n2 = noise2;
    this.n3 = noise3;
    this.fbm2 = function (x, y, oct, lac, gain) {
      oct = oct || 4; lac = lac || 2; gain = gain === undefined ? 0.5 : gain;
      let a = 1, f = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) { sum += a * noise2(x * f, y * f); norm += a; a *= gain; f *= lac; }
      return sum / norm;
    };
    this.fbm3 = function (x, y, z, oct, lac, gain) {
      oct = oct || 3; lac = lac || 2; gain = gain === undefined ? 0.5 : gain;
      let a = 1, f = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f); norm += a; a *= gain; f *= lac; }
      return sum / norm;
    };
  };

  /* ---------- mat4 (列主序) ---------- */
  const M4 = MC.mat4 = {};
  M4.create = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  M4.perspective = function (out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  };

  M4.ortho = function (out, l, r, b, t, n, f) {
    const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
    out[12] = (l + r) * lr; out[13] = (t + b) * bt; out[14] = (f + n) * nf; out[15] = 1;
    return out;
  };

  M4.identity = function (out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0; out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
  };

  M4.mul = function (out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return out;
  };

  /** 视图矩阵: 由位置与偏航/俯仰构造 (右手系, -Z 为前方) */
  M4.view = function (out, px, py, pz, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 前方向
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    // 右方向
    const rx = cy, ry = 0, rz = -sy;
    // 上方向 = right × forward
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    out[0] = rx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = ry; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = rz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = -(rx * px + ry * py + rz * pz);
    out[13] = -(ux * px + uy * py + uz * pz);
    out[14] = (fx * px + fy * py + fz * pz);
    out[15] = 1;
    return out;
  };

  /* ---------- 小工具 ---------- */
  MC.clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  MC.lerp = (a, b, t) => a + (b - a) * t;
  MC.smoothstep = (t) => t * t * (3 - 2 * t);
  MC.fmt = function (n, d) { return Number(n).toFixed(d === undefined ? 1 : d); };

  /* 把 [0,15] 的光照等级转成亮度 (接近原版曲线) */
  MC.lightCurve = function (l) {
    const f = l / (4 - 3 * l);
    return 0.05 + 0.95 * f;
  };

  /* 颜色工具 */
  MC.rgb = (r, g, b) => [r / 255, g / 255, b / 255];
})(window.MC);

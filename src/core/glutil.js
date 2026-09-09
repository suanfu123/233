/* ============================================================
 *  glutil.js — WebGL2 薄封装
 * ============================================================ */
(function (MC) {
  'use strict';

  const GL = MC.gl = {};

  GL.createContext = function (canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('此浏览器不支持 WebGL2，无法运行。');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0.6, 0.75, 1.0, 1.0);
    return gl;
  };

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
      throw new Error('着色器编译失败:\n' + log + '\n\n' + lines);
    }
    return s;
  }

  GL.program = function (gl, vsSrc, fsSrc, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败 (' + (name || '') + '): ' + gl.getProgramInfoLog(p));
    }
    const obj = { program: p, u: {}, a: {} };
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      const nm = info.name.replace(/\[0\]$/, '');
      obj.u[nm] = gl.getUniformLocation(p, info.name);
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i);
      obj.a[info.name] = gl.getAttribLocation(p, info.name);
    }
    return obj;
  };

  /** 创建 VAO + 交错 VBO + EBO */
  GL.mesh = function (gl, layout, vertexData, indexData) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
    let stride = 0;
    for (const f of layout) stride += f.size;
    let off = 0;
    for (const f of layout) {
      gl.enableVertexAttribArray(f.loc);
      gl.vertexAttribPointer(f.loc, f.size, gl.FLOAT, false, stride * 4, off * 4);
      off += f.size;
    }
    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ebo, count: indexData.length };
  };

  GL.deleteMesh = function (gl, m) {
    if (!m) return;
    gl.deleteVertexArray(m.vao);
    gl.deleteBuffer(m.vbo);
    gl.deleteBuffer(m.ebo);
  };

  /** 创建 2D 纹理 (RGBA, NEAREST) */
  GL.texture2D = function (gl, source, opts) {
    opts = opts || {};
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const filter = opts.linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  };

  /** 创建 2D 数组纹理并逐个写入图层 */
  GL.textureArray = function (gl, size, layers, opts) {
    opts = opts || {};
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (opts.mipmap && gl.TEXTURE_MAX_LEVEL !== undefined) {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return tex;
  };

  /** 把 canvas 写入数组纹理的某一层 */
  GL.uploadLayer = function (gl, tex, layer, canvas) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, canvas.width, canvas.height, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  };

  GL.bindTexArray = function (gl, prog, name, tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.uniform1i(prog.u[name], unit);
  };

  GL.bindTex2D = function (gl, prog, name, tex, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u[name], unit);
  };

  /** 视锥体: 由 viewProj 矩阵提取 6 个平面 */
  GL.frustum = function (m) {
    const p = new Float32Array(24);
    const set = (i, a, b, c, d) => {
      const len = Math.hypot(a, b, c) || 1;
      p[i] = a / len; p[i + 1] = b / len; p[i + 2] = c / len; p[i + 3] = d / len;
    };
    set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);   // left
    set(4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);   // right
    set(8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);   // bottom
    set(12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);  // top
    set(16, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); // near
    set(20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]); // far
    return p;
  };

  GL.boxInFrustum = function (planes, x0, y0, z0, x1, y1, z1) {
    for (let i = 0; i < 24; i += 4) {
      const a = planes[i], b = planes[i + 1], c = planes[i + 2], d = planes[i + 3];
      const px = a > 0 ? x1 : x0, py = b > 0 ? y1 : y0, pz = c > 0 ? z1 : z0;
      if (a * px + b * py + c * pz + d < 0) return false;
    }
    return true;
  };
})(window.MC);

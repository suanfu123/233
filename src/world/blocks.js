/* ============================================================
 *  blocks.js — 方块注册表 + 模型几何生成
 *  几何完全由原版 models/block/*.json 生成
 * ============================================================ */
(function (MC) {
  'use strict';

  const A = window.MC_ASSETS;
  const TEXSIZE = 16;

  /* 面序号: 0=-Y 1=+Y 2=-Z 3=+Z 4=-X 5=+X */
  const FACE_NORMAL = [
    [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]
  ];
  const FACE_NAME = ['down', 'up', 'north', 'south', 'west', 'east'];
  const FACE_INDEX = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

  /* 每个面的 4 个顶点 (以 x0,y0,z0,x1,y1,z1 表示) 与 uv 角点顺序 */
  const FACE_VERTS = {
    //          0            1            2            3
    down: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]],
    up: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
    north: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]],
    south: [[1, 1, 1], [0, 1, 1], [0, 0, 1], [1, 0, 1]],
    west: [[0, 1, 1], [0, 1, 0], [0, 0, 0], [0, 0, 1]],
    east: [[1, 1, 0], [1, 1, 1], [1, 0, 1], [1, 0, 0]]
  };
  /* uv 角点: 顶点0..3 依次取 (u1,v1) (u2,v1) (u2,v2) (u1,v2) */

  /* ---------- 旋转 ---------- */
  function rotatePoint(p, origin, axis, angleDeg, rescale, origBox) {
    const a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    let x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2];
    let nx = x, ny = y, nz = z;
    if (axis === 'x') { ny = y * ca + z * sa; nz = -y * sa + z * ca; }
    else if (axis === 'y') { nx = x * ca - z * sa; nz = x * sa + z * ca; }
    else { nx = x * ca + y * sa; ny = -x * sa + y * ca; }
    x = nx; y = ny; z = nz;

    if (rescale && origBox) {
      // 旋转后包围盒 -> 缩放回原始包围盒尺寸 (仅垂直于旋转轴的两个轴)
      const rx = Math.abs(origBox[3] - origBox[0]), ry = Math.abs(origBox[4] - origBox[1]), rz = Math.abs(origBox[5] - origBox[2]);
      // 旋转后 8 角的范围
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
      const ox = origBox[0] - origin[0], oy = origBox[1] - origin[1], oz = origBox[2] - origin[2];
      const px = origBox[3] - origin[0], py = origBox[4] - origin[1], pz = origBox[5] - origin[2];
      for (let i = 0; i < 8; i++) {
        const cx = (i & 1) ? px : ox, cy = (i & 2) ? py : oy, cz = (i & 4) ? pz : oz;
        let ax = cx, ay = cy, az = cz;
        if (axis === 'x') { ay = cy * ca + cz * sa; az = -cy * sa + cz * ca; }
        else if (axis === 'y') { ax = cx * ca - cz * sa; az = cx * sa + cz * ca; }
        else { ax = cx * ca + cy * sa; ay = -cx * sa + cy * ca; }
        mnx = Math.min(mnx, ax); mxx = Math.max(mxx, ax);
        mny = Math.min(mny, ay); mxy = Math.max(mxy, ay);
        mnz = Math.min(mnz, az); mxz = Math.max(mxz, az);
      }
      const ex = mxx - mnx, ey = mxy - mny, ez = mxz - mnz;
      let fx = 1, fy = 1, fz = 1;
      if (axis === 'x') {
        const f = (ry > 1e-6 && ey > 1e-6) ? ry / ey : ((rz > 1e-6 && ez > 1e-6) ? rz / ez : 1);
        fy = fz = f;
      } else if (axis === 'y') {
        const f = (rx > 1e-6 && ex > 1e-6) ? rx / ex : ((rz > 1e-6 && ez > 1e-6) ? rz / ez : 1);
        fx = fz = f;
      } else {
        const f = (rx > 1e-6 && ex > 1e-6) ? rx / ex : ((ry > 1e-6 && ey > 1e-6) ? ry / ey : 1);
        fx = fy = f;
      }
      x *= fx; y *= fy; z *= fz;
    }
    return [x + origin[0], y + origin[1], z + origin[2]];
  }

  function rotateVariant(p, rot, c) {
    // rot: [x, y, z] 角度; 绕方块中心 (c,c,c)
    let [x, y, z] = p;
    const [ax, ay, az] = rot;
    if (ax) {
      const a = ax * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      let dy = y - c, dz = z - c;
      y = dy * ca + dz * sa + c; z = -dy * sa + dz * ca + c;
    }
    if (ay) {
      const a = ay * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      let dx = x - c, dz = z - c;
      x = dx * ca - dz * sa + c; z = dx * sa + dz * ca + c;
    }
    if (az) {
      const a = az * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      let dx = x - c, dy = y - c;
      x = dx * ca + dy * sa + c; y = -dx * sa + dy * ca + c;
    }
    return [x, y, z];
  }

  /* ---------- 几何缓存 ----------
   * 缓存挂在方块定义自身的 _geo / _boxes 数组上 (下标 = 变体序号)。
   * 旧实现用 type*16+variantIdx 当 Map 键，楼梯这类变体数 40 的方块会
   * 溢出到相邻方块的键区间，导致 264 处串号 (橡木台阶拿到紫珀楼梯的模型)。
   */
  const Blocks = MC.Blocks = {
    FACE_NORMAL, FACE_NAME, FACE_INDEX,
    AIR: 0,
    byType: [],
    byName: {},
    texLookup: null,

    init(textures) {
      Blocks.texLookup = (n) => textures.lookup(n);
      let maxType = 0;
      for (const b of A.blocks) maxType = Math.max(maxType, b.type);
      Blocks.byType = new Array(maxType + 1).fill(null);

      for (const b of A.blocks) {
        const def = {
          type: b.type, id: b.id, name: A.lang[b.lang] || b.id, langKey: b.lang,
          kind: b.kind, render: b.render, solid: b.solid, opacity: b.opacity,
          light: b.light, tint: b.tint, liquid: b.liquid, hardness: b.hardness,
          rotMap: b.rotMap, variants: b.variants, boxes: b.boxes,
          iconTop: b.iconTop, iconSide: b.iconSide, iconAll: b.iconAll,
          _geo: [],
          _boxes: []
        };
        Blocks.byType[b.type] = def;
        Blocks.byName[b.id] = def;
      }
      Blocks.AIR_DEF = { type: 0, id: 'air', name: 'Air', kind: 'cube', render: 'none', solid: false, opacity: 0, light: 0, tint: null, liquid: false, variants: [], rotMap: [0], iconTop: null, iconSide: null, _geo: [], _boxes: [] };
      return Blocks;
    },

    get(type) { return Blocks.byType[type] || Blocks.AIR_DEF; },
    getByName(n) { return Blocks.byName[n] || null; },
    isAir(type) { return type === 0; },
    occludes(type) {
      if (type === 0) return false;
      const b = Blocks.byType[type];
      return b ? b.opacity >= 15 : false;
    },
    lightEmit(type) { const b = Blocks.byType[type]; return b ? b.light : 0; },
    opacityOf(type) { const b = Blocks.byType[type]; return b ? b.opacity : 0; },
    solidOf(type) { const b = Blocks.byType[type]; return b ? b.solid : false; },

    /** 变体索引: rot 由方块数据低位给出 */
    variantIndex(type, rot) {
      const b = Blocks.byType[type];
      if (!b) return 0;
      const rm = b.rotMap;
      if (!rm || rm.length <= 1) return 0;
      return rm[rot % rm.length] || 0;
    },

    /** 生成 (并缓存) 某个变体的四边形列表 */
    geo(type, variantIdx) {
      const b = Blocks.byType[type];
      if (!b) return null;
      const cached = b._geo[variantIdx];
      if (cached) return cached;

      const variant = b.variants[variantIdx] || b.variants[0];
      const model = A.models[variant.model];
      const quads = [];
      if (model) {
        const rot = variant.rot || [0, 0, 0];
        const needsRot = rot[0] || rot[1] || rot[2];
        for (const el of model.elements) {
          const from = el.from, to = el.to;
          const x0 = Math.min(from[0], to[0]) / TEXSIZE, y0 = Math.min(from[1], to[1]) / TEXSIZE, z0 = Math.min(from[2], to[2]) / TEXSIZE;
          const x1 = Math.max(from[0], to[0]) / TEXSIZE, y1 = Math.max(from[1], to[1]) / TEXSIZE, z1 = Math.max(from[2], to[2]) / TEXSIZE;
          const box = [x0, y0, z0, x1, y1, z1];

          for (const fname in el.faces) {
            const f = el.faces[fname];
            const fi = FACE_INDEX[fname];
            const corners = FACE_VERTS[fname];
            const uv = f.uv;
            const u1 = uv[0] / TEXSIZE, v1 = uv[1] / TEXSIZE, u2 = uv[2] / TEXSIZE, v2 = uv[3] / TEXSIZE;

            // 4 个顶点
            const p = new Float32Array(12);
            const t = new Float32Array(8);
            for (let i = 0; i < 4; i++) {
              const c = corners[i];
              let px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
              let pt = [px, py, pz];
              if (el.rotation) {
                const r = el.rotation;
                const o = [r.origin[0] / TEXSIZE, r.origin[1] / TEXSIZE, r.origin[2] / TEXSIZE];
                pt = rotatePoint(pt, o, r.axis, r.angle, r.rescale, box);
              }
              if (needsRot) pt = rotateVariant(pt, rot, 0.5);
              p[i * 3] = pt[0]; p[i * 3 + 1] = pt[1]; p[i * 3 + 2] = pt[2];
            }
            // uv
            const us = [u1, u2, u2, u1], vs = [v1, v1, v2, v2];
            // 面旋转 (model face rotation)
            const fr = f.rot | 0;
            let order = [0, 1, 2, 3];
            if (fr === 90) order = [3, 0, 1, 2];
            else if (fr === 180) order = [2, 3, 0, 1];
            else if (fr === 270) order = [1, 2, 3, 0];
            /* 贴图上传到 GL 时未翻转 Y，因此 v_gl=0 对应图片顶部，
             * 与原版模型 UV (v=0 为贴图顶部) 方向一致，无需翻转。 */
            for (let i = 0; i < 4; i++) {
              const o = order[i];
              t[i * 2] = us[o];
              t[i * 2 + 1] = vs[o];
            }
            // 上下两面需要反转顶点顺序 (保持 CCW 朝外)
            if (fi === 0 || fi === 1) {
              const rp = new Float32Array(12), rt = new Float32Array(8);
              for (let i = 0; i < 4; i++) {
                const s = (4 - i) % 4;
                rp[i * 3] = p[s * 3]; rp[i * 3 + 1] = p[s * 3 + 1]; rp[i * 3 + 2] = p[s * 3 + 2];
                rt[i * 2] = t[s * 2]; rt[i * 2 + 1] = t[s * 2 + 1];
              }
              p.set(rp); t.set(rt);
            }

            let tex = null;
            if (f.tex) tex = Blocks.texLookup(f.tex);
            if (!tex) continue;

            // 该面是否可用于遮挡剔除
            let cull = -1;
            if (f.cull) cull = FACE_INDEX[f.cull];

            quads.push({
              p, uv: t,
              layer: tex.layer, arr: tex.arr,
              tint: f.tint,
              shade: el.shade !== false,
              cull,
              n: FACE_NORMAL[fi],
              face: fi,
              ao: model.ao !== false && cull >= 0,
              // 该面是否为完整方块面 (用于判断 AO)
              full: cull >= 0 && Math.abs(x1 - x0) > 0.99 && Math.abs(y1 - y0) > 0.99 && Math.abs(z1 - z0) > 0.99
            });
          }
        }
      }
      const g = { quads, model: variant.model, variant };
      b._geo[variantIdx] = g;
      return g;
    },

    /** 碰撞盒 (方块局部 0..1) */
    boxesFor(type, rot) {
      const b = Blocks.byType[type];
      if (!b || !b.solid) return null;
      const vi = Blocks.variantIndex(type, rot);
      const cached = b._boxes[vi];
      if (cached) return cached;
      const variant = b.variants[vi] || b.variants[0];
      const model = A.models[variant.model];
      const out = [];
      if (model) {
        for (const el of model.elements) {
          let x0 = Math.min(el.from[0], el.to[0]) / TEXSIZE, y0 = Math.min(el.from[1], el.to[1]) / TEXSIZE, z0 = Math.min(el.from[2], el.to[2]) / TEXSIZE;
          let x1 = Math.max(el.from[0], el.to[0]) / TEXSIZE, y1 = Math.max(el.from[1], el.to[1]) / TEXSIZE, z1 = Math.max(el.from[2], el.to[2]) / TEXSIZE;
          if (x1 - x0 <= 0.12 || y1 - y0 <= 0.12 || z1 - z0 <= 0.12) continue;
          out.push([x0, y0, z0, x1, y1, z1]);
        }
      }
      if (!out.length) out.push([0, 0, 0, 1, 1, 1]);

      // 应用变体旋转
      const rot3 = variant.rot || [0, 0, 0];
      if (rot3[0] || rot3[1] || rot3[2]) {
        const rotated = [];
        for (const bb of out) {
          let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
          for (let i = 0; i < 8; i++) {
            const px = (i & 1) ? bb[3] : bb[0], py = (i & 2) ? bb[4] : bb[1], pz = (i & 4) ? bb[5] : bb[2];
            const q = rotateVariant([px, py, pz], rot3, 0.5);
            mnx = Math.min(mnx, q[0]); mxx = Math.max(mxx, q[0]);
            mny = Math.min(mny, q[1]); mxy = Math.max(mxy, q[1]);
            mnz = Math.min(mnz, q[2]); mxz = Math.max(mxz, q[2]);
          }
          rotated.push([mnx, mny, mnz, mxx, mxy, mxz]);
        }
        b._boxes[vi] = rotated;
        return rotated;
      }
      b._boxes[vi] = out;
      return out;
    },

    /** 预生成所有几何 (加快首次进入) */
    prebuild(limit) {
      let n = 0;
      for (const b of Blocks.byType) {
        if (!b) continue;
        for (let i = 0; i < b.variants.length; i++) {
          Blocks.geo(b.type, i);
          if (limit && ++n > limit) return n;
        }
      }
      return n;
    }
  };
})(window.MC);

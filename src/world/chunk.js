/* ============================================================
 *  chunk.js — 区块数据 / 光照 / 网格生成
 * ============================================================ */
(function (MC) {
  'use strict';

  const CHUNK = 16, HEIGHT = 384;
  const IDX = (x, y, z) => (y * CHUNK + z) * CHUNK + x;
  let LIGHT_QUEUE = new Int32Array(CHUNK * CHUNK * HEIGHT * 2);

  /* BFS 队列扩容 (队列元素 = (下标 << 4) | 光等级) */
  function growQueue(n) {
    if (n <= LIGHT_QUEUE.length) return;
    let cap = LIGHT_QUEUE.length;
    while (cap < n) cap *= 2;
    const nq = new Int32Array(cap);
    nq.set(LIGHT_QUEUE);
    LIGHT_QUEUE = nq;
  }

  const SKY = 4, BLK = 0;
  const opOf = (type) => (type === 0 ? 0 : MC.Blocks.opacityOf(type));

  /* 面方向表 (与 Blocks 一致) */
  const FN = MC.Blocks.FACE_NORMAL;
  const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6]; // down, up, n/s, e/w

  /* 用于 AO 的切向轴 */
  const FACE_AXES = [
    [[1, 0, 0], [0, 0, 1]],   // down: U=+X, V=+Z
    [[1, 0, 0], [0, 0, 1]],   // up
    [[1, 0, 0], [0, 1, 0]],   // north: U=+X, V=+Y
    [[1, 0, 0], [0, 1, 0]],   // south
    [[0, 0, 1], [0, 1, 0]],   // west: U=+Z, V=+Y
    [[0, 0, 1], [0, 1, 0]]    // east
  ];

  class Builder {
    constructor(cap) {
      this.verts = new Float32Array(cap * 13);
      this.idx = new Uint32Array(cap * 1.5 | 0);
      this.nv = 0; this.ni = 0;
    }
    ensure(extraV, extraI) {
      if ((this.nv + extraV) * 13 > this.verts.length) {
        const nv = new Float32Array(Math.max(this.verts.length * 2, (this.nv + extraV) * 13));
        nv.set(this.verts.subarray(0, this.nv * 13)); this.verts = nv;
      }
      if (this.ni + extraI > this.idx.length) {
        const ni = new Uint32Array(Math.max(this.idx.length * 2, this.ni + extraI));
        ni.set(this.idx.subarray(0, this.ni)); this.idx = ni;
      }
    }
    reset() { this.nv = 0; this.ni = 0; }
    get empty() { return this.ni === 0; }
    data() {
      return { verts: this.verts.subarray(0, this.nv * 13), indices: this.idx.subarray(0, this.ni) };
    }
  }

  class Chunk {
    constructor(world, cx, cz) {
      this.world = world;
      this.cx = cx; this.cz = cz;
      this.blocks = new Uint16Array(CHUNK * CHUNK * HEIGHT);
      this.light = new Uint8Array(CHUNK * CHUNK * HEIGHT);
      this.biome = new Uint8Array(CHUNK * CHUNK);
      this.heights = new Int16Array(CHUNK * CHUNK);
      this.generated = false;
      this.lit = false;
      this.dirty = true;
      this.mesh = { opaque: null, translucent: null };
      this.nonAir = 0;
      this.lastUse = 0;
      /* 非空气方块的 y 范围: 网格只遍历这一段 (不再全高 384 层扫) */
      this.minY = HEIGHT;
      this.maxY = -1;
    }

    /** 重新统计 y 范围 (整块生成后调用一次) */
    updateBounds() {
      const b = this.blocks;
      let mn = HEIGHT, mx = -1;
      for (let y = 0; y < HEIGHT && mn === HEIGHT; y++) {
        const base = y << 8;
        for (let k = 0; k < 256; k++) if (b[base + k] !== 0) { mn = y; break; }
      }
      for (let y = HEIGHT - 1; y >= 0 && mx < 0; y--) {
        const base = y << 8;
        for (let k = 0; k < 256; k++) if (b[base + k] !== 0) { mx = y; break; }
      }
      this.minY = mn; this.maxY = mx;
      return this;
    }

    /** 写入方块后扩大范围 (只会变大, 偏大不影响正确性) */
    growBounds(y) {
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
    }

    get(lx, y, lz) {
      if (y < 0 || y >= HEIGHT) return 0;
      return this.blocks[IDX(lx, y, lz)];
    }
    set(lx, y, lz, v) {
      if (y < 0 || y >= HEIGHT) return;
      this.blocks[IDX(lx, y, lz)] = v;
    }
    getLight(lx, y, lz) {
      if (y < 0) return 0;
      if (y >= HEIGHT) return 15 << 4;
      return this.light[IDX(lx, y, lz)];
    }

    /* ---------------- 光照 ---------------- */
    /**
     * 单通道增量光照: 先把"由该格推导出来"的光清掉, 再从边界重新传播。
     * shift: SKY=天空光, BLK=方块光。
     *
     * 旧实现只有增量扩散 (if (nl > cur))，光值永远不会下降，
     * 因此放下一个遮挡方块后，它下面的天空光会一直残留 (洞穴口/屋檐漏光)。
     */
    relightChannel(i0, shift) {
      const blocks = this.blocks, light = this.light;
      const oldLevel = (light[i0] >> shift) & 15;
      light[i0] &= ~(15 << shift);

      let head = 0, tail = 0;
      if (oldLevel > 0) { growQueue(1); LIGHT_QUEUE[tail++] = (i0 << 4) | oldLevel; }

      const seeds = [];
      /* 1) 清除阶段: 只清光值 <= 自身、确实由这格推出来的邻居 */
      while (head < tail) {
        const p = LIGHT_QUEUE[head++];
        const i = p >> 4, lvl = p & 15;
        const y = i >> 8, r = i & 255, z = r >> 4, x = r & 15;
        for (let d = 0; d < 6; d++) {
          const n = FN[d];
          const nx = x + n[0], ny = y + n[1], nz = z + n[2];
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= HEIGHT) continue;
          const ni = (ny << 8) | (nz << 4) | nx;
          const nl = (light[ni] >> shift) & 15;
          if (nl === 0) continue;
          /* 天空光向下不衰减, 所以下方"等于"自身等级也属于被推导出来的 */
          const derived = (n[1] === -1 && shift === SKY) ? (nl <= lvl) : (nl < lvl);
          if (derived) {
            light[ni] &= ~(15 << shift);
            growQueue(tail + 1);
            LIGHT_QUEUE[tail++] = (ni << 4) | nl;
          } else {
            seeds.push(ni);   /* 独立光源或被别处照亮, 之后重新播种 */
          }
        }
      }

      /* 2) 重新播种 + 传播 */
      head = 0; tail = 0;
      const pushSeed = (i) => {
        const l = (light[i] >> shift) & 15;
        if (l <= 1) return;
        growQueue(tail + 1);
        LIGHT_QUEUE[tail++] = (i << 4) | l;
      };
      if (shift === BLK) {
        const em = MC.Blocks.lightEmit(blocks[i0] & 0xFFF);
        if (em > 0) { light[i0] = (light[i0] & 0xF0) | em; pushSeed(i0); }
      }
      const y0 = i0 >> 8, r0 = i0 & 255, z0 = r0 >> 4, x0 = r0 & 15;
      for (let d = 0; d < 6; d++) {
        const n = FN[d];
        const nx = x0 + n[0], ny = y0 + n[1], nz = z0 + n[2];
        if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= HEIGHT) continue;
        pushSeed((ny << 8) | (nz << 4) | nx);
      }
      for (let s = 0; s < seeds.length; s++) pushSeed(seeds[s]);

      while (head < tail) {
        const p = LIGHT_QUEUE[head++];
        const i = p >> 4, lvl = p & 15;
        if (lvl <= 1) continue;
        const y = i >> 8, r = i & 255, z = r >> 4, x = r & 15;
        for (let d = 0; d < 6; d++) {
          const n = FN[d];
          const nx = x + n[0], ny = y + n[1], nz = z + n[2];
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15 || ny < 0 || ny >= HEIGHT) continue;
          const ni = (ny << 8) | (nz << 4) | nx;
          const op = opOf(blocks[ni] & 0xFFF);
          if (op >= 15) continue;
          let nl = lvl - 1 - (op > 0 ? op - 1 : 0);
          if (n[1] === -1 && shift === SKY) nl = lvl - (op > 0 ? op : 0); // 向下不衰减
          if (nl <= 0) continue;
          if (nl > ((light[ni] >> shift) & 15)) {
            light[ni] = (light[ni] & ~(15 << shift)) | (nl << shift);
            growQueue(tail + 1);
            LIGHT_QUEUE[tail++] = (ni << 4) | nl;
          }
        }
      }
    }

    /** 方块被改写成 newType 之后的增量光照 */
    updateLight(i, oldType, newType) {
      const oldOp = opOf(oldType), newOp = opOf(newType);
      const oldEm = oldType ? MC.Blocks.lightEmit(oldType) : 0;
      const newEm = newType ? MC.Blocks.lightEmit(newType) : 0;
      if (oldOp !== newOp) this.relightChannel(i, SKY);
      if (oldOp !== newOp || oldEm !== newEm) this.relightChannel(i, BLK);
    }

    computeLight() {
      const blocks = this.blocks, light = this.light;
      light.fill(0);
      let q = LIGHT_QUEUE;
      let head = 0, tail = 0;
      const push = (v) => {
        if (tail >= q.length) { const nq = new Int32Array(q.length * 2); nq.set(q); q = nq; LIGHT_QUEUE = nq; }
        q[tail++] = v;
      };

      /* 天空光: 竖直列 */
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          let s = 15;
          for (let y = HEIGHT - 1; y >= 0; y--) {
            const i = IDX(x, y, z);
            const t = blocks[i] & 0xFFF;
            const op = t === 0 ? 0 : MC.Blocks.opacityOf(t);
            if (op >= 15) s = 0;
            else if (op > 0) s = Math.max(0, s - op);
            light[i] = s << 4;
            if (s > 1) push(i);
          }
        }
      }
      /* 水平扩散 */
      const spread = (shift, mask) => {
        while (head < tail) {
          const i = q[head++];
          const l = (light[i] >> shift) & mask;
          if (l <= 1) continue;
          const y = (i / (CHUNK * CHUNK)) | 0;
          const r = i - y * CHUNK * CHUNK;
          const z = (r / CHUNK) | 0, x = r - z * CHUNK;
          for (let d = 0; d < 6; d++) {
            const n = FN[d];
            const nx = x + n[0], ny = y + n[1], nz = z + n[2];
            if (nx < 0 || nx >= CHUNK || nz < 0 || nz >= CHUNK || ny < 0 || ny >= HEIGHT) continue;
            const ni = IDX(nx, ny, nz);
            const nt = blocks[ni] & 0xFFF;
            const op = nt === 0 ? 0 : MC.Blocks.opacityOf(nt);
            if (op >= 15) continue;
            let nl = l - 1 - (op > 0 ? op - 1 : 0);
            if (n[1] === -1 && shift === 4) nl = l - (op > 0 ? op : 0); // 向下不衰减
            if (nl <= 0) continue;
            const cur = (light[ni] >> shift) & mask;
            if (nl > cur) {
              light[ni] = (light[ni] & ~(mask << shift)) | (nl << shift);
              push(ni);
            }
          }
        }
      };
      spread(4, 15);

      /* 方块光 */
      head = 0; tail = 0;
      for (let i = 0; i < blocks.length; i++) {
        const t = blocks[i] & 0xFFF;
        if (t === 0) continue;
        const em = MC.Blocks.lightEmit(t);
        if (em > 0) { light[i] = (light[i] & 0xF0) | em; push(i); }
      }
      spread(0, 15);
      this.lit = true;
    }

    /* ---------------- 网格 ---------------- */
    buildMesh(mesher) {
      return mesher.build(this);
    }
  }

  /* ================= 网格生成器 ================= */
  const Mesher = MC.Mesher = {
    opaqueB: new Builder(8192),
    transB: new Builder(2048),

    build(chunk) {
      const world = chunk.world;
      const blocks = chunk.blocks;
      const B = MC.Blocks;
      const OB = this.opaqueB, TB = this.transB;
      OB.reset(); TB.reset();

      let maxSky = 0, maxShade = 0, nTop = 0;
      const cx0 = chunk.cx * CHUNK, cz0 = chunk.cz * CHUNK;
      const getB = world.getBlockFast.bind(world);
      const getL = world.getLightFast.bind(world);
      const bioColors = world.gen.biomeColors;

      /* 只遍历非空气方块的 y 区间 (露天地形通常只有 ~70/384 层) */
      const y0 = chunk.minY, y1 = chunk.maxY;
      for (let y = y0; y <= y1; y++) {
        for (let z = 0; z < CHUNK; z++) {
          for (let x = 0; x < CHUNK; x++) {
            const i = IDX(x, y, z);
            const id = blocks[i];
            if (id === 0) continue;
            const type = id & 0xFFF;
            const rot = id >> 12;
            const def = B.byType[type];
            if (!def) continue;

            const vi = B.variantIndex(type, rot);
            const geo = B.geo(type, vi);
            if (!geo || !geo.quads.length) continue;

            const gx = cx0 + x, gy = y, gz = cz0 + z;
            const translucent = def.render === 'translucent' || def.liquid;
            const builder = translucent ? TB : OB;
            const li = chunk.light[i];
            const skyOwn = (li >> 4) / 15, blkOwn = (li & 15) / 15;

            /* 生物群系染色 (仅作用于模型中标了 tintindex 的面) */
            let tint = null;
            const biomeId = chunk.biome[z * CHUNK + x];
            if (def.tint) {
              const bc = bioColors[biomeId];
              if (bc && Array.isArray(bc[0])) tint = def.tint === 'grass' ? bc[0] : bc[1];
            } else if (def.id === 'water') {
              tint = world.gen.waterColors[biomeId] || [0.247, 0.463, 0.894];
            }
            const isWater = def.id === 'water';

            for (let qi = 0; qi < geo.quads.length; qi++) {
              const q = geo.quads[qi];

              /* 遮挡剔除 */
              if (q.cull >= 0) {
                const n = FN[q.cull];
                const nb = getB(gx + n[0], gy + n[1], gz + n[2]);
                if (nb !== 0) {
                  const ntype = nb & 0xFFF;
                  if (B.occludes(ntype)) continue;
                  if (ntype === type && (def.liquid || def.render === 'translucent')) continue;
                }
              }

              builder.ensure(4, 6);

              const base = builder.nv;
              const shadeBase = q.shade ? FACE_SHADE[q.face] : 1.0;
              const aoOn = q.ao && q.cull >= 0;
              const axes = FACE_AXES[q.face];
              const nrm = FN[q.face];

              for (let v = 0; v < 4; v++) {
                const px = x + q.p[v * 3], py = y + q.p[v * 3 + 1], pz = z + q.p[v * 3 + 2];

                let sky = skyOwn, blk = blkOwn, shade = shadeBase;

                if (q.cull >= 0) {
                  /* 平滑光照 + AO */
                  const n = nrm;
                  const fx = gx + n[0], fy = gy + n[1], fz = gz + n[2];
                  // 顶点在面内的偏移方向
                  const du = (q.p[v * 3] - 0.5) * axes[0][0] + (q.p[v * 3 + 2] - 0.5) * axes[0][2];
                  const dv = (q.p[v * 3 + 1] - 0.5) * axes[1][1] + (q.p[v * 3 + 2] - 0.5) * axes[1][2];
                  const su = du >= 0 ? 1 : -1, sv = dv >= 0 ? 1 : -1;
                  const ux = axes[0][0] * su, uy = axes[0][1] * su, uz = axes[0][2] * su;
                  const vx = axes[1][0] * sv, vy = axes[1][1] * sv, vz = axes[1][2] * sv;
                  const b1 = getB(fx + ux, fy + uy, fz + uz);
                  const b2 = getB(fx + vx, fy + vy, fz + vz);
                  const b3 = getB(fx + ux + vx, fy + uy + vy, fz + uz + vz);
                  const o1 = B.occludes(b1) ? 1 : 0, o2 = B.occludes(b2) ? 1 : 0, o3 = B.occludes(b3) ? 1 : 0;
                  let ao;
                  if (o1 && o2) ao = 0;
                  else ao = 3 - (o1 + o2 + o3);
                  shade *= 0.55 + 0.15 * ao;

                  // 平滑光照: 前方 + 侧面格子, 跳过不透明的邻居
                  // (若不跳过, 墙脚/地面交界处会被邻居的 0 光照拉黑)
                  const l0 = getL(fx, fy, fz);
                  let sSum = (l0 >> 4), bSum = (l0 & 15), cnt = 1;
                  if (!o1) {
                    const l1 = getL(fx + ux, fy + uy, fz + uz);
                    sSum += (l1 >> 4); bSum += (l1 & 15); cnt++;
                  }
                  if (!o2) {
                    const l2 = getL(fx + vx, fy + vy, fz + vz);
                    sSum += (l2 >> 4); bSum += (l2 & 15); cnt++;
                  }
                  if (!o3) {
                    const l3 = getL(fx + ux + vx, fy + uy + vy, fz + uz + vz);
                    sSum += (l3 >> 4); bSum += (l3 & 15); cnt++;
                  }
                  sky = sSum / (15 * cnt);
                  blk = bSum / (15 * cnt);
                } else {
                  /* 十字/平面模型 (草、花、藤蔓、火把、液体...): 用自身格子光照。
                   * 旧实现按面法线取邻居格的光照, 植物一旦贴着墙/地面, 邻居就是
                   * 实心方块, 光照为 0, 整片贴图被压成黑色 (表现为"半边黑")。 */
                  sky = skyOwn; blk = blkOwn;
                }

                const o = (builder.nv) * 13;
                const A = builder.verts;
                A[o] = px; A[o + 1] = py; A[o + 2] = pz;
                A[o + 3] = q.uv[v * 2]; A[o + 4] = q.uv[v * 2 + 1];
                A[o + 5] = q.layer; A[o + 6] = q.arr;
                A[o + 7] = sky; A[o + 8] = blk; A[o + 9] = shade;
                const useTint = tint && (isWater || q.tint >= 0) ? tint : null;
                A[o + 10] = useTint ? useTint[0] : 1;
                A[o + 11] = useTint ? useTint[1] : 1;
                A[o + 12] = useTint ? useTint[2] : 1;
                builder.nv++;
                if (sky > maxSky) maxSky = sky;
                if (q.face === 1 && shade > maxShade) maxShade = shade;
                if (q.face === 1) nTop++;
              }
              const I = builder.idx;
              I[builder.ni++] = base; I[builder.ni++] = base + 1; I[builder.ni++] = base + 2;
              I[builder.ni++] = base; I[builder.ni++] = base + 2; I[builder.ni++] = base + 3;
            }
          }
        }
      }
      chunk._dbg = { maxSky: +maxSky.toFixed(2), maxShade: +maxShade.toFixed(2), topFaces: nTop };
      return { opaque: OB.data(), translucent: TB.data() };
    }
  };

  MC.Chunk = Chunk;
  MC.CHUNK = CHUNK;
  MC.HEIGHT = HEIGHT;
  MC.IDX = IDX;
  MC.Builder = Builder;
})(window.MC);

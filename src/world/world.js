/* ============================================================
 *  world.js — 区块管理 / 加载调度 / 方块读写
 * ============================================================ */
(function (MC) {
  'use strict';

  const CHUNK = 16, HEIGHT = 384;

  class World {
    constructor(gen, seed) {
      this.gen = gen;
      this.chunks = new Map();
      this.renderDistance = 8;
      this.bedrock = MC.Blocks.getByName('bedrock').type;
      this.centerCX = 0; this.centerCZ = 0;
      this.genQueue = [];
      this.meshQueue = [];
      this.stats = { chunks: 0, quads: 0, genPerFrame: 0, meshPerFrame: 0 };
      this.onChunkReady = null;
      /* 跨区块写入缓冲: 树冠伸出本区块时, 目标区块可能还没生成 */
      this.pending = new Map();
      /* 每帧复用的"附近区块"列表, 避免每帧 new 数组 + sort */
      this._need = [];
      this._needR = -1;
      this._needCX = NaN; this._needCZ = NaN;
      /* 流体模拟 (水/岩浆的流动与积水) */
      this.fluid = new MC.FluidSim(this);
    }

    key(cx, cz) { return cx + ',' + cz; }

    getChunk(cx, cz) { return this.chunks.get(cx + ',' + cz) || null; }

    ensureChunk(cx, cz) {
      const k = cx + ',' + cz;
      let c = this.chunks.get(k);
      if (!c) { c = new MC.Chunk(this, cx, cz); this.chunks.set(k, c); }
      return c;
    }

    /* ---------- 读取 (不触发加载) ---------- */
    getBlockFast(x, y, z) {
      if (y < 0) return this.bedrock;
      if (y >= HEIGHT) return 0;
      const cx = x >> 4, cz = z >> 4;
      const c = this.chunks.get(cx + ',' + cz);
      if (!c) return 0;
      return c.blocks[((y * CHUNK + (z & 15)) * CHUNK) + (x & 15)];
    }

    getLightFast(x, y, z) {
      if (y < 0) return 0;
      if (y >= HEIGHT) return 15 << 4;
      const cx = x >> 4, cz = z >> 4;
      const c = this.chunks.get(cx + ',' + cz);
      if (!c) return 15 << 4;
      return c.light[((y * CHUNK + (z & 15)) * CHUNK) + (x & 15)];
    }

    getBlock(x, y, z) { return this.getBlockFast(x, y, z); }

    isSolid(x, y, z) {
      const id = this.getBlockFast(x, y, z);
      return id !== 0 && MC.Blocks.solidOf(id & 0xFFF);
    }

    /* ---------- 写入 ---------- */
    setBlock(x, y, z, id) {
      if (y < 0 || y >= HEIGHT) return false;
      const cx = x >> 4, cz = z >> 4;
      const c = this.chunks.get(cx + ',' + cz);
      if (!c) return false;
      const lx = x & 15, lz = z & 15;
      const i = ((y * CHUNK + lz) * CHUNK) + lx;
      const oldId = c.blocks[i];
      if (oldId === id) return false;

      c.blocks[i] = id;
      c.dirty = true;
      c.growBounds(y);

      /* 液体出现/消失: 唤醒流体模拟 */
      if (this.fluid) {
        const oLq = (oldId & 0xFFF) !== 0 && MC.Blocks.byType[oldId & 0xFFF] &&
          MC.Blocks.byType[oldId & 0xFFF].liquid;
        const nLq = (id & 0xFFF) !== 0 && MC.Blocks.byType[id & 0xFFF] &&
          MC.Blocks.byType[id & 0xFFF].liquid;
        if (oLq || nLq) this.fluid.wakeAround(x, y, z);
      }

      /* 增量光照: 只在光路真的变化时重算该格
       * (旧实现要么全区块 computeLight、要么整列重算，且只增不减) */
      const oldType = oldId & 0xFFF, newType = id & 0xFFF;
      const oldOp = oldType ? MC.Blocks.opacityOf(oldType) : 0;
      const newOp = newType ? MC.Blocks.opacityOf(newType) : 0;
      const oldEm = oldType ? MC.Blocks.lightEmit(oldType) : 0;
      const newEm = newType ? MC.Blocks.lightEmit(newType) : 0;
      const lightChanged = oldOp !== newOp || oldEm !== newEm;
      if (lightChanged && c.lit) c.updateLight(i, oldId, id);

      /* 跨区块边界: 邻区块的光照可能受影响, 只能整块重算 (少见) */
      if (lightChanged) {
        if (lx === 0) this._relight(cx - 1, cz);
        if (lx === 15) this._relight(cx + 1, cz);
        if (lz === 0) this._relight(cx, cz - 1);
        if (lz === 15) this._relight(cx, cz + 1);
      }

      /* 邻居网格更新 */
      if (lx === 0) this._dirty(cx - 1, cz);
      if (lx === 15) this._dirty(cx + 1, cz);
      if (lz === 0) this._dirty(cx, cz - 1);
      if (lz === 15) this._dirty(cx, cz + 1);
      if (lx === 0 && lz === 0) this._dirty(cx - 1, cz - 1);
      if (lx === 0 && lz === 15) this._dirty(cx - 1, cz + 1);
      if (lx === 15 && lz === 0) this._dirty(cx + 1, cz - 1);
      if (lx === 15 && lz === 15) this._dirty(cx + 1, cz + 1);
      return true;
    }

    _relight(cx, cz) {
      const c = this.chunks.get(cx + ',' + cz);
      if (c && c.generated) { c.needsRelight = true; c.dirty = true; }
    }
    _dirty(cx, cz) {
      const c = this.chunks.get(cx + ',' + cz);
      if (c) c.dirty = true;
    }

    /* ---------- 生成 ---------- */
    _generate(c) {
      const res = this.gen.generate(c.cx, c.cz, c.blocks, c.biome);
      c.heights = res && res.heights ? res.heights : null;
      c.generated = true;
      c.updateBounds();
      this._flushPending(c);           /* 先补写邻居区块伸过来的树 */
      if (res && res.pending && res.pending.length) this._applyPending(res.pending);
      c.updateBounds();
      c.computeLight();
      c.dirty = true;
    }

    /** 邻居区块生成时想写进本区块的方块 (跨区块树冠) */
    _applyPending(list) {
      for (let k = 0; k < list.length; k += 4) {
        const x = list[k], y = list[k + 1], z = list[k + 2], id = list[k + 3];
        const key = (x >> 4) + ',' + (z >> 4);
        const c = this.chunks.get(key);
        if (c && c.generated) this._write(c, x, y, z, id);
        else {
          let a = this.pending.get(key);
          if (!a) { a = []; this.pending.set(key, a); }
          a.push(x, y, z, id);
        }
      }
    }

    _flushPending(c) {
      const key = c.cx + ',' + c.cz;
      const a = this.pending.get(key);
      if (!a) return;
      this.pending.delete(key);
      for (let k = 0; k < a.length; k += 4) this._write(c, a[k], a[k + 1], a[k + 2], a[k + 3]);
    }

    /** 写入一个方块但不覆盖已有内容 (只用于生成期的装饰) */
    _write(c, x, y, z, id) {
      if (y < 0 || y >= HEIGHT) return;
      const i = ((y * CHUNK + (z & 15)) * CHUNK) + (x & 15);
      if (c.blocks[i] !== 0) return;
      const old = c.blocks[i];
      c.blocks[i] = id;
      if (c.lit) c.updateLight(i, old, id);
      c.growBounds(y);
      c.dirty = true;
    }

    /* ---------- 调度 ---------- */
    update(px, pz, dt, renderer) {
      const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
      this.centerCX = ccx; this.centerCZ = ccz;
      const R = this.renderDistance;
      const t0 = performance.now();
      const GEN_BUDGET = 7, MESH_BUDGET = 7;

      /* 流体: 每帧推进一点点, 只在有活动格子时才做事 */
      if (this.fluid) this.fluid.update(dt || 0);

      /* 需要加载的区块列表 (按距离排序; 只在中心/半径变化时重建) */
      if (this._needR !== R || this._needCX !== ccx || this._needCZ !== ccz) {
        const need = this._need;
        need.length = 0;
        for (let dz = -R - 1; dz <= R + 1; dz++) {
          for (let dx = -R - 1; dx <= R + 1; dx++) {
            const d2 = dx * dx + dz * dz;
            if (d2 > (R + 1) * (R + 1)) continue;
            need.push([ccx + dx, ccz + dz, d2]);
          }
        }
        need.sort((a, b) => a[2] - b[2]);
        this._needR = R; this._needCX = ccx; this._needCZ = ccz;
      }
      const need = this._need;

      /* 生成 */
      let generated = 0;
      for (const [cx, cz, d2] of need) {
        if (performance.now() - t0 > GEN_BUDGET) break;
        let c = this.chunks.get(cx + ',' + cz);
        if (c && c.generated) continue;
        c = this.ensureChunk(cx, cz);
        this._generate(c);
        generated++;
        if (this.onChunkReady) this.onChunkReady(c);
      }
      this.stats.genPerFrame = generated;

      /* 网格 */
      let meshed = 0;
      const t1 = performance.now();
      for (const [cx, cz, d2] of need) {
        if (performance.now() - t1 > MESH_BUDGET) break;
        const c = this.chunks.get(cx + ',' + cz);
        if (!c || !c.generated) continue;
        if (c.needsRelight) { c.computeLight(); c.needsRelight = false; c.dirty = true; }
        if (!c.dirty) continue;
        if (!this.neighborsReady(cx, cz)) continue;
        this.buildChunkMesh(c, renderer);
        meshed++;
      }
      this.stats.meshPerFrame = meshed;

      /* 卸载远处区块 */
      const maxD = R + 3;
      if ((this._unloadTick = (this._unloadTick || 0) + 1) % 60 === 0) {
        for (const [k, c] of this.chunks) {
          const dx = c.cx - ccx, dz = c.cz - ccz;
          if (dx * dx + dz * dz > maxD * maxD) {
            if (renderer) renderer.disposeChunk(c);
            this.chunks.delete(k);
          }
        }
      }
      this.stats.chunks = this.chunks.size;
    }

    neighborsReady(cx, cz) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get((cx + dx) + ',' + (cz + dz));
        if (!c || !c.generated) return false;
      }
      return true;
    }

    buildChunkMesh(chunk, renderer) {
      const m = chunk.buildMesh(MC.Mesher);
      chunk.dirty = false;
      if (renderer) renderer.uploadChunk(chunk, m);
      return m;
    }

    /** 立即生成一片区域 (出生点用) */
    generateAround(px, pz, radius) {
      const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const c = this.ensureChunk(ccx + dx, ccz + dz);
          if (!c.generated) this._generate(c);
        }
      }
    }

    /** 找到地表高度 */
    surfaceY(x, z) {
      const c = this.chunks.get((x >> 4) + ',' + (z >> 4));
      if (!c || !c.generated) return this.gen.heightAt(x, z) + 1;
      const lx = x & 15, lz = z & 15;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const id = c.blocks[((y * CHUNK + lz) * CHUNK) + lx];
        if (id !== 0) {
          const t = id & 0xFFF;
          const def = MC.Blocks.byType[t];
          if (def && def.solid) return y + 1;
        }
      }
      return this.gen.heightAt(x, z) + 1;
    }

    biomeAt(x, z) {
      const c = this.chunks.get((x >> 4) + ',' + (z >> 4));
      if (!c || !c.generated) return this.gen.biomeAt(x, z);
      return MC.WorldGen.BIOME_LIST[c.biome[(z & 15) * CHUNK + (x & 15)]] || this.gen.BIOMES.plains;
    }
  }

  MC.World = World;
})(window.MC);

/* ===========================================================================
 * fluid.js — 水 / 岩浆 流体模拟
 *
 * 方块 id 的高 4 位复用为液面等级:
 *   0    = 源头 (自然水体, 或玩家放置的水/岩浆)
 *   1..7 = 流动, 数值越大液面越低 (渲染高度 7/8 .. 1/8)
 *
 * 只做"看得见"的那一层: 10 秒级的滴水式扩散、逐格下流、断流回收,
 * 不做原版的 tick 调度细节。全部写在已加载区块里, 未加载区块直接跳过。
 * ========================================================================= */
(function (MC) {
  'use strict';

  const HEIGHT = 384;
  const MAXL = 7;           // 最稀的流动等级
  const TICK = 0.15;        // 秒 / 流体刻
  const MAX_CELLS = 3000;   // 单刻处理上限, 防止极端情况卡死主循环

  const DIRS = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
  ];

  class FluidSim {
    constructor(world) {
      this.world = world;
      this.acc = 0;
      this.q = [];              // [x,y,z, x,y,z, ...]
      this.mark = new Map();    // "x,y,z" -> 1, 去重
      this.t = null;            // 类型缓存
      this.stats = { flow: 0 };
    }

    /* ---------- 类型缓存 ---------- */
    get types() {
      if (!this.t) {
        const by = MC.Blocks.byName || {};
        const pick = (n) => (by[n] ? by[n].type : -1);
        this.t = {
          water: pick('water'),
          lava: pick('lava'),
          stone: pick('stone'),
          cobble: pick('cobblestone'),
          obsidian: pick('obsidian')
        };
      }
      return this.t;
    }

    isLiquid(type) { return type === this.types.water || type === this.types.lava; }

    /* ---------- 唤醒 ---------- */
    wake(x, y, z) {
      if (y < 0 || y >= HEIGHT) return;
      const k = x + ',' + y + ',' + z;
      if (this.mark.has(k)) return;
      this.mark.set(k, 1);
      this.q.push(x, y, z);
    }

    wakeAround(x, y, z) {
      this.wake(x, y, z);
      this.wake(x + 1, y, z); this.wake(x - 1, y, z);
      this.wake(x, y + 1, z); this.wake(x, y - 1, z);
      this.wake(x, y, z + 1); this.wake(x, y, z - 1);
    }

    /* ---------- 主循环 ---------- */
    update(dt) {
      if (!this.q.length) { this.acc = 0; return; }
      this.acc += dt;
      let guard = 0;
      while (this.acc >= TICK && guard < 3) {
        this.acc -= TICK;
        this.tick();
        guard++;
      }
      if (this.acc > TICK * 3) this.acc = 0;
    }

    tick() {
      if (!this.q.length) return;
      const W = this.world;
      const cells = this.q;
      this.q = [];
      this.mark.clear();

      const total = (cells.length / 3) | 0;
      const n = Math.min(total, MAX_CELLS);
      const writes = [];

      for (let c = 0; c < n; c++) {
        const x = cells[c * 3], y = cells[c * 3 + 1], z = cells[c * 3 + 2];
        const id = W.getBlockFast(x, y, z);
        const type = id & 0xFFF;
        if (!this.isLiquid(type)) continue;
        const lvl = id >> 12;
        if (lvl === 0) this.step(x, y, z, type, 0, writes);
        else this.step(x, y, z, type, lvl, writes);
      }

      for (let i = 0; i < writes.length; i += 4) {
        this.write(writes[i], writes[i + 1], writes[i + 2], writes[i + 3]);
      }

      /* 超出上限的部分留到下一刻 */
      for (let c = n; c < total; c++) this.wake(cells[c * 3], cells[c * 3 + 1], cells[c * 3 + 2]);
      this.stats.flow = total;
    }

    /** 处理一个液体格: 源头(iLvl=0) 只扩散; 流动格先重新计算自身等级 */
    step(x, y, z, type, lvl, writes) {
      const W = this.world;
      let target = lvl;

      if (lvl > 0) {
        /* --- 重新计算期望等级 --- */
        let want = 8;
        const above = W.getBlockFast(x, y + 1, z);
        if ((above & 0xFFF) === type) want = 1;                 // 上方还有同种液体 -> 往下灌
        if (want > 1) {
          for (let d = 0; d < 4; d++) {
            const nd = DIRS[d];
            const nid = W.getBlockFast(x + nd[0], y, z + nd[2]);
            if ((nid & 0xFFF) !== type) continue;
            const nl = nid >> 12;
            const cand = (nl === 0 ? 1 : nl + 1);
            if (cand < want) want = cand;
          }
        }
        if (want > MAXL) {                                       // 断流: 收回
          writes.push(x, y, z, 0);
          return;
        }
        target = want;
        if (target !== lvl) writes.push(x, y, z, type | (target << 12));
        if (target >= MAXL) return;                              // 最稀的一级不再蔓延
      }

      /* --- 向下流: 能往下流就只往下流 ---
       * 原版里"流动"的水(等级>=1)一旦有一条通路往下, 就不会再向侧面扩散,
       * 只有源头(等级0)才会一边下落一边向四周铺开。少了这条约束, 瀑布
       * 会在每一层都向四周扩散, 瞬间灌满一大片(实测 17x17 全被填满)。 */
      let falling = false;
      if (y > 0) {
        const below = W.getBlockFast(x, y - 1, z);
        const bt = below & 0xFFF;
        if (bt === type) {
          if ((below >> 12) > 1) writes.push(x, y - 1, z, type | (1 << 12));
          falling = true;
        } else if (this.replaceable(bt)) {
          writes.push(x, y - 1, z, this.mix(x, y - 1, z, type, 1));
          falling = true;
        }
      }
      if (falling && lvl > 0) return;

      /* --- 四向蔓延 (只有源头, 或者落到底的流动格才铺开) --- */
      const next = target + 1;
      if (next > MAXL) return;
      for (let d = 0; d < 4; d++) {
        const nd = DIRS[d];
        const nx = x + nd[0], nz = z + nd[2];
        const nid = W.getBlockFast(nx, y, nz);
        const nt = nid & 0xFFF;
        if (nt === type) {
          if ((nid >> 12) > next) writes.push(nx, y, nz, type | (next << 12));
        } else if (this.replaceable(nt)) {
          writes.push(nx, y, nz, this.mix(nx, y, nz, type, next));
        }
      }
    }

    /** 该方块能否被液体替换 (空气 / 花草等非固体) */
    replaceable(type) {
      if (type === 0) return true;
      const def = MC.Blocks.byType[type];
      if (!def) return false;
      if (def.liquid || def.solid) return false;
      return true;
    }

    /** 水火相遇: 岩浆变石头/黑曜石, 水变石头 */
    mix(x, y, z, type, lvl) {
      const T = this.types;
      const other = (type === T.water) ? T.lava : T.water;
      let hit = false, hitSource = false;
      for (let d = 0; d < 4; d++) {
        const nd = DIRS[d];
        const nid = this.world.getBlockFast(x + nd[0], y, z + nd[2]);
        if ((nid & 0xFFF) !== other) continue;
        hit = true;
        if ((nid >> 12) === 0) hitSource = true;
      }
      const up = this.world.getBlockFast(x, y + 1, z);
      if ((up & 0xFFF) === other) { hit = true; if ((up >> 12) === 0) hitSource = true; }

      if (!hit) return type | (lvl << 12);
      if (type === T.lava) return hitSource ? T.obsidian : T.cobble;
      return hitSource ? T.obsidian : T.stone;
    }

    write(x, y, z, id) {
      const W = this.world;
      const cur = W.getBlockFast(x, y, z);
      if (cur === id) return;
      W.setBlock(x, y, z, id);
      this.wakeAround(x, y, z);
    }
  }

  MC.FluidSim = FluidSim;
})(window.MC);

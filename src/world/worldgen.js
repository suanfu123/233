/* ============================================================
 *  worldgen.js — 生物群系 / 地形 / 洞穴 / 树木 / 矿物
 * ============================================================ */
(function (MC) {
  'use strict';

  const CHUNK = 16;
  const HEIGHT = 384;
  const SEA = 62;

  /* 生物群系表 (温度/湿度参考 1.16.5) */
  const BIOMES = {
    ocean: { id: 1, name: 'Ocean', temp: 0.5, humid: 0.5, top: 'sand', fill: 'sand', uw: 'gravel' },
    deep_ocean: { id: 2, name: 'Deep Ocean', temp: 0.5, humid: 0.5, top: 'gravel', fill: 'gravel', uw: 'gravel' },
    frozen_ocean: { id: 3, name: 'Frozen Ocean', temp: 0.0, humid: 0.5, top: 'gravel', fill: 'gravel', uw: 'gravel', ice: true },
    beach: { id: 4, name: 'Beach', temp: 0.8, humid: 0.4, top: 'sand', fill: 'sand', tree: 0 },
    snowy_beach: { id: 5, name: 'Snowy Beach', temp: 0.05, humid: 0.3, top: 'sand', fill: 'sand', snow: true, ice: true },
    stone_shore: { id: 6, name: 'Stone Shore', temp: 0.2, humid: 0.3, top: 'stone', fill: 'stone' },
    plains: { id: 7, name: 'Plains', temp: 0.8, humid: 0.4, top: 'grass_block', fill: 'dirt', tree: 0.006, grass: 0.16, flower: 0.02, treeType: 'oak' },
    forest: { id: 8, name: 'Forest', temp: 0.7, humid: 0.8, top: 'grass_block', fill: 'dirt', tree: 0.11, grass: 0.14, flower: 0.012, treeType: 'oak' },
    birch_forest: { id: 9, name: 'Birch Forest', temp: 0.6, humid: 0.6, top: 'grass_block', fill: 'dirt', tree: 0.10, grass: 0.12, flower: 0.01, treeType: 'birch' },
    taiga: { id: 10, name: 'Taiga', temp: 0.25, humid: 0.8, top: 'grass_block', fill: 'dirt', tree: 0.09, grass: 0.10, treeType: 'spruce' },
    snowy_taiga: { id: 11, name: 'Snowy Taiga', temp: -0.5, humid: 0.4, top: 'grass_block', fill: 'dirt', tree: 0.07, snow: true, ice: true, treeType: 'spruce' },
    snowy_plains: { id: 12, name: 'Snowy Plains', temp: 0.0, humid: 0.5, top: 'grass_block', fill: 'dirt', tree: 0.002, snow: true, ice: true, treeType: 'spruce' },
    snowy_mountains: { id: 13, name: 'Snowy Mountains', temp: -0.7, humid: 0.5, top: 'grass_block', fill: 'dirt', snow: true, ice: true, treeType: 'spruce', tree: 0.01 },
    desert: { id: 14, name: 'Desert', temp: 2.0, humid: 0.0, top: 'sand', fill: 'sandstone', cactus: 0.02, deadbush: 0.02 },
    savanna: { id: 15, name: 'Savanna', temp: 1.2, humid: 0.0, top: 'grass_block', fill: 'dirt', tree: 0.012, grass: 0.3, treeType: 'acacia' },
    jungle: { id: 16, name: 'Jungle', temp: 0.95, humid: 0.9, top: 'grass_block', fill: 'dirt', tree: 0.16, grass: 0.35, treeType: 'jungle' },
    swamp: { id: 17, name: 'Swamp', temp: 0.8, humid: 0.9, top: 'grass_block', fill: 'dirt', tree: 0.04, grass: 0.25, treeType: 'oak', swamp: true },
    mountains: { id: 18, name: 'Mountains', temp: 0.2, humid: 0.3, top: 'grass_block', fill: 'dirt', tree: 0.02, treeType: 'spruce' },
    badlands: { id: 19, name: 'Badlands', temp: 2.0, humid: 0.0, top: 'red_sand', fill: 'terracotta', deadbush: 0.03 },
    mushroom_fields: { id: 20, name: 'Mushroom Fields', temp: 0.9, humid: 1.0, top: 'mycelium', fill: 'dirt', tree: 0.004, treeType: 'oak', mushroom: 0.06 }
  };
  const BIOME_LIST = [];
  for (const k in BIOMES) { BIOMES[k].key = k; BIOME_LIST[BIOMES[k].id] = BIOMES[k]; }

  const T = (n) => MC.Blocks.getByName(n).type;

  const WorldGen = MC.WorldGen = {
    CHUNK, HEIGHT, SEA, BIOMES, BIOME_LIST,
    biomeColors: [],

    init(seed, textures) {
      this.seed = seed | 0;
      const s = this.seed;
      this.nCont = new MC.Simplex(s);
      this.nHill = new MC.Simplex(s + 101);
      this.nDetail = new MC.Simplex(s + 202);
      this.nTemp = new MC.Simplex(s + 303);
      this.nHumid = new MC.Simplex(s + 404);
      this.nCave = new MC.Simplex(s + 505);
      this.nCave2 = new MC.Simplex(s + 606);
      this.nDeco = new MC.Simplex(s + 707);
      this.nSurf = new MC.Simplex(s + 808);

      /* 水色 (原版在水面贴图灰度上染色) */
      const WATER_DEFAULT = [0.247, 0.463, 0.894];   // 0x3F76E4
      const waterById = {
        3: [0.224, 0.220, 0.788],   // frozen_ocean 0x3938C9
        17: [0.380, 0.482, 0.392],  // swamp 0x617B64
        19: [0.306, 0.498, 0.506]   // badlands 0x4E7F81
      };
      this.waterColors = [];
      for (const b of BIOME_LIST) {
        if (!b) continue;
        this.waterColors[b.id] = waterById[b.id] || WATER_DEFAULT;
      }

      /* 每生物群系计算草/树叶颜色 */
      const cm = textures.colormap;
      this.biomeColors = [];
      for (const b of BIOME_LIST) {
        if (!b) continue;                 // 索引 0 留空 (生物群系 id 从 1 开始)
        this.biomeColors[b.id] = [
          this.colorAt(cm.grass, b.temp, b.humid),
          this.colorAt(cm.foliage, b.temp, b.humid)
        ];
      }
      /* 方块类型缓存 */
      this.TYPES = {
        air: 0, bedrock: T('bedrock'), stone: T('stone'), dirt: T('dirt'), grass_block: T('grass_block'),
        sand: T('sand'), red_sand: T('red_sand'), gravel: T('gravel'), sandstone: T('sandstone'),
        terracotta: T('terracotta'), water: T('water'), lava: T('lava'), snow_block: T('snow_block'),
        ice: T('ice'), mycelium: T('mycelium'), clay: T('clay'),
        oak_log: T('oak_log'), oak_leaves: T('oak_leaves'), birch_log: T('birch_log'), birch_leaves: T('birch_leaves'),
        spruce_log: T('spruce_log'), spruce_leaves: T('spruce_leaves'), jungle_log: T('jungle_log'), jungle_leaves: T('jungle_leaves'),
        acacia_log: T('acacia_log'), acacia_leaves: T('acacia_leaves'), dark_oak_log: T('dark_oak_log'), dark_oak_leaves: T('dark_oak_leaves'),
        grass: T('grass'), tall_grass: T('tall_grass'), fern: T('fern'), dead_bush: T('dead_bush'),
        dandelion: T('dandelion'), poppy: T('poppy'), blue_orchid: T('blue_orchid'), allium: T('allium'),
        azure_bluet: T('azure_bluet'), red_tulip: T('red_tulip'), orange_tulip: T('orange_tulip'),
        white_tulip: T('white_tulip'), pink_tulip: T('pink_tulip'), oxeye_daisy: T('oxeye_daisy'),
        cornflower: T('cornflower'), lily_of_the_valley: T('lily_of_the_valley'),
        brown_mushroom: T('brown_mushroom'), red_mushroom: T('red_mushroom'),
        cactus: T('cactus'), sugar_cane: T('sugar_cane'), seagrass: T('seagrass'), kelp: T('kelp'),
        coal_ore: T('coal_ore'), iron_ore: T('iron_ore'), gold_ore: T('gold_ore'), diamond_ore: T('diamond_ore'),
        redstone_ore: T('redstone_ore'), lapis_ore: T('lapis_ore'), emerald_ore: T('emerald_ore'),
        granite: T('granite'), diorite: T('diorite'), andesite: T('andesite'),
        podzol: T('podzol'), coarse_dirt: T('coarse_dirt'), snow: T('snow'), pumpkin: T('pumpkin'),
        oak_sapling: T('oak_sapling')
      };
      return this;
    },

    colorAt(cm, temp, humid) {
      if (!cm) return [0.62, 0.81, 0.43];
      const t = MC.clamp(temp, 0, 1);
      const h = MC.clamp(humid, 0, 1) * t;
      let i = ((1 - t) * 255) | 0;
      let j = ((1 - h) * 255) | 0;
      i = MC.clamp(i, 0, cm.width - 1); j = MC.clamp(j, 0, cm.height - 1);
      const p = (j * cm.width + i) * 4;
      return [cm.data[p] / 255, cm.data[p + 1] / 255, cm.data[p + 2] / 255];
    },

    heightAt(x, z) {
      const c = this.nCont.fbm2(x * 0.0012, z * 0.0012, 4);
      const h1 = this.nHill.fbm2(x * 0.0075, z * 0.0075, 4);
      const d = this.nDetail.fbm2(x * 0.03, z * 0.03, 3);
      let base = SEA + c * 40;
      const m = Math.max(0, c - 0.22) / 0.78;
      base += m * m * 55 * (0.5 + 0.5 * h1);
      base += h1 * 6 + d * 3;
      return MC.clamp(Math.round(base), 3, HEIGHT - 8);
    },

    climateAt(x, z) {
      return {
        temp: (this.nTemp.fbm2(x * 0.0016, z * 0.0016, 3) + 1) * 0.5,
        humid: (this.nHumid.fbm2(x * 0.0014 + 100, z * 0.0014, 3) + 1) * 0.5
      };
    },

    biomeAt(x, z, h) {
      if (h === undefined) h = this.heightAt(x, z);
      const cl = this.climateAt(x, z);
      const t = cl.temp, hu = cl.humid;
      if (h < SEA - 2) {
        if (h < SEA - 16) return t < 0.28 ? BIOMES.frozen_ocean : BIOMES.deep_ocean;
        return t < 0.28 ? BIOMES.frozen_ocean : BIOMES.ocean;
      }
      if (h <= SEA + 1) {
        if (t < 0.3) return BIOMES.snowy_beach;
        if (h >= SEA) return t > 1.4 && hu < 0.3 ? BIOMES.desert : BIOMES.beach;
        return BIOMES.beach;
      }
      if (t < 0.26) {
        if (h > SEA + 34) return BIOMES.snowy_mountains;
        return hu > 0.55 ? BIOMES.snowy_taiga : BIOMES.snowy_plains;
      }
      if (t < 0.42) {
        if (h > SEA + 34) return BIOMES.mountains;
        return hu > 0.6 ? BIOMES.taiga : BIOMES.plains;
      }
      if (t > 1.5 && hu < 0.32) return h > SEA + 26 ? BIOMES.badlands : BIOMES.desert;
      if (hu < 0.24) return BIOMES.savanna;
      if (hu > 0.74 && t > 0.55) return h < SEA + 6 ? BIOMES.swamp : BIOMES.jungle;
      if (hu > 0.62) return t < 0.55 ? BIOMES.birch_forest : BIOMES.forest;
      if (hu > 0.5) return BIOMES.forest;
      return BIOMES.plains;
    },

    /** 3D 洞穴判定 */
    isCave(x, y, z) {
      if (y < 5) return false;
      const c1 = this.nCave.n3(x * 0.019, y * 0.03, z * 0.019);
      const c2 = this.nCave2.n3(x * 0.019, y * 0.03, z * 0.019);
      if (Math.abs(c1) < 0.062 && Math.abs(c2) < 0.062) return true;
      const cheese = this.nCave.fbm3(x * 0.011, y * 0.017, z * 0.011, 2);
      return cheese > 0.66;
    },

    /* ---------------- 区块生成 ---------------- */
    generate(cx, cz, blocks, biomes) {
      const TY = this.TYPES;
      const x0 = cx * CHUNK, z0 = cz * CHUNK;
      const rnd = MC.mulberry32((cx * 341873128 + cz * 132897987 + this.seed) | 0);

      const heights = new Int16Array(CHUNK * CHUNK);
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = x0 + lx, z = z0 + lz;
          const h = this.heightAt(x, z);
          heights[lz * CHUNK + lx] = h;
          const bio = this.biomeAt(x, z, h);
          biomes[lz * CHUNK + lx] = bio.id;

          const top = bio.top === 'grass_block' ? TY.grass_block : TY[bio.top] || TY.stone;
          const fill = TY[bio.fill] || TY.dirt;
          const depth = bio.top === 'sand' ? 4 : 3;

          for (let y = 0; y <= h; y++) {
            let id;
            if (y === 0) id = TY.bedrock;
            else if (y <= 3 && rnd() < (4 - y) / 4.5) id = TY.bedrock;
            else if (y === h) id = top;
            else if (y > h - depth) id = fill;
            else {
              id = TY.stone;
              const v = this.nSurf.n3(x * 0.05, y * 0.05, z * 0.05);
              if (v > 0.42) id = TY.granite;
              else if (v < -0.42) id = TY.diorite;
              else if (v > 0.2 && v < 0.3) id = TY.andesite;
              else if (v < -0.2 && v > -0.3) id = TY.andesite;
            }
            if (y > 4 && y < h && this.isCave(x, y, z)) id = 0;
            blocks[(y * CHUNK + lz) * CHUNK + lx] = id;
          }
          // 水 / 雪
          for (let y = h + 1; y < SEA; y++) blocks[(y * CHUNK + lz) * CHUNK + lx] = TY.water;
          if (h < SEA && bio.ice) blocks[((SEA - 1) * CHUNK + lz) * CHUNK + lx] = TY.ice;
          if (h < SEA && bio.swamp) blocks[((SEA - 1) * CHUNK + lz) * CHUNK + lx] = TY.water;
          if (bio.snow && h >= SEA && !this.isCave(x, h, z)) {
            // 雪层/积雪
            if (blocks[(h * CHUNK + lz) * CHUNK + lx] === TY.grass_block || blocks[(h * CHUNK + lz) * CHUNK + lx] === TY.stone) {
              if (h + 1 < HEIGHT) blocks[((h + 1) * CHUNK + lz) * CHUNK + lx] = TY.snow_block;
            }
          }
        }
      }

      /* 岩浆湖 (深层) */
      for (let y = 4; y < 11; y++) {
        for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
          const i = (y * CHUNK + lz) * CHUNK + lx;
          if (blocks[i] === 0 && y <= 9) blocks[i] = TY.lava;
        }
      }

      /* 矿物 */
      this.genOres(cx, cz, blocks, heights, rnd);

      /* 地表装饰 */
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = x0 + lx, z = z0 + lz;
          const h = heights[lz * CHUNK + lx];
          const bio = BIOME_LIST[biomes[lz * CHUNK + lx]];
          if (h < SEA) continue;
          const surf = blocks[(h * CHUNK + lz) * CHUNK + lx];
          if (surf === 0 || surf === TY.water) continue;
          const above = h + 1;
          if (above >= HEIGHT) continue;
          const idx = (above * CHUNK + lz) * CHUNK + lx;
          if (blocks[idx] !== 0) continue;
          const r = rnd();

          if (bio.grass && surf === TY.grass_block) {
            if (r < bio.grass * 0.75) blocks[idx] = TY.grass;
            else if (r < bio.grass * 0.75 + bio.grass * 0.25) blocks[idx] = TY.tall_grass;
          }
          if (bio.flower && surf === TY.grass_block && blocks[idx] === 0) {
            if (rnd() < bio.flower) {
              const flowers = [TY.dandelion, TY.poppy, TY.blue_orchid, TY.allium, TY.azure_bluet, TY.red_tulip,
                TY.orange_tulip, TY.white_tulip, TY.pink_tulip, TY.oxeye_daisy, TY.cornflower, TY.lily_of_the_valley];
              blocks[idx] = flowers[(rnd() * flowers.length) | 0];
            }
          }
          if (bio.cactus && surf === TY.sand && rnd() < bio.cactus) {
            const ht = 1 + ((rnd() * 3) | 0);
            for (let k = 0; k < ht; k++) blocks[((above + k) * CHUNK + lz) * CHUNK + lx] = TY.cactus;
          }
          if (bio.deadbush && rnd() < bio.deadbush) blocks[idx] = TY.dead_bush;
          if (bio.mushroom && rnd() < bio.mushroom) blocks[idx] = rnd() < 0.5 ? TY.brown_mushroom : TY.red_mushroom;
          if (bio.swamp && rnd() < 0.06 && surf === TY.grass_block) blocks[idx] = TY.sugar_cane;
        }
      }

      /* 水下植物 */
      for (let lz = 0; lz < CHUNK; lz++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const h = heights[lz * CHUNK + lx];
          if (h >= SEA - 2) continue;
          const bio = BIOME_LIST[biomes[lz * CHUNK + lx]];
          if (rnd() < 0.08) {
            const y = h + 1;
            if (y < SEA && blocks[(y * CHUNK + lz) * CHUNK + lx] === TY.water) {
              blocks[(y * CHUNK + lz) * CHUNK + lx] = rnd() < 0.5 ? TY.seagrass : TY.kelp;
            }
          }
        }
      }

      /* 树 (含边界余量, 只写入本区块) */
      this.genTrees(cx, cz, blocks, biomes, heights);
      return heights;
    },

    genTrees(cx, cz, blocks, biomes, heights) {
      const TY = this.TYPES;
      const M = 3;
      for (let dz = -M; dz < CHUNK + M; dz++) {
        for (let dx = -M; dx < CHUNK + M; dx++) {
          const x = cx * CHUNK + dx, z = cz * CHUNK + dz;
          const h = this.heightAt(x, z);
          if (h < SEA) continue;
          const bio = this.biomeAt(x, z, h);
          if (!bio.tree) continue;
          const r = MC.mulberry32((x * 1836311903) ^ (z * 2971215073) ^ this.seed);
          if (r() > bio.tree) continue;

          const type = bio.treeType || 'oak';
          const height = type === 'spruce' ? 7 + ((r() * 5) | 0)
            : type === 'jungle' ? 8 + ((r() * 7) | 0)
              : type === 'birch' ? 6 + ((r() * 3) | 0)
                : type === 'acacia' ? 5 + ((r() * 2) | 0)
                  : 4 + ((r() * 3) | 0);

          const logs = { oak: TY.oak_log, birch: TY.birch_log, spruce: TY.spruce_log, jungle: TY.jungle_log, acacia: TY.acacia_log }[type];
          const leaves = { oak: TY.oak_leaves, birch: TY.birch_leaves, spruce: TY.spruce_leaves, jungle: TY.jungle_leaves, acacia: TY.acacia_leaves }[type];

          const put = (lx, y, lz, id, overwrite) => {
            if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
            const i = (y * CHUNK + lz) * CHUNK + lx;
            if (!overwrite && blocks[i] !== 0 && blocks[i] !== TY.water) return;
            blocks[i] = id;
          };

          const bx = x - cx * CHUNK, bz = z - cz * CHUNK;

          if (type === 'spruce') {
            for (let y = 0; y < height; y++) put(bx, h + 1 + y, bz, logs, false);
            let radius = 0;
            for (let y = height - 1; y >= 2; y--) {
              const layer = height - 1 - y;
              radius = layer % 2 === 0 ? Math.min(2, 1 + ((layer / 2) | 0)) : 1;
              for (let lx = -radius; lx <= radius; lx++) for (let lz = -radius; lz <= radius; lz++) {
                if (Math.abs(lx) === radius && Math.abs(lz) === radius && radius > 1 && (layer % 4 === 0)) continue;
                put(bx + lx, h + 1 + y, bz + lz, leaves, false);
              }
            }
            put(bx, h + 1 + height, bz, leaves, false);
            put(bx, h + 2 + height, bz, leaves, false);
          } else if (type === 'jungle') {
            for (let y = 0; y < height; y++) put(bx, h + 1 + y, bz, logs, false);
            const top = h + height;
            for (let dy = -2; dy <= 1; dy++) {
              const rr = dy <= -1 ? 3 : 2;
              for (let lx = -rr; lx <= rr; lx++) for (let lz = -rr; lz <= rr; lz++) {
                if (lx * lx + lz * lz > rr * rr + 1) continue;
                put(bx + lx, top + dy, bz + lz, leaves, false);
              }
            }
            for (let i = 0; i < 4; i++) {
              const lx = ((r() * 5) | 0) - 2, lz = ((r() * 5) | 0) - 2;
              put(bx + lx, top - 2 - ((r() * 3) | 0), bz + lz, leaves, false);
            }
          } else if (type === 'acacia') {
            for (let y = 0; y < height; y++) put(bx, h + 1 + y, bz, logs, false);
            const bendX = r() < 0.5 ? 1 : -1;
            put(bx + bendX, h + height, bz, logs, false);
            put(bx + bendX, h + height + 1, bz, logs, false);
            const top = h + height + 2;
            for (let dy = -1; dy <= 1; dy++) {
              const rr = dy === 1 ? 1 : 2;
              for (let lx = -rr; lx <= rr; lx++) for (let lz = -rr; lz <= rr; lz++) {
                put(bx + bendX + lx, top + dy, bz + lz, leaves, false);
              }
            }
          } else {
            for (let y = 0; y < height; y++) put(bx, h + 1 + y, bz, logs, false);
            const top = h + height;
            for (let dy = -2; dy <= 1; dy++) {
              const rr = dy >= 0 ? 1 : 2;
              for (let lx = -rr; lx <= rr; lx++) for (let lz = -rr; lz <= rr; lz++) {
                if (dy === 1 && Math.abs(lx) === 1 && Math.abs(lz) === 1) continue;
                if (Math.abs(lx) === rr && Math.abs(lz) === rr && rr > 1 && r() < 0.6) continue;
                put(bx + lx, top + dy, bz + lz, leaves, false);
              }
            }
          }
          // 树苗/草丛被树干覆盖
          put(bx, h, bz, TY.dirt, true);
        }
      }
    },

    genOres(cx, cz, blocks, heights, rnd) {
      const TY = this.TYPES;
      const put = (lx, y, lz, id, chance) => {
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
        const i = (y * CHUNK + lz) * CHUNK + lx;
        if (blocks[i] !== TY.stone && blocks[i] !== TY.granite && blocks[i] !== TY.diorite && blocks[i] !== TY.andesite) return;
        if (chance !== undefined && rnd() > chance) return;
        blocks[i] = id;
      };
      const vein = (id, count, minY, maxY, size, chance) => {
        for (let n = 0; n < count; n++) {
          const ox = (rnd() * CHUNK) | 0, oz = (rnd() * CHUNK) | 0;
          const oy = minY + ((rnd() * (maxY - minY)) | 0);
          const s = 1 + ((rnd() * size) | 0);
          for (let i = 0; i < s * 3; i++) {
            const lx = ox + (((rnd() * 3) | 0) - 1), lz = oz + (((rnd() * 3) | 0) - 1), y = oy + (((rnd() * 3) | 0) - 1);
            put(lx, y, lz, id, chance);
          }
        }
      };
      vein(TY.coal_ore, 14, 6, 110, 6, 0.85);
      vein(TY.iron_ore, 12, 5, 68, 4, 0.8);
      vein(TY.copperOre || TY.iron_ore, 0, 0, 0, 0);
      vein(TY.gold_ore, 3, 5, 34, 3, 0.7);
      vein(TY.redstone_ore, 6, 4, 18, 4, 0.7);
      vein(TY.diamond_ore, 2, 3, 16, 3, 0.6);
      vein(TY.lapis_ore, 2, 5, 32, 3, 0.6);
      vein(TY.emerald_ore, 1, 5, 40, 2, 0.35);
    }
  };
})(window.MC);

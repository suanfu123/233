/* ============================================================
 *  hud.js — 2D 界面 (物品栏 / 菜单 / 调试信息 / 聊天)
 * ============================================================ */
(function (MC) {
  'use strict';

  const F = () => MC.Font;

  /* widgets.png 中确认过的坐标 */
  const W_HOTBAR = [0, 0, 182, 22];
  const W_SELECT = [0, 22, 24, 24];
  const W_BTN = [0, 66, 200, 20];
  const W_BTN_HOVER = [0, 86, 200, 20];
  const W_BTN_DISABLED = [0, 46, 200, 20];

  const CATEGORIES = ['建筑', '自然', '红石', '功能', '装饰'];

  /* 图标染色 (原版平原生物群系色), 用于顶面/树叶/藤蔓这类灰度贴图 */
  const ICON_TINT = {
    grass: 'rgb(145,189,89)',    // 0x91BD59
    foliage: 'rgb(119,171,47)',  // 0x77AB2F
    water: 'rgb(63,118,228)'     // 0x3F76E4
  };
  /* 面序号 0..5 = down/up/north/south/west/east */
  const FACE_SHADE6 = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

  function classify(id) {
    if (/redstone|piston|dispenser|dropper|observer|target|tnt|lamp|lever|button|rail|hopper|note_block|jukebox|comparator|repeater|redstone_torch|redstone_lamp|redstone_wire|tripwire_hook|trapped_chest|daylight_detector|sculk_sensor/.test(id)) return 2;
    if (/banner|sign|flower_pot|bed|skull|head|candle|cake|armor_stand|item_frame|painting|lead|bell|conduit|beacon/.test(id)) return 4;
    if (/torch|lantern|campfire|glowstone|sea_lantern|shroomlight|chain|end_rod|scaffolding|cobweb|chest|crafting|furnace|smoker|barrel|bookshelf|anvil|loom|grindstone|stonecutter|composter|cauldron|lectern|blast_furnace|cartography_table|fletching_table|smithing_table|turtle_egg|lightning_rod|sculk|glass_pane|iron_bars|fence|fence_gate|door|trapdoor|button|lever|pressure_plate|tripwire/.test(id)) return 3;
    if (/grass|leaves|flower|sapling|mushroom|vine|kelp|seagrass|cactus|bamboo|dirt|podzol|mycelium|snow|ice|water|lava|clay|gravel|dandelion|poppy|tulip|daisy|cornflower|lily|sunflower|lilac|rose|peony|dead_bush|sugar_cane|lily_pad|pumpkin|melon|farmland|path|sand|nylium|wart|sponge|moss|azalea|dripleaf|glow_lichen|tall_grass|fern|large_fern|bush/.test(id)) return 1;
    return 0;
  }

  class Hud {
    constructor(canvas, textures) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.tex = textures;
      this.scale = 3;
      this.w = 0; this.h = 0;
      this.screen = 'game';
      this.hotbar = new Array(9).fill(null);
      this.selected = 0;
      this.messages = [];
      this.chatActive = false;
      this.chatInput = '';
      this.debug = false;
      this.itemNameTimer = 0;
      this.mouseX = 0; this.mouseY = 0;
      this.scroll = 0;
      this.category = 0;
      this.hoverSlot = -1;
      this.buttons = [];
      this.sliderDrag = null;
      this.toast = null;
      this.deathMsg = '';
      this.fpsHistory = [];
      /* 图标缓存: 贴图帧 / 染色帧 / 整个图标 */
      this._frames = new Map();
      this._tints = new Map();
      this._icons = new Map();
      this.buildCategories();
      this.resize();
    }

    buildCategories() {
      this.categories = CATEGORIES.map(() => []);
      const seen = new Set();
      for (const b of MC.Blocks.byType) {
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        if (b.id === 'bedrock' || b.id === 'air' || b.id === 'cave_air' || b.id === 'void_air' || b.id === 'barrier' || b.id === 'piston_head' || b.id === 'moving_piston' || b.id === 'light') continue;
        this.categories[classify(b.id)].push(b.type);
      }
      this.allBlocks = this.categories.reduce((a, c) => a.concat(c), []);
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = window.innerWidth, cssH = window.innerHeight;
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      let base = Math.max(2, Math.min(4, Math.floor(Math.min(cssW / 320, cssH / 240))));
      if (this.forcedScale) base = this.forcedScale;
      this.guiScale = base;
      this.scale = dpr * base;
      this.w = this.canvas.width / this.scale;
      this.h = this.canvas.height / this.scale;
      this.dpr = dpr;
    }

    /* ---------- 输入坐标转换 ---------- */
    toLogical(cx, cy) {
      return [cx * this.dpr / this.scale, cy * this.dpr / this.scale];
    }

    /* ---------- 绘制工具 ---------- */
    btn(x, y, w, h, label, enabled) {
      const ctx = this.ctx;
      const img = this.tex.gui.widgets;
      const hover = this.mouseX >= x && this.mouseX <= x + w && this.mouseY >= y && this.mouseY <= y + h;
      const src = !enabled ? W_BTN_DISABLED : (hover ? W_BTN_HOVER : W_BTN);
      if (img) {
        ctx.drawImage(img, src[0], src[1], src[2], src[3], x, y, w, h);
      } else {
        ctx.fillStyle = hover ? '#7a7a7a' : '#6c6c6c';
        ctx.fillRect(x, y, w, h);
      }
      const col = enabled ? (hover ? '#ffffa0' : '#e0e0e0') : '#a0a0a0';
      const tw = F().width(label, 1);
      F().draw(ctx, label, x + (w - tw) / 2, y + (h - 8) / 2, { scale: 1, color: col, shadow: true });
      return { x, y, w, h, label, enabled };
    }

    panel(x, y, w, h) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }

    slotBg(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(20,20,20,0.85)';
      ctx.fillRect(x, y, 18, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y, 18, 1); ctx.fillRect(x, y, 1, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y + 17, 18, 1); ctx.fillRect(x + 17, y, 1, 18);
    }

    /* ---------- 方块图标 ----------
     * 直接用方块模型的多边形做等轴测投影, 而不是硬编码立方体。
     * 这里修掉了旧实现的几个致命问题:
     *   1. drawImage(img, x, y, 16, 16) 是 5 参数版, 会把整张图缩放成 16x16;
     *      水/岩浆/海草/海带是 16x512 这类竖向动画条, 于是被压成一条糊掉 ->
     *      "所有方块都有些扁"。现在统一只取第一帧 16x16。
     *   2. 草方块顶面/树叶/藤蔓/睡莲的贴图本身是灰度的, 必须乘生物群系染色,
     *      否则图标是灰的。
     *   3. 草方块侧面贴图在原版里本来就是"草在上", 旧的翻转 hack 把它倒过来了。
     *   4. 玻璃板/栅栏/台阶等非完整方块按模型真实形状绘制, 不再是平板。
     */
    frameTex(name) {
      if (!name) return null;
      let cv = this._frames.get(name);
      if (cv !== undefined) return cv;
      const img = this.tex.img(name);
      if (!img) { this._frames.set(name, null); return null; }
      const c0 = document.createElement('canvas');
      c0.width = 16; c0.height = 16;
      const c = c0.getContext('2d');
      c.imageSmoothingEnabled = img.width > 16;
      /* 只取第一帧: 竖向动画贴图 (16xN / 32xN) 的第 0 帧在左上角, 取正方形 */
      const fs = Math.min(img.width, img.height) || 16;
      c.drawImage(img, 0, 0, fs, fs, 0, 0, 16, 16);
      this._frames.set(name, c0);
      return c0;
    }

    tintedTex(name, color) {
      const key = name + '|' + color;
      let cv = this._tints.get(key);
      if (cv !== undefined) return cv;
      const src = this.frameTex(name);
      if (!src) { this._tints.set(key, null); return null; }
      const c0 = document.createElement('canvas');
      c0.width = 16; c0.height = 16;
      const c = c0.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(src, 0, 0);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = color;
      c.fillRect(0, 0, 16, 16);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(src, 0, 0);
      this._tints.set(key, c0);
      return c0;
    }

    /** 该面实际要用的贴图 (含染色) */
    faceTex(q, def) {
      if (!q || !q.name) return null;
      let color = null;
      if (def.liquid) color = def.id === 'water' ? ICON_TINT.water : null;
      else if (q.tint >= 0 && def.tint === 'grass') color = ICON_TINT.grass;
      else if (q.tint >= 0 && def.tint === 'foliage') color = ICON_TINT.foliage;
      return color ? this.tintedTex(q.name, color) : this.frameTex(q.name);
    }

    iconCanvas(type, vi, px) {
      const key = type + ':' + vi + ':' + px;
      let cached = this._icons.get(key);
      if (cached !== undefined) return cached;
      this._icons.set(key, null);
      const def = MC.Blocks.byType[type];
      if (!def) return null;
      const geo = def.liquid ? MC.Blocks.fluidGeo(type, 0) : MC.Blocks.geo(type, vi);
      if (!geo || !geo.quads.length) return null;

      const cv = document.createElement('canvas');
      cv.width = px; cv.height = px;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;

      /* --- 十字/平面植物: 贴图直接铺满 (原版物品栏也是平铺的) --- */
      if (def.kind === 'plant') {
        const q = geo.quads[0];
        const img = this.faceTex(q, def);
        if (img) c.drawImage(img, 0, 0, 16, 16, 0, 0, px, px);
        this._icons.set(key, cv);
        return cv;
      }

      /* --- 其余: 真实模型 + 2:1 等轴测投影, 按设备像素渲染 ---
       * 先在 16x16 里画再放大到槽位是"糊"的根源: 一个立方体的侧面在 16x16 里
       * 只有 16x8 像素, 16x16 的贴图要先丢掉一半行, 再被放大 2~3 倍。
       * 现在按目标设备像素直接渲染 (px), 贴图 1:1 落到像素上。 */
      const S = px / 16;
      const half = px / 2;
      const P = (ax, ay, az) => [(ax - az) * 8 * S + half, (ax + az) * 4 * S - ay * 8 * S + half];
      const items = [];
      for (let i = 0; i < geo.quads.length; i++) {
        const q = geo.quads[i];
        const pts = [];
        let depth = 0;
        for (let v = 0; v < 4; v++) {
          const ax = q.p[v * 3], ay = q.p[v * 3 + 1], az = q.p[v * 3 + 2];
          pts.push(P(ax, ay, az));
          depth += ax + ay + az;
        }
        items.push({ q, pts, depth: depth / 4 });
      }
      items.sort((a, b) => a.depth - b.depth);   // 远的先画

      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const q = it.q, pts = it.pts;
        const img = this.faceTex(q, def);
        if (!img) continue;
        const u0 = q.uv[0], v0 = q.uv[1];
        const du1 = (q.uv[2] - u0) * 16, dv1 = (q.uv[3] - v0) * 16;
        const du3 = (q.uv[6] - u0) * 16, dv3 = (q.uv[7] - v0) * 16;
        const det = du1 * dv3 - du3 * dv1;
        if (Math.abs(det) < 1e-6) continue;
        const sx1 = pts[1][0] - pts[0][0], sy1 = pts[1][1] - pts[0][1];
        const sx3 = pts[3][0] - pts[0][0], sy3 = pts[3][1] - pts[0][1];
        const a = (sx1 * dv3 - sx3 * dv1) / det;
        const cc = (du1 * sx3 - du3 * sx1) / det;
        const b = (sy1 * dv3 - sy3 * dv1) / det;
        const d = (du1 * sy3 - du3 * sy1) / det;
        const e = pts[0][0] - (a * u0 * 16 + cc * v0 * 16);
        const f = pts[0][1] - (b * u0 * 16 + d * v0 * 16);

        c.save();
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        c.lineTo(pts[1][0], pts[1][1]);
        c.lineTo(pts[2][0], pts[2][1]);
        c.lineTo(pts[3][0], pts[3][1]);
        c.closePath();
        c.clip();
        c.setTransform(a, b, cc, d, e, f);
        c.drawImage(img, 0, 0);
        c.restore();

        /* 面向光线的明暗 (与原版物品栏一致: 顶 1.0 / 左 0.8 / 右 0.6) */
        const sh = FACE_SHADE6[q.face];
        if (sh < 0.999) {
          c.beginPath();
          c.moveTo(pts[0][0], pts[0][1]);
          c.lineTo(pts[1][0], pts[1][1]);
          c.lineTo(pts[2][0], pts[2][1]);
          c.lineTo(pts[3][0], pts[3][1]);
          c.closePath();
          c.fillStyle = 'rgba(0,0,0,' + (1 - sh).toFixed(3) + ')';
          c.fill();
        }
      }
      this._icons.set(key, cv);
      return cv;
    }

    icon(type, x, y, s, vi) {
      const ctx = this.ctx;
      /* 当前变换的缩放 (DPR × 界面缩放), 图标按设备像素渲染才不会发糊 */
      let k = 1;
      try { const m = ctx.getTransform(); if (m && Math.abs(m.a) > 1e-6) k = Math.abs(m.a); } catch (e) { k = 1; }
      const px = Math.max(16, Math.round(16 * s * k));
      const cv = this.iconCanvas(type, vi | 0, px);
      if (!cv) return;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cv, 0, 0, px, px, x, y, 16 * s, 16 * s);
      ctx.imageSmoothingEnabled = smooth;
    }

    /* ---------- 主绘制 ---------- */
    draw(game) {
      this._draws = (this._draws || 0) + 1;
      const ctx = this.ctx;
      const tex = this.tex;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.imageSmoothingEnabled = false;

      const w = this.w, h = this.h;

      if (this.testFill) {
        ctx.fillStyle = 'rgba(255,0,0,0.5)';
        ctx.fillRect(0, 0, w, h);
      }

      if (this.screen === 'game' || this.screen === 'chat') {
        this.drawCrosshair(w, h);
        this.drawHotbar(w, h);
        if (game.player.mode === 'survival') this.drawStatus(w, h, game.player);
        if (this.debug) this.drawDebug(game);
        this.drawMessages(w, h);
        if (this.chatActive) this.drawChatInput(w, h);
        if (this.itemNameTimer > 0) this.drawItemName(w, h);
        if (this.toast) this.drawToast(w, h);
        if (game.player.health <= 0) this.drawDeath(w, h, game);
      } else if (this.screen === 'inventory') {
        this.drawCrosshair(w, h, true);
        this.drawInventory(w, h, game);
      } else if (this.screen === 'pause') {
        this.drawPause(w, h, game);
      } else if (this.screen === 'options') {
        this.drawOptions(w, h, game);
      }

    }

    drawCrosshair(w, h, dim) {
      const ctx = this.ctx;
      const img = this.tex.gui.icons;
      const cx = Math.round(w / 2 - 8), cy = Math.round(h / 2 - 8);
      ctx.globalAlpha = dim ? 0.5 : 1;
      if (img) ctx.drawImage(img, 0, 0, 16, 16, cx, cy, 16, 16);
      ctx.globalAlpha = 1;
    }

    drawHotbar(w, h) {
      const ctx = this.ctx;
      const x = Math.round((w - 182) / 2), y = h - 22;
      if (this.tex.gui.widgets) ctx.drawImage(this.tex.gui.widgets, W_HOTBAR[0], W_HOTBAR[1], W_HOTBAR[2], W_HOTBAR[3], x, y, 182, 22);
      for (let i = 0; i < 9; i++) {
        const sx = x + 3 + i * 20, sy = y + 3;
        const item = this.hotbar[i];
        if (item) {
          this.icon(item.type, sx, sy, 1);
          if (item.count > 1) {
            F().draw(ctx, String(item.count), sx + 17 - F().width(String(item.count), 1), sy + 9, { scale: 1, color: '#ffffff', shadow: true });
          }
        }
      }
      if (this.tex.gui.widgets) {
        ctx.drawImage(this.tex.gui.widgets, W_SELECT[0], W_SELECT[1], W_SELECT[2], W_SELECT[3], x - 1 + this.selected * 20, y - 1, 24, 24);
      }
    }

    drawStatus(w, h, player) {
      const ctx = this.ctx;
      const img = this.tex.gui.icons;
      const x0 = Math.round((w - 182) / 2), y0 = h - 22 - 12;
      if (!img) return;
      for (let i = 0; i < 10; i++) {
        const x = x0 + i * 8, y = y0;
        const hp = player.health - i * 2;
        let sx = 16;
        if (hp <= 0) sx = 34; else if (hp === 1) sx = 25;
        ctx.drawImage(img, sx, 0, 9, 9, x, y, 9, 9);
      }
    }

    drawDebug(game) {
      const ctx = this.ctx;
      const p = game.player;
      const w = this.w;
      const lines = [];
      lines.push('Minecraft 1.16.5 (Web)  ' + game.fps + ' fps');
      lines.push('T: ' + (game.fps > 0 ? (1000 / game.fps).toFixed(1) : '0') + 'ms  chunks: ' + game.world.stats.chunks + '  gen/f: ' + game.world.stats.genPerFrame + '  mesh/f: ' + game.world.stats.meshPerFrame);
      lines.push('draw calls: ' + game.renderer.drawCalls + '  tris: ' + (game.renderer.triangles / 1000).toFixed(0) + 'k');
      lines.push('');
      lines.push('XYZ: ' + p.pos[0].toFixed(2) + ' / ' + p.pos[1].toFixed(2) + ' / ' + p.pos[2].toFixed(2));
      lines.push('Block: ' + Math.floor(p.pos[0]) + ' ' + Math.floor(p.pos[1]) + ' ' + Math.floor(p.pos[2]));
      lines.push('Chunk: ' + Math.floor(p.pos[0] / 16) + ' ' + Math.floor(p.pos[2] / 16) + '  (in ' + ((p.pos[0] % 16 + 16) % 16).toFixed(1) + ' ' + ((p.pos[2] % 16 + 16) % 16).toFixed(1) + ')');
      const f = p.forward();
      const dirs = ['south', 'west', 'north', 'east'];
      const yawDeg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
      lines.push('Facing: ' + dirs[Math.round(yawDeg / 90) % 4] + ' (' + yawDeg.toFixed(1) + ' / ' + (-p.pitch * 180 / Math.PI).toFixed(1) + ')');
      const bio = game.world.biomeAt(Math.floor(p.pos[0]), Math.floor(p.pos[2]));
      lines.push('Biome: ' + (bio ? bio.name : '?') + '   Light: ' + ((game.world.getLightFast(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1), Math.floor(p.pos[2])) >> 4)) + ' sky / ' + (game.world.getLightFast(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 1), Math.floor(p.pos[2])) & 15) + ' block');
      lines.push('Time: ' + ((game.worldTime % 24000) / 1000).toFixed(2) + '  Day: ' + Math.floor(game.worldTime / 24000));
      lines.push('Mode: ' + (p.mode === 'creative' ? '创造' : '生存') + (p.flying ? ' (飞行)' : '') + '   Seed: ' + game.seed);
      if (game.target) {
        const b = MC.Blocks.byType[game.target.type];
        lines.push('');
        lines.push('Looking at: ' + (b ? b.name : '?') + '  ' + game.target.x + ' ' + game.target.y + ' ' + game.target.z);
      }
      if (performance.memory) {
        lines.push('');
        lines.push('Mem: ' + (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + '/' + (performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB');
      }
      let y = 2;
      for (const l of lines) {
        if (l) F().draw(ctx, l, 2, y, { scale: 1, color: '#ffffff', shadow: true, shadowColor: '#1b1b1b' });
        y += 10;
      }
    }

    drawMessages(w, h) {
      const ctx = this.ctx;
      const baseY = h - 46 - (this.chatActive ? 0 : 0);
      let y = baseY;
      const list = this.messages.slice(-10);
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        const alpha = this.chatActive ? 1 : MC.clamp(m.life / 20, 0, 1);
        F().draw(ctx, m.text, 2, y, { scale: 1, color: '#ffffff', shadow: true, alpha });
        y -= 10;
      }
    }

    drawChatInput(w, h) {
      const ctx = this.ctx;
      const y = h - 34;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(2, y - 1, w - 4, 12);
      F().draw(ctx, '> ' + this.chatInput + '_', 4, y + 1, { scale: 1, color: '#ffffff', shadow: true });
    }

    drawItemName(w, h) {
      const item = this.hotbar[this.selected];
      if (!item) return;
      const def = MC.Blocks.byType[item.type];
      if (!def) return;
      const alpha = MC.clamp(this.itemNameTimer / 20, 0, 1);
      const tw = F().width(def.name, 1);
      F().draw(this.ctx, def.name, Math.round(w / 2 - tw / 2), h - 40, { scale: 1, color: '#ffffff', shadow: true, alpha });
    }

    drawToast(w, h) {
      const t = this.toast;
      if (!t) return;
      const alpha = MC.clamp(t.life / 20, 0, 1);
      const tw = F().width(t.text, 1);
      this.ctx.fillStyle = 'rgba(0,0,0,' + (0.5 * alpha) + ')';
      this.ctx.fillRect(w / 2 - tw / 2 - 6, h / 2 - 40, tw + 12, 16);
      F().draw(this.ctx, t.text, Math.round(w / 2 - tw / 2), h / 2 - 36, { scale: 1, color: '#ffff88', shadow: true, alpha });
    }

    drawDeath(w, h, game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(96,0,0,0.55)';
      ctx.fillRect(0, 0, w, h);
      const t1 = '你死了！';
      const t2 = '点击屏幕重生';
      F().drawShadowed(ctx, t1, Math.round(w / 2 - F().width(t1, 3) / 2), h / 2 - 40, 3, '#ffffff');
      F().draw(ctx, t2, Math.round(w / 2 - F().width(t2, 1) / 2), h / 2 + 10, { scale: 1, color: '#ffff55', shadow: true });
    }

    /* ---------- 物品栏 (创造模式) ----------
     * 面板/槽位/标签全部使用原版 GUI 贴图:
     *   gui/container/creative_inventory/tab_items.png  195x136, 槽位已烘焙在图里
     *     -> 9x5 主格位于 (9,18), 步长 18; 快捷栏一行位于 (9,112)
     *   gui/container/creative_inventory/tabs.png       28x32 x 6 个标签, 第二排 (y=32) 是选中态
     */
    invLayout() {
      const pw = 195, ph = 136;
      return {
        x: Math.round((this.w - pw) / 2),
        y: Math.round((this.h - ph) / 2) + 10,
        w: pw, h: ph,
        gridX: 9, gridY: 18, barY: 112,
        slot: 18, cols: 9, rows: 5
      };
    }

    slotFace(x, y, s) {
      const ctx = this.ctx;
      ctx.fillStyle = '#8b8b8b';
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(55,55,55,0.9)';
      ctx.fillRect(x, y, s, 1); ctx.fillRect(x, y, 1, s);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x, y + s - 1, s, 1); ctx.fillRect(x + s - 1, y, 1, s);
    }

    drawInventory(w, h, game) {
      const ctx = this.ctx;
      const L = this.invLayout();
      const px = L.x, py = L.y, pw = L.w, ph = L.h, cols = L.cols, rows = L.rows;
      const slot = L.slot;
      const gui = this.tex.gui;
      this.invRect = { x: px, y: py, w: pw, h: ph };
      this.slotRects = [];
      this.tabRects = [];

      /* 背景压暗 */
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, w, h);

      const list = this.categories[this.category];
      const perPage = cols * rows;
      const pages = Math.max(1, Math.ceil(list.length / perPage));
      this.scroll = MC.clamp(this.scroll, 0, pages - 1);
      const start = this.scroll * perPage;

      /* ---- 分类标签: 先画, 让面板盖住标签底部 4px (原版就是这样接缝的) ---- */
      const tabW = 28, tabH = 28;
      const tabsW = CATEGORIES.length * tabW;
      const tx0 = px + Math.round((pw - tabsW) / 2);
      for (let i = 0; i < CATEGORIES.length; i++) {
        const active = i === this.category;
        const tx = tx0 + i * tabW;
        const ty = py - (active ? tabH : tabH - 4);
        if (gui.tabs) ctx.drawImage(gui.tabs, (i % 6) * tabW, active ? 32 : 0, tabW, tabH, tx, ty, tabW, tabH);
        else { ctx.fillStyle = active ? '#c6c6c6' : '#8b8b8b'; ctx.fillRect(tx, ty, tabW, tabH); }
        const label = CATEGORIES[i];
        F().draw(ctx, label, tx + Math.round((tabW - F().width(label, 1)) / 2), ty + 10,
          { scale: 1, color: active ? '#3a3a3a' : '#595959' });
        this.tabRects.push({ x: tx, y: ty, w: tabW, h: tabH - 4, i });
      }

      /* ---- 主面板 (槽位已烘焙在贴图里) ---- */
      if (gui.creative) {
        ctx.drawImage(gui.creative, 0, 0, pw, ph, px, py, pw, ph);
      } else {
        ctx.fillStyle = '#c6c6c6';
        ctx.fillRect(px, py, pw, ph);
      }

      F().draw(ctx, '创造模式物品栏', px + 8, py + 6, { scale: 1, color: '#404040' });
      const pg = (this.scroll + 1) + '/' + pages;
      F().draw(ctx, pg, px + 168 - F().width(pg, 1), py + 6, { scale: 1, color: '#404040' });

      /* ---- 物品格 9x5 ---- */
      const mx = this.mouseX, my = this.mouseY;
      this.hoverSlot = -1;
      const gx = px + L.gridX, gy = py + L.gridY;
      for (let i = 0; i < cols * rows; i++) {
        const sx = gx + (i % cols) * slot, sy = gy + Math.floor(i / cols) * slot;
        const idx = start + i;
        if (idx >= list.length) continue;
        const type = list[idx];
        if (mx >= sx && mx < sx + slot && my >= sy && my < sy + slot) {
          ctx.fillStyle = 'rgba(255,255,255,0.52)';
          ctx.fillRect(sx + 1, sy + 1, slot - 2, slot - 2);
          this.hoverSlot = idx;
        }
        this.icon(type, sx + 1, sy + 1, 1);
        this.slotRects.push({ x: sx, y: sy, w: slot, h: slot, type, idx });
      }

      /* ---- 滚动条 (轨道是烘焙在面板贴图里的, 这里只画滑块) ---- */
      if (pages > 1) {
        const sbx = px + 176, sby = py + L.gridY, sbh = rows * slot;
        const th = Math.max(15, Math.round(sbh / pages));
        const ty2 = sby + Math.round((sbh - th) * (this.scroll / Math.max(1, pages - 1)));
        ctx.fillStyle = '#c6c6c6';
        ctx.fillRect(sbx, ty2, 12, th);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sbx, ty2, 12, 1); ctx.fillRect(sbx, ty2, 1, th);
        ctx.fillStyle = '#555555';
        ctx.fillRect(sbx, ty2 + th - 1, 12, 1); ctx.fillRect(sbx + 11, ty2, 1, th);
      }

      /* ---- 快捷栏一行 ---- */
      const by = py + L.barY;
      for (let i = 0; i < 9; i++) {
        const sx = gx + i * slot, sy = by;
        if (i === this.selected) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, slot - 1, slot - 1);
        }
        const item = this.hotbar[i];
        if (item && item.type) {
          this.icon(item.type, sx + 1, sy + 1, 1);
          if (item.count > 1) {
            const n = String(item.count);
            F().draw(ctx, n, sx + slot - 1 - F().width(n, 1), sy + slot - 9,
              { scale: 1, color: '#ffffff', shadow: true });
          }
        }
        this.slotRects.push({ x: sx, y: sy, w: slot, h: slot, hotbar: i, type: item ? item.type : 0 });
      }

      F().draw(ctx, '滚轮翻页 · 左键选取 · E 关闭', px + 8, py + ph + 5,
        { scale: 1, color: '#e0e0e0', shadow: true });

      /* ---- 悬停提示 (最后画, 保证在最上层) ---- */
      if (this.hoverSlot >= 0) {
        const t = list[this.hoverSlot];
        const def = MC.Blocks.byType[t];
        const name = (def && def.name) || (def && def.id) || '?';
        const tw = F().width(name, 1);
        const tx2 = MC.clamp(mx + 10, 2, w - tw - 10);
        const ty2 = my - 16;
        ctx.fillStyle = 'rgba(16,0,16,0.94)';
        ctx.fillRect(tx2 - 4, ty2 - 3, tw + 8, 14);
        ctx.strokeStyle = 'rgba(160,90,220,0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx2 - 3.5, ty2 - 2.5, tw + 7, 13);
        F().draw(ctx, name, tx2, ty2, { scale: 1, color: '#ffffff', shadow: true });
      }
    }

    /* ---------- 暂停 / 设置 ---------- */
    drawPause(w, h, game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, w, h);
      const t = '游戏已暂停';
      F().drawShadowed(ctx, t, Math.round(w / 2 - F().width(t, 2) / 2), h / 2 - 78, 2, '#ffffff');
      this.buttons = [];
      const bw = 200, bx = Math.round(w / 2 - bw / 2);
      let by = Math.round(h / 2 - 44);
      this.buttons.push(this.btn(bx, by, bw, 20, '回到游戏', true)); by += 24;
      this.buttons.push(this.btn(bx, by, bw, 20, '选项…', true)); by += 24;
      this.buttons.push(this.btn(bx, by, bw, 20, '保存并退出', true)); by += 24;
      this.buttons.push(this.btn(bx, by, bw, 20, '切换游戏模式', true));
      F().draw(ctx, 'MC 1.16.5 · 网页版', Math.round(w / 2 - F().width('MC 1.16.5 · 网页版', 1) / 2), h / 2 + 70, { scale: 1, color: '#808080', shadow: true });
    }

    drawOptions(w, h, game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, w, h);
      const t = '选项';
      F().drawShadowed(ctx, t, Math.round(w / 2 - F().width(t, 2) / 2), 24, 2, '#ffffff');
      this.buttons = [];
      this.sliders = [];
      const bw = 200, bx = Math.round(w / 2 - bw / 2);
      let by = 56;
      const slider = (label, val, min, max, step, fmt) => {
        const y = by;
        const x = bx;
        ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x, y, bw, 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, 19);
        const t = val / max;
        ctx.fillStyle = '#6f6f6f';
        ctx.fillRect(x + 1 + (bw - 10) * t, y + 1, 8, 18);
        const txt = label + ': ' + fmt(val);
        F().draw(ctx, txt, x + bw / 2 - F().width(txt, 1) / 2, y + 6, { scale: 1, color: '#ffffff', shadow: true });
        this.sliders.push({ x, y, w: bw, h: 20, min, max, step, val, set: (v) => { }, label });
        by += 24;
        return this.sliders[this.sliders.length - 1];
      };
      const toggle = (label, val) => {
        const y = by;
        const x = bx;
        const hover = this.mouseX >= x && this.mouseX <= x + bw && this.mouseY >= y && this.mouseY <= y + 20;
        ctx.fillStyle = hover ? '#5a5a5a' : '#3a3a3a'; ctx.fillRect(x, y, bw, 20);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, 19);
        const indicator = val ? '[x]' : '[ ]';
        const txt = label + ': ' + indicator;
        F().draw(ctx, txt, x + bw / 2 - F().width(txt, 1) / 2, y + 6, { scale: 1, color: '#ffffff', shadow: true });
        this.buttons.push({ x, y, w: bw, h: 20, label, toggle: true, val });
        by += 24;
      };

      slider('渲染距离', game.settings.renderDistance, 2, 24, 1, v => v + ' 区块').set = (v) => {
        game.settings.renderDistance = v; game.world.renderDistance = v;
      };
      slider('视野 FOV', game.settings.fovDeg, 40, 120, 1, v => v + '\u00b0').set = (v) => { game.settings.fovDeg = v; };
      slider('鼠标灵敏度', game.settings.sensitivity * 100, 10, 300, 5, v => (v / 100).toFixed(2)).set = (v) => { game.settings.sensitivity = v / 100; };
      slider('亮度', game.settings.brightness * 100, 20, 100, 5, v => v + '%').set = (v) => { game.settings.brightness = v / 100; };
      slider('界面缩放', game.settings.guiScale || this.guiScale, 1, 4, 1, v => v + 'x').set = (v) => {
        game.settings.guiScale = v; this.forcedScale = v; this.resize();
      };
      toggle('鼠标反转 Y 轴', !!game.settings.mouseInverted);
      by += 4;
      this.buttons.push(this.btn(bx, by, bw, 20, '完成', true)); by += 24;
      this.buttons.push(this.btn(bx, by, bw, 20, '全屏: ' + (document.fullscreenElement ? '开' : '关'), true)); by += 24;
      this.buttons.push(this.btn(bx, by, bw, 20, '恢复默认设置', true));
    }

    /* ---------- 消息 ---------- */
    addMessage(text) {
      this.messages.push({ text, life: 200 });
      if (this.messages.length > 100) this.messages.shift();
    }
    showToast(text) { this.toast = { text, life: 40 }; }

    tick(dt) {
      if (this.itemNameTimer > 0) this.itemNameTimer -= dt * 20;
      if (this.toast) { this.toast.life -= dt * 20; if (this.toast.life <= 0) this.toast = null; }
      for (let i = this.messages.length - 1; i >= 0; i--) {
        if (!this.chatActive) {
          this.messages[i].life -= dt * 20;
          if (this.messages[i].life <= 0) this.messages.splice(i, 1);
        }
      }
    }
  }

  MC.Hud = Hud;
})(window.MC);

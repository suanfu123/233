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
      this.buildCategories();
      this.resize();
    }

    buildCategories() {
      this.categories = CATEGORIES.map(() => []);
      const seen = new Set();
      for (const b of MC.Blocks.byType) {
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        if (b.id === 'water' || b.id === 'lava' || b.id === 'bedrock' || b.id === 'air' || b.id === 'cave_air' || b.id === 'void_air' || b.id === 'barrier' || b.id === 'piston_head' || b.id === 'moving_piston' || b.id === 'light') continue;
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

    /* ---------- 方块图标 (等轴测) ---------- */
    icon(type, x, y, s) {
      const ctx = this.ctx;
      const def = MC.Blocks.byType[type];
      if (!def) return;
      const top = this.tex.img(def.iconTop);
      const side = this.tex.img(def.iconSide);
      const all = this.tex.img(def.iconAll);
      if (!top && !side && !all) {
        ctx.fillStyle = '#f0f';
        ctx.fillRect(x, y, 16 * s, 16 * s);
        return;
      }
      const kind = def.kind;

      /* 非完整方块: 平面渲染 */
      if (kind === 'plant' || kind === 'none' || kind === 'facing' || (!top && !all)) {
        const img = all || side || top;
        if (img) ctx.drawImage(img, x, y, 16 * s, 16 * s);
        return;
      }

      /* 草方块侧面翻转 */
      let sideTex = side;
      if (def.id === 'grass_block') {
        if (!Hud._grassFlipCache) {
          const cv = document.createElement('canvas');
          cv.width = 16; cv.height = 16;
          const cx = cv.getContext('2d');
          cx.translate(0, 16); cx.scale(1, -1);
          if (side) cx.drawImage(side, 0, 0);
          Hud._grassFlipCache = cv;
        }
        sideTex = Hud._grassFlipCache;
      }

      const topTex = top || side;

      /* 绘制一个面: 把16x16贴图映射到四边形 */
      const quad = (tex, x0, y0, x1, y1, x2, y2, x3, y3, dark) => {
        if (!tex) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.closePath();
        ctx.clip();
        /* 仿射变换: 16x16 -> 四边形 */
        ctx.transform(
          (x1 - x0) / 16, (y1 - y0) / 16,
          (x3 - x0) / 16, (y3 - y0) / 16,
          x0, y0
        );
        ctx.drawImage(tex, 0, 0, 16, 16);
        ctx.restore();
        if (dark > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
          ctx.closePath();
          ctx.fillStyle = 'rgba(0,0,0,' + dark + ')';
          ctx.fill();
          ctx.restore();
        }
      };

      /*
       * 等轴测立方体, 填满 16x16
       * 顶面菱形: (0,4) (8,0) (16,4) (8,8)    — 16宽 x 8高
       * 左面:     (0,4) (8,8) (8,16) (0,12)   — 8宽 x 8高
       * 右面:     (8,8) (16,4) (16,12) (8,16) — 8宽 x 8高
       * 总范围: x=0..16, y=0..16
       */
      const bx = x, by = y;
      const hw = 8 * s;
      const hh = 4 * s;

      /* 顶面 */
      quad(topTex,
        bx, by + hh,
        bx + hw, by,
        bx + 2 * hw, by + hh,
        bx + hw, by + 2 * hh, 0);

      /* 左面 */
      quad(sideTex,
        bx, by + hh,
        bx + hw, by + 2 * hh,
        bx + hw, by + 2 * hh + 8 * s,
        bx, by + hh + 8 * s, 0.22);

      /* 右面 */
      quad(sideTex,
        bx + hw, by + 2 * hh,
        bx + 2 * hw, by + hh,
        bx + 2 * hw, by + hh + 8 * s,
        bx + hw, by + 2 * hh + 8 * s, 0.42);
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

    /* ---------- 物品栏 ---------- */
    drawInventory(w, h, game) {
      const ctx = this.ctx;
      const cols = 9, rows = 5;
      const slot = 18, pad = 1;
      const gridW = cols * (slot + pad) - pad;
      const panelW = gridW + 12;
      const panelH = rows * (slot + pad) - pad + 34;
      const px = Math.round((w - panelW) / 2), py = Math.round((h - panelH) / 2) - 8;
      this.invRect = { x: px, y: py, w: panelW, h: panelH };

      this.panel(px, py, panelW, panelH);
      F().draw(ctx, '创造模式物品栏', px + 6, py + 4, { scale: 1, color: '#dddddd', shadow: true });

      /* 分类标签 */
      const tabsY = py - 16;
      this.tabRects = [];
      for (let i = 0; i < CATEGORIES.length; i++) {
        const tw = F().width(CATEGORIES[i], 1) + 12;
        const tx = px + 4 + i * 0;
        const prev = this.tabRects[this.tabRects.length - 1];
        const x = prev ? prev.x + prev.w + 2 : px + 4;
        const active = i === this.category;
        const hover = this.mouseX >= x && this.mouseX <= x + tw && this.mouseY >= tabsY && this.mouseY <= tabsY + 14;
        ctx.fillStyle = active ? '#8b8b8b' : (hover ? '#6a6a6a' : '#3c3c3c');
        ctx.fillRect(x, tabsY, tw, active ? 18 : 14);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(x + 0.5, tabsY + 0.5, tw - 1, (active ? 18 : 14) - 1);
        F().draw(ctx, CATEGORIES[i], x + 6, tabsY + (active ? 4 : 3), { scale: 1, color: active ? '#ffffff' : '#c8c8c8', shadow: true });
        this.tabRects.push({ x, y: tabsY, w: tw, h: 18, i });
      }

      const list = this.categories[this.category];
      const perPage = cols * rows;
      const maxScroll = Math.max(0, Math.ceil(list.length / perPage) - 1);
      this.scroll = MC.clamp(this.scroll, 0, maxScroll);
      const start = this.scroll * perPage;

      this.slotRects = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = start + r * cols + c;
          const sx = px + 6 + c * (slot + pad), sy = py + 16 + r * (slot + pad);
          this.slotBg(sx, sy);
          if (idx < list.length) {
            const type = list[idx];
            this.icon(type, sx + 1, sy + 1, 1);
            this.slotRects.push({ x: sx, y: sy, w: slot, h: slot, type });
            if (this.mouseX >= sx && this.mouseX <= sx + slot && this.mouseY >= sy && this.mouseY <= sy + slot) {
              this.hoverSlot = idx;
              const def = MC.Blocks.byType[type];
              const name = def ? def.name : '?';
              const tw = F().width(name, 1);
              const tx = MC.clamp(this.mouseX + 8, 0, w - tw - 6), ty = this.mouseY - 14;
              ctx.fillStyle = 'rgba(16,0,16,0.92)';
              ctx.fillRect(tx - 3, ty - 2, tw + 6, 13);
              ctx.strokeStyle = 'rgba(90,30,140,0.9)';
              ctx.strokeRect(tx - 2.5, ty - 1.5, tw + 5, 12);
              F().draw(ctx, name, tx, ty + 1, { scale: 1, color: '#ffffff', shadow: true });
            }
          }
        }
      }

      /* 底部: 快捷栏 */
      const hy = py + panelH - 22;
      F().draw(ctx, '快捷栏', px + 6, hy - 12, { scale: 1, color: '#aaaaaa', shadow: true });
      for (let i = 0; i < 9; i++) {
        const sx = px + 6 + i * (slot + pad), sy = hy;
        this.slotBg(sx, sy);
        const item = this.hotbar[i];
        if (item) this.icon(item.type, sx + 1, sy + 1, 1);
        if (i === this.selected) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx - 0.5, sy - 0.5, slot + 1, slot + 1);
        }
        this.slotRects.push({ x: sx, y: sy, w: slot, h: slot, hotbar: i });
      }
      if (maxScroll > 0) {
        const sbx = px + panelW - 6, sby = py + 16, sbh = rows * (slot + pad) - pad;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sbx, sby, 4, sbh);
        const kh = Math.max(10, sbh / (maxScroll + 1));
        ctx.fillStyle = '#a0a0a0';
        ctx.fillRect(sbx, sby + (sbh - kh) * (this.scroll / maxScroll || 0), 4, kh);
      }
      F().draw(ctx, '滚轮翻页 · 左键选取 · E 关闭', px + 6, py + panelH - 10, { scale: 1, color: '#8a8a8a', shadow: true });
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

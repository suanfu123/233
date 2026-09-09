/* ============================================================
 *  font.js — 原版位图字体渲染
 *   · ascii.png       : ASCII 字形 (16x16 格, 每格 8x8)
 *   · glyph_sizes.bin : Unicode 字形宽度表
 *   · unicode_page_XX.png : Unicode 字形页 (16x16 格, 每格 16x16)
 * ============================================================ */
(function (MC) {
  'use strict';

  const CELL = 8;          // ascii 字形格子
  const SHEET_COLS = 16;
  const UCELL = 16;        // unicode 字形格子

  const tintCache = new Map();
  const pageTintCache = new Map();
  const pages = new Map();          // page -> canvas | null(加载失败)
  const pageLoading = new Set();

  let sheetCanvas = null;
  let sheetData = null;
  let glyphSizes = null;            // Uint8Array(65536)

  function glyphPos(c) { return [(c % SHEET_COLS) * CELL, ((c / SHEET_COLS) | 0) * CELL]; }

  /* ---------- 颜色着色 ---------- */
  function buildTint(color) {
    if (tintCache.has(color)) return tintCache.get(color);
    const c = document.createElement('canvas');
    c.width = sheetCanvas.width; c.height = sheetCanvas.height;
    const cx = c.getContext('2d');
    cx.drawImage(sheetCanvas, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    tintCache.set(color, c);
    if (tintCache.size > 64) tintCache.delete(tintCache.keys().next().value);
    return c;
  }

  /* ---------- Unicode 页加载 (按需) ---------- */
  function loadPage(page) {
    const hex = page.toString(16).padStart(2, '0');
    const img = new Image();
    pageLoading.add(page);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      pages.set(page, c);
      pageLoading.delete(page);
    };
    img.onerror = () => { pages.set(page, null); pageLoading.delete(page); };
    img.src = 'assets/minecraft/textures/font/unicode_page_' + hex + '.png';
    return null;
  }

  function getPage(page) {
    if (pages.has(page)) return pages.get(page);
    if (!pageLoading.has(page)) loadPage(page);
    return null;
  }

  function tintedPage(page, color, canvas) {
    const key = page + '|' + color;
    if (pageTintCache.has(key)) return pageTintCache.get(key);
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const cx = c.getContext('2d');
    cx.drawImage(canvas, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    pageTintCache.set(key, c);
    if (pageTintCache.size > 24) pageTintCache.delete(pageTintCache.keys().next().value);
    return c;
  }

  /** 收集字符串需要的 unicode 页并预加载 */
  function preloadPages(text) {
    if (!glyphSizes) return;
    const set = new Set();
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 128) set.add(c >> 8);
    }
    set.forEach((p) => { if (!pages.has(p)) getPage(p); });
  }

  /** 某个字符的 unicode 度量, 返回 {start,end,w} 或 null */
  function uniMetrics(c) {
    if (!glyphSizes || c < 128 || c > 65535) return null;
    const b = glyphSizes[c];
    if (!b) return null;
    const start = b >> 4, end = b & 15;
    if (end < start) return null;
    return { start, end, w: (end - start + 1) * 0.5 };   // 16px 格子按 0.5 缩放
  }

  const MC_Font = MC.Font = {
    lineHeight: 9,
    height: 8,
    ready: false,

    init(img, sizesBuffer) {
      sheetCanvas = document.createElement('canvas');
      sheetCanvas.width = img.width;
      sheetCanvas.height = img.height;
      const cx = sheetCanvas.getContext('2d');
      cx.drawImage(img, 0, 0);
      try { sheetData = cx.getImageData(0, 0, img.width, img.height).data; } catch (e) { sheetData = null; }
      if (sizesBuffer) glyphSizes = new Uint8Array(sizesBuffer);

      for (let c = 0; c < 256; c++) {
        if (!sheetData) { this.widths[c] = c === 32 ? 4 : 5; continue; }
        const [gx, gy] = glyphPos(c);
        let w = 0;
        for (let x = CELL - 1; x >= 0; x--) {
          let any = false;
          for (let y = 0; y < CELL; y++) {
            const a = sheetData[(((gy + y) * sheetCanvas.width) + gx + x) * 4 + 3];
            if (a > 8) { any = true; break; }
          }
          if (any) { w = x + 1; break; }
        }
        if (c === 32) w = 4;
        this.widths[c] = w;
      }
      this.ready = true;
    },
    widths: new Uint8Array(256),

    charWidth(c, scale) {
      scale = scale || 1;
      if (c >= 128) {
        const m = uniMetrics(c);
        if (m) return (m.w + 1) * scale;
      }
      return ((this.widths[c] || 0) + 1) * scale;
    },

    /** 纯文本宽度 (忽略 § 格式码) */
    width(text, scale) {
      scale = scale || 1;
      let w = 0, bold = false;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 167 && i + 1 < text.length) {
          const n = text[i + 1];
          if (n === 'l') bold = true;
          else if (n === 'r') bold = false;
          i++;
          continue;
        }
        if (c >= 128) {
          const m = uniMetrics(c);
          w += m ? m.w + 1 : 8;
        } else {
          w += (this.widths[c] || 0) + 1;
        }
        if (bold) w += 1;
      }
      return w * scale;
    },

    preload(text) { preloadPages(text); },

    draw(ctx, text, x, y, opts) {
      opts = opts || {};
      const scale = opts.scale || 1;
      const color = opts.color || '#ffffff';
      const shadow = opts.shadow !== false;
      const alpha = opts.alpha === undefined ? 1 : opts.alpha;
      const tint = buildTint(color);
      const shadowTint = shadow ? buildTint(opts.shadowColor || '#3f3f3f') : null;

      let px = x, py = y;
      let curColor = color, curTint = tint, bold = false, underline = false;
      ctx.save();
      ctx.globalAlpha = alpha;

      const drawAscii = (c, dx, dy, tn) => {
        const [gx, gy] = glyphPos(c);
        ctx.drawImage(tn, gx, gy, CELL, CELL, Math.round(dx), Math.round(dy), CELL * scale, CELL * scale);
        if (bold) ctx.drawImage(tn, gx, gy, CELL, CELL, Math.round(dx + scale), Math.round(dy), CELL * scale, CELL * scale);
      };

      /* 兜底: 未加载到 Unicode 字体表时用系统字体绘制 */
      const drawFallback = (c, dx, dy, col) => {
        ctx.font = (8 * scale) + 'px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
        ctx.fillStyle = col;
        ctx.textBaseline = 'top';
        ctx.fillText(String.fromCharCode(c), dx, dy);
      };

      const drawUni = (c, dx, dy, col) => {
        const m = uniMetrics(c);
        if (!m) { if (!glyphSizes) drawFallback(c, dx, dy, col); return; }
        const canvas = getPage(c >> 8);
        if (!canvas) return;
        const sx = (c & 15) * UCELL + m.start, sy = ((c >> 4) & 15) * UCELL;
        const sw = (m.end - m.start + 1);
        const dw = sw * 0.5 * scale, dh = 8 * scale;
        const tn = tintedPage(c >> 8, col, canvas);
        ctx.drawImage(tn, sx, sy, sw, UCELL, Math.round(dx), Math.round(dy), dw, dh);
        if (bold) ctx.drawImage(tn, sx, sy, sw, UCELL, Math.round(dx + scale), Math.round(dy), dw, dh);
      };

      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 167 && i + 1 < text.length) {
          const n = text[i + 1]; i++;
          if (n === 'l') bold = true;
          else if (n === 'n') underline = true;
          else if (n === 'r') { bold = underline = false; curColor = color; curTint = tint; }
          else {
            const map = {
              '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa',
              '6': '#ffaa00', '7': '#aaaaaa', '8': '#555555', '9': '#5555ff', 'a': '#55ff55', 'b': '#55ffff',
              'c': '#ff5555', 'd': '#ff55ff', 'e': '#ffff55', 'f': '#ffffff'
            };
            if (map[n]) { curColor = map[n]; curTint = buildTint(curColor); }
          }
          continue;
        }
        if (c === 10) { px = x; py += MC_Font.lineHeight * scale; continue; }

        if (c >= 128) {
          const m = uniMetrics(c);
          const w = m ? m.w : 8;
          if (shadow) drawUni(c, px + scale, py + scale, opts.shadowColor || '#3f3f3f');
          drawUni(c, px, py, curColor);
          if (underline) { ctx.fillStyle = curColor; ctx.fillRect(px, py + 8 * scale, w * scale, scale); }
          px += (w + 1) * scale + (bold ? scale : 0);
        } else {
          const w = this.widths[c] || 0;
          if (shadowTint) drawAscii(c, px + scale, py + scale, shadowTint);
          drawAscii(c, px, py, curTint);
          if (underline && w > 0) { ctx.fillStyle = curColor; ctx.fillRect(px, py + 8 * scale, (w + 1) * scale, scale); }
          px += (w + 1) * scale + (bold ? scale : 0);
        }
      }
      ctx.restore();
    },

    drawShadowed(ctx, text, x, y, scale, color) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      MC_Font.draw(ctx, text, x + scale * 2, y + scale * 2, { scale, color: '#000000', shadow: false });
      ctx.restore();
      MC_Font.draw(ctx, text, x, y, { scale, color: color || '#ffffff', shadow: true });
    },

    wrap(text, maxWidth, scale) {
      const words = text.split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        if (MC_Font.width(test, scale) > maxWidth && cur) { lines.push(cur); cur = w; }
        else cur = test;
      }
      if (cur) lines.push(cur);
      return lines;
    }
  };
})(window.MC);

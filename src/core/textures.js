/* ============================================================
 *  textures.js — 加载资源包贴图 -> 纹理数组 + GUI 图集
 * ============================================================ */
(function (MC) {
  'use strict';

  const TEX_BASE = 'assets/minecraft/textures/';
  const TEX_SIZE = 16;
  const DEFAULT_LAYERS = 256;      // 默认每层数量
  const MAX_ARRAYS = 4;            // 最多 4 个纹理数组（对应着色器中的 4 个采样器）

  const GUI_FILES = {
    widgets: 'gui/widgets.png',
    icons: 'gui/icons.png',
    bars: 'gui/bars.png',
    ascii: 'font/ascii.png',
    sun: 'environment/sun.png',
    moon: 'environment/moon_phases.png',
    clouds: 'environment/clouds.png',
    optionsBg: 'gui/options_background.png',
    inventory: 'gui/container/inventory.png',
    tabs: 'gui/container/creative_inventory/tabs.png',
    title: 'gui/title/minecraft.png',
    vignette: 'misc/vignette.png',
    pumpkinBlur: 'misc/pumpkinblur.png'
  };

  /**
   * 把完全透明像素的 RGB 填成不透明部分的平均色。
   * 否则 mipmap 生成时会把透明的黑色平均进来, 远处贴图会发黑。
   */
  function fixAlphaBleed(cv, cx) {
    let d;
    try { d = cx.getImageData(0, 0, cv.width, cv.height); } catch (e) { return; }
    const p = d.data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] > 8) { r += p[i]; g += p[i + 1]; b += p[i + 2]; n++; }
    }
    if (!n) return;
    r = (r / n) | 0; g = (g / n) | 0; b = (b / n) | 0;
    let changed = false;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] <= 8) { p[i] = r; p[i + 1] = g; p[i + 2] = b; changed = true; }
    }
    if (changed) cx.putImageData(d, 0, 0);
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  MC.Textures = {
    size: TEX_SIZE,

    async load(gl, onProgress) {
      const A = window.MC_ASSETS;
      const names = A.textures;
      const total = names.length + Object.keys(GUI_FILES).length + 2;
      let done = 0;
      const tick = (label) => { done++; if (onProgress) onProgress(done, total, label); };

      /* ---------- 0. 检测纹理数组层数上限 ---------- */
      const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) || 256;
      const LAYERS_PER_ARRAY = Math.min(DEFAULT_LAYERS, maxLayers);

      /* ---------- 1. 方块贴图 ---------- */
      const imgs = new Array(names.length);
      const cv = document.createElement('canvas');
      cv.width = TEX_SIZE; cv.height = TEX_SIZE;
      const cx = cv.getContext('2d', { willReadFrequently: false });
      cx.imageSmoothingEnabled = false;

      const arrayCount = Math.min(Math.ceil(names.length / LAYERS_PER_ARRAY), MAX_ARRAYS);
      const arrays = [];
      for (let i = 0; i < arrayCount; i++) {
        arrays.push(MC.gl.textureArray(gl, TEX_SIZE, LAYERS_PER_ARRAY, { mipmap: true }));
      }
      const layerOf = new Int32Array(names.length);
      const arrOf = new Int32Array(names.length);

      const jobs = names.map((name, i) => loadImage(TEX_BASE + name + '.png').then((img) => {
        imgs[i] = img;
        let arr = (i / LAYERS_PER_ARRAY) | 0, layer = i % LAYERS_PER_ARRAY;
        /* 超出纹理数组数量限制的贴图，映射到最后一个数组（可能部分浪费） */
        if (arr >= arrayCount) { arr = arrayCount - 1; layer = i - (arrayCount - 1) * LAYERS_PER_ARRAY; }
        layerOf[i] = layer; arrOf[i] = arr;
        cx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
        if (img) {
          const sw = Math.min(img.width, TEX_SIZE), sh = Math.min(img.height, TEX_SIZE);
          cx.drawImage(img, 0, 0, sw, sh, 0, 0, TEX_SIZE, TEX_SIZE);
        } else {
          cx.fillStyle = '#000'; cx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
          cx.fillStyle = '#f0f'; cx.fillRect(0, 0, 8, 8); cx.fillRect(8, 8, 8, 8);
        }
        fixAlphaBleed(cv, cx);
        if (arr < arrayCount) MC.gl.uploadLayer(gl, arrays[arr], layer, cv);
        tick(name);
      }));

      /* ---------- 2. 动画贴图 (水 / 岩浆) ---------- */
      const anim = {};
      await Promise.all(jobs);
      for (const key of ['water_still', 'lava_still']) {
        const i = names.indexOf('block/' + key);
        const img = i >= 0 ? imgs[i] : null;
        if (img && img.height > TEX_SIZE) {
          const frames = Math.floor(img.height / TEX_SIZE);
          const strip = document.createElement('canvas');
          strip.width = TEX_SIZE; strip.height = frames * TEX_SIZE;
          const sc = strip.getContext('2d');
          sc.imageSmoothingEnabled = false;
          sc.drawImage(img, 0, 0);
          anim[key === 'water_still' ? 'water' : 'lava'] = {
            tex: MC.gl.texture2D(gl, strip, {}), frames
          };
        }
      }

      /* ---------- 3. GUI ---------- */
      const gui = {};
      await Promise.all(Object.keys(GUI_FILES).map(async (k) => {
        gui[k] = await loadImage(TEX_BASE + GUI_FILES[k]);
        tick(k);
      }));

      /* 云贴图: 修掉透明像素的 RGB 后再生成 mipmap, 否则远处云会发灰 */
      if (gui.clouds) {
        const c = document.createElement('canvas');
        c.width = gui.clouds.width; c.height = gui.clouds.height;
        const cc = c.getContext('2d');
        cc.drawImage(gui.clouds, 0, 0);
        fixAlphaBleed(c, cc);
        gui.cloudsFixed = c;
      }

      /* ---------- 4. 生物群系色图 ---------- */
      let colormap = { grass: null, foliage: null };
      for (const key of ['grass', 'foliage']) {
        const img = await loadImage(TEX_BASE + 'colormap/' + key + '.png');
        tick(key);
        if (img) {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const cc = c.getContext('2d');
          cc.drawImage(img, 0, 0);
          try { colormap[key] = cc.getImageData(0, 0, c.width, c.height); }
          catch (e) { colormap[key] = null; }
        }
      }

      for (const t of arrays) {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

      const texIndex = {};
      names.forEach((n, i) => { texIndex[n] = i; });

      /* 占位 2D 纹理 (保证采样器单元类型不冲突) */
      const dummyCanvas = document.createElement('canvas');
      dummyCanvas.width = dummyCanvas.height = 16;
      const dc = dummyCanvas.getContext('2d');
      dc.fillStyle = '#ffffff';
      dc.fillRect(0, 0, 16, 16);
      const dummy2D = MC.gl.texture2D(gl, dummyCanvas, {});

      const api = {
        arrays, arrayCount, layerOf, arrOf, texIndex, names, imgs, anim, gui, colormap, dummy2D,
        /** 贴图名 -> {layer, arr, index} */
        lookup(name) {
          const i = texIndex[name];
          if (i === undefined) return { layer: 0, arr: 0, index: 0 };
          return { layer: layerOf[i], arr: arrOf[i], index: i };
        },
        img(name) { const i = texIndex[name]; return i === undefined ? null : imgs[i]; },
        /** 取贴图的 16x16 RGBA 像素 (用于 HUD 图标) */
        pixels(name) {
          const img = api.img(name);
          if (!img) return null;
          const c = document.createElement('canvas');
          c.width = TEX_SIZE; c.height = TEX_SIZE;
          const cc = c.getContext('2d');
          cc.imageSmoothingEnabled = false;
          cc.drawImage(img, 0, 0, Math.min(img.width, 16), Math.min(img.height, 16), 0, 0, 16, 16);
          try { return cc.getImageData(0, 0, 16, 16); } catch (e) { return null; }
        }
      };
      return api;
    }
  };
})(window.MC);

/* ============================================================
 *  main.js — 启动 / 输入 / 游戏主循环
 * ============================================================ */
(function (MC) {
  'use strict';

  const boot = document.getElementById('boot');
  const bootFill = document.getElementById('boot-bar-fill');
  const bootMsg = document.getElementById('boot-msg');
  const fatal = document.getElementById('fatal');
  const fatalMsg = document.getElementById('fatal-msg');

  function fail(err) {
    console.error(err);
    fatal.hidden = false;
    fatalMsg.textContent = '启动失败:\n\n' + (err && err.stack ? err.stack : err) +
      '\n\n提示: 请通过本地 HTTP 服务打开本页面 (运行 start.bat 或 node server.js)，' +
      '不要直接双击 index.html —— 浏览器会因 file:// 安全策略而无法读取贴图。';
    boot.style.display = 'none';
  }

  window.addEventListener('error', (e) => fail(e.error || e.message));

  /* ============================================================
   *  设置
   * ============================================================ */
  const settings = {
    renderDistance: 8,
    fovDeg: 70,
    sensitivity: 1.0,
    brightness: 1.0,
    guiScale: 0,
    seed: 0,
    mouseInverted: false
  };
  try {
    const saved = JSON.parse(localStorage.getItem('mcweb.settings') || 'null');
    if (saved) Object.assign(settings, saved);
  } catch (e) { }
  const saveSettings = () => {
    try { localStorage.setItem('mcweb.settings', JSON.stringify(settings)); } catch (e) { }
  };

  /* ============================================================
   *  输入
   * ============================================================ */
  /* 调试参数
   * 简写: ?d=pitch:-0.6;pos:0,80,0;seed:123;rd:6;frames:60;fly:1;time:6000;screen:inventory
   * 也支持 ?pitch=&yaw=&rd=&frames=&screen=&nofog&nosky&solid&full&nocull&noalpha&hidehud
   */
  const qs = new URLSearchParams(location.search);
  const DBG = {
    pitch: null, yaw: null, time: null, rd: null, seed: null, pos: null,
    screen: null, frames: 0, fly: false,
    nofog: qs.has('nofog'), nosky: qs.has('nosky'), solid: qs.has('solid'),
    full: qs.has('full'), noalpha: qs.has('noalpha'), nocull: qs.has('nocull'),
    hideHud: qs.has('hidehud'), hudtest: qs.has('hudtest'), autotest: qs.has('autotest'), selfcheck: qs.has('selfcheck'),
    water: qs.has('water'), scene: qs.has('scene')
  };
  const num = (v) => (v === undefined || v === null || isNaN(parseFloat(v)) ? null : parseFloat(v));
  const bool = (v) => v === '1' || v === 'true' || v === '';
  if (qs.has('d')) {
    for (const part of qs.get('d').split(';')) {
      const i = part.indexOf(':');
      const k = i < 0 ? part : part.slice(0, i);
      const v = i < 0 ? '1' : part.slice(i + 1);
      if (k === 'pitch') DBG.pitch = num(v);
      else if (k === 'yaw') DBG.yaw = num(v);
      else if (k === 'time') DBG.time = num(v);
      else if (k === 'rd') DBG.rd = num(v);
      else if (k === 'seed') DBG.seed = num(v);
      else if (k === 'frames') DBG.frames = num(v) || 0;
      else if (k === 'pos') DBG.pos = v.split(',').map(Number);
      else if (k === 'screen') DBG.screen = v;
      else if (k === 'fly') DBG.fly = bool(v);
      else if (k === 'nofog') DBG.nofog = bool(v);
      else if (k === 'nosky') DBG.nosky = bool(v);
      else if (k === 'solid') DBG.solid = bool(v);
      else if (k === 'full') DBG.full = bool(v);
      else if (k === 'nocull') DBG.nocull = bool(v);
      else if (k === 'noalpha') DBG.noalpha = bool(v);
      else if (k === 'hidehud') DBG.hideHud = bool(v);
      else if (k === 'water') DBG.water = bool(v);
      else if (k === 'scene') DBG.scene = bool(v);
      else if (k === 'autotest') DBG.autotest = bool(v);
      else if (k === 'selfcheck') DBG.selfcheck = bool(v);
      else if (k === 'bench') DBG.bench = bool(v);
    }
  }
  if (qs.has('pitch')) DBG.pitch = num(qs.get('pitch'));
  if (qs.has('yaw')) DBG.yaw = num(qs.get('yaw'));
  if (qs.has('time')) DBG.time = num(qs.get('time'));
  if (qs.has('rd')) DBG.rd = num(qs.get('rd'));
  if (qs.has('seed')) DBG.seed = num(qs.get('seed'));
  if (qs.has('frames')) DBG.frames = num(qs.get('frames')) || 0;
  if (qs.has('pos')) DBG.pos = qs.get('pos').split(',').map(Number);
  if (qs.has('screen')) DBG.screen = qs.get('screen');
  if (qs.has('autotest')) DBG.autotest = true;
  if (qs.has('water')) DBG.water = true;
  if (qs.has('scene')) DBG.scene = true;
  if (qs.has('selfcheck')) DBG.selfcheck = true;
  if (DBG.selfcheck || DBG.autotest) { if (!DBG.frames) DBG.frames = 60; }
  if (!DBG.frames && (DBG.solid || DBG.full || DBG.nosky || DBG.noalpha || DBG.nocull || DBG.hideHud || DBG.hudtest || DBG.autotest)) DBG.frames = 40;

  const input = {
    forward: false, back: false, left: false, right: false,
    jump: false, sneak: false, sprint: false,
    spacePressed: false,
    breakHeld: false, placeHeld: false,
    locked: false
  };
  MC.input = input;

  const KEYMAP = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right'
  };

  /* ============================================================
   *  启动
   * ============================================================ */
  async function boot0() {
    const glCanvas = document.getElementById('gl');
    const hudCanvas = document.getElementById('hud');
    const gl = MC.gl.createContext(glCanvas);

    bootMsg.textContent = '正在读取贴图…';
    const textures = await MC.Textures.load(gl, (d, t, label) => {
      bootFill.style.width = (d / t * 100).toFixed(1) + '%';
      bootMsg.textContent = '正在读取贴图… ' + d + '/' + t + '  ' + (label || '');
    });

    bootMsg.textContent = '正在构建方块数据…';
    let glyphSizes = null;
    try {
      const r = await fetch('assets/minecraft/font/glyph_sizes.bin');
      if (r.ok) glyphSizes = await r.arrayBuffer();
    } catch (e) { }
    MC.Font.init(textures.gui.ascii, glyphSizes);
    /* 预加载界面中文字形所在的 Unicode 页 */
    MC.Font.preload('游戏已暂停回到选项保存并退出切换模式创造生存物品栏快捷栏滚轮翻页左键选取关闭渲染距离视野灵敏度亮度界面缩放全屏完成你死了点击屏幕重生欢迎来到网页版移动空格跳跃双击飞行破坏放置调试菜单可用指令种子传送时间白天夜晚正午午夜获得未知方块出生点正在加载资源同步存档设置服务器连接失败尝试重置');
    MC.Blocks.init(textures);
    bootFill.style.width = '96%';

    const seed = DBG.seed !== null ? DBG.seed : (settings.seed || ((Math.random() * 2147483647) | 0));
    settings.seed = seed;
    MC.WorldGen.init(seed, textures);

    const world = new MC.World(MC.WorldGen, seed);
    world.renderDistance = settings.renderDistance;
    const player = new MC.Player(world);
    const renderer = new MC.Renderer(gl, textures);
    MC.Sky.init(gl, textures);
    const hud = new MC.Hud(hudCanvas, textures);
    hud.testFill = !!DBG.hudtest;
    hud.forcedScale = settings.guiScale || 0;

    /* 寻找出生点 */
    bootMsg.textContent = '正在生成世界…';
    let sx = 0, sz = 0, sy = 0;
    outer:
    for (let r = 0; r < 96; r += 4) {
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const h = MC.WorldGen.heightAt(x, z);
        const bio = MC.WorldGen.biomeAt(x, z, h);
        if (h > MC.WorldGen.SEA + 2 && bio.id !== 1 && bio.id !== 2 && bio.id !== 3 && bio.id !== 6) {
          sx = x; sz = z; sy = h + 1; break outer;
        }
      }
    }
    if (!sy) { sy = MC.WorldGen.heightAt(0, 0) + 1; }

    world.generateAround(sx, sz, 3);

    /* 在附近寻找一块真正的空地 (避免生在树上/水里) */
    let spawn = null;
    for (let r = 0; r <= 26 && !spawn; r++) {
      for (let dz = -r; dz <= r && !spawn; dz++) {
        for (let dx = -r; dx <= r && !spawn; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = sx + dx, z = sz + dz;
          const y = world.surfaceY(x, z);
          if (y < MC.WorldGen.SEA + 1 || y >= MC.HEIGHT - 3) continue;
          const under = world.getBlockFast(x, y - 1, z) & 0xFFF;
          const ud = MC.Blocks.byType[under];
          if (!ud) continue;
          const okGround = /^(grass_block|sand|dirt|podzol|snow_block|coarse_dirt|mycelium|red_sand|stone)$/.test(ud.id);
          if (!okGround) continue;
          if (world.getBlockFast(x, y, z) !== 0 || world.getBlockFast(x, y + 1, z) !== 0) continue;
          spawn = [x, y, z];
        }
      }
    }
    if (!spawn) spawn = [sx, world.surfaceY(sx, sz), sz];
    player.pos = [spawn[0] + 0.5, spawn[1], spawn[2] + 0.5];
    sy = spawn[1];
    sx = spawn[0]; sz = spawn[2];
    player.yaw = 0.6; player.pitch = -0.15;
    if (DBG.pitch !== null) player.pitch = DBG.pitch;
    if (DBG.yaw !== null) player.yaw = DBG.yaw;
    if (DBG.pos && DBG.pos.length === 3 && DBG.pos.every(function (v) { return !isNaN(v); })) {
      player.pos = [DBG.pos[0], DBG.pos[1], DBG.pos[2]];
    }
    if (DBG.water) {
      /* 找到最近的水面并传送到上方 */
      const waterType = MC.Blocks.getByName('water').type;
      let best = null;
      for (const c of world.chunks.values()) {
        if (!c.generated) continue;
        for (let lz = 0; lz < 16 && !best; lz++) for (let lx = 0; lx < 16 && !best; lx++) {
          for (let y = MC.WorldGen.SEA + 2; y > MC.WorldGen.SEA - 6; y--) {
            if ((c.blocks[((y * 16 + lz) * 16) + lx] & 0xFFF) === waterType) {
              best = [c.cx * 16 + lx + 0.5, MC.WorldGen.SEA + 6, c.cz * 16 + lz + 0.5];
              break;
            }
          }
        }
        if (best) break;
      }
      if (best) { player.pos = best; player.flying = true; }
    }
    /* 受控测试场景: 正对一堵已知方块墙 */
    if (DBG.scene) {
      const bx = Math.floor(player.pos[0]), bz = Math.floor(player.pos[2]);
      const by = Math.floor(player.pos[1]);
      const set = (x, y, z, name) => {
        const d = MC.Blocks.getByName(name);
        if (d) world.setBlock(x, y, z, d.type);
      };
      /* 清出空地 */
      for (let y = by; y < by + 6; y++) for (let dz = -4; dz <= 2; dz++) for (let dx = -4; dx <= 4; dx++) {
        world.setBlock(bx + dx, y, bz + dz, 0);
      }
      /* 地面 */
      for (let dz = -4; dz <= 2; dz++) for (let dx = -4; dx <= 4; dx++) set(bx + dx, by - 1, bz + dz, 'grass_block');
      /* 墙面 */
      const row = ['grass_block', 'oak_log', 'oak_planks', 'stone', 'sandstone', 'bricks', 'oak_leaves', 'glass', 'cobblestone'];
      row.forEach((n, i) => {
        set(bx - 4 + i, by, bz - 4, n);
        set(bx - 4 + i, by + 1, bz - 4, n);
      });
      set(bx - 3, by + 2, bz - 4, 'torch');
      set(bx - 2, by + 2, bz - 4, 'dandelion');
      set(bx - 1, by + 2, bz - 4, 'poppy');
      set(bx, by + 2, bz - 4, 'oak_stairs');
      set(bx + 1, by + 2, bz - 4, 'lantern');
      set(bx + 2, by + 2, bz - 4, 'furnace');
      set(bx + 3, by + 2, bz - 4, 'oak_slab');
      set(bx + 4, by + 2, bz - 4, 'glass_pane');
      player.pos = [bx + 0.5, by, bz + 0.5];
      player.yaw = 0; player.pitch = 0;
      player.flying = true;
      window.__sceneLightPos = [bx, by + 1, bz - 3];   // 墙前空气格
      /* 等区块网格重建 */
      setTimeout(function () {
        for (const c of world.chunks.values()) { c.dirty = true; c.needsRelight = true; }
      }, 50);
    }
    if (DBG.fly) player.flying = true;
    if (DBG.screen) hud.screen = DBG.screen;
    if (DBG.rd) { settings.renderDistance = DBG.rd; world.renderDistance = DBG.rd; }
    MC.Blocks.prebuild();

    /* 初始物品栏 */
    const give = (name, n) => {
      const d = MC.Blocks.getByName(name);
      return d ? { type: d.type, count: n || 64 } : null;
    };
    hud.hotbar[0] = give('grass_block');
    hud.hotbar[1] = give('dirt');
    hud.hotbar[2] = give('stone');
    hud.hotbar[3] = give('cobblestone');
    hud.hotbar[4] = give('oak_planks');
    hud.hotbar[5] = give('oak_log');
    hud.hotbar[6] = give('glass');
    hud.hotbar[7] = give('torch');
    hud.hotbar[8] = give('glowstone');

    bootFill.style.width = '100%';
    bootMsg.textContent = '完成！';

    /* ============================================================
     *  游戏对象
     * ============================================================ */
    const game = {
      gl, glCanvas, textures, world, player, renderer, hud, settings, seed,
      worldTime: DBG.time !== null ? DBG.time : 6000,
      paused: false,
      target: null,
      fps: 0, frameCount: 0, fpsTimer: 0,
      running: true,
      breaking: { active: false, x: 0, y: 0, z: 0, progress: 0 },
      breakCd: 0
    };
    MC.game = game;

    const cam = {
      pos: [0, 0, 0], proj: MC.mat4.create(), view: MC.mat4.create(),
      forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0],
      tanHalf: { x: 1, y: 1 }, fov: 1.2, aspect: 1, fogStart: 60, fogEnd: 120
    };
    game.cam = cam;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      glCanvas.width = Math.floor(w * dpr);
      glCanvas.height = Math.floor(h * dpr);
      glCanvas.style.width = w + 'px';
      glCanvas.style.height = h + 'px';
      hud.resize();
    }
    window.addEventListener('resize', resize);
    resize();

    /* ============================================================
     *  鼠标 / 键盘
     * ============================================================ */
    function requestLock() {
      if (hud.screen === 'game' || hud.screen === 'chat') {
        if (!input.locked) glCanvas.requestPointerLock();
      }
    }

    glCanvas.addEventListener('click', () => {
      if (player.health <= 0) { respawn(); return; }
      requestLock();
    });

    document.addEventListener('pointerlockchange', () => {
      input.locked = document.pointerLockElement === glCanvas;
    });

    document.addEventListener('mousemove', (e) => {
      if (input.locked) {
        const s = settings.sensitivity * 0.0022;
        player.yaw -= e.movementX * s;
        player.pitch -= (settings.mouseInverted ? -e.movementY : e.movementY) * s;
        player.pitch = MC.clamp(player.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
      } else {
        const [lx, ly] = hud.toLogical(e.clientX, e.clientY);
        hud.mouseX = lx; hud.mouseY = ly;
        /* 滑块拖动 */
        if (hud.sliderDrag) {
          const s = hud.sliderDrag;
          const t = MC.clamp((lx - s.x) / s.w, 0, 1);
          let v = s.min + t * (s.max - s.min);
          v = Math.round(v / s.step) * s.step;
          v = MC.clamp(v, s.min, s.max);
          s.val = v;
          if (s.set) s.set(v);
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (!input.locked) {
        hudClick(e);
        return;
      }
      if (e.button === 0) { input.breakHeld = true; player.swing = 1; }
      if (e.button === 2) { input.placeHeld = true; player.swing = 1; }
      if (e.button === 1) pickBlock();
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { input.breakHeld = false; game.breaking.active = false; game.breaking.progress = 0; }
      if (e.button === 2) input.placeHeld = false;
      hud.sliderDrag = null;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('wheel', (e) => {
      if (hud.screen === 'inventory') {
        hud.scroll += e.deltaY > 0 ? 1 : -1;
        hud.scroll = Math.max(0, hud.scroll);
      } else if (hud.screen === 'game') {
        hud.selected = (hud.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
        hud.itemNameTimer = 40;
      }
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      /* 聊天输入 */
      if (hud.chatActive) {
        if (e.key === 'Enter') { sendChat(hud.chatInput); hud.chatInput = ''; hud.chatActive = false; hud.screen = 'game'; }
        else if (e.key === 'Escape') { hud.chatActive = false; hud.chatInput = ''; hud.screen = 'game'; }
        else if (e.key === 'Backspace') hud.chatInput = hud.chatInput.slice(0, -1);
        else if (e.key.length === 1 && hud.chatInput.length < 100) hud.chatInput += e.key;
        e.preventDefault();
        return;
      }

      if (KEYMAP[e.code]) input[KEYMAP[e.code]] = true;
      if (e.code === 'Space') {
        if (!input.jump) input.spacePressed = true;
        input.jump = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sneak = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.sprint = true;

      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (n >= 1 && n <= 9) { hud.selected = n - 1; hud.itemNameTimer = 40; }
      }

      if (e.code === 'KeyE') {
        if (hud.screen === 'inventory') { hud.screen = 'game'; document.exitPointerLock(); }
        else if (hud.screen === 'game') { hud.screen = 'inventory'; document.exitPointerLock(); }
        e.preventDefault();
      }
      if (e.code === 'Escape') {
        if (hud.screen === 'game') { hud.screen = 'pause'; document.exitPointerLock(); }
        else if (hud.screen === 'pause') { hud.screen = 'game'; requestLock(); }
        else if (hud.screen === 'options') { hud.screen = 'pause'; }
        else if (hud.screen === 'inventory') { hud.screen = 'game'; requestLock(); }
      }
      if (e.code === 'F3') { hud.debug = !hud.debug; e.preventDefault(); }
      if (e.code === 'KeyT' && hud.screen === 'game') { hud.chatActive = true; hud.screen = 'chat'; document.exitPointerLock(); e.preventDefault(); }
      if (e.code === 'Slash' && hud.screen === 'game') { hud.chatActive = true; hud.screen = 'chat'; hud.chatInput = '/'; document.exitPointerLock(); e.preventDefault(); }
      if (e.code === 'F11') { toggleFullscreen(); e.preventDefault(); }
      if (e.code === 'F1') { hud.hidden = !hud.hidden; e.preventDefault(); }
      if (e.code === 'KeyG' && hud.screen === 'game') { player.mode = player.mode === 'creative' ? 'survival' : 'creative'; hud.showToast('游戏模式: ' + (player.mode === 'creative' ? '创造' : '生存')); }

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].indexOf(e.code) >= 0) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
      if (e.code === 'Space') { input.jump = false; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sneak = false;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') input.sprint = false;
    });

    window.addEventListener('blur', () => {
      for (const k in input) if (typeof input[k] === 'boolean') input[k] = false;
    });

    /* ============================================================
     *  移动端触摸控制
     * ============================================================ */
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    MC.isMobile = isMobile;

    if (isMobile) {
      const touch = { moveStick: null, lookTouch: null, moveStart: null, lookStart: null };
      const STICK_RADIUS = 50;

      /* 创建虚拟摇杆和按钮的 HUD 元素 */
      const touchUI = document.createElement('div');
      touchUI.id = 'touch-ui';
      touchUI.style.cssText = 'position:fixed;bottom:0;left:0;right:0;top:0;pointer-events:none;z-index:100;';
      document.body.appendChild(touchUI);

      function makeBtn(label, x, y, size, onDown, onUp) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `position:absolute;pointer-events:auto;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:50%;border:2px solid rgba(255,255,255,0.5);background:rgba(0,0,0,0.3);color:#fff;font-size:${size * 0.35}px;touch-action:none;user-select:none;`;
        touchUI.appendChild(b);
        b.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); });
        b.addEventListener('touchend', (e) => { e.preventDefault(); onUp(); });
        b.addEventListener('touchcancel', (e) => { onUp(); });
        return b;
      }

      /* 移动摇杆区 (左半屏) */
      const moveZone = document.createElement('div');
      moveZone.style.cssText = 'position:absolute;left:20px;bottom:20px;width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,0.3);background:rgba(0,0,0,0.15);pointer-events:auto;touch-action:none;';
      touchUI.appendChild(moveZone);

      const moveKnob = document.createElement('div');
      moveKnob.style.cssText = 'position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.4);pointer-events:none;transition:none;';
      moveZone.appendChild(moveKnob);

      moveZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        touch.moveStick = t.identifier;
        touch.moveStart = { x: t.clientX, y: t.clientY };
      });

      moveZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier !== touch.moveStick) continue;
          const rect = moveZone.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          let dx = t.clientX - cx, dy = t.clientY - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > STICK_RADIUS) { dx = dx / dist * STICK_RADIUS; dy = dy / dist * STICK_RADIUS; }
          moveKnob.style.left = (35 + dx) + 'px';
          moveKnob.style.top = (35 + dy) + 'px';
          const nx = dx / STICK_RADIUS, ny = dy / STICK_RADIUS;
          input.forward = ny < -0.3;
          input.back = ny > 0.3;
          input.left = nx < -0.3;
          input.right = nx > 0.3;
        }
      });

      const resetMove = () => {
        touch.moveStick = null;
        moveKnob.style.left = '35px';
        moveKnob.style.top = '35px';
        input.forward = input.back = input.left = input.right = false;
      };
      moveZone.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === touch.moveStick) resetMove(); });
      moveZone.addEventListener('touchcancel', resetMove);

      /* 视角控制区 (右半屏) */
      const lookZone = document.createElement('div');
      lookZone.style.cssText = 'position:absolute;right:0;bottom:0;width:50%;height:100%;pointer-events:auto;touch-action:none;';
      touchUI.appendChild(lookZone);

      lookZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (touch.lookTouch !== null) return;
        const t = e.changedTouches[0];
        touch.lookTouch = t.identifier;
        touch.lookStart = { x: t.clientX, y: t.clientY };
      });

      lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier !== touch.lookTouch) continue;
          const dx = t.clientX - touch.lookStart.x;
          const dy = t.clientY - touch.lookStart.y;
          touch.lookStart = { x: t.clientX, y: t.clientY };
          const s = settings.sensitivity * 0.003;
          player.yaw -= dx * s;
          player.pitch -= dy * s;
          player.pitch = MC.clamp(player.pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
        }
      });

      const resetLook = () => { touch.lookTouch = null; };
      lookZone.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === touch.lookTouch) resetLook(); });
      lookZone.addEventListener('touchcancel', resetLook);

      /* 按钮 */
      const bw = 60;
      const bRight = window.innerWidth - bw - 20;
      makeBtn('跳', bRight, window.innerHeight - bw * 2 - 40, bw, () => { input.jump = true; }, () => { input.jump = false; });
      makeBtn('破', bRight - bw - 15, window.innerHeight - bw - 20, bw, () => { input.breakHeld = true; player.swing = 1; }, () => { input.breakHeld = false; game.breaking.active = false; });
      makeBtn('放', bRight, window.innerHeight - bw - 20, bw, () => { input.placeHeld = true; }, () => { input.placeHeld = false; });

      /* 飞行切换按钮 */
      makeBtn('飞', bRight - bw - 15, window.innerHeight - bw * 2 - 40, bw * 0.7, () => { player.flying = !player.flying; }, () => {});
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
      else document.exitFullscreen();
    }

    /* ---------- UI 点击 ---------- */
    function hudClick(e) {
      const [mx, my] = [hud.mouseX, hud.mouseY];
      const hit = (r) => r && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

      if (hud.screen === 'pause') {
        for (const b of hud.buttons) {
          if (!hit(b)) continue;
          if (b.label === '回到游戏') { hud.screen = 'game'; requestLock(); }
          else if (b.label === '选项…') hud.screen = 'options';
          else if (b.label === '保存并退出') { hud.showToast('已保存 (可关闭标签页)'); saveSettings(); }
          else if (b.label === '切换游戏模式') {
            player.mode = player.mode === 'creative' ? 'survival' : 'creative';
            hud.showToast('游戏模式: ' + (player.mode === 'creative' ? '创造' : '生存'));
          }
        }
        return;
      }
      if (hud.screen === 'options') {
        /* 先检查滑块点击 */
        if (hud.sliders) {
          for (const s of hud.sliders) {
            if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) {
              const t = MC.clamp((mx - s.x) / s.w, 0, 1);
              let v = s.min + t * (s.max - s.min);
              v = Math.round(v / s.step) * s.step;
              v = MC.clamp(v, s.min, s.max);
              s.val = v;
              if (s.set) s.set(v);
              hud.sliderDrag = s;
              return;
            }
          }
        }
        for (const b of hud.buttons) {
          if (!hit(b)) continue;
          if (b.label === '完成') { hud.screen = 'pause'; saveSettings(); }
          else if (b.label.startsWith('全屏')) toggleFullscreen();
          else if (b.label.startsWith('鼠标反转')) {
            settings.mouseInverted = !settings.mouseInverted;
          }
          else if (b.label === '恢复默认设置') {
            settings.renderDistance = 8;
            settings.fovDeg = 70;
            settings.sensitivity = 1.0;
            settings.brightness = 1.0;
            settings.guiScale = 0;
            settings.mouseInverted = false;
            world.renderDistance = 8;
            hud.forcedScale = 0;
            hud.resize();
            hud.showToast('已恢复默认设置');
          }
        }
        return;
      }
      if (hud.screen === 'inventory') {
        if (hud.tabRects) for (const t of hud.tabRects) {
          if (hit(t)) { hud.category = t.i; hud.scroll = 0; return; }
        }
        if (hud.slotRects) for (const s of hud.slotRects) {
          if (!hit(s)) continue;
          if (s.hotbar !== undefined) { hud.selected = s.hotbar; }
          else if (s.type) {
            hud.hotbar[hud.selected] = { type: s.type, count: 64 };
            hud.itemNameTimer = 40;
          }
          return;
        }
        return;
      }
      if (hud.screen === 'game') {
        if (player.health <= 0) respawn();
      }
    }

    game.hudClick = hudClick;

    function respawn() {
      const h = world.surfaceY(Math.floor(player.pos[0]), Math.floor(player.pos[2]));
      player.pos[1] = h + 0.2;
      player.vel = [0, 0, 0];
      player.health = 20;
    }

    /* ============================================================
     *  方块交互
     * ============================================================ */
    function pickBlock() {
      if (!game.target) return;
      const def = MC.Blocks.byType[game.target.type];
      if (!def) return;
      for (let i = 0; i < 9; i++) {
        if (hud.hotbar[i] && hud.hotbar[i].type === def.type) { hud.selected = i; hud.itemNameTimer = 40; return; }
      }
      hud.hotbar[hud.selected] = { type: def.type, count: 64 };
      hud.itemNameTimer = 40;
    }

    function tryBreak(dt) {
      const t = game.target;
      if (!t) return;
      const def = MC.Blocks.byType[t.type];
      if (!def || def.hardness < 0) return;
      /* 破坏间隔: 按住不放时也要一块一块地挖, 否则一帧就能挖掉一串方块 */
      if (game.breakCd > 0) return;

      if (player.mode === 'creative') {
        game.breakCd = 0.2;
        breakBlock(t.x, t.y, t.z);
        return;
      }
      const br = game.breaking;
      if (!br.active || br.x !== t.x || br.y !== t.y || br.z !== t.z) {
        br.active = true; br.x = t.x; br.y = t.y; br.z = t.z; br.progress = 0;
      }
      const tool = 1;
      br.progress += dt * tool / Math.max(0.05, def.hardness);
      if (br.progress >= 1) {
        breakBlock(t.x, t.y, t.z);
        br.progress = 0; br.active = false;
        game.breakCd = 0.15;
      }
    }

    function breakBlock(x, y, z) {
      const id = world.getBlockFast(x, y, z);
      if (!id) return;
      const def = MC.Blocks.byType[id & 0xFFF];
      if (def && def.hardness < 0) return;
      world.setBlock(x, y, z, 0);
      /* 上方植物一起掉落 */
      const above = world.getBlockFast(x, y + 1, z);
      if (above) {
        const ad = MC.Blocks.byType[above & 0xFFF];
        if (ad && ad.kind === 'plant') world.setBlock(x, y + 1, z, 0);
      }
    }

    function tryPlace() {
      const t = game.target;
      if (!t) return;
      const item = hud.hotbar[hud.selected];
      if (!item) return;
      const def = MC.Blocks.byType[item.type];
      if (!def) return;
      const n = [0, 0, 0];
      const nm = MC.Blocks.FACE_NORMAL[t.face] || [0, 1, 0];
      let px = t.x + nm[0], py = t.y + nm[1], pz = t.z + nm[2];

      const cur = world.getBlockFast(px, py, pz);
      const curDef = cur ? MC.Blocks.byType[cur & 0xFFF] : null;
      const replaceable = cur === 0 || (curDef && (curDef.kind === 'plant' || curDef.id === 'water' || curDef.id === 'seagrass' || curDef.id === 'kelp'));
      if (!replaceable) return;
      if (py < 0 || py >= MC.HEIGHT) return;

      /* 不能放在玩家身体里 */
      const rot = MC.PlayerUtil.rotationFor(item.type, t, player);
      const id = item.type | (rot << 12);
      if (def.solid) {
        const boxes = MC.Blocks.boxesFor(item.type, rot) || [[0, 0, 0, 1, 1, 1]];
        const pb = player.aabb();
        for (const b of boxes) {
          if (pb[3] <= px + b[0] || pb[0] >= px + b[3] || pb[4] <= py + b[1] || pb[1] >= py + b[4] || pb[5] <= pz + b[2] || pb[2] >= pz + b[5]) continue;
          return;
        }
      }
      world.setBlock(px, py, pz, id);
      player.swing = 1;
    }

    /* ============================================================
     *  聊天 / 指令
     * ============================================================ */
    function sendChat(text) {
      text = (text || '').trim();
      if (!text) return;
      if (text[0] !== '/') { hud.addMessage('<玩家> ' + text); return; }
      const args = text.slice(1).split(/\s+/);
      const cmd = args[0].toLowerCase();
      const ok = (m) => hud.addMessage('§a' + m);
      const err = (m) => hud.addMessage('§c' + m);
      if (cmd === 'time') {
        const v = (args[1] || '').toLowerCase();
        if (v === 'set') {
          const what = (args[2] || '').toLowerCase();
          if (what === 'day') { game.worldTime = 1000; ok('时间已设为白天'); }
          else if (what === 'noon') { game.worldTime = 6000; ok('时间已设为正午'); }
          else if (what === 'night') { game.worldTime = 13000; ok('时间已设为夜晚'); }
          else if (what === 'midnight') { game.worldTime = 18000; ok('时间已设为午夜'); }
          else err('用法: /time set day|noon|night|midnight');
        } else if (!isNaN(parseFloat(args[1]))) { game.worldTime = parseFloat(args[1]); ok('时间已设置'); }
        else err('用法: /time set day|night');
      } else if (cmd === 'gamemode') {
        const m = (args[1] || '').toLowerCase();
        if (m === 'c' || m === 'creative' || m === '1') { player.mode = 'creative'; ok('已切换到创造模式'); }
        else if (m === 's' || m === 'survival' || m === '0') { player.mode = 'survival'; player.flying = false; ok('已切换到生存模式'); }
        else err('用法: /gamemode creative|survival');
      } else if (cmd === 'tp') {
        const x = parseFloat(args[1]), y = parseFloat(args[2]), z = parseFloat(args[3]);
        if ([x, y, z].some(isNaN)) err('用法: /tp <x> <y> <z>');
        else { player.pos = [x, y, z]; player.vel = [0, 0, 0]; ok('已传送'); }
      } else if (cmd === 'seed') {
        ok('种子: ' + seed);
      } else if (cmd === 'rd' || cmd === 'renderdistance') {
        const n = MC.clamp(parseInt(args[1], 10) || 8, 2, 24);
        settings.renderDistance = n; world.renderDistance = n; ok('渲染距离: ' + n);
      } else if (cmd === 'fly') {
        player.flying = !player.flying; ok('飞行: ' + (player.flying ? '开' : '关'));
      } else if (cmd === 'give') {
        const d = MC.Blocks.getByName((args[1] || '').replace('minecraft:', ''));
        if (d) { hud.hotbar[hud.selected] = { type: d.type, count: 64 }; ok('已获得 ' + d.name); }
        else err('未知方块: ' + args[1]);
      } else if (cmd === 'kill') {
        player.health = 0;
      } else if (cmd === 'help') {
        hud.addMessage('§e可用指令: /time set day|night, /gamemode c|s, /tp x y z, /seed, /rd <n>, /fly, /give <方块>, /kill, /spawn');
      } else if (cmd === 'spawn') {
        player.pos = [sx + 0.5, world.surfaceY(sx, sz) + 0.2, sz + 0.5];
        player.vel = [0, 0, 0];
        ok('已回到出生点');
      } else {
        err('未知指令: ' + cmd + ' (输入 /help)');
      }
    }
    game.sendChat = sendChat;

    /* ============================================================
     *  主循环
     * ============================================================ */
    let last = performance.now();
    let acc = 0;

    let frameNo = 0;
    const autoLog = [];
    function autotest() {
      try {
        const p = player;
        /* 光照回归: 头顶放/拆方块, 检查天空光是否真的"减得下去" */
        const lx0 = Math.floor(p.pos[0]), lz0 = Math.floor(p.pos[2]);
        const ty = Math.floor(p.pos[1]) + 2;
        const skyBefore = world.getLightFast(lx0, ty - 1, lz0) >> 4;
        world.setBlock(lx0, ty, lz0, MC.Blocks.getByName('stone').type);
        const skyCovered = world.getLightFast(lx0, ty - 1, lz0) >> 4;
        world.setBlock(lx0, ty, lz0, 0);
        const skyRestored = world.getLightFast(lx0, ty - 1, lz0) >> 4;
        autoLog.push('skyLight ' + skyBefore + '->' + skyCovered + '->' + skyRestored);

        /* 方块光回归: 火把放置/拆除 */
        const tx = lx0 + 2, tz = lz0, tyy = Math.floor(p.pos[1]);
        const b0 = world.getLightFast(tx, tyy, tz) & 15;
        world.setBlock(tx, tyy, tz, MC.Blocks.getByName('torch').type);
        const b1 = world.getLightFast(tx, tyy, tz) & 15;
        world.setBlock(tx, tyy, tz, 0);
        const b2 = world.getLightFast(tx, tyy, tz) & 15;
        autoLog.push('torchLight ' + b0 + '->' + b1 + '->' + b2);

        p.pitch = -1.55; p.yaw = 0;
        const t = p.raycast(6);
        autoLog.push('target=' + (t ? (MC.Blocks.byType[t.type] || {}).id + '@' + t.x + ',' + t.y + ',' + t.z : 'none'));
        if (t) {
          const before = world.getBlockFast(t.x, t.y, t.z);
          breakBlock(t.x, t.y, t.z);
          autoLog.push('break ' + (before & 0xFFF) + ' -> ' + (world.getBlockFast(t.x, t.y, t.z) & 0xFFF));
          const t2 = p.raycast(6);
          if (t2) {
            game.target = t2;
            const slot = hud.hotbar[hud.selected];
            tryPlace();
            const nm = MC.Blocks.FACE_NORMAL[t2.face] || [0, 1, 0];
            autoLog.push('place at ' + (t2.x + nm[0]) + ',' + (t2.y + nm[1]) + ',' + (t2.z + nm[2]) + ' -> ' + (world.getBlockFast(t2.x + nm[0], t2.y + nm[1], t2.z + nm[2]) & 0xFFF) + ' expect ' + (slot ? slot.type : -1));
          }
        }
        autoLog.push('onGround=' + p.onGround + ' y=' + p.pos[1].toFixed(2));
        const c = world.getChunk(Math.floor(p.pos[0] / 16), Math.floor(p.pos[2] / 16));
        autoLog.push('chunkDirty=' + (c ? c.dirty : 'n/a') + ' meshCount=' + (c && c.mesh.opaque ? c.mesh.opaque.count : 0));
        autoLog.push('lightAbove=' + (world.getLightFast(Math.floor(p.pos[0]), Math.floor(p.pos[1]) + 1, Math.floor(p.pos[2])) >> 4));
        autoLog.push('hudSlots=' + hud.hotbar.filter(Boolean).length + ' categories=' + hud.categories.map(function (c2) { return c2.length; }).join('/'));
        const px = textures.pixels('block/grass_block_top');
        autoLog.push('iconPixels=' + (px ? px.data.length : 0));

        /* UI 点击测试 */
        hud.screen = 'inventory';
        hud.draw(game);
        if (hud.slotRects && hud.slotRects.length > 3) {
          const s = hud.slotRects[3];
          hud.selected = 5;
          hud.mouseX = s.x + 4; hud.mouseY = s.y + 4;
          hudClick({ button: 0, preventDefault: function () { } });
          autoLog.push('invClick type=' + (hud.hotbar[5] ? hud.hotbar[5].type : -1) + ' expect=' + s.type);
        }
        if (hud.tabRects && hud.tabRects.length > 1) {
          const t = hud.tabRects[1];
          hud.mouseX = t.x + 4; hud.mouseY = t.y + 4;
          hudClick({ button: 0, preventDefault: function () { } });
          autoLog.push('tabClick=' + hud.category + ' expect=1');
        }
        hud.screen = 'game';
      } catch (e) { autoLog.push('ERR ' + e.message); }
      window.__autolog = autoLog.join(' | ');
    }

    /**
     * 资源一致性自检: 逐个方块变体重建几何, 检查
     *  1) 缓存的几何对象是否真的属于这个变体 (防止 key 碰撞串号)
     *  2) 每个面的贴图索引是否等于模型里写的贴图
     * 结果挂到 window.__selfcheck, 可通过 ?d=selfcheck 在无头环境跑。
     */
    function selfcheck() {
      const errs = [];
      const B = MC.Blocks, A = window.MC_ASSETS;
      const per = textures.layerCount || 256;
      let variants = 0, quads = 0;
      const seen = new Set();
      for (let t = 1; t < B.byType.length; t++) {
        const b = B.byType[t];
        if (!b || !b.variants) continue;
        for (let vi = 0; vi < b.variants.length; vi++) {
          variants++;
          const v = b.variants[vi];
          const g = B.geo(t, vi);
          if (!g) { errs.push(b.id + '#' + vi + ' 无几何'); continue; }
          if (g.model !== v.model) errs.push(b.id + '#' + vi + ' 模型串号: ' + g.model + ' != ' + v.model);
          if (seen.has(g)) errs.push(b.id + '#' + vi + ' 与其他变体共享同一几何对象');
          seen.add(g);
          const model = A.models[v.model];
          const want = new Set();
          if (model && model.elements) {
            for (let e = 0; e < model.elements.length; e++) {
              const faces = model.elements[e].faces || {};
              for (const k in faces) {
                const tex = faces[k].tex;
                if (!tex) continue;
                if (!textures.has(tex)) { errs.push(b.id + ' 缺贴图: ' + tex); continue; }
                want.add(textures.lookup(tex).index);
              }
            }
          }
          const qs = g.quads;
          for (let qi = 0; qi < qs.length; qi++) {
            quads++;
            const gi = qs[qi].arr * per + qs[qi].layer;
            if (!want.has(gi)) errs.push(b.id + '#' + vi + ' 面贴图不符: ' + (textures.names[gi] || gi));
          }
        }
      }
      window.__selfcheck = { variants, quads, errCount: errs.length, errors: errs.slice(0, 12) };
      return window.__selfcheck;
    }

    /** 生成 / 网格化耗时采样 (?d=bench) */
    function bench() {
      const gen = [], mesh = [], quads = [];
      const chunks = [];
      for (let i = 0; i < 16; i++) {
        const c = world.ensureChunk(60 + i, 60);
        const t0 = performance.now();
        world._generate(c);
        gen.push(+(performance.now() - t0).toFixed(1));
        chunks.push(c);
      }
      for (const c of chunks) {
        const t0 = performance.now();
        const m = c.buildMesh(MC.Mesher);
        mesh.push(+(performance.now() - t0).toFixed(1));
        quads.push((m.opaque ? m.opaque.count || 0 : 0) + (m.translucent ? m.translucent.count || 0 : 0));
      }
      const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
      window.__bench = {
        genAvg: avg(gen), meshAvg: avg(mesh), gen, mesh, quads,
        yRange: chunks.map(function (c) { return c.minY + '-' + c.maxY; })
      };
      return window.__bench;
    }

    function frame(now) {
      frameNo++;
      if (DBG.autotest && frameNo === 2) autotest();
      if (DBG.selfcheck && frameNo === 3) {
        try { selfcheck(); }
        catch (e) { window.__selfcheck = { error: e.message, stack: String(e.stack || '').split('\n').slice(0, 4).join(' / ') }; }
        document.title = 'SC ' + (window.__selfcheck.error ? 'ERR' : window.__selfcheck.errCount);
      }
      if (DBG.bench && frameNo === 3) {
        try { bench(); } catch (e) { window.__bench = { error: e.message }; }
      }
      if (!DBG.frames || frameNo < DBG.frames) requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;

      const paused = hud.screen !== 'game' && hud.screen !== 'chat';

      /* 时间流动 */
      if (!paused) {
        game.worldTime += dt * 20;
        if (game.worldTime > 24000 * 100) game.worldTime -= 24000 * 100;
      }

      /* 玩家 */
      if (!paused) player.update(dt, input);
      else { input.jump = false; }
      input.spacePressed = false;

      /* 世界加载 */
      world.update(player.pos[0], player.pos[2], dt, renderer);

      /* 目标方块 */
      game.target = (hud.screen === 'game' && player.health > 0) ? player.raycast(player.reach) : null;

      /* 破坏 / 放置 */
      if (hud.screen === 'game') {
        if (game.breakCd > 0) game.breakCd = Math.max(0, game.breakCd - dt);
        if (input.breakHeld && game.target) tryBreak(dt);
        else { game.breaking.active = false; game.breaking.progress = 0; }
        if (input.placeHeld) {
          acc += dt;
          if (acc > 0.22) { acc = 0; tryPlace(); }
        } else acc = 1;
      }

      /* 相机 */
      const eye = player.eye();
      const bob = player.bob;
      const fov = (settings.fovDeg + (player.sprinting ? 4 : 0) + (player.flying ? 7 : 0)) * Math.PI / 180;
      const aspect = glCanvas.width / glCanvas.height;
      const farPlane = Math.max(320, world.renderDistance * 16 * 2.2 + 120);
      MC.mat4.perspective(cam.proj, fov, aspect, 0.1, farPlane);
      cam.fov = fov; cam.aspect = aspect;
      cam.pos[0] = eye[0]; cam.pos[1] = eye[1] + bob; cam.pos[2] = eye[2];
      MC.mat4.view(cam.view, cam.pos[0], cam.pos[1], cam.pos[2], player.yaw, player.pitch);
      const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
      cam.forward = [-sy * cp, sp, -cy * cp];
      cam.right = [cy, 0, -sy];
      cam.up = [
        cam.right[1] * cam.forward[2] - cam.right[2] * cam.forward[1],
        cam.right[2] * cam.forward[0] - cam.right[0] * cam.forward[2],
        cam.right[0] * cam.forward[1] - cam.right[1] * cam.forward[0]
      ];
      const th = Math.tan(fov / 2);
      cam.tanHalf = { x: th * aspect, y: th };

      /* 环境 */
      var env = MC.Env.compute(game.worldTime);
      game._env = env;
      const under = player.headInWater;
      const fogDist = world.renderDistance * 16;
      let fogColor = env.fog;
      let fogStart = fogDist * 0.55, fogEnd = fogDist * 0.95;
      if (DBG.nofog) { fogStart = 1e6; fogEnd = 1e6 + 1; }
      if (under) {
        fogColor = [0.06, 0.22, 0.38];
        fogStart = 0.2; fogEnd = 22;
      }
      const b = settings.brightness;
      env.fog = [fogColor[0] * b, fogColor[1] * b, fogColor[2] * b];
      env.dayLight = Math.min(1, env.dayLight * (0.55 + 0.45 * b));

      /* 选中框 */
      let highlight = null;
      if (game.target) {
        const def = MC.Blocks.byType[game.target.type];
        const boxes = def && def.solid ? MC.Blocks.boxesFor(game.target.type, game.target.id >> 12) : null;
        highlight = {
          x: game.target.x, y: game.target.y, z: game.target.z,
          box: (boxes && boxes.length) ? boxes[0] : [0, 0, 0, 1, 1, 1]
        };
      }

      /* 破坏进度 */
      let breakInfo = null;
      if (player.mode === 'survival' && game.breaking.active && game.breaking.progress > 0.02) {
        breakInfo = { x: game.breaking.x, y: game.breaking.y, z: game.breaking.z, stage: Math.min(9, Math.floor(game.breaking.progress * 10)) };
      }

      /* 渲染 */
      renderer.render(cam, world, env, {
        noSky: DBG.nosky, debugSolid: DBG.solid, noAlpha: DBG.noalpha, noCull: DBG.nocull, fullBright: DBG.full,
        fogColor: env.fog, fogStart, fogEnd, underwater: under,
        highlight, breakInfo,
        heldType: hud.screen === 'game' && hud.hotbar[hud.selected] ? hud.hotbar[hud.selected].type : 0,
        heldSwing: player.swing
      });

      /* HUD */
      hud.tick(dt);
      if (!hud.hidden && !DBG.hideHud) hud.draw(game); else { const c = hud.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, hud.canvas.width, hud.canvas.height); }

      /* FPS */
      game.frameCount++;
      game.fpsTimer += dt;
      if (game.fpsTimer >= 0.5) {
        game.fps = Math.round(game.frameCount / game.fpsTimer);
        game.frameCount = 0; game.fpsTimer = 0;
      }

      /* 诊断信息 (供自动化测试读取) */
      if (!window.__diagEl) {
        const d = document.createElement('pre');
        d.id = 'diag';
        d.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:1px;';
        document.body.appendChild(d);
        window.__diagEl = d;
      }
      if (now - (game._diagT || 0) > 500) {
        game._diagT = now;
        const p = player.pos;
        window.__diagEl.textContent = JSON.stringify({
          pos: [+p[0].toFixed(1), +p[1].toFixed(1), +p[2].toFixed(1)],
          yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3),
          below: world.getBlockFast(Math.floor(p[0]), Math.floor(p[1]) - 1, Math.floor(p[2])) & 0xFFF,
          onGround: player.onGround, flying: player.flying, inWater: player.inWater,
          chunks: world.chunks.size, meshed: renderer.visible.length,
          draws: renderer.drawCalls, tris: Math.round(renderer.triangles),
          fps: game.fps, frames: frameNo, target: game.target ? (MC.Blocks.byType[game.target.type] || {}).id : null,
          time: Math.round(game.worldTime), dayLight: game._env ? +game._env.dayLight.toFixed(2) : null,
          lightAbove: world.getLightFast(Math.floor(p[0]), Math.floor(p[1]) + 1, Math.floor(p[2])) >> 4,
          screen: hud.screen, autolog: window.__autolog || '',
          sceneLight: (function () {
            const p2 = window.__sceneLightPos;
            if (!p2) return null;
            const lv = world.getLightFast(p2[0], p2[1], p2[2]);
            return [(lv >> 4), (lv & 15), world.getBlockFast(p2[0], p2[1], p2[2]) & 0xFFF];
          })(),
          dirtyChunks: (function () { let n = 0; for (const c of world.chunks.values()) if (c.dirty) n++; return n; })(),
          wallChunk: (function () {
            const p2 = window.__sceneLightPos;
            if (!p2) return null;
            const c = world.chunks.get((p2[0] >> 4) + ',' + (p2[2] >> 4));
            if (!c) return 'no chunk';
            return { dirty: c.dirty, relight: !!c.needsRelight, lit: c.lit, mesh: c.mesh.opaque ? c.mesh.opaque.count : -1, dbg: c._dbg };
          })(),
          animFrames: [(textures.anim.water || {}).frames || 0, (textures.anim.lava || {}).frames || 0],
          texArrays: textures.arrays.length, texCount: textures.names.length,
          self: window.__selfcheck || null,
          bench: window.__bench || null,
          glErr: gl.getError()
        });
      }
    }

    requestAnimationFrame(frame);

    /* 淡出加载界面 */
    setTimeout(() => {
      boot.style.opacity = '0';
      setTimeout(() => {
        boot.style.display = 'none';
        requestLock();
      }, 400);
      hud.addMessage('§e欢迎来到 Minecraft 1.16.5 网页版！');
      hud.addMessage('§7WASD 移动 · 空格跳跃 · 双击空格飞行 · 左键破坏 · 右键放置');
      hud.addMessage('§7E 物品栏 · T 聊天 · F3 调试 · Esc 菜单');
    }, 200);
  }

  boot0().catch(fail);
})(window.MC);

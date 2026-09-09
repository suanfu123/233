/* ============================================================
 *  player.js — 玩家物理 / 射线拾取 / 放置与破坏
 * ============================================================ */
(function (MC) {
  'use strict';

  const HW = 0.3, HEIGHT = 1.8, EYE = 1.62;
  const GRAVITY = 32, JUMP_V = 8.6, TERMINAL = 78;

  const SPEED = { walk: 4.317, sprint: 5.612, sneak: 1.31, fly: 10.9, flySprint: 21.8, flyVertical: 7.5, swim: 2.6 };

  class Player {
    constructor(world) {
      this.world = world;
      this.pos = [0.5, 80, 0.5];
      this.vel = [0, 0, 0];
      this.yaw = 0; this.pitch = 0;
      this.onGround = false;
      this.flying = false;
      this.sneaking = false;
      this.sprinting = false;
      this.inWater = false;
      this.headInWater = false;
      this.mode = 'creative';
      this.reach = 5.0;
      this.lastSpaceTap = 0;
      this.fallDistance = 0;
      this.health = 20;
      this.stepDistance = 0;
      this.bob = 0;
      this.swing = 0;
      this.breaking = { x: 0, y: 0, z: 0, time: 0, stage: -1 };
    }

    get eyeY() { return this.pos[1] + EYE - (this.sneaking ? 0.22 : 0); }

    eye() { return [this.pos[0], this.eyeY, this.pos[2]]; }

    forward() {
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      return [-sy * cp, sp, -cy * cp];
    }

    aabb(px, py, pz) {
      const x = px === undefined ? this.pos[0] : px;
      const y = py === undefined ? this.pos[1] : py;
      const z = pz === undefined ? this.pos[2] : pz;
      return [x - HW, y, z - HW, x + HW, y + HEIGHT, z + HW];
    }

    /* ---------------- 物理 ---------------- */
    update(dt, input) {
      dt = Math.min(dt, 0.05);
      const world = this.world;
      const TY = world.gen.TYPES;

      /* 所处环境 */
      const fx = Math.floor(this.pos[0]), fz = Math.floor(this.pos[2]);
      const feet = world.getBlockFast(fx, Math.floor(this.pos[1] + 0.1), fz);
      const head = world.getBlockFast(fx, Math.floor(this.eyeY), fz);
      this.inWater = (feet & 0xFFF) === TY.water;
      this.headInWater = (head & 0xFFF) === TY.water;
      const inLava = (feet & 0xFFF) === TY.lava;

      /* 输入方向 */
      let mx = 0, mz = 0;
      if (input.forward) mz -= 1;
      if (input.back) mz += 1;
      if (input.left) mx -= 1;
      if (input.right) mx += 1;
      const len = Math.hypot(mx, mz);
      if (len > 0) { mx /= len; mz /= len; }

      this.sneaking = input.sneak && !this.flying;
      this.sprinting = input.sprint && !this.sneaking && len > 0;

      /* 速度 */
      let speed;
      if (this.flying) speed = this.sprinting ? SPEED.flySprint : SPEED.fly;
      else if (this.inWater) speed = SPEED.swim;
      else if (this.sneaking) speed = SPEED.sneak;
      else speed = this.sprinting ? SPEED.sprint : SPEED.walk;
      if (!this.onGround && !this.flying && !this.inWater) speed *= 0.99;

      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      // 前方向 (-sy,-cy), 右方向 (cy,-sy)
      const wx = (-sy * -mz) + (cy * mx);
      const wz = (-cy * -mz) + (-sy * mx);

      /* 飞行切换 (双击空格) */
      if (this.mode === 'creative') {
        if (input.spacePressed) {
          const now = performance.now();
          if (now - this.lastSpaceTap < 300) { this.flying = !this.flying; this.vel[1] = 0; }
          this.lastSpaceTap = now;
        }
      } else this.flying = false;

      /* 竖直速度 */
      if (this.flying) {
        let vy = 0;
        if (input.jump && input.sneak) {
          vy = 0;
        } else {
          if (input.jump) vy = SPEED.flyVertical;
          if (input.sneak) vy = -SPEED.flyVertical;
        }
        this.vel[1] = vy;
      } else if (this.inWater) {
        this.vel[1] -= GRAVITY * 0.18 * dt;
        if (this.vel[1] < -6) this.vel[1] = -6;
        if (input.jump) this.vel[1] = 3.2;
      } else {
        this.vel[1] -= GRAVITY * dt;
        if (inLava) this.vel[1] -= GRAVITY * 0.4 * dt;
        if (this.vel[1] < -TERMINAL) this.vel[1] = -TERMINAL;
        if (input.jump && this.onGround) {
          this.vel[1] = JUMP_V;
          this.onGround = false;
        }
      }

      /* 水平速度 (直接设定, 手感更接近) */
      const targetX = wx * speed, targetZ = wz * speed;
      let accel;
      if (this.flying) {
        accel = len > 0 ? 3.0 : 0.8;
      } else if (this.onGround || this.inWater) {
        accel = 12;
      } else {
        accel = 3.2;
      }
      const k = Math.min(1, accel * dt);
      this.vel[0] += (targetX - this.vel[0]) * k;
      this.vel[2] += (targetZ - this.vel[2]) * k;

      /* 移动 + 碰撞 */
      const before = this.pos[1];
      this.onGround = false;
      this.moveAxis(0, this.vel[0] * dt);
      this.moveAxis(2, this.vel[2] * dt);
      this.moveAxis(1, this.vel[1] * dt);

      if (this.onGround) {
        if (this.fallDistance > 3 && this.mode === 'survival') {
          this.health = Math.max(0, this.health - Math.floor(this.fallDistance - 3));
        }
        this.fallDistance = 0;
      } else if (this.vel[1] < 0) {
        this.fallDistance += (before - this.pos[1]);
      }

      /* 视角摇晃 */
      const horiz = Math.hypot(this.vel[0], this.vel[2]);
      if (this.onGround && horiz > 0.5) {
        this.stepDistance += horiz * dt;
        this.bob = Math.sin(this.stepDistance * 1.9) * Math.min(1, horiz / 5.6) * 0.055;
      } else {
        this.bob *= 0.9;
      }
      if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4.2);

      /* 掉出世界 */
      if (this.pos[1] < -20) { this.pos[1] = 90; this.vel = [0, 0, 0]; }
    }

    moveAxis(axis, amount) {
      if (amount === 0) return;
      const p = this.pos;
      p[axis] += amount;
      let b = this.aabb();
      const x0 = Math.floor(b[0]), x1 = Math.floor(b[3]);
      const y0 = Math.floor(b[1]), y1 = Math.floor(b[4]);
      const z0 = Math.floor(b[2]), z1 = Math.floor(b[5]);
      const B = MC.Blocks;

      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const id = this.world.getBlockFast(x, y, z);
            if (id === 0) continue;
            const type = id & 0xFFF;
            if (!B.solidOf(type)) continue;
            const boxes = B.boxesFor(type, id >> 12);
            if (!boxes) continue;
            for (const bx of boxes) {
              const X0 = x + bx[0], Y0 = y + bx[1], Z0 = z + bx[2];
              const X1 = x + bx[3], Y1 = y + bx[4], Z1 = z + bx[5];
              b = this.aabb();
              if (b[3] <= X0 || b[0] >= X1 || b[4] <= Y0 || b[1] >= Y1 || b[5] <= Z0 || b[2] >= Z1) continue;
              const eps = 1e-4;
              if (axis === 0) {
                if (amount > 0) p[0] = X0 - HW - eps; else p[0] = X1 + HW + eps;
                this.vel[0] = 0;
              } else if (axis === 2) {
                if (amount > 0) p[2] = Z0 - HW - eps; else p[2] = Z1 + HW + eps;
                this.vel[2] = 0;
              } else {
                if (amount > 0) { p[1] = Y0 - HEIGHT - eps; this.vel[1] = 0; }
                else {
                  p[1] = Y1 + eps; this.vel[1] = 0; this.onGround = true;
                  if (this.flying && this.mode === 'creative') {
                    this.flying = false;
                  }
                }
              }
            }
          }
        }
      }
    }

    /* ---------------- 射线拾取 ---------------- */
    raycast(maxDist) {
      maxDist = maxDist || this.reach;
      const o = this.eye();
      const d = this.forward();
      const B = MC.Blocks;

      let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
      const stepX = d[0] > 0 ? 1 : -1, stepY = d[1] > 0 ? 1 : -1, stepZ = d[2] > 0 ? 1 : -1;
      const tDeltaX = Math.abs(1 / (d[0] || 1e-9));
      const tDeltaY = Math.abs(1 / (d[1] || 1e-9));
      const tDeltaZ = Math.abs(1 / (d[2] || 1e-9));
      let tMaxX = ((d[0] > 0 ? (x + 1 - o[0]) : (o[0] - x)) || 1e-9) * tDeltaX;
      let tMaxY = ((d[1] > 0 ? (y + 1 - o[1]) : (o[1] - y)) || 1e-9) * tDeltaY;
      let tMaxZ = ((d[2] > 0 ? (z + 1 - o[2]) : (o[2] - z)) || 1e-9) * tDeltaZ;
      let t = 0, face = -1;

      for (let i = 0; i < 200; i++) {
        const id = this.world.getBlockFast(x, y, z);
        if (id !== 0) {
          const type = id & 0xFFF;
          const def = B.byType[type];
          if (def && (def.solid || def.liquid || def.render !== 'none')) {
            const boxes = def.solid ? (B.boxesFor(type, id >> 12) || [[0, 0, 0, 1, 1, 1]]) : [[0, 0, 0, 1, 1, 1]];
            let best = null, bestT = 1e9;
            for (const bx of boxes) {
              const hit = rayBox(o, d, x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5], maxDist);
              if (hit && hit.t < bestT) { bestT = hit.t; best = { box: bx, t: hit.t, face: hit.face }; }
            }
            if (best) return { x, y, z, type, id, box: best.box, t: best.t, face: best.face };
          }
        }
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
          x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 4 : 5;
        } else if (tMaxY < tMaxZ) {
          y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 0 : 1;
        } else {
          z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 2 : 3;
        }
        if (t > maxDist) break;
        if (y < -2 || y > MC.HEIGHT + 2) break;
      }
      return null;
    }
  }

  function rayBox(o, d, x0, y0, z0, x1, y1, z1, maxT) {
    let tmin = 0, tmax = maxT, face = -1;
    const p = [o[0], o[1], o[2]], dd = [d[0], d[1], d[2]];
    const lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) {
        if (p[a] < lo[a] || p[a] > hi[a]) return null;
        continue;
      }
      let t1 = (lo[a] - p[a]) / dd[a], t2 = (hi[a] - p[a]) / dd[a];
      /* 入口平面决定面朝向: 向 + 方向走从 lo 进入(低面), 向 - 方向走从 hi 进入(高面) */
      const f = dd[a] > 0 ? (a === 0 ? 4 : a === 1 ? 0 : 2) : (a === 0 ? 5 : a === 1 ? 1 : 3);
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) { tmin = t1; face = f; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmin < 0 || tmin > maxT) return null;
    return { t: tmin, face };
  }

  /* ---------------- 放置方向 ---------------- */
  function rotationFor(type, hit, player) {
    const def = MC.Blocks.byType[type];
    if (!def) return 0;
    const fx = -player.forward()[0], fz = -player.forward()[2];
    if (def.kind === 'facing') {
      if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
      return fz > 0 ? 2 : 0;
    }
    if (def.kind === 'axis') {
      if (hit.face === 0 || hit.face === 1) return 0;
      if (hit.face === 4 || hit.face === 5) return 1;
      return 2;
    }
    if (def.kind === 'stairs') {
      const f = player.forward();
      if (Math.abs(f[0]) > Math.abs(f[2])) return f[0] > 0 ? 1 : 3;
      return f[2] > 0 ? 2 : 0;
    }
    if (def.kind === 'slab') {
      if (hit.face === 1 && (player.eyeY - hit.y) > 1.5) return 1;
      if (hit.face === 0 && (player.eyeY - hit.y) < 0) return 1;
      return 0;
    }
    return 0;
  }

  MC.Player = Player;
  MC.PlayerUtil = { rotationFor, rayBox, HW, HEIGHT, EYE };
})(window.MC);

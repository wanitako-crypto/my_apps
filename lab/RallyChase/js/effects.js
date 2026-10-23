'use strict';
// エフェクト:パーティクル、土煙、スコアのポップ、画面フラッシュ、スピードライン、タイヤ痕

// タイヤ痕:横滑りが大きいときに後輪の軌跡を線分で残す。古いものから薄くなって消える
class TireMarks {
  constructor() { this.clear(); }
  clear() { this.segs = []; this.prev = null; }

  update(car, P, time) {
    const e = P.effects;
    const on = car.grounded && car.speed > 60 && (car.slip > e.tireMarkSlip || (car.handbrake && car.speed > 120));
    const w = car.rearWheels();
    if (on && this.prev) {
      const a = clamp(car.slip / 600, 0.35, 1);
      this.segs.push({ x1: this.prev[0], y1: this.prev[1], x2: w[0], y2: w[1], t: time, a });
      this.segs.push({ x1: this.prev[2], y1: this.prev[3], x2: w[2], y2: w[3], t: time, a });
    }
    this.prev = on ? w : null;
    let n = 0;
    while (n < this.segs.length && time - this.segs[n].t > e.tireMarkLife) n++;
    if (this.segs.length - n > 8000) n = this.segs.length - 8000;
    if (n > 0) this.segs.splice(0, n);
  }

  // 濃さを数段階に分け、段階ごとにまとめて描く
  draw(ctx, time, P) {
    const life = P.effects.tireMarkLife, B = 6;
    const paths = [];
    for (let i = 0; i < B; i++) paths.push([]);
    for (const s of this.segs) {
      const f = s.a * (1 - (time - s.t) / life);
      if (f <= 0) continue;
      paths[Math.min(B - 1, Math.floor(f * B))].push(s);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    for (let i = 0; i < B; i++) {
      if (!paths[i].length) continue;
      ctx.strokeStyle = `rgba(35,28,20,${((i + 1) / B * 0.42).toFixed(3)})`;
      ctx.beginPath();
      for (const s of paths[i]) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
      ctx.stroke();
    }
  }
}

// スピードライン:ワールドに固定した点から、車の進行方向と逆向きに線を引く。
// 点は地面と同じ速さで画面を流れるので、速さがそのまま線の流れに出る
class SpeedLines {
  constructor() { this.pts = []; this.alpha = 0; }

  update(dt, car, view, P) {
    const e = P.effects;
    this.alpha = smoothstep(e.speedLineStart, 1, car.speed / P.car.maxSpeed) * e.speedLines;
    const n = Math.round(e.speedLineCount);
    if (this.pts.length > n) this.pts.length = n;
    while (this.pts.length < n) this.pts.push(this.spawn(view, car, Math.random()));
    const w = view.x1 - view.x0, h = view.y1 - view.y0;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i];
      p.age += dt;
      const out = p.x < view.x0 - w * 0.1 || p.x > view.x1 + w * 0.1 || p.y < view.y0 - h * 0.1 || p.y > view.y1 + h * 0.1;
      if (p.age > p.life || out) this.pts[i] = this.spawn(view, car, 0);
    }
  }

  // 進行方向の少し先寄りに置き直す
  spawn(view, car, age01) {
    const w = view.x1 - view.x0, h = view.y1 - view.y0;
    const life = 0.35 + Math.random() * 0.5;
    return {
      x: view.x0 + Math.random() * w + car.vx * 0.25,
      y: view.y0 + Math.random() * h + car.vy * 0.25,
      age: age01 * life, life,
    };
  }

  draw(ctx, car, P, zoom) {
    if (this.alpha <= 0.01) return;
    const sp = car.speed;
    if (sp < 1) return;
    const len = sp * P.effects.speedLineLen;
    const dx = car.vx / sp * len, dy = car.vy / sp * len;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2 / zoom;
    for (const p of this.pts) {
      // 出始めと消え際はフェードさせる
      const t = p.age / p.life;
      const f = Math.min(1, t * 6) * Math.min(1, (1 - t) * 4);
      ctx.strokeStyle = `rgba(255,255,255,${(this.alpha * f * 0.45).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dx, p.y - dy); ctx.stroke();
    }
  }
}

class Effects {
  constructor() { this.clear(); }

  clear() {
    this.dust = [];
    this.parts = [];
    this.popups = [];
    this.flash = 0;
  }

  // o: { speed, up, life, size, color, gravity }
  burst(x, y, z, n, o) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = o.speed * (0.4 + Math.random() * 0.6);
      const life = o.life * (0.6 + Math.random() * 0.4);
      this.parts.push({
        x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: o.up * (0.5 + Math.random()),
        life, max: life, size: o.size * (0.6 + Math.random() * 0.8),
        color: o.color, g: o.gravity,
      });
    }
  }

  popup(x, y, z, text) {
    this.popups.push({ x, y, z, text, life: 0.9, max: 0.9 });
  }

  // 土煙:広がりながら薄くなる円。vx, vy は初速
  addDust(x, y, vx, vy, r, life, color) {
    if (this.dust.length > 600) return;
    this.dust.push({ x, y, vx, vy, r, grow: r * 2.2, life, max: life, color });
  }

  update(dt) {
    for (const p of this.dust) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = Math.exp(-3 * dt);
      p.vx *= k; p.vy *= k;
      p.r += p.grow * dt;
      p.life -= dt;
    }
    this.dust = this.dust.filter(p => p.life > 0);
    for (const p of this.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
      p.life -= dt;
    }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const p of this.popups) { p.z += 90 * dt; p.life -= dt; }
    this.popups = this.popups.filter(p => p.life > 0);
    this.flash = Math.max(0, this.flash - dt * 4);
  }

  // 土煙は車より下に描く
  drawDust(ctx) {
    for (const p of this.dust) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.32;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx, P) {
    for (const p of this.parts) {
      const hv = heightVisual(p.x, p.y, p.z);
      const s = p.size * hv.s;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(hv.x - s / 2, hv.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px system-ui, sans-serif';
    // スコアのポップは表示物なので、高さではなく画面の上方向へ浮かせる
    for (const p of this.popups) {
      const y = p.y - p.z * 0.6;
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = '#3a2600';
      ctx.fillText(p.text, p.x + 2, y + 2);
      ctx.fillStyle = '#ffe66a';
      ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // 画面座標で描くもの(フラッシュ)
  drawScreen(ctx, w, h) {
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,250,210,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

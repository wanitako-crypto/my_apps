'use strict';
// カメラ:なめらかな追従、速度に応じた先読みとズーム、画面揺れ

class Camera {
  constructor() { this.reset(0, 0); }

  reset(x, y) {
    this.x = x; this.y = y; this.zoom = 1;
    this.lx = 0; this.ly = 0;     // 先読みのずれ
    this.trauma = 0;              // 画面揺れの残量(0〜1)
    this.sx = 0; this.sy = 0;     // 画面揺れのずれ
    this.t = 0;
  }

  update(dt, car, P, vw, vh) {
    const c = P.camera;
    // 先読み:速度方向に速度に比例してずらす。ドリフトで向きが急に変わっても揺れないよう、なめらかに追う
    let tx = car.vx * c.lookAhead, ty = car.vy * c.lookAhead;
    const l = Math.hypot(tx, ty);
    if (l > c.lookAheadMax) { tx *= c.lookAheadMax / l; ty *= c.lookAheadMax / l; }
    // 車が画面外に出ないよう、画面の縦横に合わせて制限する
    const hw = vw / 2 / this.zoom, hh = vh / 2 / this.zoom;
    tx = clamp(tx, -hw * 0.6, hw * 0.6);
    ty = clamp(ty, -hh * 0.6, hh * 0.6);
    const k = damp(c.lookSmooth, dt);
    this.lx += (tx - this.lx) * k;
    this.ly += (ty - this.ly) * k;

    const f = damp(c.follow, dt);
    this.x += (car.x + this.lx - this.x) * f;
    this.y += (car.y + this.ly - this.y) * f;

    const sp = clamp(car.speed / P.car.maxSpeed, 0, 1);
    this.zoom += (lerp(c.zoomSlow, c.zoomFast, sp) - this.zoom) * damp(c.zoomSmooth, dt);

    this.t += dt;
    this.trauma = Math.max(0, this.trauma - c.shakeDecay * dt);
    const amp = this.trauma * this.trauma * c.shake * 28;
    this.sx = amp * (Math.sin(this.t * 53.1) + Math.sin(this.t * 31.7 + 1.3)) * 0.5;
    this.sy = amp * (Math.sin(this.t * 47.3 + 2.1) + Math.sin(this.t * 27.9 + 0.4)) * 0.5;
    // 高速時の微振動(画面のピクセル単位で一定の大きさになるようズームで割る)
    this.vib = smoothstep(P.effects.vibrationStart, 1, sp) * P.effects.vibration;
    if (this.vib > 0) {
      this.sx += (Math.random() - 0.5) * this.vib * 3 / this.zoom;
      this.sy += (Math.random() - 0.5) * this.vib * 3 / this.zoom;
    }
  }

  addShake(a) { this.trauma = Math.min(1, this.trauma + a); }

  viewRect(vw, vh) {
    const hw = vw / 2 / this.zoom, hh = vh / 2 / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  worldToScreen(x, y, vw, vh) {
    return {
      x: (x - this.x - this.sx) * this.zoom + vw / 2,
      y: (y - this.y - this.sy) * this.zoom + vh / 2,
    };
  }

  apply(ctx, vw, vh) {
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-(this.x + this.sx), -(this.y + this.sy));
  }
}

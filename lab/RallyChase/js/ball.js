'use strict';
// ボール:物理シミュレーションではなく決まったルールで動く
// 水平速度は常に一定、一直線に飛び、バウンドした瞬間だけ地形の傾きで少し曲がる


class Ball {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0; this.vz = 0;
    this.dirX = 1; this.dirY = 0;
    this.cooldown = 0;   // 射出直後に即捕獲されないための待ち時間
    this.bounces = 0;
    this.boost = 1;      // 射出直後だけの速度倍率。最初の着地で1に戻る
    this.visRef = 0;     // 見た目の高さの基準
  }

  // 捕獲判定:車とボールが触れる距離に余裕を足す。大きなボールほど取りやすい
  captureDist(P) { return CAR_RADIUS + P.ball.size + P.ball.captureMargin; }
  captureDz(P) { return P.ball.captureHeight + P.ball.size; }

  // 水平速度は車の最高速に対する比で決める(最高速を変えても追いつけるように)
  speed(P) { return P.ball.speedRatio * P.car.maxSpeed * this.boost; }

  launch(x, y, z, angle, P, high) {
    this.x = x; this.y = y; this.z = z;
    this.visRef = z;
    this.dirX = Math.cos(angle); this.dirY = Math.sin(angle);
    const h = high ? P.ball.launchHeight : P.ball.bounceHeight;
    this.vz = Math.sqrt(2 * P.ball.gravity * h);
    this.cooldown = high ? 0.35 : 0;
    this.boost = 1;
    if (high) {
      // 指定した距離(m)の先に着地するよう、射出中の水平速度を決める(平地での滞空時間から逆算)
      const b = P.ball;
      const meters = lerp(b.launchDistMin, Math.max(b.launchDistMin, b.launchDistMax), Math.random());
      const flight = 2 * this.vz / b.gravity;
      this.boost = Math.max(1, meters * PX_PER_METER / flight / (b.speedRatio * P.car.maxSpeed));
    }
  }

  update(dt, P, world) {
    const b = P.ball;
    const s = this.speed(P);
    this.x += this.dirX * s * dt;
    this.y += this.dirY * s * dt;
    this.vz -= b.gravity * dt;
    this.z += this.vz * dt;
    const g = world.height(this.x, this.y);
    // 見た目の高さの基準は車と同じ規則:空中ではゆっくり地面に寄せる
    // (普段の小さなバウンドは接地の間隔が短いので、射出中より速めに寄せる)
    const rate = P.height.airRefFollow * (this.boost > 1 ? 1 : 3);
    this.visRef += (g - this.visRef) * damp(rate, dt);
    if (this.visRef > this.z) this.visRef = this.z;
    if (this.z <= g && this.vz <= 0) {
      if (this.visRef > g) this.visRef = g;
      // バウンドの高さは毎回一定(減衰しない)
      this.z = g;
      this.boost = 1;
      this.vz = Math.sqrt(2 * b.gravity * b.bounceHeight);
      this.bounceTurn(world, P);
      this.bounces++;
    }
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  // 地形の下り方向へ進行方向を少し曲げる。1回あたりの角度に上限あり
  bounceTurn(world, P) {
    const gr = world.gradient(this.x, this.y);
    const downX = -gr.x, downY = -gr.y;
    if (Math.hypot(downX, downY) < 1e-5) return;
    const cross = this.dirX * downY - this.dirY * downX;
    const maxTurn = P.ball.maxTurnDeg * Math.PI / 180;
    const turn = clamp(cross * P.ball.turnStrength * Math.PI / 180, -maxTurn, maxTurn);
    const c = Math.cos(turn), s = Math.sin(turn);
    const nx = this.dirX * c - this.dirY * s, ny = this.dirX * s + this.dirY * c;
    // 曲げたあと、水平方向の向きを単位ベクトルに正規化する(速さは speed() で一定)
    const l = Math.hypot(nx, ny);
    this.dirX = nx / l; this.dirY = ny / l;
  }

  // 障害物の上を通るときは、障害物の上面に影を落とす
  drawShadow(ctx, P, world) {
    const sh = world.shadowAt(this.x, this.y, this.z);
    const sv = shadowVisual(Math.max(0, this.z - this.visRef - sh.surf), P.height);
    const p = heightVisual(this.x + 2 + sv.dx, this.y + 2 + sv.dy, sh.surf);
    ctx.fillStyle = `rgba(0,0,0,${0.4 * sv.a})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, P.ball.size * sv.s * p.s, P.ball.size * sv.s * p.s * 0.85, 0, 0, TAU);
    ctx.fill();
  }

  drawBody(ctx, P, world) {
    const hv = heightVisual(this.x, this.y, Math.max(0, this.z - this.visRef));
    const r = P.ball.size * hv.s;
    const x = hv.x, y = hv.y;
    // 見つけやすいよう外側に淡い輪
    ctx.fillStyle = 'rgba(255,255,220,0.28)';
    ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.fill();
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, '#fffbe0');
    grad.addColorStop(0.45, '#ffd83a');
    grad.addColorStop(1, '#e09a00');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5a3a00'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

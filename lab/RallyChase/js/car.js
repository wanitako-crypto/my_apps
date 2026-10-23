'use strict';
// 車:アーケード型の自作物理

const CAR_LEN = 46, CAR_WID = 24;
const CAR_RADIUS = 20;   // 当たり判定(円)

class Car {
  constructor() { this.reset(0, 0, -Math.PI / 2); }

  reset(x, y, angle) {
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.angle = angle; this.angVel = 0;
    this.grounded = true;
    this.steerVis = 0;      // 前輪の見た目の切れ角
    this.slip = 0;          // 横滑りの速さ(ドリフト判定・エフェクト用)
    this.fwdSpeed = 0;
    this.handbrake = false;
    this.landTimer = 0;     // 着地直後のグリップ低下の残り時間
    this.landImpact = 0;    // このステップで着地したときの衝撃(0なら着地なし)
    this.squash = 0;        // 着地のつぶれ(見た目)
    this.airTime = 0;
    this.vib = 0;           // 高速時の微振動の強さ(見た目)
    this.visRef = 0;        // 見た目の高さの基準(接地中は地面、空中ではゆっくり地面に寄る)
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  update(dt, inp, P, world) {
    const c = P.car;
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const rx = -fy, ry = fx;
    // 速度を車の向きに対する前後成分と横成分に分解する
    let vF = this.vx * fx + this.vy * fy;
    let vS = this.vx * rx + this.vy * ry;
    const steerIn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const hb = inp.handbrake;
    this.handbrake = hb;
    this.braking = inp.down && vF > 10;
    // 低速の度合い(停止で1、低速の範囲を超えると0)。低速時だけトルク・グリップを上げ、斜面の影響を弱める。
    // 高速では0になるので、ドリフトの挙動は変わらない
    const lo = 1 - smoothstep(0, c.lowSpeedRange, Math.hypot(vF, vS));
    this.lowSpeed = lo;

    if (this.grounded) {
      // 前後:アクセル・ブレーキ・バック
      const accel = c.accel * (1 + c.lowSpeedTorque * lo);
      if (inp.up) {
        if (vF < -10) vF += c.brake * dt;
        else if (vF < c.maxSpeed) vF = Math.min(c.maxSpeed, vF + accel * dt);
      }
      if (inp.down) {
        if (vF > 10) vF = Math.max(0, vF - c.brake * dt);
        else if (vF > -c.reverseMax) vF = Math.max(-c.reverseMax, vF - accel * 0.6 * dt);
      }
      // 前後摩擦は惰性で走るときだけ。アクセル中にもかけると「加速÷摩擦」の速度で頭打ちになり、
      // 加速が小さいと最高速に届かなくなる(アクセル中はエンジンが摩擦に勝つものとする)
      if (!inp.up || vF < 0) vF *= Math.exp(-c.fwdFriction * dt);
      if (hb) vF *= Math.exp(-c.handbrakeDrag * dt);

      // 横:摩擦で横滑りを打ち消す。ただし打ち消せる量には上限があり、超えると滑る
      const landMul = this.landTimer > 0 ? c.landGripMul : 1;   // 着地直後はグリップが下がる
      const loGrip = hb ? 1 : 1 + c.lowSpeedGrip * lo;          // サイドブレーキ中は低速でも滑らせる
      const sf = (hb ? c.handbrakeSideFriction : c.sideFriction) * landMul * loGrip;
      const lim = (hb ? c.handbrakeGripLimit : c.gripLimit) * landMul * loGrip * dt;
      const dS = clamp(vS * (1 - Math.exp(-sf * dt)), -lim, lim);
      vS -= dS;

      // ハンドル:停止中は回らず、超高速では効きが落ちる
      const spd = Math.hypot(vF, vS);
      const dir = vF >= -5 ? 1 : -1;
      let k = clamp(spd / c.steerFullSpeed, 0, 1);
      const hs = clamp(spd / c.maxSpeed, 0, 1.5);
      k *= Math.max(0.1, 1 - c.steerHighSpeedLoss * hs * hs);
      if (hb) k *= c.handbrakeSteerBoost;
      const target = steerIn * c.steer * k * dir;
      this.angVel += (target - this.angVel) * damp(c.steerResponse, dt);
    } else {
      // 空中:アクセル・ハンドルは効かず、慣性のまま飛ぶ
      this.angVel *= Math.exp(-0.5 * dt);
    }

    // 回転する前の向きで速度を組み立てる(向きだけ先に変わることで横滑りが生まれる)
    this.vx = fx * vF + rx * vS;
    this.vy = fy * vF + ry * vS;
    if (this.grounded) {
      // 斜面では下り方向へ力がかかる(傾いた丘で横滑りする)。低速時はタイヤが踏ん張るので弱める
      const gr = world.gradient(this.x, this.y);
      const slope = c.gravity * c.slopeSlide * lerp(1, c.slopeLowSpeed, this.lowSpeed);
      this.vx -= gr.x * slope * dt;
      this.vy -= gr.y * slope * dt;
    }
    this.angle += this.angVel * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.updateVertical(dt, P, world);

    this.fwdSpeed = vF;
    this.slip = Math.abs(vS);
    this.steerVis += (steerIn * 0.45 - this.steerVis) * damp(14, dt);
    if (this.landTimer > 0) this.landTimer -= dt;
    this.squash *= Math.exp(-12 * dt);
  }

  // 高さ方向:接地中は地形に沿い、地形が重力より速く下がれば離陸する
  updateVertical(dt, P, world) {
    const c = P.car;
    const g = world.height(this.x, this.y);
    const gr = world.gradient(this.x, this.y);
    // 地形に沿って走ったときの上下速度(水平速度と勾配の内積)。
    // ジャンプ台の側面のような急な段差で真上に打ち上がらないよう、水平速度に比例した上限をつける
    const vzT = Math.min(this.vx * gr.x + this.vy * gr.y, this.speed * c.maxClimbRatio);
    this.landImpact = 0;
    if (this.grounded) {
      const fall = this.vz - c.gravity * dt;   // 重力だけで下がれる速さ
      // 重力だけで落ちた場合の高さより地面が低くなったら離陸する(丘の頂上で自然に投げ出される)。
      // 傾きではなく実際の高さで比べるので、ジャンプ台の先端の段差を1ステップで越えても判定できる
      const zAir = this.z + fall * dt;
      if (g < zAir) {
        // 丘の頂上や段差の先:地面が車より速く下がるので離陸
        this.grounded = false;
        this.vz = fall;
        this.z = zAir;
        this.airTime = 0;
      } else {
        this.z = g;
        this.vz = vzT;
        // 着地直後に見た目の高さが一気に飛ばないよう、接地中も素早く寄せる
        this.visRef += (g - this.visRef) * damp(20, dt);
        if (this.visRef > this.z) this.visRef = this.z;
      }
      return;
    }
    this.airTime += dt;
    this.vz -= c.gravity * dt;
    this.z += this.vz * dt;
    // 見た目の高さの基準は、空中ではゆっくり地面に寄せる(真下の起伏で車が上下して見えないように)
    this.visRef += (g - this.visRef) * damp(P.height.airRefFollow, dt);
    if (this.visRef > this.z) this.visRef = this.z;
    if (this.z <= g) {
      // 着地。落下の速さ(地面との相対)が大きいと少しバウンドする
      const impact = vzT - this.vz;
      this.z = g;
      if (this.visRef > g) this.visRef = g;
      const bounce = impact > 250 ? impact * c.landBounce : 0;
      if (bounce > 60) {
        this.vz = vzT + bounce;
      } else {
        this.vz = vzT;
        this.grounded = true;
      }
      this.landImpact = impact;
      // 軽く触れただけの着地では、グリップ低下やつぶれを起こさない
      if (impact > 150) {
        this.landTimer = c.landGripTime;
        this.squash = Math.max(this.squash, clamp(impact / 900, 0, 0.5));
      }
    }
  }

  // 描画に使う高さ(地面からの見た目の高さ)
  visualAlt() { return Math.max(0, this.z - this.visRef); }

  // 影を落とす面からの見た目の高さ(障害物の上なら上面から)
  visualAltOver(sh) { return Math.max(0, this.visualAlt() - sh.surf); }

  // 後輪の位置(タイヤ痕・土煙用)
  rearWheels() {
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const bx = this.x - fx * 14, by = this.y - fy * 14;
    return [bx + fy * 11, by - fx * 11, bx - fy * 11, by + fx * 11];
  }

  // 影は光源と反対へ、影を落とす面(地面か障害物の上面)からの高さに比例してずれる
  drawShadow(ctx, P, world, sh) {
    const sv = shadowVisual(this.visualAltOver(sh), P.height);
    const p = heightVisual(this.x + 3 + sv.dx, this.y + 4 + sv.dy, sh.surf);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);
    ctx.scale(sv.s * p.s, sv.s * p.s);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * sv.a})`;
    roundRectPath(ctx, -CAR_LEN / 2, -CAR_WID / 2, CAR_LEN, CAR_WID, 7);
    ctx.fill();
    ctx.restore();
  }

  drawBody(ctx, P, world) {
    const hv = heightVisual(this.x, this.y, this.visualAlt());
    ctx.save();
    // 高速時の微振動
    const jx = (Math.random() - 0.5) * this.vib * 2, jy = (Math.random() - 0.5) * this.vib * 2;
    ctx.translate(hv.x + jx, hv.y + jy);
    ctx.rotate(this.angle);
    // 着地の瞬間はサスペンションが縮んで車体がわずかに沈む(真上から見ると少し小さくなる)
    const sq = 1 - this.squash * 0.08;
    ctx.scale(hv.s * sq, hv.s * sq);
    // タイヤ(前輪はハンドルに合わせて切れる)
    ctx.fillStyle = '#1b1b1b';
    const wheel = (x, y, a) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillRect(-5, -3, 10, 6);
      ctx.restore();
    };
    wheel(-14, -12, 0); wheel(-14, 12, 0);
    wheel(14, -12, this.steerVis); wheel(14, 12, this.steerVis);
    // 車体
    ctx.fillStyle = '#e0452b';
    roundRectPath(ctx, -CAR_LEN / 2, -CAR_WID / 2 + 1, CAR_LEN, CAR_WID - 2, 6);
    ctx.fill();
    ctx.strokeStyle = '#7a1d10'; ctx.lineWidth = 1.5; ctx.stroke();
    // 白いライン
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(-CAR_LEN / 2 + 2, -2, CAR_LEN - 4, 4);
    // キャビンと窓
    ctx.fillStyle = '#8f2a1a';
    roundRectPath(ctx, -11, -8, 21, 16, 4); ctx.fill();
    ctx.fillStyle = '#9fd3f0';
    roundRectPath(ctx, 4, -7, 6, 14, 2); ctx.fill();
    ctx.fillStyle = '#6f9fb8';
    roundRectPath(ctx, -11, -6, 4, 12, 1.5); ctx.fill();
    // ライト
    ctx.fillStyle = '#fff6b0';
    ctx.fillRect(CAR_LEN / 2 - 3, -9, 3, 4);
    ctx.fillRect(CAR_LEN / 2 - 3, 5, 3, 4);
    // ブレーキランプ
    ctx.fillStyle = (this.handbrake || this.braking || this.fwdSpeed < -5) ? '#ff3030' : '#801010';
    ctx.fillRect(-CAR_LEN / 2, -9, 2.5, 4);
    ctx.fillRect(-CAR_LEN / 2, 5, 2.5, 4);
    ctx.restore();
  }

  // 高速時の残像。pose は過去の位置と向き
  drawGhost(ctx, pose, alpha, P) {
    const hv = heightVisual(pose.x, pose.y, pose.alt);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(hv.x, hv.y);
    ctx.rotate(pose.angle);
    ctx.scale(hv.s, hv.s);
    ctx.fillStyle = '#ff6a4a';
    roundRectPath(ctx, -CAR_LEN / 2, -CAR_WID / 2 + 1, CAR_LEN, CAR_WID - 2, 6);
    ctx.fill();
    ctx.restore();
  }
}

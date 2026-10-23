'use strict';
// 障害物:チャンクごとの決定的な配置、車との衝突と破壊、描画

const OB_SLOTS = 8;          // 1チャンクあたりの配置候補の数
const OB_GAP = 50;           // 障害物どうしの最小間隔
const OB_START_CLEAR = 500;  // 開始地点の周りには置かない半径

const OB_COLORS = {
  rock:     { side: '#6b655c', top: '#9b958a' },
  building: { side: '#767982', top: '#a7abb4' },
  crate:    { side: '#7a5530', top: '#b8854c' },
  fence:    { side: '#86663d', top: '#c69c60' },
  shed:     { side: '#7a4a3a', top: '#b4553d' },
};

class ObstacleField {
  constructor(world) {
    this.world = world;
    this.cand = new Map();
    this.lists = new Map();
    this.destroyed = new Set();   // 破壊済みのID。チャンクを作り直しても復活しない
  }

  reset() { this.cand.clear(); this.lists.clear(); }

  // チャンク内の配置候補(間隔のチェック前)
  candidates(cx, cy) {
    const key = cx + ',' + cy;
    if (this.cand.has(key)) return this.cand.get(key);
    const W = this.world, O = W.P.obstacles;
    const rnd = chunkRng(W.seed, cx, cy, 2);
    const out = [];
    for (let i = 0; i < OB_SLOTS; i++) {
      // 設定によらず乱数の消費数を同じにする
      const u = []; for (let k = 0; k < 10; k++) u.push(rnd());
      if (u[0] >= O.density * 0.4) continue;
      const x = (cx + u[1]) * CHUNK, y = (cy + u[2]) * CHUNK;
      const breakable = u[3] < O.breakableRatio;
      let o;
      if (breakable) {
        const s = lerp(O.breakMin, O.breakMax, u[5]);
        if (u[4] < 0.45) o = { kind: 'crate', shape: 'rect', hw: s * 0.6, hh: s * 0.6, h: 26 + s * 0.3 };
        else if (u[4] < 0.8) o = { kind: 'fence', shape: 'rect', hw: s * 1.8, hh: 5, h: 22 };
        else o = { kind: 'shed', shape: 'rect', hw: s * 1.1, hh: s * 0.85, h: 40 + s * 0.4 };
      } else {
        const R = lerp(O.solidMin, O.solidMax, u[5]);
        if (u[4] < 0.55) o = { kind: 'rock', shape: 'circle', r: R * 0.8, h: 50 + R * 0.35 };
        else o = { kind: 'building', shape: 'rect', hw: R * lerp(0.6, 0.85, u[7]), hh: R * lerp(0.45, 0.7, u[8]), h: 110 + R * 0.4 };
      }
      Object.assign(o, { id: `${cx},${cy},${i}`, x, y, rot: u[6] * Math.PI, breakable, pri: u[9] });
      o.R = o.shape === 'circle' ? o.r : Math.hypot(o.hw, o.hh);
      if (Math.hypot(x, y) < OB_START_CLEAR + o.R) continue;
      if (!this.flatEnough(x, y, o.R)) continue;
      o.base = W.height(x, y);
      o.cos = Math.cos(o.rot); o.sin = Math.sin(o.rot);
      out.push(o);
    }
    if (this.cand.size > 800) this.cand.clear();
    this.cand.set(key, out);
    return out;
  }

  // ジャンプ台の上や急斜面には置かない
  flatEnough(x, y, R) {
    const W = this.world;
    if (W.rampNear(x, y, R + 30)) return false;
    const pts = [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]];
    for (const [dx, dy] of pts) {
      const g = W.gradient(x + dx, y + dy);
      if (Math.hypot(g.x, g.y) > 0.3) return false;
    }
    return true;
  }

  // 間隔を守った確定リスト。優先度が高い(pri が小さい)ものと近すぎる候補を外す。
  // 隣のチャンクの候補も見るので、チャンクの境目でも間隔が守られる
  list(cx, cy) {
    const key = cx + ',' + cy;
    if (this.lists.has(key)) return this.lists.get(key);
    const near = [];
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) near.push(...this.candidates(i, j));
    const out = this.candidates(cx, cy).filter(c => !near.some(o =>
      o !== c && o.pri < c.pri && Math.hypot(o.x - c.x, o.y - c.y) < o.R + c.R + OB_GAP));
    if (this.lists.size > 800) this.lists.clear();
    this.lists.set(key, out);
    return out;
  }

  // 矩形の範囲にかかる、壊れていない障害物
  inRect(x0, y0, x1, y1) {
    const out = [];
    const cx0 = Math.floor(x0 / CHUNK) - 1, cx1 = Math.floor(x1 / CHUNK) + 1;
    const cy0 = Math.floor(y0 / CHUNK) - 1, cy1 = Math.floor(y1 / CHUNK) + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const o of this.list(cx, cy)) {
          if (this.destroyed.has(o.id)) continue;
          if (o.x + o.R < x0 || o.x - o.R > x1 || o.y + o.R < y0 || o.y - o.R > y1) continue;
          out.push(o);
        }
      }
    }
    return out;
  }

  contains(o, x, y) {
    const px = x - o.x, py = y - o.y;
    if (o.shape === 'circle') return px * px + py * py < o.r * o.r;
    const lx = px * o.cos + py * o.sin, ly = -px * o.sin + py * o.cos;
    return Math.abs(lx) < o.hw && Math.abs(ly) < o.hh;
  }

  // その地点にある障害物の上面の高さ(なければ null)
  topAt(x, y) {
    let top = null;
    for (const o of this.inRect(x, y, x, y)) {
      if (this.contains(o, x, y)) top = Math.max(top === null ? -Infinity : top, o.base + o.h);
    }
    return top;
  }

  // 車との衝突。戻り値 { hits: [{o, impact}], broken: [o] }
  collideCar(car, P) {
    const ev = { hits: [], broken: [] };
    const r = CAR_RADIUS;
    for (const o of this.inRect(car.x - r, car.y - r, car.x + r, car.y + r)) {
      if (car.z - o.base > o.h) continue;   // 上を飛び越えている
      let nx, ny, pen;
      const px = car.x - o.x, py = car.y - o.y;
      if (o.shape === 'circle') {
        const d = Math.hypot(px, py);
        pen = o.r + r - d;
        if (pen <= 0) continue;
        nx = d > 1e-6 ? px / d : 1; ny = d > 1e-6 ? py / d : 0;
      } else {
        const lx = px * o.cos + py * o.sin, ly = -px * o.sin + py * o.cos;
        const qx = clamp(lx, -o.hw, o.hw), qy = clamp(ly, -o.hh, o.hh);
        const ddx = lx - qx, ddy = ly - qy, d = Math.hypot(ddx, ddy);
        let nlx, nly;
        if (d > 1e-6) {
          pen = r - d;
          if (pen <= 0) continue;
          nlx = ddx / d; nly = ddy / d;
        } else {
          // 中心が矩形の中:近い辺の方向へ押し出す
          const ex = o.hw - Math.abs(lx), ey = o.hh - Math.abs(ly);
          if (ex < ey) { nlx = Math.sign(lx) || 1; nly = 0; pen = r + ex; }
          else { nlx = 0; nly = Math.sign(ly) || 1; pen = r + ey; }
        }
        nx = nlx * o.cos - nly * o.sin; ny = nlx * o.sin + nly * o.cos;
      }
      // 速ければ壊せる。壊せなければ壊せない障害物と同じく弾かれる
      if (o.breakable && car.speed >= P.break.breakSpeedRatio * P.car.maxSpeed) {
        this.destroyed.add(o.id);
        const k = 1 - P.break.breakSlow;
        car.vx *= k; car.vy *= k;
        ev.broken.push(o);
        continue;
      }
      car.x += nx * pen; car.y += ny * pen;
      const vn = car.vx * nx + car.vy * ny;
      if (vn < 0) {
        car.vx -= (1 + P.car.bounceObstacle) * vn * nx;
        car.vy -= (1 + P.car.bounceObstacle) * vn * ny;
        car.angVel += (Math.random() - 0.5) * -vn * 0.004;
        ev.hits.push({ o, impact: -vn });
      }
    }
    return ev;
  }

  // 形のパス。(ox, oy) だけずらし、上へ lift だけ持ち上げる
  shapePath(ctx, o, ox, oy) {
    ctx.beginPath();
    if (o.shape === 'circle') {
      ctx.arc(o.x + ox, o.y + oy, o.r, 0, TAU);
    } else {
      const c = this.corners(o);
      ctx.moveTo(c[0] + ox, c[1] + oy);
      for (let i = 2; i < 8; i += 2) ctx.lineTo(c[i] + ox, c[i + 1] + oy);
      ctx.closePath();
    }
  }

  // 矩形の角(時計回り)
  corners(o) {
    const out = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = sx * o.hw, ly = sy * o.hh;
      out.push(o.x + lx * o.cos - ly * o.sin, o.y + lx * o.sin + ly * o.cos);
    }
    return out;
  }

  // 影:光源と反対へ、高さに比例して伸びる
  drawShadows(ctx, list, P) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (const o of list) {
      const sv = shadowVisual(o.h, P.height);
      for (let k = 1; k <= 4; k++) {
        this.shapePath(ctx, o, sv.dx * k / 4 + 2, sv.dy * k / 4 + 2);
        ctx.fill();
      }
    }
  }

  // 真上のカメラから見た立体として描く。上面は画面の中心から外側へずれ、少し大きく見える
  draw(ctx, list, P) {
    // 中心から遠いものほど手前の物に隠れるので先に描く
    const d2 = o => (o.x - VIEW.cx) ** 2 + (o.y - VIEW.cy) ** 2;
    const sorted = list.slice().sort((a, b) => d2(b) - d2(a));
    for (const o of sorted) {
      const col = OB_COLORS[o.kind];
      const T = heightVisual(o.x, o.y, o.h);
      if (o.shape === 'circle') {
        // 側面:底面から上面へ円を重ねて筒の形にする
        const n = clamp(Math.ceil(Math.hypot(T.x - o.x, T.y - o.y) / 3), 2, 14);
        for (let i = 0; i < n; i++) {
          const t = i / n;
          ctx.fillStyle = col.side;
          ctx.beginPath(); ctx.arc(lerp(o.x, T.x, t), lerp(o.y, T.y, t), o.r * lerp(1, T.s, t), 0, TAU); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
        const r = o.r * T.s;
        ctx.fillStyle = col.top;
        ctx.beginPath(); ctx.arc(T.x, T.y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath(); ctx.arc(T.x - r * 0.3, T.y - r * 0.3, r * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.beginPath(); ctx.arc(T.x + r * 0.25, T.y + r * 0.2, r * 0.35, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(T.x, T.y, r, 0, TAU); ctx.stroke();
        continue;
      }
      const c = this.corners(o);
      const t = [];
      for (let i = 0; i < 8; i += 2) { const p = heightVisual(c[i], c[i + 1], o.h); t.push(p.x, p.y); }
      // カメラ側を向いた側面だけが見える
      for (let i = 0; i < 4; i++) {
        const ia = i * 2, ib = (i * 2 + 2) % 8;
        const ax = c[ia], ay = c[ia + 1], bx = c[ib], by = c[ib + 1];
        const nx = by - ay, ny = -(bx - ax);
        if (nx * (VIEW.cx - (ax + bx) / 2) + ny * (VIEW.cy - (ay + by) / 2) <= 0) continue;
        const nl = Math.hypot(nx, ny);
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(t[ib], t[ib + 1]); ctx.lineTo(t[ia], t[ia + 1]); ctx.closePath();
        ctx.fillStyle = col.side; ctx.fill();
        // 光源(左上)を向いた面は明るく、反対側は暗く
        const lit = (-nx * 0.6 - ny * 0.8) / nl;
        ctx.fillStyle = lit > 0 ? `rgba(255,255,255,${(0.12 * lit).toFixed(3)})` : `rgba(0,0,0,${(0.12 - 0.22 * lit).toFixed(3)})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(t[0], t[1]);
      for (let i = 2; i < 8; i += 2) ctx.lineTo(t[i], t[i + 1]);
      ctx.closePath();
      ctx.fillStyle = col.top; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      this.drawTopDetail(ctx, o, T);
    }
  }

  // 上面の模様。高さ h の水平面は、画面の中心を基準にした一様な拡大になる
  drawTopDetail(ctx, o, T) {
    ctx.save();
    ctx.translate(T.x, T.y);
    ctx.scale(T.s, T.s);
    ctx.rotate(o.rot);
    if (o.kind === 'crate') {
      ctx.strokeStyle = 'rgba(80,50,20,0.8)'; ctx.lineWidth = 2;
      ctx.strokeRect(-o.hw + 3, -o.hh + 3, o.hw * 2 - 6, o.hh * 2 - 6);
      ctx.beginPath();
      ctx.moveTo(-o.hw + 3, -o.hh + 3); ctx.lineTo(o.hw - 3, o.hh - 3);
      ctx.moveTo(o.hw - 3, -o.hh + 3); ctx.lineTo(-o.hw + 3, o.hh - 3);
      ctx.stroke();
    } else if (o.kind === 'fence') {
      ctx.fillStyle = 'rgba(90,60,30,0.8)';
      for (let x = -o.hw + 4; x < o.hw; x += 14) ctx.fillRect(x - 2, -o.hh, 4, o.hh * 2);
    } else if (o.kind === 'shed' || o.kind === 'building') {
      // 屋根の棟
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-o.hw, 0); ctx.lineTo(o.hw, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(-o.hw, -o.hh, o.hw * 2, o.hh);
    }
    ctx.restore();
  }

  drawDebug(ctx, list) {
    ctx.lineWidth = 2;
    for (const o of list) {
      ctx.strokeStyle = o.breakable ? '#40ff60' : '#ff4040';
      this.shapePath(ctx, o, 0, 0);
      ctx.stroke();
    }
  }
}

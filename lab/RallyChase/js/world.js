'use strict';
// ワールド:地形の高さ関数と、チャンク方式の地面生成・キャッシュ

const CHUNK = 512;            // 1チャンクの一辺(px)
const CELL = 8;               // 地面の色ムラの解像度(px)
const GRID = CHUNK / CELL;    // 1チャンクあたりの色ムラのマス数
const DETAIL_MARGIN = 64;     // 隣のチャンクからはみ出してくる模様を拾う幅
const BLEED = 1;              // 継ぎ目が見えないよう、各チャンクを1pxはみ出して描く
// 傾いた丘・ジャンプ台を置く格子の一辺。1マスに最大1つ
const FEATURE_LAYERS = {
  slope: { cell: 2200, salt: 3 },
  ramp: { cell: 900, salt: 4 },
};
const RAMP_DROP = 8;          // ジャンプ台の先端で高さが落ちる幅(急な段差)
const START_CLEAR = 700;      // 開始地点の周りは地形を平らにしておく半径
const CONTOUR_STEP = 25;      // 等高線の間隔(高さ)
// 陰影の光源(左上から)
const LIGHT = (() => { const l = Math.hypot(-0.55, -0.65, 0.75); return { x: -0.55 / l, y: -0.65 / l, z: 0.75 / l }; })();

class World {
  constructor(seed, P) {
    this.seed = seed | 0;
    this.P = P;
    this.nBiome = new ValueNoise(this.seed ^ 0x51a3);
    this.nMid = new ValueNoise(this.seed ^ 0x2c91);
    this.nFine = new ValueNoise(this.seed ^ 0x7e05);
    this.nRoll = new ValueNoise(this.seed ^ 0x3d17);
    this.nHill = new ValueNoise(this.seed ^ 0x6b29);
    this.nHillDetail = new ValueNoise(this.seed ^ 0x18f3);
    this.chunks = new Map();
    this.detailCache = new Map();
    this.featureCache = new Map();
    this.stats = { generated: 0, discarded: 0 };
    this.tmp = document.createElement('canvas');
    this.tmp.width = this.tmp.height = GRID + 2;
    this.tmpCtx = this.tmp.getContext('2d');
    this.img = this.tmpCtx.createImageData(GRID + 2, GRID + 2);
    this.hbuf = new Float32Array((GRID + 4) * (GRID + 4));
    this.obs = new ObstacleField(this);
  }

  // 丘:ノイズで作る大きなうねり。しきい値より上だけを持ち上げるので、間には平地が残る
  hillHeight(x, y) {
    const T = this.P.terrain;
    if (T.hillHeight <= 0 || T.hillFreq <= 0) return 0;
    const n = this.nHill.fbm(x / T.hillSize, y / T.hillSize, 3);
    const th = lerp(0.72, 0.4, T.hillFreq);
    const m = smoothstep(th, th + T.hillEdge, n);
    if (m <= 0) return 0;
    const fade = smoothstep(START_CLEAR, START_CLEAR + 900, Math.hypot(x, y));
    const detail = 0.8 + 0.4 * this.nHillDetail.get(x / 700, y / 700);
    return T.hillHeight * m * detail * fade;
  }

  // ジャンプ台を除いた地形の高さ(ジャンプ台を平地に置くための判定にも使う)
  baseHeight(x, y, slopes) {
    const T = this.P.terrain;
    let h = (this.nRoll.fbm(x / 1500, y / 1500, 2) - 0.5) * 80 * T.roll + this.hillHeight(x, y);
    for (const f of slopes || this.layerFeaturesAt('slope', x, y)) h += this.featureHeight(f, x, y);
    return h;
  }

  // 傾いた丘・ジャンプ台。格子のマス座標から決定的に作る
  feature(layer, ix, iy) {
    const key = layer + ix + ',' + iy;
    if (this.featureCache.has(key)) return this.featureCache.get(key);
    const T = this.P.terrain;
    const L = FEATURE_LAYERS[layer];
    const rnd = chunkRng(this.seed, ix, iy, L.salt);
    // 設定によらず乱数の消費数を同じにして、頻度を変えても配置が大きく崩れないようにする
    const u = []; for (let k = 0; k < 7; k++) u.push(rnd());
    const x = (ix + 0.3 + u[1] * 0.4) * L.cell, y = (iy + 0.3 + u[2] * 0.4) * L.cell;
    const a = u[3] * TAU, dx = Math.cos(a), dy = Math.sin(a);
    let f = null;
    if (layer === 'slope' && u[0] < T.slopeFreq) {
      const r = 600 + u[4] * 400;
      f = { type: 'slope', x, y, r, h: 90 + u[5] * 80, dx, dy, ext: r };
    } else if (layer === 'ramp' && u[0] < T.rampFreq) {
      // 実際のジャンプ台のように、長めでゆるい傾き(先端で約10〜13度)
      const len = 200 + u[4] * 140, wid = 80 + u[6] * 50, h = 25 + u[5] * 22;
      f = { type: 'ramp', x, y, len, wid, h, dx, dy, ext: Math.hypot(len / 2 + RAMP_DROP + h, wid / 2) };
      // ジャンプ台は平地にだけ置く(丘や斜面の上だと傾いて不自然になる)
      const e = f.ext;
      const b0 = this.baseHeight(x, y);
      for (const [ox, oy] of [[e, 0], [-e, 0], [0, e], [0, -e]]) {
        if (Math.abs(this.baseHeight(x + ox, y + oy) - b0) > 6) { f = null; break; }
      }
    }
    if (f && Math.hypot(x, y) < START_CLEAR + f.ext) f = null;
    if (this.featureCache.size > 4000) this.featureCache.clear();
    this.featureCache.set(key, f);
    return f;
  }

  // その地点にかかりうる、ある層の構成要素(周囲3×3マス)
  layerFeaturesAt(layer, x, y) {
    const cell = FEATURE_LAYERS[layer].cell;
    const ix = Math.floor(x / cell), iy = Math.floor(y / cell);
    const out = [];
    for (let j = iy - 1; j <= iy + 1; j++) {
      for (let i = ix - 1; i <= ix + 1; i++) {
        const f = this.feature(layer, i, j);
        if (f) out.push(f);
      }
    }
    return out;
  }

  featureHeight(f, x, y) {
    const px = x - f.x, py = y - f.y;
    if (Math.abs(px) > f.ext || Math.abs(py) > f.ext) return 0;
    if (f.type === 'slope') {
      // 一方向に傾いた大きな台地:向き (dx, dy) 側が高い。縁はなだらかに落とす
      const d = Math.hypot(px, py) / f.r;
      if (d >= 1) return 0;
      const w = smoothstep(1, 0.25, d);
      const proj = (px * f.dx + py * f.dy) / f.r;
      return f.h * w * (0.5 + 0.5 * proj);
    }
    // ジャンプ台:手前から先端に向かって高くなり、先端で急に落ちる
    const u = px * f.dx + py * f.dy + f.len / 2;
    const v = Math.abs(-px * f.dy + py * f.dx);
    if (v >= f.wid / 2 || u <= 0 || u >= f.len + RAMP_DROP) return 0;
    const side = smoothstep(f.wid / 2, f.wid / 2 - 14, v);
    const prof = u <= f.len ? f.h * Math.pow(u / f.len, 1.4) : f.h * (1 - (u - f.len) / RAMP_DROP);
    return prof * side;
  }

  // 地形の高さ。どこでも取得できる
  height(x, y) {
    const T = this.P.terrain;
    if (T.amount <= 0) return 0;
    let h = this.baseHeight(x, y);
    for (const f of this.layerFeaturesAt('ramp', x, y)) h += this.featureHeight(f, x, y);
    return h * T.amount;
  }

  // height() と同じ値を、あらかじめ集めた構成要素だけで計算する(チャンク描画用の高速版)
  heightWith(x, y, feats) {
    const T = this.P.terrain;
    if (T.amount <= 0) return 0;
    let h = (this.nRoll.fbm(x / 1500, y / 1500, 2) - 0.5) * 80 * T.roll + this.hillHeight(x, y);
    for (let k = 0; k < feats.length; k++) h += this.featureHeight(feats[k], x, y);
    return h * T.amount;
  }

  // 範囲にかかる傾いた丘・ジャンプ台
  featuresIn(x0, y0, x1, y1) {
    const out = [];
    for (const layer of Object.keys(FEATURE_LAYERS)) {
      const cell = FEATURE_LAYERS[layer].cell;
      const i0 = Math.floor(x0 / cell) - 1, i1 = Math.floor(x1 / cell) + 1;
      const j0 = Math.floor(y0 / cell) - 1, j1 = Math.floor(y1 / cell) + 1;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const f = this.feature(layer, i, j);
          if (f && f.x + f.ext > x0 && f.x - f.ext < x1 && f.y + f.ext > y0 && f.y - f.ext < y1) out.push(f);
        }
      }
    }
    return out;
  }

  rampNear(x, y, r) {
    return this.featuresIn(x - r, y - r, x + r, y + r).some(f => f.type === 'ramp' && Math.hypot(f.x - x, f.y - y) < f.ext + r);
  }

  // 影を落とす面:障害物の上にいるなら障害物の上面、そうでなければ地面
  // 戻り値 surf は面の地面からの高さ、alt は面からの高さ
  shadowAt(x, y, z) {
    const g = this.height(x, y);
    const top = this.obs.topAt(x, y);
    if (top !== null && z >= top - 1) {
      return { surf: top - g, alt: Math.max(0, z - top), onTop: true };
    }
    return { surf: 0, alt: Math.max(0, z - g), onTop: false };
  }

  // 地形の傾き(差分で計算)。車とボールが共通で使う
  gradient(x, y) {
    const e = 2;
    return {
      x: (this.height(x + e, y) - this.height(x - e, y)) / (2 * e),
      y: (this.height(x, y + e) - this.height(x, y - e)) / (2 * e),
    };
  }

  // 0 = 草地、1 = 土
  dirt(x, y) {
    const n = this.nBiome.fbm(x / 900, y / 900, 3) + (this.nMid.get(x / 170, y / 170) - 0.5) * 0.35;
    return smoothstep(0.42, 0.62, n);
  }

  key(cx, cy) { return cx + ',' + cy; }

  // 模様の設定を変えたときに作り直す
  clearChunks() {
    this.chunks.clear();
    this.detailCache.clear();
  }

  // 地形・障害物の設定を変えたときに作り直す
  resetTerrain() {
    this.featureCache.clear();
    this.obs.reset();
    this.clearChunks();
  }

  // 画面内のチャンクを用意し、遠いチャンクを破棄する
  update(view) {
    const cx0 = Math.floor(view.x0 / CHUNK), cx1 = Math.floor(view.x1 / CHUNK);
    const cy0 = Math.floor(view.y0 / CHUNK), cy1 = Math.floor(view.y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.chunks.has(this.key(cx, cy))) this.generate(cx, cy);
      }
    }
    // 周囲1チャンク分は先読み。カクつかないよう1フレームあたりの数を絞る
    let budget = 1;
    for (let cy = cy0 - 1; cy <= cy1 + 1 && budget > 0; cy++) {
      for (let cx = cx0 - 1; cx <= cx1 + 1 && budget > 0; cx++) {
        if (!this.chunks.has(this.key(cx, cy))) { this.generate(cx, cy); budget--; }
      }
    }
    for (const [k, c] of this.chunks) {
      if (c.cx < cx0 - 2 || c.cx > cx1 + 2 || c.cy < cy0 - 2 || c.cy > cy1 + 2) {
        this.chunks.delete(k);
        this.stats.discarded++;
      }
    }
    if (this.detailCache.size > 400) this.detailCache.clear();
  }

  generate(cx, cy) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK + BLEED * 2;
    const ctx = canvas.getContext('2d');
    this.paintBase(ctx, cx, cy);
    this.paintDetails(ctx, cx, cy);
    this.paintRamps(ctx, cx, cy);
    const c = { cx, cy, canvas };
    this.chunks.set(this.key(cx, cy), c);
    this.stats.generated++;
    return c;
  }

  // 地面の色ムラと陰影(ヒルシェード)。ワールド座標で決まるのでチャンクの境目でもつながる
  paintBase(ctx, cx, cy) {
    const d = this.img.data, N = GRID + 2, M = GRID + 4;
    // 傾きを出すため、1マス外側まで高さを先に計算しておく
    const H = this.hbuf;
    const m = CELL * 3;
    const feats = this.featuresIn(cx * CHUNK - m, cy * CHUNK - m, (cx + 1) * CHUNK + m, (cy + 1) * CHUNK + m);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        H[j * M + i] = this.heightWith((cx * GRID + i - 2 + 0.5) * CELL, (cy * GRID + j - 2 + 0.5) * CELL, feats);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const gx = cx * GRID + i - 1, gy = cy * GRID + j - 1;
        const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
        const t = this.dirt(x, y);
        const f = this.nFine.get(x / 45, y / 45) - 0.5;
        const jit = hash2i(this.seed, gx, gy) / 4294967296 - 0.5;
        const hi = (j + 1) * M + (i + 1);
        const h = H[hi];
        const sx = (H[hi + 1] - H[hi - 1]) / (2 * CELL), sy = (H[hi + M] - H[hi - M]) / (2 * CELL);
        // 光源との向きで明暗をつける(平地で1)。高いところは少し明るく
        const nl = Math.hypot(sx, sy, 1);
        const shade = clamp(((-sx * LIGHT.x - sy * LIGHT.y + LIGHT.z) / nl) / LIGHT.z, 0.45, 1.5);
        // 丘の縁が分かるよう、等高線をうっすら入れる
        const fr = (h / CONTOUR_STEP) - Math.floor(h / CONTOUR_STEP);
        const contour = h > 3 && (fr < 0.12 || fr > 0.88) ? 0.93 : 1;
        const k = (1 + f * 0.22 + jit * 0.08) * shade * contour * (1 + h * 0.0012);
        const idx = (j * N + i) * 4;
        d[idx] = lerp(80, 156, t) * k;
        d[idx + 1] = lerp(124, 126, t) * k;
        d[idx + 2] = lerp(52, 86, t) * k;
        d[idx + 3] = 255;
      }
    }
    this.tmpCtx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // マス i の中心がチャンク内座標 (i - 0.5) * CELL に来るよう引き伸ばす
    ctx.drawImage(this.tmp, BLEED - CELL, BLEED - CELL, N * CELL, N * CELL);
  }

  // 地面の細かい模様の一覧(チャンク座標から決定的に作る)
  details(cx, cy) {
    const key = this.key(cx, cy);
    const cached = this.detailCache.get(key);
    if (cached) return cached;
    const rnd = chunkRng(this.seed, cx, cy, 1);
    const ox = cx * CHUNK, oy = cy * CHUNK;
    const out = [];
    const pick = () => [ox + rnd() * CHUNK, oy + rnd() * CHUNK];
    const gp = this.P.ground;
    const S = gp.detailScale;
    const count = n => Math.round(n * gp.detailDensity);
    const A = a => Math.min(1, a * gp.detailContrast).toFixed(3);

    // 大きめの斑(草むら・土の色違い)
    for (let i = 0; i < count(14); i++) {
      const [x, y] = pick();
      const t = this.dirt(x, y);
      const c = t > 0.5 ? `rgba(105,80,50,${A(0.22)})` : (rnd() < 0.5 ? `rgba(45,85,30,${A(0.25)})` : `rgba(150,165,85,${A(0.18)})`);
      out.push({ layer: 0, kind: 'patch', x, y, rx: (14 + rnd() * 30) * S, ry: (8 + rnd() * 18) * S, rot: rnd() * Math.PI, c });
    }
    // 細かい点(色ムラ)
    for (let i = 0; i < count(420); i++) {
      const [x, y] = pick();
      const dark = rnd() < 0.6;
      out.push({ layer: 1, kind: 'dot', x, y, s: (1 + rnd() * 1.8) * S, c: dark ? `rgba(30,35,18,${A(0.45)})` : `rgba(225,215,165,${A(0.35)})` });
    }
    // ひび(土の上)
    for (let i = 0; i < count(18); i++) {
      const [x, y] = pick();
      if (this.dirt(x, y) < 0.5) continue;
      const pts = [x, y];
      let a = rnd() * TAU, px = x, py = y;
      const n = 3 + Math.floor(rnd() * 4);
      for (let s = 0; s < n; s++) {
        a += (rnd() - 0.5) * 1.4;
        const len = (5 + rnd() * 9) * S;
        px += Math.cos(a) * len; py += Math.sin(a) * len;
        pts.push(px, py);
      }
      out.push({ layer: 2, kind: 'crack', pts, w: (0.9 + rnd() * 0.8) * S, c: `rgba(70,48,28,${A(0.55)})` });
    }
    // 小石(土の上に多め)
    for (let i = 0; i < count(150); i++) {
      const [x, y] = pick();
      const t = this.dirt(x, y);
      if (t < 0.35 && rnd() < 0.65) continue;
      const g = 110 + Math.floor(rnd() * 4) * 20;   // まとめて塗れるよう色は4段階
      out.push({ layer: 3, kind: 'pebble', x, y, rx: (1.5 + rnd() * 2.8) * S, ry: (1.2 + rnd() * 2.0) * S, rot: rnd() * Math.PI,
        c: `rgb(${g},${g - 6},${g - 16})`, hi: `rgba(255,255,240,${A(0.45)})`, sh: `rgba(0,0,0,${A(0.25)})` });
    }
    // 草(草地に多め)
    for (let i = 0; i < count(320); i++) {
      const [x, y] = pick();
      const t = this.dirt(x, y);
      if (t > 0.65 && rnd() < 0.85) continue;
      const light = rnd() < 0.4;
      const blades = [];
      const base = rnd() * TAU;
      for (let b = 0; b < 3; b++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6 + Math.sin(base) * 0.3;
        const len = (3.5 + rnd() * 5.5) * S;
        blades.push(Math.cos(a) * len, Math.sin(a) * len);
      }
      out.push({ layer: 4, kind: 'grass', x, y, blades, w: 1.1 * S, c: light ? `rgba(160,190,90,${A(0.75)})` : `rgba(40,75,25,${A(0.7)})` });
    }
    // 小さな花
    for (let i = 0; i < count(30); i++) {
      const [x, y] = pick();
      if (this.dirt(x, y) > 0.3) continue;
      out.push({ layer: 5, kind: 'flower', x, y, r: 1.4 * S, c: rnd() < 0.5 ? '#f3f0dc' : '#f2d65a' });
    }
    this.detailCache.set(key, out);
    return out;
  }

  // 自分と隣の8チャンクの模様のうち、このチャンクにかかるものを描く
  paintDetails(ctx, cx, cy) {
    const m = DETAIL_MARGIN * Math.max(1, this.P.ground.detailScale);
    const x0 = cx * CHUNK - m, y0 = cy * CHUNK - m;
    const x1 = (cx + 1) * CHUNK + m, y1 = (cy + 1) * CHUNK + m;
    const items = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const it of this.details(cx + dx, cy + dy)) {
          const ix = it.kind === 'crack' ? it.pts[0] : it.x, iy = it.kind === 'crack' ? it.pts[1] : it.y;
          if (ix >= x0 && ix < x1 && iy >= y0 && iy < y1) items.push(it);
        }
      }
    }
    // 描画を速くするため、同じ層・同じ色の模様をひとつのパスにまとめて一度に塗る
    const groups = new Map();
    const add = (layer, c, mode, fn) => {
      const k = layer + '|' + c;
      let g = groups.get(k);
      if (!g) { g = { layer, c, mode, fns: [] }; groups.set(k, g); }
      g.fns.push(fn);
    };
    for (const it of items) {
      switch (it.kind) {
        case 'patch':
          add(0, it.c, 'fill', () => { ctx.moveTo(it.x + it.rx, it.y); ctx.ellipse(it.x, it.y, it.rx, it.ry, it.rot, 0, TAU); });
          break;
        case 'dot':
          add(1, it.c, 'fill', () => ctx.rect(it.x, it.y, it.s, it.s));
          break;
        case 'crack':
          add(2, it.c, 'stroke', () => {
            ctx.moveTo(it.pts[0], it.pts[1]);
            for (let i = 2; i < it.pts.length; i += 2) ctx.lineTo(it.pts[i], it.pts[i + 1]);
          });
          break;
        case 'pebble': {
          const ell = (ox, oy) => () => {
            const x = it.x + ox, y = it.y + oy;
            ctx.moveTo(x + it.rx, y); ctx.ellipse(x, y, it.rx, it.ry, it.rot, 0, TAU);
          };
          add(3, it.sh, 'fill', ell(it.rx * 0.35, it.ry * 0.45));
          add(3.1, it.c, 'fill', ell(0, 0));
          add(3.2, it.hi, 'fill', () => ctx.rect(it.x - it.rx * 0.4, it.y - it.ry * 0.5, it.rx * 0.5, it.ry * 0.5));
          break;
        }
        case 'grass':
          add(4, it.c, 'stroke', () => {
            for (let i = 0; i < it.blades.length; i += 2) {
              ctx.moveTo(it.x, it.y); ctx.lineTo(it.x + it.blades[i], it.y + it.blades[i + 1]);
            }
          });
          break;
        case 'flower':
          add(5, it.c, 'fill', () => { ctx.moveTo(it.x + it.r, it.y); ctx.arc(it.x, it.y, it.r, 0, TAU); });
          break;
      }
    }
    const S = this.P.ground.detailScale;
    ctx.save();
    ctx.translate(BLEED - cx * CHUNK, BLEED - cy * CHUNK);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const g of [...groups.values()].sort((a, b) => a.layer - b.layer)) {
      ctx.beginPath();
      for (const fn of g.fns) fn();
      if (g.mode === 'fill') { ctx.fillStyle = g.c; ctx.fill(); }
      else { ctx.strokeStyle = g.c; ctx.lineWidth = (g.layer === 2 ? 1.3 : 1.1) * S; ctx.stroke(); }
    }
    ctx.restore();
  }

  // ジャンプ台は陰影だけだと分かりにくいので、板張りの見た目と先端の落差の影を描く
  paintRamps(ctx, cx, cy) {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const ramps = this.featuresIn(x0, y0, x0 + CHUNK, y0 + CHUNK).filter(f => f.type === 'ramp');
    if (!ramps.length) return;
    const amt = this.P.terrain.amount;
    ctx.save();
    ctx.translate(BLEED - x0, BLEED - y0);
    for (const f of ramps) {
      const L = f.len, W = f.wid, h = f.h * amt;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(Math.atan2(f.dy, f.dx));
      // 先端の向こうに落ちる影
      const sh = ctx.createLinearGradient(L / 2, 0, L / 2 + h * 0.9 + 6, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.45)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(L / 2, -W / 2 + 4, h * 0.9 + 6, W - 8);
      // 本体:手前は低く暗く、先端に向かって明るく
      const g = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
      g.addColorStop(0, 'rgba(120,92,58,0.55)');
      g.addColorStop(1, 'rgba(214,176,118,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(-L / 2, -W / 2 + 3, L, W - 6);
      // 板の継ぎ目
      ctx.strokeStyle = 'rgba(70,45,22,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let u = -L / 2 + 16; u < L / 2; u += 16) { ctx.moveTo(u, -W / 2 + 3); ctx.lineTo(u, W / 2 - 3); }
      ctx.stroke();
      // 進行方向の矢印
      ctx.strokeStyle = 'rgba(255,240,200,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let k = 0; k < 2; k++) {
        const u = -L * 0.15 + k * L * 0.25;
        ctx.moveTo(u - 14, -W * 0.25); ctx.lineTo(u, 0); ctx.lineTo(u - 14, W * 0.25);
      }
      ctx.stroke();
      // 先端のふち
      ctx.fillStyle = '#f4e4b4';
      ctx.fillRect(L / 2 - 5, -W / 2 + 3, 5, W - 6);
      ctx.strokeStyle = 'rgba(60,40,20,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-L / 2, -W / 2 + 3, L, W - 6);
      ctx.restore();
    }
    ctx.restore();
  }

  draw(ctx, view, P) {
    for (const c of this.chunks.values()) {
      const x = c.cx * CHUNK, y = c.cy * CHUNK;
      if (x > view.x1 || x + CHUNK < view.x0 || y > view.y1 || y + CHUNK < view.y0) continue;
      ctx.drawImage(c.canvas, x - BLEED, y - BLEED);
    }
    if (P.debug.showChunks) {
      ctx.strokeStyle = 'rgba(255,255,0,0.6)';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(255,255,0,0.8)';
      ctx.font = '16px monospace';
      for (const c of this.chunks.values()) {
        ctx.strokeRect(c.cx * CHUNK, c.cy * CHUNK, CHUNK, CHUNK);
        ctx.fillText(`${c.cx},${c.cy}`, c.cx * CHUNK + 8, c.cy * CHUNK + 20);
      }
    }
    if (P.debug.showGradient) {
      // 地形の勾配ベクトル(下り方向)
      ctx.strokeStyle = 'rgba(0,200,255,0.8)';
      ctx.lineWidth = 1.5;
      const stepPx = 64;
      const sx = Math.floor(view.x0 / stepPx) * stepPx, sy = Math.floor(view.y0 / stepPx) * stepPx;
      ctx.beginPath();
      for (let y = sy; y < view.y1; y += stepPx) {
        for (let x = sx; x < view.x1; x += stepPx) {
          const g = this.gradient(x, y);
          ctx.moveTo(x, y); ctx.lineTo(x - g.x * 60, y - g.y * 60);
          ctx.rect(x - 1, y - 1, 2, 2);
        }
      }
      ctx.stroke();
    }
  }
}

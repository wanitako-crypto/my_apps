'use strict';
// 共通の数学・乱数・ノイズ関数

const TAU = Math.PI * 2;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
// フレームレートに依存しない lerp 係数(rate が大きいほど速く近づく)
function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// 整数座標からの決定的なハッシュ(0〜2^32-1)
function hash2i(seed, x, y) {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// シード付き乱数(0〜1)
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// チャンク座標から決定的な乱数列を作る。salt で用途ごとに系列を分ける
function chunkRng(seed, cx, cy, salt) {
  return mulberry32(hash2i((seed + Math.imul(salt, 0x9E3779B1)) | 0, cx, cy));
}

// 自前の value noise(0〜1)
class ValueNoise {
  constructor(seed) { this.seed = seed | 0; }
  lat(ix, iy) { return hash2i(this.seed, ix, iy) / 4294967296; }
  get(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = this.lat(ix, iy), b = this.lat(ix + 1, iy);
    const c = this.lat(ix, iy + 1), d = this.lat(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  fbm(x, y, octaves) {
    let sum = 0, amp = 0.5, norm = 0, f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.get(x * f + i * 17.3, y * f - i * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

// 高さ表現:真上にあるカメラから見た遠近法で描く(車・ボール・破片・障害物で共通)。
// 高い点ほど少し大きく、画面の中心から外側へずれて見える。毎フレーム setView でカメラを設定する
const VIEW = { cx: 0, cy: 0, D: 1400 };

function setView(cx, cy, D) { VIEW.cx = cx; VIEW.cy = cy; VIEW.D = D; }

// 高さ alt の点 (x, y) が画面上(ワールド座標)のどこに見えるか。k は見かけの拡大率
function heightVisual(x, y, alt) {
  const k = VIEW.D / Math.max(VIEW.D - alt, VIEW.D * 0.25);
  return { x: VIEW.cx + (x - VIEW.cx) * k, y: VIEW.cy + (y - VIEW.cy) * k, s: k };
}

// 影:光源(左上)と反対へ、面からの高さに比例してずらす。高いほど小さく薄く
function shadowVisual(alt, hp) {
  const s = 1 / (1 + alt * 0.0025);
  return { s, a: s, dx: alt * hp.shadowShift * 0.6, dy: alt * hp.shadowShift * 0.8 };
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

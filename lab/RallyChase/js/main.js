'use strict';
// メイン:全体の組み立てとゲームループ

const SEED = (() => {
  const m = /[?&]seed=(\d+)/.exec(location.search);
  return m ? parseInt(m[1], 10) : 20261022;
})();
const STEP = 1 / 120;   // 物理は固定ステップで回す
const GHOST_INTERVAL = 0.03, GHOST_COUNT = 6;

const P = loadParams();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const G = {
  P,
  world: new World(SEED, P),
  lines: new SpeedLines(),
  marks: new TireMarks(),
  car: new Car(),
  ball: new Ball(),
  camera: new Camera(),
  fx: new Effects(),
  hud: new Hud(),
  ghosts: [],
  ghostTimer: 0,
  score: 0,
  scorePop: 0,
  time: 0,
  paused: false,
  fps: 60,
  viewW: 0, viewH: 0, dpr: 1,
  stats: { broken: 0, hits: 0, jumps: 0, maxAir: 0, maxZ: 0 },
  warnings: { carOffscreen: 0, carInside: 0, nan: 0 },
};

function resize() {
  G.dpr = window.devicePixelRatio || 1;
  G.viewW = window.innerWidth;
  G.viewH = window.innerHeight;
  canvas.width = Math.round(G.viewW * G.dpr);
  canvas.height = Math.round(G.viewH * G.dpr);
}

function restart() {
  G.score = 0;
  G.scorePop = 0;
  G.time = 0;
  G.car.reset(0, 0, -Math.PI / 2);
  G.car.z = G.car.visRef = G.world.height(0, 0);
  G.camera.reset(0, 0);
  G.fx.clear();
  G.marks.clear();
  G.ghosts = [];
  G.world.obs.destroyed.clear();
  // 最初のボールは車の前方に置く
  G.ball.launch(0, -520, G.world.height(0, -520), -Math.PI / 2 + (Math.random() - 0.5) * 1.6, P, false);
}

function capture() {
  const b = G.ball;
  const alt = b.z - G.world.height(b.x, b.y);
  G.score++;
  G.scorePop = 1;
  G.fx.burst(b.x, b.y, alt, 26, { speed: 260, up: 320, life: 0.7, size: 5, color: '#ffe066', gravity: 900 });
  G.fx.popup(b.x, b.y, alt + 20, '+1');
  G.fx.flash = 1;
  G.camera.addShake(0.15);
  // 捕獲した地点からランダムな方向へ、高めの放物線で打ち上げる
  b.launch(b.x, b.y, Math.max(b.z, G.world.height(b.x, b.y)), Math.random() * TAU, P, true);
}

// 土煙の色:土の上は茶色、草の上は薄い黄緑
function dustColor(x, y) {
  return G.world.dirt(x, y) > 0.5 ? '#b89a6e' : '#a8b080';
}

function carEffects(dt) {
  const { car, fx, camera, world } = G;
  const e = P.effects;

  // 障害物との衝突と破壊
  const ev = world.obs.collideCar(car, P);
  for (const hit of ev.hits) {
    G.stats.hits++;
    camera.addShake(clamp(hit.impact / 1500, 0.05, 0.6));
    for (let i = 0; i < 4 * e.dust; i++) fx.addDust(car.x, car.y, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 8, 0.6, dustColor(car.x, car.y));
  }
  for (const o of ev.broken) {
    G.stats.broken++;
    camera.addShake(0.25);
    const col = OB_COLORS[o.kind];
    fx.burst(o.x, o.y, o.h * 0.5, 16, { speed: 380, up: 420, life: 0.9, size: 7, color: col.top, gravity: 1400 });
    fx.burst(o.x, o.y, o.h * 0.5, 10, { speed: 300, up: 300, life: 0.8, size: 5, color: col.side, gravity: 1400 });
    for (let i = 0; i < 6 * e.dust; i++) fx.addDust(o.x, o.y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, 10, 0.8, dustColor(o.x, o.y));
  }

  // 着地:画面揺れと土煙
  if (car.landImpact > 150) {
    G.stats.jumps++;
    camera.addShake(clamp(car.landImpact / 2200, 0.05, 0.5));
    const n = Math.round(clamp(car.landImpact / 80, 4, 16) * e.dust);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 80 + Math.random() * 160;
      fx.addDust(car.x, car.y, Math.cos(a) * sp + car.vx * 0.2, Math.sin(a) * sp + car.vy * 0.2, 10, 0.7, dustColor(car.x, car.y));
    }
  }
  if (!car.grounded) {
    G.stats.maxAir = Math.max(G.stats.maxAir, car.airTime);
    G.stats.maxZ = Math.max(G.stats.maxZ, car.z - world.height(car.x, car.y));
  }

  // ドリフト中の土煙
  if (car.grounded && car.slip > e.tireMarkSlip && car.speed > 100) {
    const w = car.rearWheels();
    const p = e.dust * clamp(car.slip / 900, 0.15, 0.6);
    for (let k = 0; k < 2; k++) {
      if (Math.random() < p) {
        const x = w[k * 2], y = w[k * 2 + 1];
        fx.addDust(x, y, -car.vx * 0.15 + (Math.random() - 0.5) * 40, -car.vy * 0.15 + (Math.random() - 0.5) * 40, 6, 0.6 + Math.random() * 0.4, dustColor(x, y));
      }
    }
  }

  G.marks.update(car, P, G.time);

  // 高速時の残像
  G.ghostTimer += dt;
  if (G.ghostTimer >= GHOST_INTERVAL) {
    G.ghostTimer = 0;
    G.ghosts.unshift({ x: car.x, y: car.y, angle: car.angle, alt: car.visualAlt() });
    if (G.ghosts.length > GHOST_COUNT) G.ghosts.length = GHOST_COUNT;
  }
}

function step(dt) {
  const { car, ball } = G;
  G.time += dt;
  car.update(dt, input, P, G.world);
  carEffects(dt);
  ball.update(dt, P, G.world);
  if (ball.cooldown <= 0 &&
      Math.hypot(ball.x - car.x, ball.y - car.y) < ball.captureDist(P) &&
      Math.abs(ball.z - car.z) < ball.captureDz(P)) {
    capture();
  }
  G.fx.update(dt);
  G.scorePop = Math.max(0, G.scorePop - dt * 4);
  G.camera.update(dt, car, P, G.viewW, G.viewH);
  car.vib = G.camera.vib * 0.8;
  G.lines.update(dt, car, G.camera.viewRect(G.viewW, G.viewH), P);
  checkState();
}

// 見た目の異常・物理の破綻をテキストで検知する
function checkState() {
  const { car, world } = G;
  if (!Number.isFinite(car.x + car.y + car.z + car.vx + car.vy + car.vz) && G.time - G.warnings.nan > 1) {
    console.warn('[check] 車の状態が数値でなくなりました', { x: car.x, y: car.y, z: car.z });
    G.warnings.nan = G.time;
  }
  if (car.z - world.height(car.x, car.y) < 2) {
    for (const o of world.obs.inRect(car.x, car.y, car.x, car.y)) {
      if (car.z - o.base <= o.h && world.obs.contains(o, car.x, car.y) && G.time - G.warnings.carInside > 1) {
        console.warn('[check] 車の中心が障害物の中にあります', o.id);
        G.warnings.carInside = G.time;
      }
    }
  }
}

function render() {
  const { car, ball, camera, world, fx } = G;
  const w = G.viewW, h = G.viewH;
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.fillStyle = '#2c4220';
  ctx.fillRect(0, 0, w, h);

  const view = camera.viewRect(w, h);
  world.update(view);
  // 遠近法の基準:画面の中心の真上にカメラがある。ズームアウトはカメラが高くなったものとして扱う
  setView(camera.x, camera.y, P.height.camHeight / camera.zoom);
  // 障害物の上面は外側へずれるので、画面の少し外にあるものも描く
  const obs = world.obs.inRect(view.x0 - 300, view.y0 - 300, view.x1 + 300, view.y1 + 300);
  const carSh = world.shadowAt(car.x, car.y, car.z);

  ctx.save();
  camera.apply(ctx, w, h);
  // 描画順:地面 → タイヤ痕 → 影 → 障害物 → 車 → ボールの影 → ボール → エフェクト
  world.draw(ctx, view, P);
  G.marks.draw(ctx, G.time, P);
  world.obs.drawShadows(ctx, obs, P);
  if (!carSh.onTop) car.drawShadow(ctx, P, world, carSh);
  world.obs.draw(ctx, obs, P);
  // 障害物の上を飛んでいるときは、影を障害物の上面に落とす
  if (carSh.onTop) car.drawShadow(ctx, P, world, carSh);
  fx.drawDust(ctx);
  const ga = smoothstep(P.effects.ghostStart, 1, car.speed / P.car.maxSpeed) * P.effects.ghost;
  if (ga > 0.01) {
    for (let i = G.ghosts.length - 1; i >= 1; i--) car.drawGhost(ctx, G.ghosts[i], ga * 0.35 * (1 - i / G.ghosts.length), P);
  }
  car.drawBody(ctx, P, world);
  ball.drawShadow(ctx, P, world);
  ball.drawBody(ctx, P, world);
  fx.draw(ctx, P);
  G.lines.draw(ctx, car, P, camera.zoom);
  if (P.debug.showHitbox) {
    world.obs.drawDebug(ctx, obs);
    ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(car.x, car.y, CAR_RADIUS, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ff00ff';
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.captureDist(P), 0, TAU); ctx.stroke();
  }
  ctx.restore();

  fx.drawScreen(ctx, w, h);
  G.hud.draw(ctx, w, h, G);

  const s = camera.worldToScreen(car.x, car.y, w, h);
  if (s.x < 0 || s.x > w || s.y < 0 || s.y > h) {
    if (G.time - G.warnings.carOffscreen > 1) {
      console.warn('[check] 車が画面外に出ています', s);
      G.warnings.carOffscreen = G.time;
    }
  }
}

let lastTime = performance.now();
let acc = 0;
function frame(now) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;
  if (dt > 0) G.fps += (1 / dt - G.fps) * 0.05;
  if (!G.paused) {
    acc += dt;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
  }
  render();
  requestAnimationFrame(frame);
}

const gui = buildPanel(P, fk => {
  if (fk === 'terrain' || fk === 'obstacles' || fk === 'all') G.world.resetTerrain();
  else if (fk === 'ground') G.world.clearChunks();
});
initInput(action => {
  if (action === 'restart') restart();
  if (action === 'panel') togglePanel(gui);
});
window.addEventListener('resize', resize);
resize();
restart();
requestAnimationFrame(frame);

// 動作確認用
window.RB = { G, P, input, step, restart, capture };

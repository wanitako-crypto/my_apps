'use strict';
// UI:スコア、速度メーター、画面外のボールへの矢印

const PX_PER_METER = 18;      // 距離表示用の換算
const KMH_PER_PXS = 0.2;      // 速度表示用の換算

class Hud {
  draw(ctx, w, h, G) {
    const { P, car, ball, camera } = G;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;

    // スコア(取った瞬間に少し大きくなる)
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('SCORE', 24, 30);
    const pop = 1 + G.scorePop * 0.5;
    ctx.save();
    ctx.translate(24, 74);
    ctx.scale(pop, pop);
    ctx.fillStyle = '#ffe66a';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillText(String(G.score), 0, 0);
    ctx.restore();

    this.drawSpeed(ctx, w, h, car, P);
    this.drawBallArrow(ctx, w, h, car, ball, camera);

    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('↑↓←→ / WASD:運転   Space:サイドブレーキ   R:リスタート   F1 / `:調整パネル', 16, h - 14);

    if (P.debug.showStats) this.drawStats(ctx, G);
    ctx.restore();
  }

  drawSpeed(ctx, w, h, car, P) {
    // 右側は調整パネルと重なるので左下に置く(下の操作説明の上)
    const cx = 92, cy = h - 106, r = 58;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const t = clamp(car.speed / P.car.maxSpeed, 0, 1);
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    // 壊せる速度を超えたら色を変える
    const bt = clamp(P.break.breakSpeedRatio, 0, 1);
    ctx.strokeStyle = t >= bt ? '#ff7a3a' : '#7fe0ff';
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * t); ctx.stroke();
    const ba = a0 + (a1 - a0) * bt;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ba) * (r - 9), cy + Math.sin(ba) * (r - 9));
    ctx.lineTo(cx + Math.cos(ba) * (r + 9), cy + Math.sin(ba) * (r + 9));
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(String(Math.round(car.speed * KMH_PER_PXS)), cx, cy + 8);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('km/h', cx, cy + 26);
    if (car.slip > 150 && car.speed > 200) {
      ctx.fillStyle = '#ffcf5a';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('DRIFT', cx, cy - 22);
    }
  }

  drawBallArrow(ctx, w, h, car, ball, camera) {
    const s = camera.worldToScreen(ball.x, ball.y, w, h);
    const m = 20;
    if (s.x >= m && s.x <= w - m && s.y >= m && s.y <= h - m) return;
    const cx = w / 2, cy = h / 2;
    const dx = s.x - cx, dy = s.y - cy;
    const inset = 44;
    const t = Math.min((w / 2 - inset) / Math.max(Math.abs(dx), 1e-6), (h / 2 - inset) / Math.max(Math.abs(dy), 1e-6));
    const ax = cx + dx * t, ay = cy + dy * t;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffd83a';
    ctx.strokeStyle = '#4a3000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    const dist = Math.hypot(ball.x - car.x, ball.y - car.y) / PX_PER_METER;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(`${Math.round(dist)} m`, ax - Math.cos(ang) * 34, ay - Math.sin(ang) * 34 + 5);
  }

  drawStats(ctx, G) {
    const { car, ball, world, P } = G;
    const lines = [
      `FPS ${G.fps.toFixed(0)}`,
      `車 速度 ${car.speed.toFixed(0)} / 前 ${car.fwdSpeed.toFixed(0)} / 横滑り ${car.slip.toFixed(0)}`,
      `ボール 速度 ${ball.speed(P).toFixed(0)} / 高さ ${ball.z.toFixed(0)} / バウンド ${ball.bounces}`,
      `チャンク 保持 ${world.chunks.size} / 生成 ${world.stats.generated} / 破棄 ${world.stats.discarded}`,
      `位置 ${car.x.toFixed(0)}, ${car.y.toFixed(0)} / 高さ ${(car.z - world.height(car.x, car.y)).toFixed(0)} / ${car.grounded ? '接地' : '空中'}`,
      `ジャンプ ${G.stats.jumps} / 最長滞空 ${G.stats.maxAir.toFixed(2)}秒 / 破壊 ${G.stats.broken} / 衝突 ${G.stats.hits}`,
      `タイヤ痕 ${G.marks.segs.length} / 土煙 ${G.fx.dust.length} / 破壊済み ${world.obs.destroyed.size}`,
    ];
    ctx.textAlign = 'left';
    ctx.font = '13px monospace';
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, 24, 110 + i * 18));
  }
}

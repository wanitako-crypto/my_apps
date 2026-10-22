// ゲームの状態を管理する変数
let gameState = 'playing'; // 'playing', 'charging', 'firing', 'gameClear', 'gameOver'

// オブジェクト
let player; 
let walls = []; // 壁を配列で管理
let treasure;
let particles = [];

// チャージ関連
let chargeTime = 0;
const MAX_CHARGE = 800; // 最大チャージ時間 (例: 2倍に変更)
const CHARGE_SPEED = 3; // ★チャージ速度。この数値を大きくすると速くなります。
let fireDuration = 0; // ビームの持続時間
let initialFireDuration = 0; // ビームの総持続時間
let shotsRemaining = 3; // ★残り弾数

function setup() {
  createCanvas(800, 600);

  // 他のツールへのリンクを追加
  // プレイヤーの初期化
  player = {
    x: 20,
    y: height / 2,
    size: 30
  };

  // 壁の生成
  walls = []; // 配列を初期化
  const numWalls = 6;
  const startX = 300;
  const wallSpacing = 70;
  const initialHp = 5000;
  const hpIncrement = 7000;

  for (let i = 0; i < numWalls; i++) {
    const x = startX + i * wallSpacing;
    const hp = initialHp + i * hpIncrement;
    walls.push(new Wall(x, height / 2, 40, 220, hp));
  }

  // 最後の壁の後ろに宝物を配置
  const lastWallX = walls[walls.length - 1].x;
  treasure = new Treasure(lastWallX + 80, height / 2, 60, 2500);
}

function draw() {
  background(0, 50); // 黒背景＋残像効果

  // ゲーム状態に応じた処理の分岐
  switch (gameState) {
    case 'playing':
    case 'charging':
    case 'firing':
      runGame();
      break;
    case 'gameClear':
      showGameClearScreen();
      break;
    case 'gameOver':
      showGameOverScreen();
      break;
  }
}

// ゲーム実行中の処理
function runGame() {
  // プレイヤーの描画とエフェクト
  drawEmitter();

  // チャージ処理
  if (gameState === 'charging') {
    chargeTime += CHARGE_SPEED; // ★チャージ速度を適用
    if (chargeTime > MAX_CHARGE) {
      chargeTime = MAX_CHARGE;
    }
  }

  // ビーム放出処理
  if (gameState === 'firing') {
    if (fireDuration > 0) {
      fireDuration--;

      // ★ 放出量の動的計算
      // ビームの進行度を計算 (0.0 -> 1.0)
      const progress = (initialFireDuration - fireDuration) / initialFireDuration;

      // チャージ量の影響度を計算 (短いチャージほど影響が少なくなる)
      // pow()を使って、チャージが少ない領域では値が0に近くなるように調整
      const chargeImpact = pow(initialFireDuration / MAX_CHARGE, 2);
      
      // 進行度とチャージ量に応じて放出量を変化させる
      const minParticles = 1;
      const maxParticles = map(initialFireDuration, 0, MAX_CHARGE, 10, 40); // チャージ量が多いほど最大放出量も増える
      const particlesThisFrame = floor(map(pow(progress, 2) * chargeImpact, 0, 1, minParticles, maxParticles));

      generateParticles(particlesThisFrame);
    } else {
      gameState = 'playing'; // 撃ち終わったら通常状態に
    }
  }

  // 壁と宝物の描画と更新
  for(const wall of walls) {
    wall.display();
  }
  treasure.display();

  // パーティクルの更新と描画
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.update();
    p.display();

    let hitAnyWall = false;
    // 壁との当たり判定
    for (const wall of walls) {
      if (wall.hp > 0 && wall.checkCollision(p)) {
        hitAnyWall = true;
        break; // 1フレームで1つの壁にしか当たらない
      }
    }
    if (hitAnyWall) continue; // 壁に当たったら宝物には当たらない

    // 宝物との当たり判定
    if (treasure.hp > 0) {
      treasure.checkCollision(p);
    }

    // 寿命か画面外で削除
    if (p.isDead()) {
      particles.splice(i, 1);
    }
  }
  
  // ゲージ描画
  drawGauge();

  // ★残り弾数を表示
  textAlign(RIGHT, TOP);
  textSize(24);
  fill(255);
  noStroke();
  text(`残り弾数: ${shotsRemaining}`, width - 20, 20);

  // FPS表示
  fill(255);
  textSize(20);
  textAlign(LEFT, TOP);
  text(`FPS: ${floor(frameRate())}`, 10, 20);

  // ゲームクリア・オーバーの判定
  checkGameState();
}

// マウスボタンが押された時
function mousePressed() {
  if (gameState === 'playing') {
    gameState = 'charging';
    chargeTime = 0;
  } else if (gameState === 'gameClear' || gameState === 'gameOver') {
    // ゲームクリア/オーバー画面でクリックしたらリスタート
    restartGame();
  }
}

// マウスボタンが離された時
function mouseReleased() {
  if (gameState === 'charging') {
    gameState = 'firing';
    // チャージ量に応じて持続時間と放出数を設定
    initialFireDuration = chargeTime; // 総持続時間を保存
    fireDuration = chargeTime; // 残り時間をセット
    chargeTime = 0;
    shotsRemaining--; // ★弾数を1減らす
  }
}

// ゲーム状態の判定
function checkGameState() {
  // ゲームオーバーは最優先で即時判定
  if (treasure.hp <= 0) {
    gameState = 'gameOver';
    return; // ゲームオーバーが確定したら他の判定は不要
  }

  const allWallsDestroyed = walls.every(w => w.hp <= 0);
  const isAttackFinished = gameState !== 'firing' && particles.length === 0;

  // 攻撃が完全に終了した時点でのみ判定
  if (isAttackFinished) {
    // この時点で宝物のHPが残っていればクリア
    if (allWallsDestroyed && treasure.hp > 0) {
      gameState = 'gameClear';
    } 
    // ★弾切れによるゲームオーバー判定
    // 壁が残っている状態で、残り弾数が0になったらゲームオーバー
    else if (!allWallsDestroyed && shotsRemaining <= 0) {
      gameState = 'gameOver';
    }
  }
}

// ゲームクリア画面
function showGameClearScreen() {
  background(20, 80, 20, 150);
  textAlign(CENTER, CENTER);
  textSize(50);
  fill(0);
  text('GAME CLEAR!', width / 2, height / 2 - 40);
  textSize(20);
  text('お宝ゲット！', width / 2, height / 2 + 20);
  text('Click to restart', width / 2, height / 2 + 60);
}

// ゲームオーバー画面
function showGameOverScreen() {
  background(80, 20, 20, 150);
  textAlign(CENTER, CENTER);
  textSize(50);
  fill(0);
  text('GAME OVER', width / 2, height / 2 - 40);
  textSize(20);
  text('宝物を壊してしまった...', width / 2, height / 2 + 20);
  text('Click to restart', width / 2, height / 2 + 60);
}

// ゲームのリスタート
function restartGame() {
  for (const wall of walls) {
    wall.hp = wall.initialHp;
  }
  treasure.hp = treasure.initialHp;
  particles = [];
  shotsRemaining = 3; // ★残り弾数をリセット
  gameState = 'playing';
}

// プレイヤー（エミッター）の描画
function drawEmitter() {
  const x = player.x;
  const y = player.y;

  // チャージ中のエフェクト
  if (gameState === 'charging') {
    let chargeRatio = chargeTime / MAX_CHARGE;
    let auraSize = 10 + chargeRatio * 30;
    let auraAlpha = 0.3 + chargeRatio * 0.5;
    fill(255, 255, 0, random(100, 200) * auraAlpha);
    noStroke();
    ellipse(x, y, auraSize, auraSize);
  }

  fill(255);
  noStroke();
  ellipse(x, y, 15, 15);
}

// ゲージの描画
function drawGauge() {
  const barWidth = 200;
  const barHeight = 15;
  const x = player.x; // ゲージの開始位置をプレイヤーのX座標に合わせる
  const y = player.y + 30;

  if (gameState === 'charging') {
    const chargeRatio = chargeTime / MAX_CHARGE;
    fill(50);
    rect(x, y, barWidth, barHeight);
    const gaugeColor = lerpColor(color(255, 255, 0), color(255, 0, 0), chargeRatio);
    fill(gaugeColor);
    rect(x, y, barWidth * chargeRatio, barHeight);
  } else if (gameState === 'firing') {
    const durationRatio = fireDuration / MAX_CHARGE;
    fill(50);
    rect(x, y, barWidth, barHeight);
    fill(0, 255, 255);
    rect(x, y, barWidth * durationRatio, barHeight);
  }
}

// パーティクル生成
function generateParticles(count) {
  const startX = player.x;
  const startY = player.y;
  const thickness = map(count, 2, 40, 5, 40, true); // 放出量に応じてビームの太さも変える

  for (let i = 0; i < count; i++) {
    const angle = (random() - 0.5) * 0.1;
    const speed = 15 + random() * 5;
    const vx = cos(angle) * speed;
    const vy = sin(angle) * speed;
    const pY = startY + (random() - 0.5) * thickness;
    particles.push(new Particle(startX, pY, vx, vy));
  }
}

// --- クラス定義 ---

// パーティクルクラス
class Particle {
  constructor(x, y, vx, vy) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.size = random(2, 4);
    this.life = 120 + random(60);
    this.damage = 10; // 1粒あたりのダメージ
    this.baseColor = random() > 0.1 ? color(0, 255, 255) : color(255, 255, 0);
  }

  update() {
    this.life--;
    this.x += this.vx;
    this.y += this.vy;
  }

  display() {
    let alpha = map(this.life, 0, 180, 0, 255);
    this.baseColor.setAlpha(alpha);
    fill(this.baseColor);
    noStroke();
    ellipse(this.x, this.y, this.size, this.size);
  }

  isDead() {
    return this.life <= 0 || this.x > width || this.x < 0 || this.y > height || this.y < 0;
  }
}

// 共通の機能を持つ親クラス
class Target {
  constructor(x, y, w, h, hp) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.initialHp = hp;
    this.hp = hp;
    this.hitEffect = 0;
  }

  takeDamage(damage) {
    this.hp -= damage;
    if (this.hp < 0) {
      this.hp = 0;
    }
  }

  checkCollision(particle) {
    if (this.hp <= 0) return false;

    if (
      particle.x > this.x - this.w / 2 &&
      particle.x < this.x + this.w / 2 &&
      particle.y > this.y - this.h / 2 &&
      particle.y < this.y + this.h / 2
    ) {
      this.takeDamage(particle.damage);
      this.hitEffect = 10; // ヒットエフェクト開始

      // 壁に当たったパーティクルは散乱させる
      if (this instanceof Wall) {
        particle.x = this.x - this.w / 2 - particle.size; // めり込み防止
        particle.vx = -particle.vx * random(0.2, 0.5);
        particle.vy = (random() - 0.5) * 20;
      } else {
        // 宝物はパーティクルを消すだけ
        particle.life = 0;
      }
      return true;
    }
    return false;
  }

  displayHpBar() {
    const hpRatio = this.hp / this.initialHp;
    const barY = this.y - this.h / 2 - 15;
    rectMode(CORNER);
    fill(50);
    rect(this.x - this.w / 2, barY, this.w, 8);
    const hpColor = lerpColor(color(255, 0, 0), color(0, 255, 0), hpRatio);
    fill(hpColor);
    rect(this.x - this.w / 2, barY, this.w * hpRatio, 8);
  }
}

// 壁クラス (Targetを継承)
class Wall extends Target {
  display() {
    if (this.hp > 0) {
      let shakeX = 0;
      let shakeY = 0;
      const shakeIntensity = 3; // 揺れの大きさを調整

      // ヒットエフェクト中に揺らす
      if (this.hitEffect > 0) {
        shakeX = (random() - 0.5) * shakeIntensity;
        shakeY = (random() - 0.5) * shakeIntensity;
      }

      rectMode(CENTER);
      const hpRatio = this.hp / this.initialHp;
      const wallColor = lerpColor(color(255, 100, 100), color(100, 100, 100), hpRatio);
      fill(wallColor);
      if (this.hitEffect > 0) {
        fill(255, 255, 200, map(this.hitEffect, 0, 10, 0, 255)); // ヒット時の閃光
        this.hitEffect--;
      }
      noStroke();
      rect(this.x + shakeX, this.y + shakeY, this.w, this.h);
      this.displayHpBar();
    }
  }
}

// 宝物クラス (Targetを継承)
class Treasure extends Target {
  constructor(x, y, size, hp) {
    super(x, y, size, size, hp); // wとhに同じsizeを渡す
  }

  display() {
    if (this.hp > 0) {
      rectMode(CENTER);
      fill(255, 223, 0); // 金色
      if (this.hitEffect > 0) {
        fill(255, 255, 255, map(this.hitEffect, 0, 10, 0, 255));
        this.hitEffect--;
      }
      stroke(200, 160, 0); strokeWeight(2);
      rect(this.x, this.y, this.w, this.h);
      this.displayHpBar();
    }
  }
}

// ---------------------------------------------------
// 設定と変数
// ---------------------------------------------------
let layer1, layer2, layer3; // 3つのオフスクリーンキャンバス（画用紙）
let layers = []; // 描画順を管理するための配列

// カラーパレット集 (Hexコード)
const palettes = [
  // Original 5
  ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"],
  ["#000000", "#14213d", "#fca311", "#e5e5e5", "#ffffff"],
  ["#cdb4db", "#ffc8dd", "#ffafcc", "#bde0fe", "#a2d2ff"],
  ["#d8f3dc", "#b7e4c7", "#95d5b2", "#74c69d", "#52b788"],
  ["#e63946", "#f1faee", "#a8dadc", "#457b9d", "#1d3557"],
  // New 5
  ["#ffbe0b", "#fb5607", "#ff006e", "#8338ec", "#3a86ff"], // Vibrant
  ["#006d77", "#83c5be", "#edf6f9", "#ffddd2", "#e29578"], // Muted, earthy
  ["#b5838d", "#e5989b", "#ffb4a2", "#ffcdb2", "#fff1e6"], // Soft, warm
  ["#10002b", "#240046", "#3c096c", "#5a189a", "#7b2cbf"], // Purple gradient
  ["#b7094c", "#a01a58", "#892b64", "#723c70", "#5c4d7d"]  // Wine/plum
];

let currentPalette = [];

// --- フローフィールド用の変数 ---
let particles = [];
let numParticles = 500; // letに変更
const scl = 20; // グリッドの解像度
let cols, rows;
let flowfield;

// --- ポストプロセスとデバッグ用の変数 ---
let renderBuffer; 
let finalImage;
let isDebugMode = false;
let debugInfo = {};


function setup() {
  createCanvas(windowWidth, windowHeight);
  
  // バッファとグリッドを初期化
  renderBuffer = createGraphics(width, height);
  finalImage = createGraphics(width, height);
  layer1 = createGraphics(width, height);
  layer2 = createGraphics(width, height);
  layer3 = createGraphics(width, height);
  cols = floor(width / scl);
  rows = floor(height / scl);
  flowfield = new Array(cols * rows);

  // 最初のアートを生成
  generateArt();
}

function draw() {
  // 静止画なのでdraw内でのループ処理は不要
  noLoop(); 
}

// ---------------------------------------------------
// メイン生成ロジック
// ---------------------------------------------------
function generateArt() {
  // 0. デバッグ情報をリセット
  debugInfo = {};

  // 1. バッファをクリア
  renderBuffer.clear();
  layer1.clear();
  layer2.clear();
  layer3.clear();

  // === ポストプロセス用バッファに描画 ===
  
  // 2. カラーパレットをランダムに選択
  const paletteIndex = int(random(palettes.length));
  currentPalette = palettes[paletteIndex];
  debugInfo.palette = `Palette #${paletteIndex}`;
  
  // 3. 背景色を決める（パレットからランダム）
  let bgCol = color(random(currentPalette));
  renderBuffer.background(bgCol);
  debugInfo.background = bgCol.toString('#rrggbb');

  // 4. ブレンドモードをランダムに選択
  const blendModes = {
    'MULTIPLY': MULTIPLY, 'SCREEN': SCREEN, 'OVERLAY': OVERLAY, 
    'HARD_LIGHT': HARD_LIGHT, 'DIFFERENCE': DIFFERENCE, 'ADD': ADD, 'DODGE': DODGE
  };
  const blendModeName = random(Object.keys(blendModes));
  renderBuffer.blendMode(blendModes[blendModeName]);
  debugInfo.blendMode = blendModeName;

  // 5. 各レイヤーに絵を描き込む
  let zoff = random(10000); 
  let noiseZoom = random(0.01, 0.3);
  let angleMultiplier = random(0.5, 12);
  updateFlowField(zoff, noiseZoom, angleMultiplier);
  debugInfo.flowField = `zoom: ${noiseZoom.toFixed(2)}, angleMult: ${angleMultiplier.toFixed(2)}`;

  numParticles = int(random(200, 1500));
  particles = [];
  for (let i = 0; i < numParticles; i++) {
    particles[i] = new Particle();
  }
  
  drawGeometricLayer(layer1);
  drawFlowLineLayer(layer2);
  drawNoiseLayer(layer3);

  // 6. 表示するレイヤーをランダムに決める
  let activeLayers = [];
  if (random() > 0.5) activeLayers.push({name: 'Layer1', buffer: layer1});
  if (random() > 0.5) activeLayers.push({name: 'Layer2', buffer: layer2});
  if (random() > 0.5) activeLayers.push({name: 'Layer3', buffer: layer3});

  if (activeLayers.length === 0) {
    const emergencyLayer = random([{name: 'Layer1', buffer: layer1}, {name: 'Layer2', buffer: layer2}, {name: 'Layer3', buffer: layer3}]);
    activeLayers.push(emergencyLayer);
  }
  debugInfo.activeLayers = activeLayers.map(l => l.name).join(', ');

  // 7. レイヤーの重ね順をシャッフルする
  layers = shuffleArray(activeLayers);

  // 8. 決定した順序でポストプロセス用バッファに描画
  for (let l of layers) {
    renderBuffer.image(l.buffer, 0, 0);
  }
  
  // === ポストプロセス処理 ===
  let processedImage = renderBuffer;
  const postEffect = random(['chromaticAberration', 'filter', 'none']);
  debugInfo.postProcessing = postEffect;

  switch (postEffect) {
    case 'chromaticAberration':
      processedImage = applyChromaticAberration(renderBuffer);
      break;
    case 'filter':
      applyFilter(renderBuffer);
      processedImage = renderBuffer;
      break;
    case 'none':
      break;
  }

  // 9. 最終結果をグローバル変数に保存し、可視キャンバスに描画
  finalImage.clear();
  finalImage.image(processedImage, 0, 0);
  
  blendMode(BLEND);
  image(finalImage, 0, 0);

  // 10. デバッグ表示がオンなら更新
  if (isDebugMode) {
    drawDebugInfo();
  }
}

// ---------------------------------------------------
// ポストプロセス エフェクト
// ---------------------------------------------------

function applyChromaticAberration(buffer) {
  const outputBuffer = createGraphics(buffer.width, buffer.height);
  const shiftX = random(-20, 20);
  const shiftY = random(-20, 20);
  debugInfo.postParams = `shift: (${shiftX.toFixed(1)}, ${shiftY.toFixed(1)})`;

  outputBuffer.blendMode(ADD);
  outputBuffer.tint(255, 0, 0);
  outputBuffer.image(buffer, shiftX, shiftY);
  outputBuffer.tint(0, 255, 0);
  outputBuffer.image(buffer, 0, 0);
  outputBuffer.tint(0, 0, 255);
  outputBuffer.image(buffer, -shiftX, -shiftY);
  outputBuffer.blendMode(BLEND);
  outputBuffer.noTint();
  
  return outputBuffer;
}

function applyFilter(buffer) {
  const filters = {
    'BLUR': BLUR, 'POSTERIZE': POSTERIZE, 'INVERT': INVERT, 
    'GRAY': GRAY, 'ERODE': ERODE, 'DILATE': DILATE
  };
  const filterName = random(Object.keys(filters));
  const filterType = filters[filterName];
  
  if (filterType === BLUR) {
    const val = int(random(1, 6));
    buffer.filter(filterType, val);
    debugInfo.postParams = `type: ${filterName}, value: ${val}`;
  } else if (filterType === POSTERIZE) {
    const val = int(random(2, 8));
    buffer.filter(filterType, val);
    debugInfo.postParams = `type: ${filterName}, value: ${val}`;
  } else {
    buffer.filter(filterType);
    debugInfo.postParams = `type: ${filterName}`;
  }
}

// ---------------------------------------------------
// 各レイヤーの描画ロジック
// ---------------------------------------------------

function drawGeometricLayer(pg) {
  pg.noStroke();
  pg.rectMode(CENTER);
  const mode = random(['giant', 'swarm', 'balanced']);
  debugInfo.layer1Mode = mode;

  switch (mode) {
    case 'giant':
      drawGiantShape(pg);
      break;
    case 'swarm':
      drawSwarm(pg);
      break;
    case 'balanced':
      drawBalancedShapes(pg);
      break;
  }
}

function drawGiantShape(pg) {
  const x = random(-width * 0.5, width * 1.5);
  const y = random(-height * 0.5, height * 1.5);
  const size = max(width, height) * random(0.8, 2.5);
  const c = color(random(currentPalette));
  c.setAlpha(random(100, 220));
  pg.fill(c);
  if (random() > 0.5) pg.circle(x, y, size); else pg.rect(x, y, size, size);
}

function drawSwarm(pg) {
  const shapeCount = int(random(200, 800));
  for (let i = 0; i < shapeCount; i++) {
    const c = color(random(currentPalette));
    c.setAlpha(random(50, 180));
    pg.fill(c);
    const x = random(width);
    const y = random(height);
    const size = random(2, 30);
    if (random() > 0.5) pg.circle(x, y, size); else pg.rect(x, y, size, size);
  }
}

function drawBalancedShapes(pg) {
  const shapeCount = int(random(3, 20));
  for (let i = 0; i < shapeCount; i++) {
    pg.fill(random(currentPalette));
    if (random() > 0.5) {
      const c = color(random(currentPalette));
      c.setAlpha(150);
      pg.fill(c);
    }
    const x = random(width);
    const y = random(height);
    const size = random(20, 400);
    if (random() > 0.5) pg.circle(x, y, size); else pg.rect(x, y, size, size);
  }
}

function drawFlowLineLayer(pg) {
  const mode = random() > 0.5 ? 'subdivision' : 'flowfield';
  debugInfo.layer2Mode = mode;
  if (mode === 'subdivision') {
    drawRecursiveSubdivision(pg);
  } else {
    drawFlowFieldLines(pg); 
  }
}

function drawRecursiveSubdivision(pg) {
  pg.strokeWeight(random(0.5, 8));
  pg.stroke(random(currentPalette));
  subdivide(pg, 0, 0, width, height);
}

function subdivide(pg, x, y, w, h) {
  const minSize = random(20, 60);
  if (w < minSize || h < minSize || random() < random(0.05, 0.25)) {
    pg.noStroke();
    if (random() > 0.3) {
      const c = color(random(currentPalette));
      c.setAlpha(random(150, 255));
      pg.fill(c);
      pg.rect(x, y, w, h);
    } else {
      const c = color(random(currentPalette));
      c.setAlpha(random(150, 255));
      pg.fill(c);
      pg.circle(x + w / 2, y + h / 2, min(w, h));
    }
    return;
  }
  if (w > h) {
    const splitX = x + w * random(0.2, 0.8);
    pg.line(splitX, y, splitX, y + h);
    subdivide(pg, x, y, splitX - x, h);
    subdivide(pg, splitX, y, w - (splitX - x), h);
  } else {
    const splitY = y + h * random(0.2, 0.8);
    pg.line(x, splitY, x + w, splitY);
    subdivide(pg, x, y, w, splitY - y);
    subdivide(pg, x, splitY, w, h - (splitY - y));
  }
}

function drawFlowFieldLines(pg) {
  pg.noFill();
  const steps = int(random(50, 600));
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const c = color(random(currentPalette));
    c.setAlpha(random(80, 150));
    pg.stroke(c);
    pg.strokeWeight(random(0.5, 3));
    pg.beginShape();
    for (let step = 0; step < steps; step++) {
      if (p.pos.x < 0 || p.pos.x > width || p.pos.y < 0 || p.pos.y > height) break;
      pg.vertex(p.pos.x, p.pos.y);
      p.follow(flowfield);
      p.update();
    }
    pg.endShape();
  }
}

function drawNoiseLayer(pg) {
  const mode = random(['stippling', 'halftone', 'scratches']);
  debugInfo.layer3Mode = mode;
  switch (mode) {
    case 'stippling':
      drawDensityStippling(pg);
      break;
    case 'halftone':
      drawHalftone(pg);
      break;
    case 'scratches':
      drawDustAndScratches(pg);
      break;
  }
}

function drawDensityStippling(pg) {
  pg.noStroke();
  const dotCount = int(random(5000, 20000));
  const noiseScale = random(0.002, 0.03);
  for (let i = 0; i < dotCount; i++) {
    const x = random(width);
    const y = random(height);
    const density = noise(x * noiseScale, y * noiseScale);
    if (random() < density) {
      const c = color(random(currentPalette));
      c.setAlpha(random(100, 200) * density);
      pg.fill(c);
      const size = random(1, 5) * density;
      pg.circle(x, y, size);
    }
  }
}

function drawHalftone(pg) {
  pg.noStroke();
  const gridSize = int(random(5, 40));
  const noiseScale = random(0.003, 0.04);
  const maxDotSize = gridSize * 1.5;
  for (let y = 0; y < height; y += gridSize) {
    for (let x = 0; x < width; x += gridSize) {
      const noiseVal = noise(x * noiseScale, y * noiseScale);
      const dotSize = map(noiseVal, 0, 1, 0, maxDotSize);
      const c = color(random(currentPalette));
      c.setAlpha(random(100, 220));
      pg.fill(c);
      pg.circle(x + gridSize / 2, y + gridSize / 2, dotSize);
    }
  }
}

function drawDustAndScratches(pg) {
  pg.noStroke();
  const dotCount = int(random(1000, 5000));
  for (let i = 0; i < dotCount; i++) {
    const c = color(random(currentPalette));
    c.setAlpha(random(50, 150));
    pg.fill(c);
    pg.circle(random(width), random(height), random(1, 4));
  }
  pg.noFill();
  const scratchCount = int(random(10, 40));
  for (let i = 0; i < scratchCount; i++) {
    const c = color(random(currentPalette));
    c.setAlpha(random(20, 100));
    pg.stroke(c);
    pg.strokeWeight(random(0.2, 1.2));
    if (random() > 0.5) {
      const x1 = random(width); const y1 = 0;
      const x2 = random(width); const y2 = height;
      pg.line(x1, y1, x2, y2);
    } else {
      const x1 = 0; const y1 = random(height);
      const x2 = width; const y2 = random(height);
      pg.line(x1, y1, x2, y2);
    }
  }
}

// ---------------------------------------------------
// フローフィールド関連の関数
// ---------------------------------------------------

function updateFlowField(zoff, noiseZoom, angleMultiplier) {
  let yoff = 0;
  for (let y = 0; y < rows; y++) {
    let xoff = 0;
    for (let x = 0; x < cols; x++) {
      let index = x + y * cols;
      let angle = noise(xoff * noiseZoom, yoff * noiseZoom, zoff) * TWO_PI * angleMultiplier;
      let v = p5.Vector.fromAngle(angle);
      v.setMag(1);
      flowfield[index] = v;
      xoff++;
    }
    yoff++;
  }
}

function Particle() {
  this.pos = createVector(random(width), random(height));
  this.vel = createVector(0, 0);
  this.acc = createVector(0, 0);
  this.maxspeed = random(2, 6);
  this.update = function() {
    this.vel.add(this.acc);
    this.vel.limit(this.maxspeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
  }
  this.follow = function(vectors) {
    let x = floor(this.pos.x / scl);
    let y = floor(this.pos.y / scl);
    let index = x + y * cols;
    if (index >= 0 && index < vectors.length) {
      let force = vectors[index];
      if (force) this.applyForce(force);
    }
  }
  this.applyForce = function(force) {
    this.acc.add(force);
  }
}

// ---------------------------------------------------
// デバッグとユーティリティ
// ---------------------------------------------------

function drawDebugInfo() {
  let infoStr = '';
  for (const [key, value] of Object.entries(debugInfo)) {
    infoStr += `${key}: ${value}\n`;
  }

  push(); // Save current drawing style
  noStroke();
  fill(0, 0, 0, 150);
  rect(10, 10, 250, 150); // Background for text
  
  fill(255);
  textSize(12);
  textFont('monospace');
  text(infoStr, 20, 30);
  pop(); // Restore original drawing style
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function mousePressed() {
  if (mouseButton === LEFT) {
    generateArt();
  }
  return false;
}

function touchStarted() {
  generateArt();
  return false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  renderBuffer = createGraphics(width, height);
  finalImage = createGraphics(width, height);
  layer1 = createGraphics(width, height);
  layer2 = createGraphics(width, height);
  layer3 = createGraphics(width, height);
  cols = floor(width / scl);
  rows = floor(height / scl);
  flowfield = new Array(cols * rows);
  generateArt();
}

function keyPressed() {
  if (key === 's' || key === 'S') {
    saveCanvas('my_generative_art', 'png');
  }
  if (key === 'd' || key === 'D') {
    isDebugMode = !isDebugMode;
    // 再描画してデバッグ情報を表示/非表示
    image(finalImage, 0, 0);
    if (isDebugMode) {
      drawDebugInfo();
    }
  }
}

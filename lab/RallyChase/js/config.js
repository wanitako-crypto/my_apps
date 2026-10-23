'use strict';
// 調整パラメータの定義と保存、調整パネル
// 各項目は [初期値, 最小, 最大, 刻み, 表示名]。真偽値は [初期値, 表示名]
// 表示名は「短い名前|説明」の形で書ける(説明はマウスを乗せたときに出る)

const PARAM_SPEC = {
  car: { label: '車', items: {
    accel:                 [900, 100, 3000, 10, '加速'],
    maxSpeed:              [1100, 300, 2500, 10, '最高速'],
    brake:                 [1800, 200, 5000, 10, 'ブレーキ'],
    reverseMax:            [350, 50, 1000, 10, 'バック最高速'],
    steer:                 [3.0, 0.5, 8, 0.05, 'ハンドルの効き'],
    steerFullSpeed:        [260, 20, 1000, 10, '効き切る速度|ハンドルが効き切る速度'],
    steerHighSpeedLoss:    [0.45, 0, 0.9, 0.01, '高速時の効き低下|高速でのハンドルの効きの低下'],
    steerResponse:         [12, 1, 40, 0.5, 'ハンドルの反応'],
    fwdFriction:           [0.15, 0, 3, 0.01, '前後摩擦|アクセルを離して惰性で走るときの減速'],
    sideFriction:          [2.0, 0, 30, 0.1, '横摩擦'],
    gripLimit:             [750, 100, 8000, 10, 'グリップ上限|横グリップの上限'],
    handbrakeSideFriction: [0.35, 0, 10, 0.05, 'SB 横摩擦|サイドブレーキ時の横摩擦'],
    handbrakeGripLimit:    [200, 0, 4000, 10, 'SB グリップ上限|サイドブレーキ時のグリップ上限'],
    handbrakeDrag:         [0.8, 0, 5, 0.05, 'SB 減速|サイドブレーキ時の減速'],
    handbrakeSteerBoost:   [1.6, 1, 3, 0.05, 'SB 回頭倍率|サイドブレーキ時の回頭倍率'],
    slopeSlide:            [1.0, 0, 4, 0.05, '斜面の横滑り|斜面の横滑りの強さ'],
    lowSpeedRange:         [500, 50, 1500, 10, '低速の範囲|この速度より下で、低速時の補正(トルク・グリップ・斜面)が効く。停止時に最大'],
    lowSpeedTorque:        [1.5, 0, 5, 0.05, '低速トルク|停止時に加速を (1+この値) 倍にする。速度が上がると1倍に戻る'],
    lowSpeedGrip:          [3, 0, 10, 0.1, '低速グリップ|停止時に横摩擦を (1+この値) 倍にする(サイドブレーキ中は効かない)'],
    slopeLowSpeed:         [0.3, 0, 1, 0.01, '低速の斜面影響|停止時の斜面の力の倍率(1で補正なし)'],
    gravity:               [1500, 300, 5000, 10, '重力'],
    landBounce:            [0.08, 0, 0.9, 0.01, '着地時の反発|着地時の反発(サスペンションが衝撃を吸うので小さめ)'],
    landGripTime:          [0.25, 0, 1.5, 0.01, '着地後の低下時間|着地直後にグリップが下がる時間(秒)'],
    landGripMul:           [0.4, 0, 1, 0.01, '着地後のグリップ|着地直後のグリップ倍率'],
    maxClimbRatio:         [0.8, 0.1, 3, 0.05, '段差の跳ね上限|段差で跳ね上がる速さの上限(水平速度比)'],
    bounceObstacle:        [0.35, 0, 1, 0.01, '障害物の反発|障害物に当たったときの反発'],
  }},
  break: { label: '破壊', items: {
    breakSpeedRatio: [0.6, 0, 1.2, 0.01, '壊せる速度|壊せる速度(最高速比)'],
    breakSlow:       [0.12, 0, 0.8, 0.01, '壊した時の減速|壊したときの減速量'],
  }},
  terrain: { label: '地形', items: {
    amount:    [1.0, 0, 3, 0.05, '起伏の量'],
    hillFreq:   [0.4, 0, 1, 0.01, '丘の広さ|丘の出現頻度(丘が占める範囲の広さ)'],
    hillHeight: [150, 0, 600, 5, '丘の高さ'],
    hillSize:   [2400, 600, 8000, 50, '丘の大きさ|丘の大きさ(うねりの幅)'],
    hillEdge:   [0.18, 0.04, 0.5, 0.01, '丘のなだらかさ|丘の斜面のなだらかさ(小さいほど頂上が急になり、投げ出されやすい)'],
    slopeFreq:  [0.35, 0, 1, 0.01, '傾いた丘の頻度|傾いた丘の出現頻度'],
    rampFreq:   [0.25, 0, 1, 0.01, 'ジャンプ台の頻度|ジャンプ台の出現頻度'],
    roll:      [0.3, 0, 2, 0.05, 'なだらかなうねり'],
  }},
  obstacles: { label: '障害物', items: {
    density:        [1.0, 0, 2.5, 0.05, '密度'],
    breakableRatio: [0.6, 0, 1, 0.01, '壊せる比率|壊せるものの比率'],
    solidMin:       [80, 30, 300, 1, '固い物 最小|壊せない障害物の最小サイズ'],
    solidMax:       [200, 30, 400, 1, '固い物 最大|壊せない障害物の最大サイズ'],
    breakMin:       [14, 6, 80, 1, '壊せる物 最小|壊せる障害物の最小サイズ'],
    breakMax:       [40, 6, 120, 1, '壊せる物 最大|壊せる障害物の最大サイズ'],
  }},
  ball: { label: 'ボール', items: {
    speedRatio:    [0.65, 0.2, 1.2, 0.01, '水平速度|水平速度(車の最高速に対する比)'],
    bounceHeight:  [60, 5, 300, 1, 'バウンドの高さ'],
    launchHeight:  [400, 50, 1200, 5, '射出時の高さ'],
    launchDistMin: [200, 50, 5000, 10, '射出距離 最小|獲得時にボールが飛ぶ距離の最小(m)。この範囲からランダムに選ぶ'],
    launchDistMax: [500, 50, 5000, 10, '射出距離 最大|獲得時にボールが飛ぶ距離の最大(m)'],
    gravity:       [1800, 300, 5000, 10, 'ボールの重力'],
    maxTurnDeg:    [10, 0, 45, 0.5, '最大曲がり角|バウンド時の最大曲がり角(度)'],
    turnStrength:  [120, 0, 600, 1, '曲がりの強さ|地形の傾きによる曲がりの強さ'],
    size:          [20, 6, 60, 1, '大きさ|ボールの半径。捕獲判定もこれに合わせて広がる'],
    captureMargin: [20, 0, 120, 1, '捕獲の余裕|車とボールが触れる距離に足す、捕獲判定の余裕'],
    captureHeight: [45, 5, 300, 1, '捕獲の高さ差|捕獲判定の高さの差(ボールの半径を足して判定する)'],
  }},
  camera: { label: 'カメラ', items: {
    lookAhead:    [0.35, 0, 1.5, 0.01, '先読み量(秒)'],
    lookAheadMax: [380, 0, 1000, 5, '先読み上限|先読みの上限(px)'],
    lookSmooth:   [3, 0.2, 20, 0.1, '先読みの滑らかさ|先読みのなめらかさ'],
    follow:       [7, 0.5, 30, 0.1, '追従の速さ'],
    zoomSlow:     [1.0, 0.3, 2, 0.01, 'ズーム(低速)'],
    zoomFast:     [0.7, 0.2, 2, 0.01, 'ズーム(高速)'],
    zoomSmooth:   [2, 0.2, 10, 0.1, 'ズームの滑らかさ|ズームのなめらかさ'],
    shake:        [1, 0, 3, 0.05, '画面揺れの強さ'],
    shakeDecay:   [1.6, 0.2, 6, 0.1, '揺れの収まり|画面揺れの収まる速さ'],
  }},
  ground: { label: '地面の模様', items: {
    detailScale:    [1.3, 0.5, 4, 0.05, '模様の大きさ'],
    detailDensity:  [1.0, 0.2, 3, 0.05, '模様の量'],
    detailContrast: [0.6, 0.1, 3, 0.05, '模様の濃さ'],
  }},
  effects: { label: 'エフェクト', items: {
    speedLines:     [0.8, 0, 2, 0.05, 'ラインの濃さ|スピードラインの濃さ'],
    speedLineStart: [0.45, 0, 1, 0.01, 'ライン開始速度|スピードラインが出る速度(最高速比)'],
    speedLineLen:   [0.09, 0, 0.3, 0.005, 'ラインの長さ|スピードラインの長さ(秒)'],
    speedLineCount: [50, 0, 200, 1, 'ラインの本数|スピードラインの本数'],
    tireMarkSlip:   [160, 0, 800, 5, 'タイヤ痕の条件|タイヤ痕が付く横滑りの速さ'],
    tireMarkLife:   [6, 0.5, 30, 0.5, 'タイヤ痕の寿命|タイヤ痕が消えるまで(秒)'],
    dust:           [1.0, 0, 3, 0.05, '土煙の量'],
    ghost:          [0.5, 0, 1.5, 0.05, '残像の濃さ'],
    ghostStart:     [0.6, 0, 1, 0.01, '残像の開始速度|残像が出る速度(最高速比)'],
    vibration:      [0.6, 0, 3, 0.05, '微振動|高速時の微振動の強さ'],
    vibrationStart: [0.75, 0, 1, 0.01, '微振動の開始速度|微振動が出る速度(最高速比)'],
  }},
  height: { label: '高さ表現', items: {
    camHeight:   [1500, 400, 6000, 10, 'カメラの高さ|真上のカメラの高さ。低いほど遠近感(高い物の大きさ・傾き)が強くなる'],
    shadowShift: [0.7, 0, 2, 0.01, '影のずれ|高さあたりの影のずれ量(高さの見え方の主な手がかり)'],
    airRefFollow: [1.0, 0, 10, 0.1, '空中の起伏追従|空中で見た目の高さが真下の起伏に寄る速さ(0で起伏の影響なし)'],
  }},
  debug: { label: 'デバッグ表示', items: {
    showHitbox:   [false, '当たり判定'],
    showGradient: [false, '勾配ベクトル|地形の勾配ベクトル'],
    showChunks:   [false, 'チャンク境界'],
    showStats:    [false, '数値表示'],
  }},
};

const PARAM_STORAGE_KEY = 'rallyball.params.v1';

// 過去の初期値。保存値がこれと同じなら「いじっていない」とみなし、今の初期値を使う
// (以前は全項目を保存していたため、初期値を変えても反映されなかった)
const PARAM_OLD_DEFAULTS = {
  'car.fwdFriction': [0.35],
  'car.sideFriction': [7],
  'car.gripLimit': [2000],
  'car.handbrakeSideFriction': [1.0],
  'car.handbrakeGripLimit': [600],
  'ball.launchHeight': [300],
  'car.landBounce': [0.25],
  'ball.captureHeight': [50],
  'terrain.hillHeight': [200],
  'terrain.hillEdge': [0.15, 0.22],
  'terrain.hillFreq': [0.3],
  'terrain.slopeFreq': [0.2],
  'terrain.rampFreq': [0.18],
  'ground.detailScale': [1.7],
  'ground.detailDensity': [1.2],
  'ground.detailContrast': [1.5],
};

function makeDefaultParams() {
  const P = {};
  for (const [fk, folder] of Object.entries(PARAM_SPEC)) {
    P[fk] = {};
    for (const [k, def] of Object.entries(folder.items)) P[fk][k] = def[0];
  }
  return P;
}

function loadParams() {
  const P = makeDefaultParams();
  try {
    const saved = JSON.parse(localStorage.getItem(PARAM_STORAGE_KEY) || 'null');
    if (saved) {
      for (const fk of Object.keys(P)) {
        if (!saved[fk]) continue;
        for (const k of Object.keys(P[fk])) {
          const v = saved[fk][k];
          if (typeof v !== typeof P[fk][k]) continue;
          const old = PARAM_OLD_DEFAULTS[fk + '.' + k];
          if (old && old.includes(v)) continue;
          P[fk][k] = v;
        }
      }
    }
  } catch (e) {
    console.warn('保存済みパラメータを読めませんでした', e);
  }
  return P;
}

// 初期値から変えた項目だけを保存する。初期値を見直したとき、いじっていない項目には新しい値が効く
function saveParams(P) {
  const D = makeDefaultParams();
  const diff = {};
  for (const fk of Object.keys(P)) {
    for (const k of Object.keys(P[fk])) {
      if (P[fk][k] === D[fk][k]) continue;
      (diff[fk] = diff[fk] || {})[k] = P[fk][k];
    }
  }
  try { localStorage.setItem(PARAM_STORAGE_KEY, JSON.stringify(diff)); } catch (e) { /* 保存できない環境では無視 */ }
}

function resetParams(P) {
  const D = makeDefaultParams();
  for (const fk of Object.keys(D)) Object.assign(P[fk], D[fk]);
  saveParams(P);
}

// onChange(folderKey) は値が変わったときに呼ばれる(リセット時は 'all')
function buildPanel(P, onChange) {
  if (typeof lil === 'undefined') {
    console.warn('lil-gui を読み込めませんでした(オフライン?)。調整パネルなしで動作します');
    return null;
  }
  const gui = new lil.GUI({ title: '調整パネル(F1 / ` で表示切替)', width: 340 });
  for (const [fk, folder] of Object.entries(PARAM_SPEC)) {
    const f = gui.addFolder(folder.label);
    for (const [k, def] of Object.entries(folder.items)) {
      // 表示名は「短い名前|説明」。説明はマウスを乗せたときに出す(長い名前だとスライダーが狭くなるため)
      const [label, desc] = (typeof def[0] === 'boolean' ? def[1] : def[4]).split('|');
      const ctrl = typeof def[0] === 'boolean'
        ? f.add(P[fk], k).name(label)
        : f.add(P[fk], k, def[1], def[2], def[3]).name(label);
      ctrl.domElement.title = desc || label;
      ctrl.onChange(() => { saveParams(P); if (onChange) onChange(fk); });
    }
    if (fk !== 'car') f.close();
  }
  gui.add({ reset() {
    resetParams(P);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    if (onChange) onChange('all');
  } }, 'reset').name('デフォルトに戻す');
  gui.hide();
  return gui;
}

function togglePanel(gui) {
  if (!gui) return;
  gui.show(gui._hidden);
}

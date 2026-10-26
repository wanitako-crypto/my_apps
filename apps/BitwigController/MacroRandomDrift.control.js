// Macro Random Drift - Bitwig Studio コントローラースクリプト
// 選択中デバイスのマクロ(リモートコントロール)8つを、それぞれ別の揺れ方でランダムに動かす。
//
// 使い方:
//   Studio I/O パネルに出る「開始 / 停止」ボタンをクリック
//   1回目: 揺れ方をランダムに決めて開始（クリック時のつまみ位置が揺れの中心）
//   2回目: 停止して元の位置に戻す
//   3回目: また別の揺れ方を引き直して開始
//   「マクロ1」〜「マクロ8」を「揺らさない」にすると、そのマクロは動かさない（動作中でも切り替え可）
//   揺れ幅は「最小揺れ幅」〜「最大揺れ幅」の範囲で、マクロごとにランダムに決まる
//   「モード」で動き方を選べる（動作中でも切り替え可）
//     ランダム : 「間隔」ごとに新しい値へ移動
//     サイン波 : 「間隔」を1周期とするなめらかな往復（マクロごとに位相をずらす）
//   「手動操作に追従」がオンなら、動作中につまみを手で回したり Macro Gacha で変えたりすると、
//   その位置を新しい揺れの中心にする（オフなら揺れで上書きし続ける）
//
// 動作中は対象デバイスを固定するので、別のデバイスを選んで作業していても揺れ続ける。
// 対象デバイスが削除された、またはリモートコントロールのページが切り替わった場合は自動で停止する。

loadAPI(17);
host.setShouldFailOnDeprecatedUse(true);
host.defineController(
  "Custom",
  "Macro Random Drift",
  "1.5",
  "6f3c2a1e-9b4d-4e8a-b7c2-5d1f0a9e3c47",
  "user"
);
host.defineMidiPorts(0, 0);

var NUM_MACROS = 8;
var TICK_MS = 30;        // 更新間隔（ミリ秒）
var RETRY_MS = 150;      // ページを戻してから値を戻すまでの待ち時間
var POLL_MS = 100;       // 開始時、マクロの準備ができたかを確認する間隔
var WAIT_LIMIT_MS = 2000; // 準備を待つ最大時間
var ECHO_TICKS = 10;     // 自分が送った値の履歴を何回分覚えておくか（外部からの変更の判定用）
var ECHO_TOLERANCE = 0.01;

var cursorTrack, cursorDevice, remotes, statusSetting;
var running = false;
var generation = 0; // 古いループを止めるためのカウンター
var states = [];
var enabled = [];
var startPage = -1;          // 開始時のリモートコントロールのページ
var wasTrackPinned = false;  // 開始前のピン留め状態（停止時に戻す）
var wasDevicePinned = false;

// Studio I/O パネルで変えられる設定
var minDepth = 0.03;  // 最小揺れ幅（0〜1）
var maxDepth = 0.3;   // 最大揺れ幅（0〜1）
var minPeriod = 0.3;  // 値が切り替わる間隔の最短（秒）
var maxPeriod = 4.0;  // 値が切り替わる間隔の最長（秒）
var mode = "ランダム"; // "ランダム" または "サイン波"
var followManual = true;

function init() {
  cursorTrack = host.createCursorTrack("MRD_TRACK", "Cursor Track", 0, 0, true);
  cursorDevice = cursorTrack.createCursorDevice(
    "MRD_DEVICE", "Cursor Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION
  );
  remotes = cursorDevice.createCursorRemoteControlsPage(NUM_MACROS);

  cursorTrack.isPinned().markInterested();
  cursorDevice.isPinned().markInterested();
  cursorDevice.name().markInterested();
  cursorDevice.exists().markInterested();
  remotes.selectedPageIndex().markInterested();

  for (var i = 0; i < NUM_MACROS; i++) {
    var p = remotes.getParameter(i);
    p.markInterested();
    p.value().markInterested();
    p.exists().markInterested();
    p.name().markInterested();
    states.push(null);
    enabled.push(true);
  }

  var doc = host.getDocumentState();

  var toggle = doc.getSignalSetting("開始 / 停止", "Random Drift", "クリック");
  toggle.addSignalObserver(function () {
    if (running) stopDrift("停止（元の位置に戻しました）"); else startDrift();
  });

  var modeSetting = doc.getEnumSetting("モード", "Random Drift", ["ランダム", "サイン波"], "ランダム");
  modeSetting.addValueObserver(function (v) { mode = v; });

  var followSetting = doc.getEnumSetting("手動操作に追従", "Random Drift", ["オン", "オフ"], "オン");
  followSetting.addValueObserver(function (v) { followManual = (v === "オン"); });

  var minDepthSetting = doc.getNumberSetting("最小揺れ幅", "Random Drift", 0, 100, 1, "%", 3);
  minDepthSetting.addRawValueObserver(function (v) { minDepth = v / 100; });

  var depthSetting = doc.getNumberSetting("最大揺れ幅", "Random Drift", 1, 100, 1, "%", 30);
  depthSetting.addRawValueObserver(function (v) { maxDepth = v / 100; });

  var minSetting = doc.getNumberSetting("最短間隔", "Random Drift", 0.05, 20, 0.05, "秒", 0.3);
  minSetting.addRawValueObserver(function (v) { minPeriod = v; });

  var maxSetting = doc.getNumberSetting("最長間隔", "Random Drift", 0.05, 20, 0.05, "秒", 4.0);
  maxSetting.addRawValueObserver(function (v) { maxPeriod = v; });

  // マクロごとの対象オン/オフ（Studio I/O で確実に表示されるようドロップダウン形式にする）
  var CHOICES = ["揺らす", "揺らさない"];
  for (var j = 0; j < NUM_MACROS; j++) {
    (function (idx) {
      var e = doc.getEnumSetting("マクロ" + (idx + 1), "Random Drift", CHOICES, "揺らす");
      e.addValueObserver(function (v) { setEnabled(idx, v === "揺らす"); });
    })(j);
  }

  statusSetting = doc.getStringSetting("状態", "Random Drift", 64, "停止中");

  println("Macro Random Drift ready");
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function clamp01(x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// 1つのマクロ用の揺れ方をランダムに決める
function makeState(i) {
  var p = remotes.getParameter(i);
  if (!p.exists().get()) return null;
  var lo = Math.min(minPeriod, maxPeriod);
  var hi = Math.max(minPeriod, maxPeriod);
  var c = p.value().get();
  return {
    center: c,
    current: c,
    target: c,
    // 最小と最大を逆に設定しても動くよう、小さい方〜大きい方の範囲で決める
    depth: rand(Math.min(minDepth, maxDepth), Math.max(minDepth, maxDepth)),
    periodTicks: Math.max(1, Math.round(rand(lo, hi) * 1000 / TICK_MS)),
    // なめらかさ: 1に近いほどカクッと飛ぶ、小さいほどふわっと移動
    alpha: Math.pow(10, rand(-2, 0)),
    counter: 0,
    // サイン波用: 位相をランダムにずらし、1回の更新で進む量を周期から決める
    phase: rand(0, Math.PI * 2),
    phaseStep: (Math.PI * 2 * TICK_MS) / (rand(lo, hi) * 1000),
    // 自分が最近送った値（Bitwig から返ってくる値と照合して、外部からの変更を見分ける）
    sent: [c]
  };
}

// 動作中にチェックを切り替えたときの処理
function setEnabled(i, on) {
  enabled[i] = on;
  if (!running) return;
  if (on) {
    if (!states[i]) states[i] = makeState(i);
  } else if (states[i]) {
    remotes.getParameter(i).value().set(states[i].center); // 元の位置に戻す
    states[i] = null;
  }
}

// 今のマクロの割り当て状況を1つの文字列にまとめる（前回と同じなら「落ち着いた」とみなす）
function mappingSignature() {
  var parts = [cursorDevice.name().get(), remotes.selectedPageIndex().get()];
  for (var i = 0; i < NUM_MACROS; i++) {
    var p = remotes.getParameter(i);
    parts.push(p.exists().get() ? p.name().get() : "-");
  }
  return parts.join("|");
}

function usableCount() {
  var n = 0;
  for (var i = 0; i < NUM_MACROS; i++) {
    if (enabled[i] && remotes.getParameter(i).exists().get()) n++;
  }
  return n;
}

// マクロの情報が揃い、2回続けて同じ状態になったら開始する（最大 WAIT_LIMIT_MS 待つ）
var waiting = false;
function startDrift() {
  if (waiting) return;
  waiting = true;
  var started = Date.now();
  var lastSig = null;

  var check = function () {
    var ready = cursorDevice.exists().get() && usableCount() > 0;
    var sig = mappingSignature();

    if (ready && sig === lastSig) {
      waiting = false;
      beginDrift();
      return;
    }
    if (Date.now() - started >= WAIT_LIMIT_MS) {
      waiting = false;
      host.showPopupNotification(cursorDevice.exists().get()
        ? "Random Drift: 動かせるマクロがありません（このページのマクロ割り当て・設定を確認）"
        : "Random Drift: デバイスが選択されていません");
      return;
    }
    lastSig = ready ? sig : null;
    host.scheduleTask(check, POLL_MS);
  };

  check();
}

function beginDrift() {
  var count = 0;
  for (var i = 0; i < NUM_MACROS; i++) {
    states[i] = enabled[i] ? makeState(i) : null;
    if (states[i]) count++;
  }
  if (count === 0) {
    host.showPopupNotification("Random Drift: 動かせるマクロがありません（このページのマクロ割り当て・設定を確認）");
    return;
  }

  // 開始前にもともとピン留めしていたかを覚えておき、停止時にその状態へ戻す
  wasTrackPinned = cursorTrack.isPinned().get();
  wasDevicePinned = cursorDevice.isPinned().get();

  // 動作中に別デバイスを選んでも、対象が切り替わらないよう固定する
  cursorTrack.isPinned().set(true);
  cursorDevice.isPinned().set(true);

  startPage = remotes.selectedPageIndex().get();
  running = true;
  generation++;
  var name = cursorDevice.name().get();
  statusSetting.set("動作中: " + name);
  host.showPopupNotification("Random Drift 開始: " + name);
  tick(generation);
}

// Bitwig から返ってきた値が、自分の送った値のどれとも一致しなければ外部からの変更とみなす
function isExternalChange(s, v) {
  for (var k = 0; k < s.sent.length; k++) {
    if (Math.abs(s.sent[k] - v) <= ECHO_TOLERANCE) return false;
  }
  return true;
}

function tick(gen) {
  if (!running || gen !== generation) return;

  // 対象デバイスが消えた
  if (!cursorDevice.exists().get()) {
    stopDrift("対象デバイスが見つからないため停止しました", true);
    return;
  }
  // リモートコントロールのページが切り替わった（このまま書き込むと別のパラメーターを動かしてしまう）
  if (remotes.selectedPageIndex().get() !== startPage) {
    stopDrift("ページが切り替わったため停止しました");
    return;
  }

  for (var i = 0; i < NUM_MACROS; i++) {
    var s = states[i];
    if (!s) continue;
    var p = remotes.getParameter(i);
    if (!p.exists().get()) continue;

    // 手で回された・他のスクリプトで変えられた場合は、その位置を新しい中心にする
    if (followManual) {
      var v = p.value().get();
      if (isExternalChange(s, v)) {
        var offset = v - s.current;
        s.center = clamp01(s.center + offset);
        s.target = clamp01(s.target + offset);
        s.current = v;
        s.sent = [v];
      }
    }

    if (mode === "サイン波") {
      s.phase += s.phaseStep;
      if (s.phase > Math.PI * 2) s.phase -= Math.PI * 2;
      var sineValue = clamp01(s.center + s.depth * Math.sin(s.phase));
      // モード切り替え直後に値が飛ばないよう、少しだけ追従を遅らせる
      s.current += (sineValue - s.current) * 0.5;
      s.counter = 0; // ランダムに戻したとき、すぐ次の値を決める
    } else {
      s.counter--;
      if (s.counter <= 0) {
        s.target = clamp01(s.center + s.depth * (Math.random() * 2 - 1));
        // 間隔にも少し揺らぎを入れて機械的になりすぎないようにする
        s.counter = Math.max(1, Math.round(s.periodTicks * rand(0.7, 1.3)));
      }
      s.current += (s.target - s.current) * s.alpha;
    }

    p.value().set(s.current);
    s.sent.push(s.current);
    if (s.sent.length > ECHO_TICKS) s.sent.shift();
  }

  host.scheduleTask(function () { tick(gen); }, TICK_MS);
}

// skipRestore: デバイスが消えたときなど、元に戻す先がない場合は true
function stopDrift(message, skipRestore) {
  running = false;
  generation++;

  var centers = [];
  for (var i = 0; i < NUM_MACROS; i++) {
    centers.push(states[i] ? states[i].center : null);
    states[i] = null;
  }

  var finish = function () {
    if (!skipRestore) {
      for (var j = 0; j < NUM_MACROS; j++) {
        if (centers[j] !== null) remotes.getParameter(j).value().set(centers[j]);
      }
    }
    // 開始前のピン留め状態に戻す
    cursorDevice.isPinned().set(wasDevicePinned);
    cursorTrack.isPinned().set(wasTrackPinned);
    statusSetting.set("停止中");
    host.showPopupNotification("Random Drift: " + message);
  };

  // ページが切り替わっていたら、元のページに戻してから値を戻す
  if (!skipRestore && startPage >= 0 && remotes.selectedPageIndex().get() !== startPage) {
    remotes.selectedPageIndex().set(startPage);
    host.scheduleTask(finish, RETRY_MS);
  } else {
    finish();
  }
}

function flush() {}

function exit() {
  if (running) stopDrift("停止しました");
}
// Macro Gacha - Bitwig Studio コントローラースクリプト
// 選択中デバイスのマクロ(リモートコントロール)8つを、クリックでランダムな値に変える「音色ガチャ」。
//
// 使い方（すべて Studio I/O パネルから）:
//   「ガチャを回す」 : 対象マクロをランダムな値に変更
//   「最初に戻す」   : このデバイスで最初にガチャを回す前の値に戻す
//   「変化量」       : 100% で完全ランダム、小さくするほど今の値の近くで変わる
//   「移行時間」     : 0秒で即座に切り替え、増やすとその秒数かけてなめらかに移動
//   「マクロ1」〜「マクロ8」: 「固定」にするとそのマクロは変えない
//   別のデバイスを選ぶと「最初」の記録はそのデバイス用に取り直される
//
// 取りこぼし対策:
//   - クリック時にマクロの情報が揃っていなければ、揃って落ち着くまで最大2秒待ってから実行する
//   - 書き込んだ値が反映されていなければ、少し待って送り直す（最大3回）
//   うまくいかなかったときは、各マクロの状態を Control Script Console に出力する

loadAPI(17);
host.setShouldFailOnDeprecatedUse(true);
host.defineController(
  "Custom",
  "Macro Gacha",
  "1.2",
  "a8e41f07-3c5b-4d92-9e16-2b7f8c0d4a53",
  "user"
);
host.defineMidiPorts(0, 0);

var NUM_MACROS = 8;
var TICK_MS = 30;          // なめらか移動の更新間隔（ミリ秒）
var POLL_MS = 100;         // 準備ができたかを確認する間隔
var WAIT_LIMIT_MS = 2000;  // 準備を待つ最大時間
var VERIFY_MS = 250;       // 書き込み後、反映を確認するまでの時間
var VERIFY_RETRIES = 3;    // 送り直す最大回数
var VERIFY_TOLERANCE = 0.02;

var cursorTrack, cursorDevice, remotes;
var enabled = [];
var amount = 1.0;      // 変化量（0〜1）
var transition = 0.0;  // 移行時間（秒）

var originValues = null; // 最初にガチャを回す前の値
var originKey = null;    // その値がどのデバイスのものか
var generation = 0;      // 古い処理を止めるためのカウンター
var waiting = false;     // 準備待ちの間の連打を無視する

function init() {
  cursorTrack = host.createCursorTrack("MG_TRACK", "Cursor Track", 0, 0, true);
  cursorDevice = cursorTrack.createCursorDevice(
    "MG_DEVICE", "Cursor Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION
  );
  remotes = cursorDevice.createCursorRemoteControlsPage(NUM_MACROS);

  // デバイスの見分けに使う情報
  cursorTrack.name().markInterested();
  cursorTrack.position().markInterested();
  cursorDevice.name().markInterested();
  cursorDevice.position().markInterested();
  cursorDevice.exists().markInterested();

  remotes.pageNames().markInterested();
  remotes.selectedPageIndex().markInterested();

  for (var i = 0; i < NUM_MACROS; i++) {
    var p = remotes.getParameter(i);
    p.markInterested();
    p.value().markInterested();
    p.exists().markInterested();
    p.name().markInterested();
    enabled.push(true);
  }

  var doc = host.getDocumentState();

  doc.getSignalSetting("ガチャを回す", "Macro Gacha", "クリック")
    .addSignalObserver(function () { whenReady(doGacha); });

  doc.getSignalSetting("最初に戻す", "Macro Gacha", "クリック")
    .addSignalObserver(function () { whenReady(doRestore); });

  doc.getNumberSetting("変化量", "Macro Gacha", 1, 100, 1, "%", 100)
    .addRawValueObserver(function (v) { amount = v / 100; });

  doc.getNumberSetting("移行時間", "Macro Gacha", 0, 5, 0.1, "秒", 0)
    .addRawValueObserver(function (v) { transition = v; });

  var CHOICES = ["変える", "固定"];
  for (var j = 0; j < NUM_MACROS; j++) {
    (function (idx) {
      doc.getEnumSetting("マクロ" + (idx + 1), "Macro Gacha", CHOICES, "変える")
        .addValueObserver(function (v) { enabled[idx] = (v === "変える"); });
    })(j);
  }

  println("Macro Gacha ready");
}

function clamp01(x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// トラックとデバイスの位置・名前の組み合わせで「どのデバイスか」を判定する
function deviceKey() {
  return cursorTrack.position().get() + "|" + cursorTrack.name().get() + "|" +
         cursorDevice.position().get() + "|" + cursorDevice.name().get();
}

// 今のマクロの割り当て状況を1つの文字列にまとめる（前回と同じなら「落ち着いた」とみなす）
function mappingSignature() {
  var parts = [deviceKey(), remotes.selectedPageIndex().get()];
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

// マクロの情報が揃い、2回続けて同じ状態になったら action を実行する
function whenReady(action) {
  if (waiting) return;
  waiting = true;
  var started = Date.now();
  var lastSig = null;

  var check = function () {
    var ready = cursorDevice.exists().get() && usableCount() > 0;
    var sig = mappingSignature();

    if (ready && sig === lastSig) {
      waiting = false;
      action();
      return;
    }
    if (Date.now() - started >= WAIT_LIMIT_MS) {
      waiting = false;
      if (!cursorDevice.exists().get()) {
        host.showPopupNotification("Macro Gacha: デバイスが選択されていません");
      } else {
        logState("準備待ちタイムアウト");
        host.showPopupNotification("Macro Gacha: 変えられるマクロが見つかりません（このページの割り当てを確認）");
      }
      return;
    }
    lastSig = ready ? sig : null;
    host.scheduleTask(check, POLL_MS);
  };

  check();
}

// 今の8つの値を配列で取る（存在しないマクロは null）
function readValues() {
  var vals = [];
  for (var i = 0; i < NUM_MACROS; i++) {
    var p = remotes.getParameter(i);
    vals.push(p.exists().get() ? p.value().get() : null);
  }
  return vals;
}

// 調査用ログ: Control Script Console に各マクロの状態を出す
function logState(label) {
  var pages = remotes.pageNames().get();
  var pageIdx = remotes.selectedPageIndex().get();
  println("---- " + label + " ----");
  println("デバイス: " + cursorDevice.name().get() +
          " (トラック " + cursorTrack.name().get() + ")" +
          " / ページ " + pageIdx + ": " + (pages[pageIdx] || "(なし)") +
          " / 全" + pages.length + "ページ");
  for (var i = 0; i < NUM_MACROS; i++) {
    var p = remotes.getParameter(i);
    println("  マクロ" + (i + 1) +
            " 名前=" + (p.name().get() || "(空)") +
            " 存在=" + p.exists().get() +
            " 値=" + p.value().get().toFixed(3) +
            " 設定=" + (enabled[i] ? "変える" : "固定"));
  }
}

function doGacha() {
  var current = readValues();
  var targets = [];

  for (var i = 0; i < NUM_MACROS; i++) {
    if (current[i] === null || !enabled[i]) {
      targets.push(null);
      continue;
    }
    // 変化量100%なら完全ランダム、小さいほど今の値に寄せる
    var r = Math.random();
    targets.push(clamp01(current[i] + (r - current[i]) * amount));
  }

  // 別のデバイスなら「最初」の記録を取り直す
  var key = deviceKey();
  if (key !== originKey) {
    originValues = current.slice();
    originKey = key;
  }

  moveTo(targets);
}

function doRestore() {
  if (!originValues || originKey !== deviceKey()) {
    host.showPopupNotification("Macro Gacha: このデバイスではまだガチャを回していません");
    return;
  }
  moveTo(originValues);
  host.showPopupNotification("最初の音色に戻しました");
}

function setTargets(targets) {
  for (var i = 0; i < NUM_MACROS; i++) {
    if (targets[i] !== null && targets[i] !== undefined) {
      remotes.getParameter(i).value().set(targets[i]);
    }
  }
}

// targets[i] が null のマクロは動かさない
function moveTo(targets) {
  generation++;
  var gen = generation;
  var key = deviceKey();

  if (transition <= 0) {
    setTargets(targets);
    scheduleVerify(gen, key, targets, 1);
    return;
  }

  var from = readValues();
  var totalTicks = Math.max(1, Math.round(transition * 1000 / TICK_MS));
  step(gen, key, 1, totalTicks, from, targets);
}

function step(gen, key, k, totalTicks, from, targets) {
  if (gen !== generation) return;  // 新しい操作が来たら古い移動は打ち切り
  if (key !== deviceKey()) return; // 別デバイスに切り替わったら打ち切り

  var t = k / totalTicks;
  var eased = t * t * (3 - 2 * t); // 始めと終わりをゆっくりにする

  for (var i = 0; i < NUM_MACROS; i++) {
    if (targets[i] === null || targets[i] === undefined || from[i] === null) continue;
    remotes.getParameter(i).value().set(from[i] + (targets[i] - from[i]) * eased);
  }

  if (k >= totalTicks) {
    scheduleVerify(gen, key, targets, 1);
    return;
  }
  host.scheduleTask(function () { step(gen, key, k + 1, totalTicks, from, targets); }, TICK_MS);
}

// 書き込んだ値が反映されているか確かめ、ずれているマクロだけ送り直す
function scheduleVerify(gen, key, targets, attempt) {
  host.scheduleTask(function () {
    if (gen !== generation || key !== deviceKey()) return;

    var missed = [];
    for (var i = 0; i < NUM_MACROS; i++) {
      if (targets[i] === null || targets[i] === undefined) continue;
      var p = remotes.getParameter(i);
      if (!p.exists().get() || Math.abs(p.value().get() - targets[i]) > VERIFY_TOLERANCE) {
        missed.push(i);
      }
    }
    if (missed.length === 0) return;

    if (attempt > VERIFY_RETRIES) {
      logState("反映されなかったマクロあり: " + missed.map(function (m) { return m + 1; }).join(","));
      return;
    }
    for (var j = 0; j < missed.length; j++) {
      var idx = missed[j];
      var q = remotes.getParameter(idx);
      if (q.exists().get()) q.value().set(targets[idx]);
    }
    scheduleVerify(gen, key, targets, attempt + 1);
  }, VERIFY_MS);
}

function flush() {}

function exit() {
  generation++;
}
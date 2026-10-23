'use strict';
// キーボード入力

const input = { up: false, down: false, left: false, right: false, handbrake: false };

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'handbrake',
};

function initInput(onAction) {
  window.addEventListener('keydown', e => {
    // 調整パネルの入力欄に打っているときはゲーム操作にしない
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = KEYMAP[e.code];
    if (k) { input[k] = true; e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'KeyR') onAction('restart');
    // JIS配列では ` が別のキー位置になるので e.key でも判定する
    if (e.code === 'F1' || e.code === 'Backquote' || e.key === '`') {
      e.preventDefault();
      onAction('panel');
    }
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.code];
    if (k) input[k] = false;
  });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(input)) input[k] = false;
  });
}

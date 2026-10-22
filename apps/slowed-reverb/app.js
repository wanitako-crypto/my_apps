// --- グローバル変数定義 --- //

// DOM要素
const dropZone = document.getElementById('drop-zone');

// Web Audio APIのコアとなるオブジェクト
let audioCtx; // オーディオコンテキスト
let source;   // 現在の音声ソース
let audioBuffer; // デコード済みの音声データ。シーク（再生位置変更）のために保持する

// エフェクトチェーンを構成するオーディオノード
let reverbNode;     // リバーブ（残響）エフェクト
let masterGain;     // 全体の音量を制御するマスターゲイン
let wetGain;        // エフェクト音（ウェット信号）の音量
let dryGain;        // 原音（ドライ信号）の音量
let lowpassFilter;  // ローパスフィルター（高音域をカット）
let highpassFilter; // ハイパスフィルター（低音域をカット）

// 再生位置と時間に関する変数
let startTime = 0;      // 再生開始時の時刻（コンテキスト内時間）
let startOffset = 0;    // 再生開始位置（秒）
let animationFrameId; // シークバー更新のためのアニメーションフレームID

// 定数
const minFreq = 20;    // フィルター周波数の最小値 (人間の可聴域下限)
const maxFreq = 20000; // フィルター周波数の最大値 (人間の可聴域上限)


/**
 * スライダーの直線的な値（0-1000）を、対数スケールの周波数（20-20000Hz）に変換する。
 * 人間の聴覚は音の高さを対数的に知覚するため、この変換によりスライダー操作がより直感的になる。
 * @param {number} position - スライダーの現在の値 (0-1000)
 * @param {number} min - 変換後の最小周波数
 * @param {number} max - 変換後の最大周波数
 * @returns {number} 対数スケールに変換された周波数
 */
function logSlider(position, min, max) {
  const minp = 0;      // スライダーの最小値
  const maxp = 1000;   // スライダーの最大値

  // 対数スケールでの計算準備
  const minv = Math.log(min);
  const maxv = Math.log(max);

  // スライダーの位置に合わせて、対数スケール上の値を計算
  const scale = (maxv - minv) / (maxp - minp);

  return Math.exp(minv + scale * (position - minp));
}

// --- イベントリスナー設定 --- //

// ファイルがドロップゾーンにドラッグされたときの視覚的フィードバック
dropZone.addEventListener('dragover', e => {
  e.preventDefault(); // デフォルトの動作（ファイルを開くなど）を無効化
  dropZone.classList.add('hover');
});
dropZone.addEventListener('dragleave', e => {
  e.preventDefault();
  dropZone.classList.remove('hover');
});

// ファイルがドロップされたときの処理
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('hover');
  const file = e.dataTransfer.files[0]; // ドロップされたファイルを取得
  if (file) {
    loadAudio(file); // 音声ファイルを読み込んで再生準備
  }
});

// 各種コントロールスライダーのイベントリスナー
document.getElementById('rate').addEventListener('input', e => {
  const rate = parseFloat(e.target.value);
  if (source) {
    source.playbackRate.value = rate; // 再生速度（ピッチ）を変更
  }
  document.getElementById('rateValue').textContent = rate.toFixed(2);
});

document.getElementById('reverbAmt').addEventListener('input', e => {
  if (wetGain && dryGain) {
    const mix = parseFloat(e.target.value);
    wetGain.gain.value = mix;         // エフェクト音の大きさ
    dryGain.gain.value = 1.0 - mix;   // 原音の大きさ
    document.getElementById('reverbValue').textContent = mix.toFixed(2);
  }
});

document.getElementById('playbackSeek').addEventListener('input', e => {
  if (audioBuffer) {
    if (source) { // 再生中の場合のみシークする
      const seekTime = parseFloat(e.target.value) * audioBuffer.duration;
      play(seekTime); // 新しい位置から再生を開始
    }
  }
});

document.getElementById('reverbDuration').addEventListener('input', e => {
    document.getElementById('durationValue').textContent = parseFloat(e.target.value).toFixed(1);
    updateReverbEffect(); // リバーブのパラメーターを更新
});

document.getElementById('reverbDecay').addEventListener('input', e => {
    document.getElementById('decayValue').textContent = parseFloat(e.target.value).toFixed(1);
    updateReverbEffect(); // リバーブのパラメーターを更新
});

document.getElementById('volume').addEventListener('input', e => {
    const volume = parseFloat(e.target.value);
    if (masterGain) {
        masterGain.gain.value = volume; // マスターボリュームを更新
    }
    document.getElementById('volumeValue').textContent = volume.toFixed(2);
});

document.getElementById('lowpassFreq').addEventListener('input', e => {
  const freq = logSlider(parseFloat(e.target.value), minFreq, maxFreq);
  if (lowpassFilter) {
    lowpassFilter.frequency.value = freq; // ローパスフィルターの周波数を更新
  }
  document.getElementById('lowpassValue').textContent = Math.round(freq);
});

document.getElementById('highpassFreq').addEventListener('input', e => {
  const freq = logSlider(parseFloat(e.target.value), minFreq, maxFreq);
  if (highpassFilter) {
    highpassFilter.frequency.value = freq; // ハイパスフィルターの周波数を更新
  }
  document.getElementById('highpassValue').textContent = Math.round(freq);
});

document.getElementById('lowpassQ').addEventListener('input', e => {
  const q = parseFloat(e.target.value);
  if (lowpassFilter) {
    lowpassFilter.Q.value = q; // ローパスフィルターのQ値（レゾナンス）を更新
  }
  document.getElementById('lowpassQValue').textContent = q.toFixed(1);
});

document.getElementById('highpassQ').addEventListener('input', e => {
  const q = parseFloat(e.target.value);
  if (highpassFilter) {
    highpassFilter.Q.value = q; // ハイパスフィルターのQ値（レゾナンス）を更新
  }
  document.getElementById('highpassQValue').textContent = q.toFixed(1);
});

document.getElementById('stopBtn').addEventListener('click', () => {
  if (source) {
    source.stop(); // 再生を停止
    source = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId); // シークバーの更新を停止
    animationFrameId = null;
  }
});

// --- Web Audio API メイン処理 --- //

/**
 * ファイルを読み込み、デコードして再生を開始する
 * @param {File} file - ユーザーがドロップした音声ファイル
 */
async function loadAudio(file) {
  // 初めてファイルを読み込む場合は、AudioContextを初期化する
  if (!audioCtx) {
    initAudio();
  }
  // 現在再生中の音声を停止
  document.getElementById('stopBtn').click();

  dropZone.textContent = "Loading...";
  // ファイルをArrayBufferとして読み込み
  const arrayBuffer = await file.arrayBuffer();
  // ArrayBufferをAudioBufferにデコード（Web Audio APIで扱える形式に変換）
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  document.getElementById('playbackSeek').value = 0;
  play(0); // デコードが完了したら、先頭から再生を開始
}

/**
 * Web Audio APIの初期設定。AudioContextの作成、各ノードの生成と接続を行う。
 */
function initAudio() {
  // AudioContextを作成。ブラウザ間の互換性を考慮
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  // --- オーディオノードの作成 ---
  // ローパスフィルター
  lowpassFilter = audioCtx.createBiquadFilter();
  lowpassFilter.type = 'lowpass'; // タイプを設定
  lowpassFilter.Q.value = document.getElementById('lowpassQ').value; // Q値を初期化
  lowpassFilter.frequency.value = logSlider(document.getElementById('lowpassFreq').value, minFreq, maxFreq); // 周波数を初期化

  // ハイパスフィルター
  highpassFilter = audioCtx.createBiquadFilter();
  highpassFilter.type = 'highpass';
  highpassFilter.Q.value = document.getElementById('highpassQ').value;
  highpassFilter.frequency.value = logSlider(document.getElementById('highpassFreq').value, minFreq, maxFreq);

  // リバーブ (ConvolverNode)
  reverbNode = audioCtx.createConvolver();
  updateReverbEffect(); // 初期設定でインパルスレスポンスを生成

  // ゲイン（音量）ノード
  dryGain = audioCtx.createGain(); // 原音用
  wetGain = audioCtx.createGain(); // エフェクト音用
  masterGain = audioCtx.createGain(); // 全体用

  // --- オーディオグラフの接続 ---
  // ここでは各ノード間の基本的な接続のみを行う。
  // source（音源）は再生のたびに作成され、このグラフに接続される。
  //
  // [Source] -> [Filters] -> [Dry/Wet Gains] -> [Master Gain] -> [Destination(Speaker)]
  //
  // リバーブ(Wet)側の接続
  reverbNode.connect(wetGain);
  wetGain.connect(masterGain);
  // 原音(Dry)側の接続
  dryGain.connect(masterGain);
  // マスターゲインから最終出力へ
  masterGain.connect(audioCtx.destination);

  // --- UIの初期値設定 ---
  // 各スライダーの初期値をオーディオノードと表示に反映させる
  const initialVolume = parseFloat(document.getElementById('volume').value);
  if (masterGain) masterGain.gain.value = initialVolume;

  const initialMix = parseFloat(document.getElementById('reverbAmt').value);
  wetGain.gain.value = initialMix;
  dryGain.gain.value = 1.0 - initialMix;

  // 各スライダーの隣にある値の表示を更新
  document.getElementById('rateValue').textContent = parseFloat(document.getElementById('rate').value).toFixed(2);
  document.getElementById('reverbValue').textContent = initialMix.toFixed(2);
  document.getElementById('durationValue').textContent = parseFloat(document.getElementById('reverbDuration').value).toFixed(1);
  document.getElementById('decayValue').textContent = parseFloat(document.getElementById('reverbDecay').value).toFixed(1);
  document.getElementById('volumeValue').textContent = initialVolume.toFixed(2);
  document.getElementById('lowpassValue').textContent = Math.round(logSlider(document.getElementById('lowpassFreq').value, minFreq, maxFreq));
  document.getElementById('lowpassQValue').textContent = parseFloat(document.getElementById('lowpassQ').value).toFixed(1);
  document.getElementById('highpassValue').textContent = Math.round(logSlider(document.getElementById('highpassFreq').value, minFreq, maxFreq));
  document.getElementById('highpassQValue').textContent = parseFloat(document.getElementById('highpassQ').value).toFixed(1);
}

/**
 * リバーブエフェクト（インパルスレスポンス）を現在のスライダー値に基づいて再生成する。
 */
function updateReverbEffect() {
    if (!reverbNode) return;
    const duration = parseFloat(document.getElementById('reverbDuration').value);
    const decay = parseFloat(document.getElementById('reverbDecay').value);
    // 新しいパラメーターでインパルスレスポンスを生成し、ConvolverNodeに設定する
    reverbNode.buffer = createImpulseResponse(duration, decay);
}

/**
 * 音声の再生処理。指定されたオフセットから再生を開始する。
 * @param {number} offset - 再生を開始する位置（秒）
 */
function play(offset) {
  // 既に再生中のソースがあれば停止する
  if (source) {
    source.onended = null; // onendedイベントが意図せず発火するのを防ぐ
    source.stop();
  }
  // シークバーの更新アニメーションも停止
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  // 新しい音源（AudioBufferSourceNode）を作成
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer; // デコード済みの音声データを設定
  
  // 現在の再生速度を設定
  source.playbackRate.value = document.getElementById('rate').value;

  // --- 再生時のオーディオグラフ接続 ---
  // 音源をフィルターチェーンに接続し、そこからDry/Wetの分岐に接続する
  source.connect(lowpassFilter);
  lowpassFilter.connect(highpassFilter);
  highpassFilter.connect(dryGain);    // フィルター後の音をDry（原音）パスへ
  highpassFilter.connect(reverbNode); // フィルター後の音をWet（リバーブ）パスへ
  
  // 再生開始時間とオフセットを記録
  startOffset = offset;
  startTime = audioCtx.currentTime;
  
  // 指定されたオフセットから再生を開始
  source.start(0, startOffset);
  dropZone.textContent = `Playing...`;
  
  // 再生が自然に終了したときの処理
  source.onended = () => {
      // seekやstopではなく、最後まで再生しきった場合
      if (document.getElementById('playbackSeek').value > 0.99) {
          document.getElementById('stopBtn').click();
          dropZone.textContent = "Finished. Drop a new file.";
          document.getElementById('playbackSeek').value = 1;
      }
  };

  // シークバーの更新を開始
  updateSeekSlider();
}

/**
 * 再生位置に合わせてシークバーのスライダーを更新する
 */
function updateSeekSlider() {
  if (!source || !audioBuffer) return;

  // 経過時間を計算（再生速度を考慮に入れる）
  const elapsed = audioCtx.currentTime - startTime;
  let currentPos = startOffset + (elapsed * source.playbackRate.value);
  
  // 再生位置がバッファの長さを超えないように調整
  currentPos = Math.min(currentPos, audioBuffer.duration);
  // スライダーの位置を更新 (0.0 - 1.0の範囲)
  document.getElementById('playbackSeek').value = currentPos / audioBuffer.duration;

  // 再生中であれば、次のフレームで再度この関数を呼び出す
  if (currentPos < audioBuffer.duration) {
    animationFrameId = requestAnimationFrame(updateSeekSlider);
  }
}


/**
 * リバーブ用のインパルスレスポンスを動的に生成する。
 * ここでは、減衰するノイズを生成することで簡易的なリバーブをシミュレートしている。
 * @param {number} duration - リバーブの長さ（秒）
 * @param {number} decay - 減衰率
 * @returns {AudioBuffer} 生成されたインパルスレスポンス
 */
function createImpulseResponse(duration, decay) {
  const rate = audioCtx.sampleRate;
  const length = rate * duration;
  const impulse = audioCtx.createBuffer(2, length, rate); // ステレオ（2チャンネル）のバッファを作成
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    // 時間の経過とともに指数関数的に減衰するランダムなノイズを生成
    const n = i / length;
    left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
    right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
  }
  return impulse;
}
